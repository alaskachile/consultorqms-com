import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getDemoOrgId } from "@/lib/demo-org";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  diagnosing: "Diagnóstico en curso",
  in_progress: "Cerrando gaps",
  audit_ready: "Listo para auditar",
  audited: "Auditado",
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const orgId = await getDemoOrgId();

  // SOLO LECTURA, scoped por org demo (multi-tenant): un proyecto de otra org
  // nunca debe ser visible aunque se adivine el id.
  const [project] = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      scope: schema.projects.scope,
      status: schema.projects.status,
      readinessPct: schema.projects.readinessPct,
      standardName: schema.standards.name,
      standardVersion: schema.standards.version,
    })
    .from(schema.projects)
    .innerJoin(schema.standards, eq(schema.projects.standardId, schema.standards.id))
    .where(and(eq(schema.projects.id, params.id), eq(schema.projects.orgId, orgId)))
    .limit(1);

  if (!project) notFound();

  return (
    <main style={{ maxWidth: 640 }}>
      <p>
        <Link href="/projects" style={{ color: "#7cc4ff" }}>
          ← Volver a proyectos
        </Link>
      </p>
      <h1>{project.name}</h1>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.6rem 1.5rem", marginTop: "1.5rem" }}>
        <dt style={dtStyle}>Norma</dt>
        <dd style={ddStyle}>
          {project.standardName} ({project.standardVersion})
        </dd>

        <dt style={dtStyle}>Estado</dt>
        <dd style={ddStyle}>{STATUS_LABELS[project.status] ?? project.status}</dd>

        <dt style={dtStyle}>Preparación</dt>
        <dd style={ddStyle}>{Number(project.readinessPct)}%</dd>

        <dt style={dtStyle}>Alcance</dt>
        <dd style={ddStyle}>{project.scope || <span style={{ opacity: 0.5 }}>Sin definir</span>}</dd>
      </dl>

      <div style={{ marginTop: "2rem" }}>
        <Link href={`/projects/${project.id}/diagnostic`} style={btnStyle}>
          Diagnóstico / GAP →
        </Link>
        <p style={{ opacity: 0.6, marginTop: "0.75rem", fontSize: "0.9rem" }}>
          Evaluá cada cláusula (cumple / parcial / gap / no aplica). La preparación se recalcula al guardar.
        </p>
      </div>
    </main>
  );
}

const dtStyle = { opacity: 0.6, margin: 0 } as const;
const ddStyle = { margin: 0 } as const;

const btnStyle = {
  display: "inline-block",
  padding: "0.6rem 1.25rem",
  background: "#1d4ed8",
  color: "white",
  borderRadius: 8,
  textDecoration: "none",
  fontWeight: 600,
} as const;
