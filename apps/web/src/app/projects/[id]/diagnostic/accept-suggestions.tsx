"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptAiSuggestions, type AcceptSuggestionsResult } from "./actions";

/**
 * Banner de "sugerencias de IA pendientes de aceptar". Solo se renderiza cuando
 * hay al menos una cláusula sugerida por IA sin confirmar (`pendingCount > 0`).
 *
 * Al aceptar, las sugerencias pendientes pasan a contar para el readiness_pct.
 * El usuario puede seguir corrigiendo cláusula por cláusula con el form de cada
 * cláusula, antes o después de aceptar en masa.
 */
export function AcceptSuggestions({
  projectId,
  pendingCount,
}: {
  projectId: string;
  pendingCount: number;
}) {
  const [result, setResult] = useState<AcceptSuggestionsResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (pendingCount <= 0) return null;

  function handleAccept() {
    setResult(null);
    startTransition(async () => {
      const res = await acceptAiSuggestions(projectId);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "0.85rem 1.15rem",
        background: "#2a2411",
        border: "1px solid #6b5a1e",
        borderRadius: 10,
        margin: "0 0 1.5rem",
      }}
    >
      <span style={{ fontSize: "0.9rem", lineHeight: 1.5, flex: 1, minWidth: 220 }}>
        <strong style={{ color: "#fcd34d" }}>{pendingCount}</strong> cláusula
        {pendingCount === 1 ? "" : "s"} sugerida{pendingCount === 1 ? "" : "s"} por IA sin aceptar.
        <span style={{ opacity: 0.75 }}>
          {" "}
          No cuentan para el % hasta que las aceptes o las corrijas a mano.
        </span>
      </span>

      <button
        type="button"
        onClick={handleAccept}
        disabled={pending}
        style={{
          padding: "0.55rem 1.1rem",
          background: pending ? "#7c6a1e" : "#ca8a04",
          color: "#1a1400",
          border: "none",
          borderRadius: 8,
          fontWeight: 700,
          cursor: pending ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {pending ? "Aceptando…" : "Aceptar sugerencias de la IA"}
      </button>

      {result?.ok && (
        <span style={{ color: "#4ade80", fontSize: "0.85rem", width: "100%" }}>
          ✓ {result.accepted} sugerencia{result.accepted === 1 ? "" : "s"} aceptada
          {result.accepted === 1 ? "" : "s"}.
        </span>
      )}
      {result && !result.ok && (
        <span style={{ color: "#f87171", fontSize: "0.85rem", width: "100%" }}>✗ {result.error}</span>
      )}
    </div>
  );
}
