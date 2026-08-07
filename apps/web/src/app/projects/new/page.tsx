import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { createProject } from "../actions";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  // Sesión obligatoria: sin esto la pantalla se renderizaba para cualquiera (el
  // `org_id` recién se derivaba al enviar el formulario).
  await requireSession();

  // SOLO LECTURA: normas disponibles del catálogo (hoy solo ISO 9001).
  const standards = await db
    .select({
      id: schema.standards.id,
      code: schema.standards.code,
      name: schema.standards.name,
      version: schema.standards.version,
    })
    .from(schema.standards)
    .orderBy(asc(schema.standards.code));

  return (
    <main style={{ maxWidth: 560 }}>
      <p>
        <Link href="/projects" style={{ color: "#7cc4ff" }}>
          ← Volver a proyectos
        </Link>
      </p>
      <h1>Nuevo Proyecto ISO X</h1>

      <form action={createProject} style={{ display: "grid", gap: "1.25rem", marginTop: "1.5rem" }}>
        <label style={{ display: "grid", gap: "0.4rem" }}>
          <span>Nombre del proyecto</span>
          <input
            name="name"
            required
            placeholder="Proyecto ISO 9001"
            style={inputStyle}
          />
        </label>

        <label style={{ display: "grid", gap: "0.4rem" }}>
          <span>Norma</span>
          <select name="standardId" required defaultValue="" style={inputStyle}>
            <option value="" disabled>
              Elegí una norma…
            </option>
            {standards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.version})
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: "0.4rem" }}>
          <span>Alcance (opcional)</span>
          <textarea
            name="scope"
            rows={3}
            placeholder="Ej: diseño y fabricación de envases plásticos en planta Santiago."
            style={inputStyle}
          />
        </label>

        <button type="submit" style={submitStyle}>
          Crear proyecto
        </button>
      </form>
    </main>
  );
}

const inputStyle = {
  padding: "0.6rem 0.75rem",
  background: "#0f1729",
  border: "1px solid #283655",
  borderRadius: 8,
  color: "#e7ecf3",
  fontSize: "1rem",
  fontFamily: "inherit",
} as const;

const submitStyle = {
  justifySelf: "start",
  padding: "0.6rem 1.25rem",
  background: "#1d4ed8",
  color: "white",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "1rem",
  cursor: "pointer",
} as const;
