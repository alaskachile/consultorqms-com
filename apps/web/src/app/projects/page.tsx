import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrgId } from "@/lib/org";
import { requireSession } from "@/lib/auth";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  diagnosing: "Diagnóstico en curso",
  in_progress: "Cerrando gaps",
  audit_ready: "Listo para auditar",
  audited: "Auditado",
};

export default async function ProjectsPage() {
  // Sesión obligatoria (redirige a /login si no hay). `getOrgId()` deriva el
  // tenant del `sub` del token y crea la org la primera vez que el usuario entra.
  const session = await requireSession();
  const orgId = await getOrgId();

  // SOLO LECTURA: proyectos de la org del usuario + nombre de la norma.
  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      status: schema.projects.status,
      readinessPct: schema.projects.readinessPct,
      standardName: schema.standards.name,
    })
    .from(schema.projects)
    .innerJoin(schema.standards, eq(schema.projects.standardId, schema.standards.id))
    .where(eq(schema.projects.orgId, orgId))
    .orderBy(desc(schema.projects.createdAt));

  return (
    <main>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "0.75rem",
          fontSize: "0.9rem",
        }}
      >
        <span style={{ opacity: 0.7 }}>{session.email}</span>
        <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
          <button
            type="submit"
            style={{
              padding: "0.35rem 0.75rem",
              background: "transparent",
              color: "#e7ecf3",
              border: "1px solid #2a3650",
              borderRadius: 8,
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Cerrar sesión
          </button>
        </form>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1>Proyectos ISO</h1>
        {rows.length > 0 && (
          <Link href="/projects/new" style={btnStyle}>
            + Crear proyecto
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            marginTop: "2rem",
            padding: "3rem 2rem",
            textAlign: "center",
            border: "1px dashed #2a3650",
            borderRadius: 12,
          }}
        >
          <p style={{ opacity: 0.8, marginTop: 0 }}>Todavía no hay proyectos en esta organización.</p>
          <Link href="/projects/new" style={btnStyle}>
            Crear proyecto
          </Link>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "1.5rem", display: "grid", gap: "0.75rem" }}>
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                style={{
                  display: "block",
                  padding: "1rem 1.25rem",
                  background: "#121b2e",
                  border: "1px solid #1f2a44",
                  borderRadius: 10,
                  color: "#e7ecf3",
                  textDecoration: "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                  <strong>{p.name}</strong>
                  <span style={{ opacity: 0.7 }}>{Number(p.readinessPct)}% listo</span>
                </div>
                <div style={{ opacity: 0.7, marginTop: "0.25rem", fontSize: "0.9rem" }}>
                  {p.standardName} · {STATUS_LABELS[p.status] ?? p.status}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const btnStyle = {
  display: "inline-block",
  padding: "0.5rem 1rem",
  background: "#1d4ed8",
  color: "white",
  borderRadius: 8,
  textDecoration: "none",
  fontWeight: 600,
} as const;
