"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema, withEnumCasts } from "@/lib/db";
import { getDemoOrgId } from "@/lib/demo-org";
import { generateDocumentDraft } from "@/lib/agents/documentation";
import { type DocumentType } from "@cqms/shared";

/** Etiqueta en español del tipo de documento, para armar el título. */
const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  policy: "Política",
  procedure: "Procedimiento",
  record: "Registro",
  manual: "Manual",
  other: "Documento",
};

export type GenerateDocumentResult =
  | { ok: true; documentId: string; documentType: DocumentType; modelId: string }
  | { ok: false; error: string };

/**
 * Server Action del AGENTE de documentación.
 *
 * Corre el agente sobre UNA cláusula del proyecto y persiste el borrador:
 *  - INSERT en `documents` (type = tipo sugerido por la guía o 'procedure',
 *    title descriptivo, origin 'generated', status 'draft', requirement_id,
 *    project_id, scopeado por org).
 *  - INSERT de la primera fila en `document_versions` (version_no 1, content_md).
 *  - UPDATE de `documents.current_version_id` apuntando a esa versión.
 *  - INSERT en `agent_runs` (agent='documentation') para trazabilidad y gasto.
 *
 * Reglas de CLAUDE.md respetadas:
 *  - Multi-tenant: el `org_id` sale SIEMPRE del helper demo, nunca del cliente.
 *    Verificamos que el proyecto sea de esta org y que el requisito pertenezca a
 *    la norma del proyecto antes de escribir.
 *  - DML acotado: solo INSERT/UPDATE sobre `documents`, `document_versions` y
 *    `agent_runs`. Sin DROP/ALTER/migraciones/DELETE.
 *  - Enums casteados con `withEnumCasts` (la Data API manda texto plano).
 */
export async function generateDocument(
  projectId: string,
  requirementId: string,
  companyContext: string,
): Promise<GenerateDocumentResult> {
  try {
    const context = companyContext?.trim() ?? "";
    if (!projectId?.trim()) throw new Error("Falta el proyecto.");
    if (!requirementId?.trim()) throw new Error("Falta el requisito.");
    if (!context) {
      throw new Error("Escribí el contexto de la empresa antes de generar el documento.");
    }

    const orgId = await getDemoOrgId();

    // Scoping multi-tenant: el proyecto tiene que ser de esta org.
    const [project] = await db
      .select({ id: schema.projects.id, standardId: schema.projects.standardId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId.trim()), eq(schema.projects.orgId, orgId)))
      .limit(1);
    if (!project) throw new Error("Proyecto no encontrado.");

    // Integridad: el requisito tiene que pertenecer a la norma del proyecto.
    // Traemos también su guía (LEFT JOIN: puede no existir) para el agente.
    const [clause] = await db
      .select({
        requirementId: schema.requirements.id,
        clauseNo: schema.requirements.clauseNo,
        title: schema.requirements.title,
        paraphrasedText: schema.requirements.paraphrasedText,
        expectedEvidence: schema.requirementGuidance.expectedEvidence,
        suggestedDocumentType: schema.requirementGuidance.suggestedDocumentType,
        auditCriteria: schema.requirementGuidance.auditCriteria,
      })
      .from(schema.requirements)
      .leftJoin(
        schema.requirementGuidance,
        eq(schema.requirementGuidance.requirementId, schema.requirements.id),
      )
      .where(
        and(
          eq(schema.requirements.id, requirementId.trim()),
          eq(schema.requirements.standardId, project.standardId),
        ),
      )
      .limit(1);
    if (!clause) throw new Error("El requisito no pertenece a la norma del proyecto.");

    // Corre el agente (solo lee catálogo). Si no devuelve nada, lanza y no escribimos.
    const agent = await generateDocumentDraft({
      clauseNo: clause.clauseNo,
      title: clause.title,
      paraphrasedText: clause.paraphrasedText,
      expectedEvidence: clause.expectedEvidence,
      suggestedDocumentType: clause.suggestedDocumentType as DocumentType | null,
      auditCriteria: clause.auditCriteria,
      companyContext: context,
    });

    const title = `${DOC_TYPE_LABEL[agent.documentType]} para ${clause.clauseNo} — ${clause.title}`;

    // 1) INSERT del documento (cabecera), scopeado por org.
    const [doc] = await db
      .insert(schema.documents)
      .values(
        withEnumCasts(schema.documents, {
          orgId,
          projectId: project.id,
          requirementId: clause.requirementId,
          type: agent.documentType,
          title,
          origin: "generated",
          status: "draft",
        }),
      )
      .returning({ id: schema.documents.id });
    if (!doc) throw new Error("No se pudo crear el documento.");

    // 2) INSERT de la primera versión con el markdown generado.
    const [version] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: doc.id,
        versionNo: 1,
        contentMd: agent.markdown,
      })
      .returning({ id: schema.documentVersions.id });
    if (!version) throw new Error("No se pudo crear la versión del documento.");

    // 3) UPDATE del puntero a la versión actual (scopeado por org).
    await db
      .update(schema.documents)
      .set({ currentVersionId: version.id })
      .where(and(eq(schema.documents.id, doc.id), eq(schema.documents.orgId, orgId)));

    // 4) Trazabilidad: registramos la corrida del agente (input/output JSON + tokens).
    await db.insert(schema.agentRuns).values(
      withEnumCasts(schema.agentRuns, {
        orgId,
        projectId: project.id,
        agent: "documentation",
        inputJson: {
          companyContext: context,
          requirementId: clause.requirementId,
          clauseNo: clause.clauseNo,
          documentType: agent.documentType,
        },
        outputJson: {
          provider: agent.provider,
          modelId: agent.modelId,
          documentId: doc.id,
          title,
          markdownChars: agent.markdown.length,
        },
        tokensIn: agent.usage?.inputTokens ?? null,
        tokensOut: agent.usage?.outputTokens ?? null,
      }),
    );

    revalidatePath(`/projects/${project.id}/documents`);
    revalidatePath(`/projects/${project.id}`);
    revalidatePath(`/projects/${project.id}/diagnostic`);

    return { ok: true, documentId: doc.id, documentType: agent.documentType, modelId: agent.modelId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
