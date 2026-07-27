import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getDemoOrgId } from "@/lib/demo-org";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

const DOC_TYPE_LABEL: Record<string, string> = {
  policy: "Política",
  procedure: "Procedimiento",
  record: "Registro",
  manual: "Manual",
  other: "Documento",
};

const DOC_STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "#eab308" },
  in_review: { label: "En revisión", color: "#7cc4ff" },
  approved: { label: "Aprobado", color: "#22c55e" },
};

const ORIGIN_LABEL: Record<string, string> = {
  generated: "Generado por IA",
  uploaded: "Subido",
};

export default async function DocumentsPage({ params }: { params: { id: string } }) {
  const orgId = await getDemoOrgId();

  // SOLO LECTURA, scoped por org (multi-tenant): proyecto + su norma.
  const [project] = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      standardName: schema.standards.name,
      standardVersion: schema.standards.version,
    })
    .from(schema.projects)
    .innerJoin(schema.standards, eq(schema.projects.standardId, schema.standards.id))
    .where(and(eq(schema.projects.id, params.id), eq(schema.projects.orgId, orgId)))
    .limit(1);

  if (!project) notFound();

  // Documentos del proyecto + la cláusula que cubren (LEFT JOIN: requirement_id es opcional).
  const docs = await db
    .select({
      id: schema.documents.id,
      type: schema.documents.type,
      title: schema.documents.title,
      status: schema.documents.status,
      origin: schema.documents.origin,
      createdAt: schema.documents.createdAt,
      clauseNo: schema.requirements.clauseNo,
    })
    .from(schema.documents)
    .leftJoin(schema.requirements, eq(schema.documents.requirementId, schema.requirements.id))
    .where(and(eq(schema.documents.projectId, project.id), eq(schema.documents.orgId, orgId)))
    .orderBy(desc(schema.documents.createdAt));

  return (
    <main style={{ maxWidth: 860 }}>
      <p>
        <Link href={`/projects/${project.id}`} style={{ color: "#7cc4ff" }}>
          ← Volver al proyecto
        </Link>
      </p>

      <h1>Documentos</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        {project.name} · {project.standardName} ({project.standardVersion})
      </p>

      {docs.length === 0 ? (
        <div
          style={{
            padding: "1.5rem",
            background: "#121b2e",
            border: "1px solid #1f2a44",
            borderRadius: 10,
            marginTop: "1.5rem",
            opacity: 0.75,
            lineHeight: 1.6,
          }}
        >
          Todavía no hay documentos. Generá borradores con IA desde el{" "}
          <Link href={`/projects/${project.id}/diagnostic`} style={{ color: "#7cc4ff" }}>
            diagnóstico
          </Link>{" "}
          para las cláusulas con gap o parcial.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "1.5rem 0 0", display: "grid", gap: "0.75rem" }}>
          {docs.map((d) => {
            const statusMeta = DOC_STATUS_META[d.status] ?? { label: d.status, color: "#94a3b8" };
            return (
              <li
                key={d.id}
                style={{
                  background: "#121b2e",
                  border: "1px solid #1f2a44",
                  borderRadius: 10,
                }}
              >
                <Link
                  href={`/projects/${project.id}/documents/${d.id}`}
                  style={{ display: "block", padding: "1rem 1.25rem", color: "inherit", textDecoration: "none" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
                    <strong style={{ color: "#e7ecf3" }}>{d.title}</strong>
                    <span style={{ color: statusMeta.color, fontWeight: 600, fontSize: "0.85rem", whiteSpace: "nowrap" }}>
                      ● {statusMeta.label}
                    </span>
                  </div>
                  <div style={{ opacity: 0.6, fontSize: "0.82rem", marginTop: "0.35rem" }}>
                    {DOC_TYPE_LABEL[d.type] ?? d.type}
                    {d.clauseNo && <> · Cláusula {d.clauseNo}</>} · {ORIGIN_LABEL[d.origin] ?? d.origin}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
