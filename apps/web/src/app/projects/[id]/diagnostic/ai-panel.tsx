"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runDiagnosticAgent, type DiagnosticAgentActionResult } from "./actions";

/**
 * Sección "Diagnóstico asistido por IA": textarea para el contexto de la empresa
 * + botón que dispara el agente. Al completar, refresca la lista de cláusulas
 * (que ya muestra las sugerencias con su nota de IA). El usuario puede seguir
 * corrigiendo cada cláusula a mano.
 */
export function AiDiagnosticPanel({ projectId }: { projectId: string }) {
  const [context, setContext] = useState("");
  const [result, setResult] = useState<DiagnosticAgentActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleRun() {
    setResult(null);
    startTransition(async () => {
      const res = await runDiagnosticAgent(projectId, context);
      setResult(res);
      // La acción ya revalidó; refrescamos el server component para ver las sugerencias.
      if (res.ok) router.refresh();
    });
  }

  return (
    <section
      style={{
        padding: "1.25rem 1.5rem",
        background: "#101a2e",
        border: "1px solid #24406e",
        borderRadius: 10,
        margin: "0 0 2rem",
      }}
    >
      <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem" }}>Diagnóstico asistido por IA</h2>
      <p style={{ opacity: 0.7, margin: "0 0 0.9rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
        Contá a qué se dedica la empresa, su tamaño, qué procesos y documentación tiene hoy. El
        agente evalúa cada cláusula y precarga una sugerencia. Las cláusulas que ya respondiste a
        mano no se tocan.
      </p>

      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        disabled={pending}
        rows={6}
        placeholder="Ej.: Somos una PyME metalmecánica de 45 personas en Santiago. Tenemos procedimientos de producción escritos pero sin control de versiones formal…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0.7rem 0.85rem",
          background: "#0f1729",
          border: "1px solid #283655",
          borderRadius: 8,
          color: "#e7ecf3",
          fontSize: "0.95rem",
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "0.85rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleRun}
          disabled={pending || context.trim() === ""}
          style={{
            padding: "0.6rem 1.15rem",
            background: pending || context.trim() === "" ? "#25406e" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: pending || context.trim() === "" ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Generando…" : "Generar diagnóstico con IA"}
        </button>

        {result?.ok && (
          <span style={{ color: "#4ade80", fontSize: "0.9rem" }}>
            ✓ {result.applied} cláusulas sugeridas · {result.skipped} respetadas ·{" "}
            <span style={{ opacity: 0.7 }}>{result.modelId}</span>
          </span>
        )}
        {result && !result.ok && (
          <span style={{ color: "#f87171", fontSize: "0.9rem" }}>✗ {result.error}</span>
        )}
      </div>
    </section>
  );
}
