import { db } from "../index.js";
import { standards, requirements, requirementGuidance } from "../schema.js";
import { ISO9001 } from "./iso9001.js";
import { eq } from "drizzle-orm";

async function seed() {
  console.log(`Sembrando catálogo ${ISO9001.code}...`);

  const existing = await db.select().from(standards).where(eq(standards.code, ISO9001.code));
  if (existing.length > 0) {
    console.log("El estándar ya existe, se omite. Borralo antes para re-sembrar.");
    return;
  }

  const [std] = await db
    .insert(standards)
    .values({
      code: ISO9001.code,
      name: ISO9001.name,
      version: ISO9001.version,
      structureType: "annex_sl",
    })
    .returning();

  let order = 0;
  for (const r of ISO9001.requirements) {
    const [req] = await db
      .insert(requirements)
      .values({
        standardId: std!.id,
        clauseNo: r.clauseNo,
        title: r.title,
        paraphrasedText: r.paraphrasedText,
        category: r.category,
        sortOrder: order++,
      })
      .returning();

    await db.insert(requirementGuidance).values({
      requirementId: req!.id,
      expectedEvidence: r.guidance.expectedEvidence,
      suggestedDocumentType: r.guidance.suggestedDocumentType ?? undefined,
      auditCriteria: r.guidance.auditCriteria,
    });
  }

  console.log(`Listo: ${ISO9001.requirements.length} requisitos cargados.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
