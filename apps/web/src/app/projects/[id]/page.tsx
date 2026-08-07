import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrgId } from "@/lib/org";

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
  const orgId = await getOrgId();

  // Blindaje por URL (multi-tenant): el proyecto se busca por id **y** por el
  // `org_id` de la sesión. Si el id es de otra organización no hay fila y
  // devolvemos notFound() — indistinguible de un id inexistente, así que la URL
  // tampoco filtra la existencia de proyectos ajenos.
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

  // Contador de documentos del proyecto (SOLO LECTURA, scoped por org).
  const [{ count: docCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, project.id), eq(schema.documents.orgId, orgId)));

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

      <div style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link href={`/projects/${project.id}/diagnostic`} style={btnStyle}>
          Diagnóstico / GAP →
        </Link>
        <Link href={`/projects/${project.id}/documents`} style={secondaryBtnStyle}>
          Documentos ({docCount}) →
        </Link>
      </div>
      <p style={{ opacity: 0.6, marginTop: "0.75rem", fontSize: "0.9rem" }}>
        Evaluá cada cláusula (cumple / parcial / gap / no aplica). La preparación se recalcula al guardar.
        Generá borradores de documentos con IA desde las cláusulas con gap o parcial.
      </p>
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

const secondaryBtnStyle = {
  display: "inline-block",
  padding: "0.6rem 1.25rem",
  background: "transparent",
  color: "#7cc4ff",
  border: "1px solid #2f5599",
  borderRadius: 8,
  textDecoration: "none",
  fontWeight: 600,
} as const;
