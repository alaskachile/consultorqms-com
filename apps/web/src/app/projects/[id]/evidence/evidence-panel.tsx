"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  confirmUpload,
  deleteEvidence,
  getEvidenceDownloadUrl,
  requestUpload,
} from "./actions";
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_RULES_LABEL,
  checkEvidenceFile,
} from "@/lib/evidence-files";

export type EvidenceItem = {
  id: string;
  filename: string;
  /** Ya formateada en el server (la Data API devuelve la fecha como texto). */
  uploadedAt: string;
};

/**
 * Panel de evidencia de UNA cláusula: subir, listar, descargar y borrar.
 *
 * La subida va directa del navegador a S3:
 *   `requestUpload` (Server Action) → PUT a la presigned URL → `confirmUpload`.
 * El archivo nunca pasa por el server de Next. Si el PUT falla, no se llama a
 * `confirmUpload` y no queda ningún registro huérfano.
 *
 * El listado que se ve acá viene de la tabla `evidence` (lo arma el Server
 * Component), nunca de un `ListObjects` contra el bucket.
 */
export function EvidencePanel({
  projectId,
  requirementId,
  items,
}: {
  projectId: string;
  requirementId: string;
  items: EvidenceItem[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const uploading = progress !== null;

  async function handleFile(file: File) {
    setError(null);

    // Aviso temprano: la validación que manda es la del server, que se vuelve a
    // correr en `requestUpload` antes de firmar nada.
    const local = checkEvidenceFile(file.name, file.size);
    if (!local.ok) {
      setError(local.error);
      return;
    }

    setProgress(0);
    try {
      const signed = await requestUpload(projectId, requirementId, file.name, file.size);
      if (!signed.ok) throw new Error(signed.error);

      await putToS3(signed.uploadUrl, file, signed.contentType, setProgress);

      const confirmed = await confirmUpload(projectId, requirementId, signed.s3Key);
      if (!confirmed.ok) throw new Error(confirmed.error);

      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  async function handleDownload(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await getEvidenceDownloadUrl(id);
      if (!res.ok) throw new Error(res.error);
      // La URL trae Content-Disposition: attachment, así que el navegador baja
      // el archivo sin abandonar la página.
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(id: string, filename: string) {
    if (!window.confirm(`¿Borrar "${filename}"? No se puede deshacer.`)) return;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await deleteEvidence(id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      style={{
        marginTop: "0.75rem",
        paddingTop: "0.75rem",
        borderTop: "1px solid #1f2a44",
      }}
    >
      <div style={{ fontSize: "0.8rem", fontWeight: 600, opacity: 0.7, marginBottom: "0.5rem" }}>
        Evidencia {items.length > 0 && <span style={{ opacity: 0.7 }}>({items.length})</span>}
      </div>

      {items.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.6rem", display: "grid", gap: "0.35rem" }}>
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                flexWrap: "wrap",
                padding: "0.4rem 0.6rem",
                background: "#0f1729",
                border: "1px solid #24304d",
                borderRadius: 8,
                fontSize: "0.83rem",
              }}
            >
              <span style={{ flex: 1, minWidth: 160, wordBreak: "break-all" }}>{item.filename}</span>
              <span style={{ opacity: 0.5, whiteSpace: "nowrap" }}>{item.uploadedAt}</span>
              <button
                type="button"
                onClick={() => handleDownload(item.id)}
                disabled={busyId === item.id || pending}
                style={linkBtn}
              >
                Descargar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item.id, item.filename)}
                disabled={busyId === item.id || pending}
                style={{ ...linkBtn, color: "#f87171" }}
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          type="file"
          accept={EVIDENCE_ACCEPT}
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          style={{ fontSize: "0.82rem", color: "#94a3b8", maxWidth: "100%" }}
        />
        {uploading ? (
          <span style={{ fontSize: "0.8rem", color: "#7cc4ff" }}>Subiendo… {progress}%</span>
        ) : (
          <span style={{ fontSize: "0.75rem", opacity: 0.45 }}>{EVIDENCE_RULES_LABEL}</span>
        )}
      </div>

      {error && (
        <div style={{ marginTop: "0.5rem", color: "#f87171", fontSize: "0.8rem" }}>✗ {error}</div>
      )}
    </div>
  );
}

/**
 * PUT del archivo a la presigned URL.
 *
 * Va con XMLHttpRequest y no con `fetch` sólo por el progreso de subida
 * (`fetch` no lo expone). El `Content-Type` es el que derivó el server desde la
 * extensión: no está firmado, pero es el que queda guardado en el objeto.
 */
function putToS3(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 rechazó la subida (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(new Error("No se pudo subir a S3. Revisá el CORS del bucket para este origen."));
    xhr.onabort = () => reject(new Error("Subida cancelada."));

    xhr.send(file);
  });
}

const linkBtn = {
  padding: 0,
  background: "transparent",
  border: "none",
  color: "#7cc4ff",
  fontSize: "0.8rem",
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;
