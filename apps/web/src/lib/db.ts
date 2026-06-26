import "server-only";

import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { getTableColumns, is, sql } from "drizzle-orm";
import { PgEnumColumn, type PgTable } from "drizzle-orm/pg-core";
// Reutilizamos el schema existente de packages/db (NO se redefine ni se modifica).
import * as schema from "@cqms/db/src/schema";

const resourceArn = process.env.DB_CLUSTER_ARN;
const secretArn = process.env.DB_SECRET_ARN;
const database = process.env.DB_NAME;

if (!resourceArn || !secretArn || !database) {
  throw new Error(
    "Faltan DB_CLUSTER_ARN, DB_SECRET_ARN o DB_NAME en el entorno. " +
      "Se cargan desde el .env de la raíz del monorepo (ver next.config.mjs).",
  );
}

// El RDSDataClient toma las credenciales AWS de la cadena por defecto
// (perfil/SSO/variables AWS_*). La región viene del .env.
const rdsClient = new RDSDataClient({ region: process.env.AWS_REGION });

/**
 * Cliente Drizzle sobre Aurora vía RDS Data API (RDS Data API).
 *
 * Regla del proyecto: por defecto SOLO LECTURA (`db.select(...)`).
 *
 * Excepción controlada (Etapa 3 — gestión de Proyectos ISO X): se permite
 * INSERT/SELECT únicamente sobre las tablas `organizations` y `projects`.
 * NUNCA ejecutar DROP / ALTER / migraciones ni tocar otras tablas con DML.
 */
export const db = drizzle(rdsClient, { resourceArn, secretArn, database, schema });

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
