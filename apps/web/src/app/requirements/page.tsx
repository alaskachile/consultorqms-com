import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

export default async function RequirementsPage() {
  // SOLO LECTURA: las 28 cláusulas del catálogo ordenadas por sort_order.
  const rows = await db
    .select({
      clauseNo: schema.requirements.clauseNo,
      title: schema.requirements.title,
    })
    .from(schema.requirements)
    .orderBy(asc(schema.requirements.sortOrder));

  return (
    <main>
      <h1>Requisitos ISO 9001</h1>
      <p style={{ opacity: 0.7 }}>{rows.length} cláusulas en el catálogo.</p>
      <ol style={{ lineHeight: 1.8 }}>
        {rows.map((r, i) => (
          <li key={`${r.clauseNo}-${i}`}>
            <strong>{r.clauseNo}</strong> — {r.title}
          </li>
        ))}
      </ol>
    </main>
  );
}
