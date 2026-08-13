/**
 * Bloque 1.1 — reglas de archivo para la evidencia.
 *
 * Este módulo lo comparten el server (validación real, la que manda) y el
 * componente cliente (el `accept` del input y un aviso temprano de tamaño). Por
 * eso NO lleva `server-only`.
 *
 * Regla: lo que valida el cliente es cortesía; lo que decide es el server. Toda
 * función de acá se vuelve a correr en la Server Action antes de firmar nada.
 */

/** Tope de tamaño: 25 MB. */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

/**
 * Extensiones permitidas y su Content-Type canónico.
 *
 * El Content-Type se deriva de la extensión y NUNCA del `file.type` que manda el
 * navegador: así el tipo que se firma en la presigned URL es determinístico y el
 * cliente no puede inyectar uno arbitrario.
 */
export const EVIDENCE_CONTENT_TYPES: Record<string, string> = {
  // Documentos
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Texto
  txt: "text/plain",
  csv: "text/csv",
  // Imágenes (fotos de registros, capturas de pantalla)
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** Valor para el `accept` del `<input type="file">`. */
export const EVIDENCE_ACCEPT = Object.keys(EVIDENCE_CONTENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/** Descripción corta de lo permitido, para mostrarle al usuario. */
export const EVIDENCE_RULES_LABEL = "PDF, Word, Excel, texto o imagen · máx. 25 MB";

/** Largo máximo del nombre saneado (la clave S3 completa aguanta 1024 bytes). */
const MAX_FILENAME_LENGTH = 120;

/** Extensión en minúsculas, sin punto. Cadena vacía si no tiene. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Sanea el nombre de archivo para usarlo dentro de una clave S3.
 *
 * - Descarta cualquier ruta (`../`, `C:\...`, `/etc/...`): solo queda el nombre.
 * - Deja únicamente `[A-Za-z0-9._-]`; el resto (espacios, acentos, `%`, `#`,
 *   emojis) pasa a `_`. Evita sorpresas con el encoding de la clave y con los
 *   headers de la descarga.
 * - Recorta el largo conservando la extensión.
 *
 * Es idempotente: `sanitizeFilename(sanitizeFilename(x)) === sanitizeFilename(x)`.
 * De eso depende `confirmUpload` para poder re-derivar el nombre desde la clave.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";

  const cleaned = base
    .normalize("NFKD")
    // Saca los diacríticos que dejó la descomposición (café -> cafe).
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    // Colapsa separadores repetidos y saca los de los bordes.
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");

  if (!cleaned) return "";

  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;

  const ext = extensionOf(cleaned);
  if (!ext) return cleaned.slice(0, MAX_FILENAME_LENGTH);

  const stem = cleaned.slice(0, cleaned.length - ext.length - 1);
  return `${stem.slice(0, Math.max(1, MAX_FILENAME_LENGTH - ext.length - 1))}.${ext}`;
}

export type EvidenceFileCheck =
  | { ok: true; filename: string; contentType: string }
  | { ok: false; error: string };

/**
 * Valida nombre + tamaño y devuelve el nombre saneado y el Content-Type que hay
 * que firmar. La corre el server antes de emitir la presigned URL; el cliente la
 * usa para avisar antes de gastar el viaje.
 */
export function checkEvidenceFile(rawFilename: string, size: number): EvidenceFileCheck {
  const filename = sanitizeFilename(rawFilename ?? "");
  if (!filename) return { ok: false, error: "El nombre del archivo no es válido." };

  const ext = extensionOf(filename);
  const contentType = ext ? EVIDENCE_CONTENT_TYPES[ext] : undefined;
  if (!contentType) {
    return {
      ok: false,
      error: `Tipo de archivo no permitido${ext ? ` (.${ext})` : ""}. Se aceptan ${EVIDENCE_RULES_LABEL}.`,
    };
  }

  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, error: "El archivo está vacío o su tamaño no es válido." };
  }
  if (size > MAX_EVIDENCE_BYTES) {
    return { ok: false, error: `El archivo supera el máximo de ${formatBytes(MAX_EVIDENCE_BYTES)}.` };
  }

  return { ok: true, filename, contentType };
}

/** Tamaño legible: 1.4 MB, 812 kB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
