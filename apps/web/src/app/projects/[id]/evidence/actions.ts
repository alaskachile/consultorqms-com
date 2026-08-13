"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema, withEnumCasts } from "@/lib/db";
import { getOrgId, getUserId } from "@/lib/org";
import { isRedirectError } from "@/lib/auth";
import {
  buildEvidenceKey,
  deleteObject,
  getDownloadUrl,
  getUploadUrl,
  headObject,
} from "@/lib/s3";
import { MAX_EVIDENCE_BYTES, checkEvidenceFile, sanitizeFilename } from "@/lib/evidence-files";

/**
 * Bloque 1.1 — evidencia por cláusula.
 *
 * Flujo de subida en DOS PASOS, a propósito:
 *
 *   1. `requestUpload`  → valida todo y devuelve una presigned URL de PUT.
 *   2. el navegador     → PUT directo a S3 (el archivo no pasa por Vercel).
 *   3. `confirmUpload`  → verifica con HeadObject que el objeto exista y recién
 *                         ahí escribe la fila en `evidence`.
 *
 * Si la subida falla (red, tab cerrada, URL vencida) no queda ningún registro
 * huérfano: en el peor caso queda un objeto en S3 que nadie referencia, que es
 * invisible y barato, y no una fila que promete evidencia inexistente.
 *
 * Reglas de CLAUDE.md respetadas:
 *  - Multi-tenant: el `org_id` sale SIEMPRE de `getOrgId()`. El cliente manda
 *    `projectId`/`requirementId`/`s3Key`, y los tres se re-validan contra la org
 *    de la sesión antes de firmar o escribir nada.
 *  - DML acotado: INSERT/DELETE sobre `evidence` solamente.
 *  - Enums casteados con `withEnumCasts` (la Data API manda texto plano).
 */

/** UUID v4 tal como lo genera `randomUUID()`, para re-parsear la clave S3. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Proyecto de la sesión + cláusula válida para ese proyecto.
 *
 * Es el guardián de todo el módulo: si el proyecto no es de esta org, o el
 * requisito no pertenece a la norma del proyecto, no hay firma ni escritura.
 */
async function assertProjectAndClause(projectId: string, requirementId: string) {
  const orgId = await getOrgId();

  const [project] = await db
    .select({ id: schema.projects.id, standardId: schema.projects.standardId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)))
    .limit(1);
  if (!project) throw new Error("Proyecto no encontrado.");

  const [clause] = await db
    .select({ id: schema.requirements.id })
    .from(schema.requirements)
    .where(
      and(
        eq(schema.requirements.id, requirementId),
        eq(schema.requirements.standardId, project.standardId),
      ),
    )
    .limit(1);
  if (!clause) throw new Error("El requisito no pertenece a la norma del proyecto.");

  return { orgId, projectId: project.id, requirementId: clause.id };
}

/** Refresca las vistas donde se ve la evidencia de un proyecto. */
function revalidateProject(projectId: string): void {
  revalidatePath(`/projects/${projectId}/diagnostic`);
  revalidatePath(`/projects/${projectId}`);
}

// ───────────────────────────── 1) pedir la URL de subida ─────────────────────

export type RequestUploadResult =
  | { ok: true; uploadUrl: string; s3Key: string; filename: string; contentType: string }
  | { ok: false; error: string };

/**
 * Paso 1: valida y devuelve la presigned URL de PUT (5 min).
 *
 * El `contentType` NO se toma del navegador: se deriva de la extensión saneada.
 * Se firma junto con el tamaño exacto, así que la URL emitida sirve para ESE
 * archivo y para ningún otro.
 */
export async function requestUpload(
  projectId: string,
  requirementId: string,
  rawFilename: string,
  size: number,
): Promise<RequestUploadResult> {
  try {
    if (!projectId?.trim()) throw new Error("Falta el proyecto.");
    if (!requirementId?.trim()) throw new Error("Falta el requisito.");

    const scope = await assertProjectAndClause(projectId.trim(), requirementId.trim());

    const check = checkEvidenceFile(rawFilename ?? "", size);
    if (!check.ok) throw new Error(check.error);

    const s3Key = buildEvidenceKey({
      orgId: scope.orgId,
      projectId: scope.projectId,
      requirementId: scope.requirementId,
      uuid: randomUUID(),
      filename: check.filename,
    });

    const uploadUrl = await getUploadUrl({
      key: s3Key,
      contentType: check.contentType,
      contentLength: size,
    });

    return {
      ok: true,
      uploadUrl,
      s3Key,
      filename: check.filename,
      contentType: check.contentType,
    };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ───────────────────────────── 2) confirmar la subida ────────────────────────

export type ConfirmUploadResult = { ok: true; evidenceId: string } | { ok: false; error: string };

/**
 * Paso 2: confirma que el objeto llegó a S3 y registra la evidencia.
 *
 * La clave vuelve del cliente, así que se desarma y se verifica entera contra el
 * scope de la sesión: prefijo `{org}/{project}/{requirement}/`, UUID con forma
 * de UUID y nombre ya saneado. Una clave de otra organización (o inventada) no
 * pasa de acá. El `filename` no se recibe: se re-deriva de la clave.
 */
export async function confirmUpload(
  projectId: string,
  requirementId: string,
  s3Key: string,
): Promise<ConfirmUploadResult> {
  try {
    if (!projectId?.trim()) throw new Error("Falta el proyecto.");
    if (!requirementId?.trim()) throw new Error("Falta el requisito.");
    if (!s3Key?.trim()) throw new Error("Falta la clave del archivo.");

    const scope = await assertProjectAndClause(projectId.trim(), requirementId.trim());

    const prefix = `${scope.orgId}/${scope.projectId}/${scope.requirementId}/`;
    const key = s3Key.trim();
    if (!key.startsWith(prefix)) throw new Error("La clave del archivo no corresponde a esta cláusula.");

    const tail = key.slice(prefix.length);
    const uuid = tail.slice(0, 36);
    const filename = tail.slice(37);
    if (!UUID_RE.test(uuid) || tail[36] !== "-" || !filename) {
      throw new Error("La clave del archivo no tiene el formato esperado.");
    }
    // El nombre tiene que ser exactamente el que habría producido `requestUpload`.
    if (filename !== sanitizeFilename(filename)) {
      throw new Error("El nombre del archivo no es válido.");
    }

    // La subida realmente ocurrió (y con el tamaño esperado). Sin esto, un
    // cliente podría registrar evidencia que no existe en el bucket.
    const head = await headObject(key);
    if (!head) throw new Error("La subida no se completó. Probá de nuevo.");
    if (head.contentLength > MAX_EVIDENCE_BYTES) {
      // Cinturón y tiradores: el PUT ya iba firmado con el tamaño exacto.
      await deleteObject(key).catch(() => {});
      throw new Error("El archivo supera el máximo permitido.");
    }

    const uploadedBy = await getUserId();

    const [row] = await db
      .insert(schema.evidence)
      .values(
        withEnumCasts(schema.evidence, {
          orgId: scope.orgId,
          projectId: scope.projectId,
          requirementId: scope.requirementId,
          s3Key: key,
          filename,
          uploadedBy,
        }),
      )
      .returning({ id: schema.evidence.id });
    if (!row) throw new Error("No se pudo registrar la evidencia.");

    revalidateProject(scope.projectId);

    return { ok: true, evidenceId: row.id };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ───────────────────────────── descarga ──────────────────────────────────────

export type DownloadUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * URL de descarga de 5 min para una evidencia de ESTA organización.
 *
 * El bucket es privado: no hay URL pública que filtrar. La fila se busca por
 * `id` + `org_id` de la sesión, así que un id de otro tenant simplemente no
 * existe desde acá.
 */
export async function getEvidenceDownloadUrl(evidenceId: string): Promise<DownloadUrlResult> {
  try {
    if (!evidenceId?.trim()) throw new Error("Falta la evidencia.");

    const orgId = await getOrgId();

    const [row] = await db
      .select({ s3Key: schema.evidence.s3Key, filename: schema.evidence.filename })
      .from(schema.evidence)
      .where(and(eq(schema.evidence.id, evidenceId.trim()), eq(schema.evidence.orgId, orgId)))
      .limit(1);
    if (!row) throw new Error("Evidencia no encontrada.");

    const url = await getDownloadUrl({ key: row.s3Key, filename: row.filename });
    return { ok: true, url };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ───────────────────────────── borrado ───────────────────────────────────────

export type DeleteEvidenceResult = { ok: true } | { ok: false; error: string };

/**
 * Borra la evidencia: primero la fila, después el objeto.
 *
 * El orden importa. El listado sale de la tabla, así que borrar primero la fila
 * deja, en el peor caso, un objeto huérfano en S3 (invisible y barato). Al
 * revés, un fallo al borrar la fila dejaría una evidencia listada que no se
 * puede descargar — mucho peor para una auditoría.
 */
export async function deleteEvidence(evidenceId: string): Promise<DeleteEvidenceResult> {
  try {
    if (!evidenceId?.trim()) throw new Error("Falta la evidencia.");

    const orgId = await getOrgId();

    const [row] = await db
      .select({
        id: schema.evidence.id,
        s3Key: schema.evidence.s3Key,
        projectId: schema.evidence.projectId,
      })
      .from(schema.evidence)
      .where(and(eq(schema.evidence.id, evidenceId.trim()), eq(schema.evidence.orgId, orgId)))
      .limit(1);
    if (!row) throw new Error("Evidencia no encontrada.");

    await db
      .delete(schema.evidence)
      .where(and(eq(schema.evidence.id, row.id), eq(schema.evidence.orgId, orgId)));

    // Best-effort: si S3 falla, la evidencia ya desapareció de la app.
    try {
      await deleteObject(row.s3Key);
    } catch (err) {
      console.error("No se pudo borrar el objeto de S3 (queda huérfano):", row.s3Key, err);
    }

    revalidateProject(row.projectId);

    return { ok: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
