import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Bloque 1.1 — acceso a S3 para la evidencia.
 *
 * Arquitectura (decidida, no negociable acá):
 *  - La subida va DIRECTA del navegador a S3 con una presigned URL. El archivo
 *    NUNCA pasa por el server de Next (Vercel tiene límite de body y cobra
 *    tránsito; además así no hay que bufferear 25 MB en una Server Action).
 *  - El bucket es privado. La descarga también es con presigned URL, de 5 min.
 *  - El listado sale SIEMPRE de la tabla `evidence`, nunca de `s3:ListBucket`:
 *    el usuario de producción no tiene ese permiso a propósito, así que un
 *    `ListObjects` no es una alternativa, es un error.
 *
 * Permisos IAM que necesita la app sobre `arn:aws:s3:::<bucket>/*`:
 * `s3:PutObject`, `s3:GetObject` (también lo usa HeadObject) y `s3:DeleteObject`.
 */

type S3Env = {
  bucket: string;
  region: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Se carga desde el .env de la raíz del monorepo (ver next.config.mjs).`,
    );
  }
  return value;
}

/**
 * Lectura perezosa del entorno: si falta una variable, falla al usarse y no al
 * importarse (mismo criterio que `lib/auth.ts`; si no, `next build` revienta al
 * pre-renderizar cualquier página que toque este módulo).
 */
let cachedEnv: S3Env | null = null;

function getS3Env(): S3Env {
  if (cachedEnv) return cachedEnv;
  cachedEnv = {
    bucket: required("S3_EVIDENCE_BUCKET"),
    region: required("AWS_REGION"),
  };
  return cachedEnv;
}

/** Nombre del bucket de evidencia (para mensajes de error y chequeos). */
export function getEvidenceBucket(): string {
  return getS3Env().bucket;
}

/**
 * Cliente S3 cacheado a nivel módulo. Toma las credenciales de la cadena por
 * defecto (perfil/SSO/variables AWS_*), igual que el RDSDataClient de `db.ts`.
 *
 * `requestChecksumCalculation: "WHEN_REQUIRED"` es obligatorio acá: desde
 * v3.729 el SDK agrega por defecto un checksum (`x-amz-checksum-crc32`) a los
 * PutObject, y en una URL prefirmada ese header queda FIRMADO — el navegador no
 * lo manda y S3 responde 403. Con WHEN_REQUIRED solo se agrega cuando la
 * operación lo exige (no es el caso de PutObject).
 */
let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: getS3Env().region,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return cachedClient;
}

/** Duración de las URLs prefirmadas, en segundos. Cortas a propósito. */
const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Arma la clave S3 de una evidencia: `{org_id}/{project_id}/{requirement_id}/{uuid}-{filename}`.
 *
 * El prefijo por `org_id` es lo que permite acotar el acceso por tenant a nivel
 * IAM/bucket policy el día que haga falta. El `org_id` que entra acá sale
 * SIEMPRE de `getOrgId()`, nunca de datos del cliente.
 */
export function buildEvidenceKey(parts: {
  orgId: string;
  projectId: string;
  requirementId: string;
  uuid: string;
  filename: string;
}): string {
  return `${parts.orgId}/${parts.projectId}/${parts.requirementId}/${parts.uuid}-${parts.filename}`;
}

/**
 * URL prefirmada para que el navegador haga `PUT` del archivo directo a S3.
 *
 * `contentLength` va FIRMADO (`SignedHeaders=content-length;host`): el PUT tiene
 * que traer exactamente ese tamaño o S3 lo rechaza. Es lo que impide que una URL
 * emitida para un PDF de 2 MB se use para subir otra cosa de 2 GB.
 *
 * `contentType` NO se firma: `s3-request-presigner` lo excluye a propósito
 * (`unsignableHeaders`), porque el navegador puede reescribirlo y rompería la
 * firma. Sirve igual — el objeto queda guardado con ese tipo — pero no es una
 * garantía: un cliente podría subir otro tipo bajo esa misma clave. Por eso la
 * descarga fuerza `attachment` (ver `getDownloadUrl`) en vez de confiar en él.
 *
 * Requiere que el CORS del bucket permita `PUT` desde el origen de la app.
 */
export async function getUploadUrl(input: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getS3Env().bucket,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  });

  return getSignedUrl(getClient(), command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

/**
 * URL prefirmada de descarga (5 min). El bucket es privado: este es el único
 * camino para que el usuario baje su evidencia.
 *
 * `ResponseContentDisposition` hace que el navegador descargue el archivo con su
 * nombre original en vez de renderizarlo inline (importante con HTML/SVG: evita
 * ejecutar contenido subido bajo el dominio de S3).
 */
export async function getDownloadUrl(input: { key: string; filename: string }): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getS3Env().bucket,
    Key: input.key,
    // El filename ya viene saneado (solo A-Za-z0-9._-), así que entrecomillarlo
    // es seguro: no puede romper el header.
    ResponseContentDisposition: `attachment; filename="${input.filename}"`,
  });

  return getSignedUrl(getClient(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

/**
 * Metadatos del objeto, o `null` si no existe.
 *
 * Es el chequeo del segundo paso (`confirmUpload`): confirma que la subida
 * realmente ocurrió antes de escribir la fila en `evidence`.
 */
export async function headObject(key: string): Promise<{ contentLength: number } | null> {
  try {
    const out = await getClient().send(
      new HeadObjectCommand({ Bucket: getS3Env().bucket, Key: key }),
    );
    return { contentLength: out.ContentLength ?? 0 };
  } catch (err) {
    // NotFound (404) o NoSuchKey: la subida no llegó a completarse.
    const name = (err as { name?: string })?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) return null;
    throw err;
  }
}

/** Borra el objeto. S3 no falla si la clave ya no existe (DELETE es idempotente). */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: getS3Env().bucket, Key: key }));
}
