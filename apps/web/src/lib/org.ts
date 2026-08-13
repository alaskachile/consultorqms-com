import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema, withEnumCasts } from "@/lib/db";
import { requireSession, type Session } from "@/lib/auth";

/**
 * Etapa 2 — Paso B: la organización real del usuario logueado.
 *
 * Modelo actual: **UNA organización por usuario**. El que se registra crea su
 * org y queda como `admin`. Invitaciones y multi-usuario vienen después; hasta
 * entonces `users.cognito_sub` es único y apunta a una sola `org_id`.
 *
 * Regla de oro de CLAUDE.md: el `org_id` sale SIEMPRE de la sesión (el `sub` del
 * id_token verificado), nunca de `params`, `body`, props ni de ningún dato que
 * mande el cliente.
 */

/** Busca la org del usuario por su `sub` de Cognito. `null` si todavía no existe. */
async function findOrgIdBySub(sub: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: schema.users.orgId })
    .from(schema.users)
    .where(eq(schema.users.cognitoSub, sub))
    .limit(1);

  return row?.orgId ?? null;
}

/**
 * Señal interna: otro request concurrente ya aprovisionó este `sub`. No es un
 * fallo — sirve para abortar la transacción (drizzle hace ROLLBACK ante
 * cualquier throw) y que el llamador relea la org ganadora.
 */
class AlreadyProvisionedError extends Error {}

/**
 * Aprovisiona `organizations` + `users` en UNA transacción.
 *
 * Idempotencia bajo concurrencia: el `INSERT` en `users` va con
 * `ON CONFLICT (cognito_sub) DO NOTHING` contra la constraint única real de la
 * tabla (`users_cognito_sub_key`). Si dos requests del mismo `sub` entran a la
 * vez, el segundo no inserta nada y devolvemos `null`; el rollback descarta
 * además la organización que ese request alcanzó a insertar, así que nunca
 * quedan dos orgs (ni una org huérfana) para el mismo usuario.
 *
 * @returns el `org_id` recién creado, o `null` si perdió la carrera.
 */
async function provisionOrg(session: Session): Promise<string | null> {
  try {
    return await db.transaction(async (tx) => {
      // El nombre inicial de la org es el email; después se edita desde la app.
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: session.email })
        .returning({ id: schema.organizations.id });

      if (!org) throw new Error("No se pudo crear la organización.");

      // `role` es enum: la Data API manda texto plano y Postgres no castea
      // text -> enum solo (ver withEnumCasts en lib/db.ts).
      const [user] = await tx
        .insert(schema.users)
        .values(
          withEnumCasts(schema.users, {
            orgId: org.id,
            cognitoSub: session.sub,
            email: session.email,
            role: "admin",
          }),
        )
        .onConflictDoNothing({ target: schema.users.cognitoSub })
        .returning({ orgId: schema.users.orgId });

      // Sin fila = otro request ya creó este usuario. Abortamos: el ROLLBACK
      // descarta la org de esta transacción y el llamador relee la que ganó.
      if (!user) throw new AlreadyProvisionedError();

      return user.orgId;
    });
  } catch (err) {
    if (err instanceof AlreadyProvisionedError) return null;
    throw err;
  }
}

/**
 * Devuelve el `org_id` del usuario de la sesión, creando su organización la
 * primera vez que entra.
 *
 * Exige sesión válida: si no hay, `requireSession()` redirige a `/login`.
 *
 * Memoizado por request con `cache()` de React: una misma página que lo llama
 * varias veces (layout + page + acciones) hace un solo SELECT.
 */
export const getOrgId = cache(async (): Promise<string> => {
  const session = await requireSession();

  const existing = await findOrgIdBySub(session.sub);
  if (existing) return existing;

  const created = await provisionOrg(session);
  if (created) return created;

  // Perdimos la carrera contra un request concurrente: releemos la org ganadora.
  const winner = await findOrgIdBySub(session.sub);
  if (!winner) throw new Error("No se pudo aprovisionar la organización del usuario.");

  return winner;
});

/**
 * `users.id` del usuario logueado (el de la tabla, no el `sub` de Cognito).
 *
 * Sirve para las columnas de autoría (`evidence.uploaded_by`,
 * `document_versions.created_by`, …). Llama primero a `getOrgId()` para
 * garantizar que el usuario ya esté aprovisionado.
 *
 * Devuelve `null` en vez de tirar: la autoría es un dato de auditoría deseable,
 * pero no es motivo para abortar una operación del usuario.
 *
 * Memoizado por request, igual que `getOrgId()`.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  await getOrgId();
  const session = await requireSession();

  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.cognitoSub, session.sub))
    .limit(1);

  return row?.id ?? null;
});
