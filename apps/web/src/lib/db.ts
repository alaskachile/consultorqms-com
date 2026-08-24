import "server-only";

import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { getTableColumns, is, sql } from "drizzle-orm";
import { PgEnumColumn, type PgTable } from "drizzle-orm/pg-core";
// Reutilizamos el schema existente de packages/db (NO se redefine ni se modifica).
import * as schema from "@cqms/db/src/schema";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Se carga desde el .env de la raíz del monorepo (ver next.config.mjs).`,
    );
  }
  return value;
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Cliente Drizzle sobre Aurora vía RDS Data API, cacheado a nivel módulo.
 *
 * Lectura perezosa del entorno: si falta una variable, falla al usarse y no al
 * importarse (mismo criterio que `lib/auth.ts` y `lib/s3.ts`; si no, `next build`
 * revienta al pre-renderizar cualquier página que toque este módulo).
 *
 * Regla del proyecto: por defecto SOLO LECTURA (`db.select(...)`).
 *
 * Excepciones controladas:
 *  - Etapa 3 (gestión de Proyectos ISO X): INSERT/SELECT sobre `organizations`
 *    y `projects`.
 *  - Etapa 6 (Diagnóstico / GAP): INSERT/UPDATE/SELECT sobre `diagnostics` y
 *    UPDATE de `readiness_pct` en `projects` (recálculo de preparación).
 *  - Bloque 1.1 (Evidencia en S3): INSERT/SELECT/DELETE sobre `evidence`. El
 *    DELETE es la única excepción de borrado del proyecto: el usuario puede
 *    quitar un archivo que subió por error.
 * NUNCA ejecutar DROP / ALTER / migraciones ni tocar otras tablas con DML.
 */
let cachedDb: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (cachedDb) return cachedDb;
  const resourceArn = required("DB_CLUSTER_ARN");
  const secretArn = required("DB_SECRET_ARN");
  const database = required("DB_NAME");
  // El RDSDataClient toma las credenciales AWS de la cadena por defecto
  // (perfil/SSO/variables AWS_*). La región viene del .env.
  const rdsClient = new RDSDataClient({ region: process.env.AWS_REGION });
  cachedDb = drizzle(rdsClient, { resourceArn, secretArn, database, schema });
  return cachedDb;
}

/**
 * Proxy sobre el cliente real: mantiene la API pública (`db.select(...)`, etc.)
 * sin construir el cliente al importar el módulo. Cada acceso a una propiedad
 * dispara `getDb()`, que solo construye el cliente la primera vez.
 */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const client = getDb();
    const value = client[prop as keyof DrizzleDb];
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as DrizzleDb;

export { schema };

/**
 * Castea los valores de columnas enum a su tipo Postgres antes de un INSERT/UPDATE.
 *
 * El driver RDS Data API manda los enums como texto plano y Postgres NO castea
 * `text -> enum` de forma implícita (error 42804: "column ... is of type X but
 * expression is of type text"). En vez de acordarse columna por columna, pasá el
 * objeto de `.values()` por acá: cualquier columna enum de la tabla (status,
 * priority, verdict, ...) sale con su `::tipo` correcto automáticamente.
 *
 * @example db.insert(schema.projects).values(withEnumCasts(schema.projects, { ... }))
 */
export function withEnumCasts<T extends Record<string, unknown>>(table: PgTable, values: T): T {
  const columns = getTableColumns(table);
  const out: Record<string, unknown> = { ...values };
  for (const [key, value] of Object.entries(out)) {
    const col = columns[key];
    // Solo casteamos strings sobre columnas enum reales; el resto queda intacto.
    if (typeof value === "string" && is(col, PgEnumColumn)) {
      out[key] = sql`${value}::${sql.raw(col.getSQLType())}`;
    }
  }
  return out as T;
}
