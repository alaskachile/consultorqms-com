import "server-only";

import { invokeModel } from "@/lib/ai";
import { DOCUMENT_TYPES, type DocumentType } from "@cqms/shared";

/**
 * Agente de documentación (segundo agente IA de ConsultorQMS).
 *
 * Entrada: UNA cláusula (clause_no, title, paraphrased_text) + su guía
 * (`requirement_guidance`: expected_evidence, suggested_document_type,
 * audit_criteria) + el contexto de la empresa (rubro, tamaño, procesos).
 * Salida: el BORRADOR de un documento del QMS en markdown (texto, NO JSON),
 * del tipo sugerido (política / procedimiento / registro), adaptado al rubro y
 * listo para que la pyme lo use y adapte.
 *
 * Reglas de CLAUDE.md respetadas:
 *  - Estructurado vs RAG: la cláusula, su guía y el criterio de auditoría vienen
 *    de Postgres (`requirements` / `requirement_guidance`), no del modelo.
 *  - Trazabilidad: el prompt le pide citar el número de cláusula en el documento.
 *  - Copyright: se usa `paraphrased_text` (contenido propio), nunca texto oficial ISO.
 *
 * Este módulo NO escribe en la base: solo arma el prompt, invoca el modelo y
 * devuelve el markdown + metadatos. El persistido (INSERT en `documents` /
 * `document_versions`, scopeado por org) lo hace la Server Action que lo llama.
 */

/** Etiqueta en español de cada tipo de documento, para el prompt y el título. */
const DOC_TYPE_LABEL: Record<DocumentType, string> = {
  policy: "política",
  procedure: "procedimiento",
  record: "registro / plantilla",
  manual: "manual",
  other: "documento",
};

export interface DocumentAgentInput {
  clauseNo: string;
  title: string;
  paraphrasedText: string;
  /** De requirement_guidance (opcionales: el LEFT JOIN puede no traerlos). */
  expectedEvidence: string | null;
  suggestedDocumentType: DocumentType | null;
  auditCriteria: string | null;
  /** Contexto de la empresa (rubro, tamaño, procesos, documentación actual). */
  companyContext: string;
}

export interface DocumentAgentResult {
  /** Markdown del documento generado (texto plano, listo para guardar). */
  markdown: string;
  /** Tipo de documento efectivamente usado (guía o 'procedure' por defecto). */
  documentType: DocumentType;
  modelId: string;
  provider: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

const SYSTEM_PROMPT = [
  "Sos un consultor experto en sistemas de gestión de calidad que redacta documentación para",
  "que una pyme quede lista para auditar una norma ISO.",
  "",
  "Tu tarea: dado UNA cláusula de la norma (con su texto parafraseado y su guía) y el contexto de",
  "una empresa, redactar el BORRADOR de un documento del QMS del tipo indicado (política,",
  "procedimiento o registro), adaptado al rubro y tamaño de esa empresa.",
  "",
  "Requisitos del documento:",
  "  - Debe cubrir lo que la cláusula exige y alinearse con el criterio de auditoría dado.",
  "  - Adaptado al rubro concreto (ejemplos, roles y procesos propios de esa empresa), NO una",
  "    plantilla genérica.",
  "  - Redactado para una pyme: claro, accionable, listo para usar y ajustar. Dejá entre corchetes",
  "    los datos que la empresa debe completar (p. ej. [nombre del responsable], [frecuencia]).",
  "  - Citá el número de cláusula en el documento (trazabilidad para la auditoría).",
  "  - Estructura habitual según el tipo: objetivo/propósito, alcance, responsabilidades,",
  "    desarrollo/procedimiento, registros/evidencia asociada, y control del documento",
  "    (versión, fecha, responsable).",
  "",
  "FORMATO DE SALIDA (obligatorio): devolvé SOLO el documento en markdown. Nada de JSON, ni",
  "explicaciones previas o posteriores, ni fences ``` alrededor. Empezá directamente por el título",
  "del documento con '# '.",
].join("\n");

function buildUserPrompt(input: DocumentAgentInput, docType: DocumentType): string {
  const lines: string[] = [];
  lines.push(`TIPO DE DOCUMENTO A REDACTAR: ${DOC_TYPE_LABEL[docType]}`);
  lines.push("");
  lines.push("CLÁUSULA QUE DEBE CUBRIR:");
  lines.push(`Cláusula ${input.clauseNo} — ${input.title}`);
  lines.push(`Requisito: ${input.paraphrasedText}`);
  if (input.expectedEvidence) lines.push(`Evidencia esperada: ${input.expectedEvidence}`);
  if (input.auditCriteria) lines.push(`Criterio de auditoría: ${input.auditCriteria}`);
  lines.push("");
  lines.push("CONTEXTO DE LA EMPRESA:");
  lines.push(input.companyContext.trim());
  lines.push("");
  lines.push(
    `Redactá el ${DOC_TYPE_LABEL[docType]} en markdown, adaptado a esta empresa y cubriendo la cláusula ${input.clauseNo}.`,
  );
  return lines.join("\n");
}

/**
 * Corre el agente sobre una cláusula y devuelve el markdown del documento.
 * NO escribe en la base. Lanza error claro si el modelo no devuelve texto útil.
 */
export async function generateDocumentDraft(
  input: DocumentAgentInput,
): Promise<DocumentAgentResult> {
  const companyContext = input.companyContext.trim();
  if (!companyContext) {
    throw new Error("El contexto de la empresa está vacío.");
  }

  // Tipo sugerido por la guía, con 'procedure' como default seguro.
  const documentType: DocumentType =
    input.suggestedDocumentType &&
    (DOCUMENT_TYPES as readonly string[]).includes(input.suggestedDocumentType)
      ? input.suggestedDocumentType
      : "procedure";

  const userPrompt = buildUserPrompt({ ...input, companyContext }, documentType);

  const result = await invokeModel([{ role: "user", content: userPrompt }], {
    system: SYSTEM_PROMPT,
    // Un documento completo (política/procedimiento) entra holgado en 8000 tokens.
    maxTokens: 8000,
  });

  const markdown = stripFences(result.text).trim();
  if (!markdown) {
    throw new Error("El modelo no devolvió contenido para el documento.");
  }

  return {
    markdown,
    documentType,
    modelId: result.modelId,
    provider: result.provider,
    usage: result.usage,
  };
}

/**
 * Quita un fence ```markdown ... ``` envolvente si el modelo lo agregó pese a la
 * instrucción. Deja intacto el markdown interno (incluidos bloques de código).
 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
