import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getDemoOrgId } from "@/lib/demo-org";
import { saveDiagnostic } from "./actions";
import { AiDiagnosticPanel } from "./ai-panel";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: "compliant", label: "Cumple" },
  { value: "partial", label: "Parcial" },
  { value: "gap", label: "Gap" },
  { value: "not_applicable", label: "No aplica" },
] as const;

const STATUS_META: Record<string, { label: string; color: string }> = {
  compliant: { label: "Cumple", color: "#22c55e" },
  partial: { label: "Parcial", color: "#eab308" },
  gap: { label: "Gap", color: "#ef4444" },
  not_applicable: { label: "No aplica", color: "#64748b" },
};

export default async function DiagnosticPage({ params }: { params: { id: string } }) {
  const orgId = await getDemoOrgId();

  // SOLO LECTURA, scoped por org (multi-tenant): proyecto + su norma.
  const [project] = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      standardId: schema.projects.standardId,
      readinessPct: schema.projects.readinessPct,
      standardName: schema.standards.name,
      standardVersion: schema.standards.version,
    })
    .from(schema.projects)
    .innerJoin(schema.standards, eq(schema.projects.standardId, schema.standards.id))
    .where(and(eq(schema.projects.id, params.id), eq(schema.projects.orgId, orgId)))
    .limit(1);

  if (!project) notFound();

  // Las cláusulas de la norma + el estado de diagnóstico de ESTE proyecto (si ya
  // se evaluó). LEFT JOIN acotado a este project_id + org para no traer el
  // diagnóstico de otro proyecto/tenant.
  const rows = await db
    .select({
      requirementId: schema.requirements.id,
      clauseNo: schema.requirements.clauseNo,
      title: schema.requirements.title,
      category: schema.requirements.category,
      status: schema.diagnostics.status,
      answerText: schema.diagnostics.answerText,
      aiNotes: schema.diagnostics.aiNotes,
    })
    .from(schema.requirements)
    .leftJoin(
      schema.diagnostics,
      and(
        eq(schema.diagnostics.requirementId, schema.requirements.id),
        eq(schema.diagnostics.projectId, project.id),
        eq(schema.diagnostics.orgId, orgId),
      ),
    )
    .where(eq(schema.requirements.standardId, project.standardId))
    .orderBy(asc(schema.requirements.sortOrder));

  const evaluated = rows.filter((r) => r.status).length;
  const naCount = rows.filter((r) => r.status === "not_applicable").length;
  const compliant = rows.filter((r) => r.status === "compliant").length;
  const applicable = rows.length - naCount;

  return (
    <main style={{ maxWidth: 860 }}>
      <p>
        <Link href={`/projects/${project.id}`} style={{ color: "#7cc4ff" }}>
          ← Volver al proyecto
        </Link>
      </p>

      <h1>Diagnóstico / GAP</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        {project.name} · {project.standardName} ({project.standardVersion})
      </p>

      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          alignItems: "baseline",
          padding: "1rem 1.25rem",
          background: "#121b2e",
          border: "1px solid #1f2a44",
          borderRadius: 10,
          margin: "1.25rem 0 2rem",
        }}
      >
        <div>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "#7cc4ff" }}>
            {Number(project.readinessPct)}%
          </div>
          <div style={{ opacity: 0.6, fontSize: "0.85rem" }}>Preparación para auditar</div>
        </div>
        <div style={{ opacity: 0.75, fontSize: "0.9rem", lineHeight: 1.6 }}>
          {compliant} cumple · {applicable} aplicables · {naCount} no aplica
          <br />
          {evaluated} de {rows.length} cláusulas evaluadas
        </div>
      </div>

      <AiDiagnosticPanel projectId={project.id} />

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
        {rows.map((r) => {
          const meta = r.status ? STATUS_META[r.status] : null;
          return (
            <li
              key={r.requirementId}
              style={{
                padding: "1rem 1.25rem",
                background: "#121b2e",
                border: "1px solid #1f2a44",
                borderRadius: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
                <strong>
                  {r.clauseNo} — {r.title}
                </strong>
                <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", whiteSpace: "nowrap" }}>
                  {r.aiNotes && !r.answerText && (
                    <span
                      title="Sugerido por IA (sin corrección manual)"
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "#93c5fd",
                        background: "#1e3a6b",
                        border: "1px solid #2f5599",
                        borderRadius: 6,
                        padding: "0.1rem 0.4rem",
                        letterSpacing: "0.03em",
                      }}
                    >
                      IA
                    </span>
                  )}
                  {meta ? (
                    <span style={{ color: meta.color, fontWeight: 600, fontSize: "0.85rem" }}>
                      ● {meta.label}
                    </span>
                  ) : (
                    <span style={{ opacity: 0.45, fontSize: "0.85rem" }}>Sin evaluar</span>
                  )}
                </span>
              </div>
              {r.category && (
                <div style={{ opacity: 0.5, fontSize: "0.8rem", marginTop: "0.2rem" }}>{r.category}</div>
              )}
              {r.aiNotes && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem 0.7rem",
                    background: "#0f1b30",
                    border: "1px solid #24406e",
                    borderRadius: 8,
                    fontSize: "0.85rem",
                    lineHeight: 1.5,
                    opacity: 0.9,
                  }}
                >
                  <span style={{ color: "#93c5fd", fontWeight: 600 }}>Nota IA: </span>
                  {r.aiNotes}
                </div>
              )}

              <form
                action={saveDiagnostic}
                style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.75rem" }}
              >
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="requirementId" value={r.requirementId} />

                <select
                  name="status"
                  required
                  defaultValue={r.status ?? ""}
                  style={{ ...controlStyle, minWidth: 140 }}
                >
                  <option value="" disabled>
                    Elegí estado…
                  </option>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <input
                  name="answerText"
                  defaultValue={r.answerText ?? ""}
                  placeholder="Nota (opcional)"
                  style={{ ...controlStyle, flex: 1, minWidth: 200 }}
                />

                <button type="submit" style={saveBtnStyle}>
                  Guardar
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

const controlStyle = {
  padding: "0.5rem 0.65rem",
  background: "#0f1729",
  border: "1px solid #283655",
  borderRadius: 8,
  color: "#e7ecf3",
  fontSize: "0.95rem",
  fontFamily: "inherit",
} as const;

const saveBtnStyle = {
  padding: "0.5rem 1rem",
  background: "#1d4ed8",
  color: "white",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer",
} as const;
