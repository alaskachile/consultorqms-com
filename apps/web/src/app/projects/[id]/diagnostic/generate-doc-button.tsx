"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateDocument, type GenerateDocumentResult } from "../documents/actions";

/**
 * Botón "Generar documento con IA" para una cláusula en estado `gap` o `partial`.
 *
 * Al abrirse muestra un textarea con el contexto de la empresa (precargado con lo
 * que se haya escrito en el panel de diagnóstico, si está disponible) y dispara el
 * agente de documentación. Al terminar, ofrece el link al documento generado.
 */
export function GenerateDocButton({
  projectId,
  requirementId,
  defaultContext = "",
}: {
  projectId: string;
  requirementId: string;
  defaultContext?: string;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(defaultContext);
  const [result, setResult] = useState<GenerateDocumentResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleGenerate() {
    setResult(null);
    startTransition(async () => {
      const res = await generateDocument(projectId, requirementId, context);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={outlineBtn}>
        Generar documento con IA
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: "0.75rem",
        padding: "0.85rem 1rem",
        background: "#101a2e",
        border: "1px solid #24406e",
        borderRadius: 8,
      }}
    >
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.5 }}>
        El agente redacta un borrador del documento sugerido para esta cláusula, adaptado a la
        empresa. Contá a qué se dedica, su tamaño y qué documentación tiene hoy.
      </p>
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        disabled={pending}
        rows={4}
        placeholder="Ej.: PyME metalmecánica de 45 personas en Santiago, con procedimientos de producción escritos…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0.6rem 0.75rem",
          background: "#0f1729",
          border: "1px solid #283655",
          borderRadius: 8,
          color: "#e7ecf3",
          fontSize: "0.9rem",
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginTop: "0.6rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={pending || context.trim() === ""}
          style={{
            padding: "0.5rem 1rem",
            background: pending || context.trim() === "" ? "#25406e" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: pending || context.trim() === "" ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Generando…" : "Generar borrador"}
        </button>
        {!pending && (
          <button type="button" onClick={() => setOpen(false)} style={ghostBtn}>
            Cancelar
          </button>
        )}
        {result?.ok && (
          <span style={{ color: "#4ade80", fontSize: "0.85rem" }}>
            ✓ Documento creado ·{" "}
            <a
              href={`/projects/${projectId}/documents/${result.documentId}`}
              style={{ color: "#7cc4ff" }}
            >
              Ver documento
            </a>
          </span>
        )}
        {result && !result.ok && (
          <span style={{ color: "#f87171", fontSize: "0.85rem" }}>✗ {result.error}</span>
        )}
      </div>
    </div>
  );
}

const outlineBtn = {
  padding: "0.45rem 0.9rem",
  background: "transparent",
  color: "#7cc4ff",
  border: "1px solid #2f5599",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
} as const;

const ghostBtn = {
  padding: "0.5rem 0.85rem",
  background: "transparent",
  color: "#94a3b8",
  border: "1px solid #334155",
  borderRadius: 8,
  fontWeight: 500,
  cursor: "pointer",
} as const;
