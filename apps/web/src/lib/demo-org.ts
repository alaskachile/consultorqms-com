import "server-only";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * ⚠️ TEMPORAL — andamiaje hasta integrar Cognito (Etapa 2).
 *
 * Todavía no hay auth, así que no podemos derivar el `org_id` del token como
 * exige CLAUDE.md. Mientras tanto, todo el flujo de Proyectos ISO X opera sobre
 * una única organización demo fija. En cuanto exista Cognito, este helper se
 * borra y el `org_id` pasa a venir del token.
 */
const DEMO_ORG_NAME = "Demo Org";

/**
 * Devuelve el id de la organización demo. La busca por nombre y, si no existe,
 * la inserta una sola vez (INSERT acotado a `organizations`, permitido en Etapa 3).
 */
export async function getDemoOrgId(): Promise<string> {
  const [existing] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.name, DEMO_ORG_NAME))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(schema.organizations)
    .values({ name: DEMO_ORG_NAME, country: "CL" })
    .returning({ id: schema.organizations.id });

  if (!created) throw new Error("No se pudo crear la organización demo.");
  return created.id;
}
