import "server-only";

import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { invokeModel } from "@/lib/ai";
import { DIAGNOSTIC_STATUSES, type DiagnosticStatus } from "@cqms/shared";

/**
 * Agente de diagnóstico (primer agente IA de ConsultorQMS).
 *
 * Entrada: contexto de la empresa + las cláusulas de la norma (paraphrased_text y
 * su guía en `requirement_guidance`) leídas de Aurora.
 * Salida: por CADA cláusula un veredicto { clauseNo, status, rationale }.
 *
 * Reglas de CLAUDE.md respetadas:
 *  - Estructurado vs RAG: los requisitos/criterios vienen de Postgres, no del modelo.
 *  - Trazabilidad: se le pide al modelo citar la cláusula en cada justificación.
 *  - Copyright: se usa `paraphrased_text` (contenido propio), nunca texto oficial ISO.
 *
 * El parseo del JSON es defensivo: si el modelo devuelve algo inválido, se lanza un
 * error claro y el llamador NO escribe nada en la base.
 */

export interface ClauseAssessment {
  clauseNo: string;
  status: DiagnosticStatus;
  rationale: string;
}

export interface DiagnosticAgentResult {
  assessments: ClauseAssessment[];
  /** Texto crudo del modelo (para log en agent_runs). */
  raw: string;
  modelId: string;
  provider: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Cuántas cláusulas se enviaron a evaluar. */
  clauseCount: number;
}

interface ClauseInput {
  clauseNo: string;
  title: string;
  paraphrasedText: string;
  category: string | null;
  expectedEvidence: string | null;
  auditCriteria: string | null;
}

const SYSTEM_PROMPT = [
  "Sos un consultor experto en sistemas de gestión de calidad que prepara empresas para auditar normas ISO.",
  "Tu tarea: dado el contexto de una empresa y una lista de cláusulas (con su texto parafraseado y su guía),",
  "evaluar el grado de cumplimiento actual de CADA cláusula.",
  "",
  "Estados posibles (usá EXACTAMENTE uno de estos valores en inglés):",
  '  - "compliant": hay evidencia razonable de que la empresa ya cumple el requisito.',
  '  - "partial": lo cumple parcialmente; falta formalizar, documentar o completar.',
  '  - "gap": brecha clara; no hay evidencia de cumplimiento.',
  '  - "not_applicable": la cláusula no aplica al alcance/rubro de esta empresa.',
  "",
  "Criterio conservador: si el contexto no alcanza para afirmar cumplimiento, usá \"partial\" o \"gap\",",
  'nunca "compliant". Reservá "not_applicable" solo cuando quede claro que está fuera de alcance.',
  "",
  "Para cada cláusula devolvé una justificación breve (1-2 frases, en español) que CITE el número de cláusula",
  "en que se basa (trazabilidad para auditoría).",
  "",
  "FORMATO DE SALIDA (obligatorio): respondé SOLO un array JSON, sin texto adicional, sin explicaciones,",
  "sin fences de markdown. Cada elemento con esta forma exacta:",
  '  { "clauseNo": "<n>", "status": "<estado>", "rationale": "<justificación>" }',
  "Incluí un elemento por cada cláusula recibida, usando el clauseNo tal cual te fue dado.",
].join("\n");

function buildUserPrompt(companyContext: string, clauses: ClauseInput[]): string {
  const lines: string[] = [];
  lines.push("CONTEXTO DE LA EMPRESA:");
  lines.push(companyContext.trim());
  lines.push("");
  lines.push(`CLÁUSULAS A EVALUAR (${clauses.length}):`);
  for (const c of clauses) {
    lines.push("");
    lines.push(`Cláusula ${c.clauseNo} — ${c.title}${c.category ? ` [${c.category}]` : ""}`);
    lines.push(`Requisito: ${c.paraphrasedText}`);
    if (c.expectedEvidence) lines.push(`Evidencia esperada: ${c.expectedEvidence}`);
    if (c.auditCriteria) lines.push(`Criterio de auditoría: ${c.auditCriteria}`);
  }
  lines.push("");
  lines.push("Devolvé el array JSON con un veredicto por cada cláusula listada.");
  return lines.join("\n");
}

/**
 * Extrae y valida el array JSON de la respuesta del modelo.
 * Tolera texto envolvente (fences, prólogos) recortando del primer `[` al último `]`.
 * Lanza error claro si nada de eso produce un array válido de veredictos.
 */
function parseAssessments(raw: string, validClauseNos: Set<string>): ClauseAssessment[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("El modelo no devolvió un array JSON. Respuesta cruda: " + raw.slice(0, 300));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new Error(
      "No se pudo parsear el JSON del modelo: " +
        (err instanceof Error ? err.message : String(err)) +
        ". Fragmento: " +
        raw.slice(start, start + 300),
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("El JSON del modelo no es un array.");
  }

  const statuses = new Set<string>(DIAGNOSTIC_STATUSES);
  const out: ClauseAssessment[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const clauseNo = typeof rec.clauseNo === "string" ? rec.clauseNo.trim() : "";
    const status = typeof rec.status === "string" ? rec.status.trim() : "";
    const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";

    if (!clauseNo || !statuses.has(status)) continue;
    // Ignoramos cláusulas inventadas por el modelo que no están en la norma.
    if (!validClauseNos.has(clauseNo)) continue;
    if (seen.has(clauseNo)) continue; // primer veredicto gana ante duplicados

    seen.add(clauseNo);
    out.push({ clauseNo, status: status as DiagnosticStatus, rationale });
  }

  if (out.length === 0) {
    throw new Error(
      "El modelo no produjo ningún veredicto válido para las cláusulas de la norma.",
    );
  }

  return out;
}

/**
 * Corre el agente sobre una norma. NO escribe en la base: solo lee catálogo y
 * devuelve los veredictos. El persistido (UPSERT scopeado por org) lo hace la
 * Server Action que llama a este agente.
 */
export async function diagnoseCompany(params: {
  standardId: string;
  companyContext: string;
}): Promise<DiagnosticAgentResult> {
  const companyContext = params.companyContext.trim();
  if (!companyContext) {
    throw new Error("El contexto de la empresa está vacío.");
  }

  // SOLO LECTURA del catálogo: cláusulas + su guía (LEFT JOIN: la guía es opcional).
  const clauses = await db
    .select({
      clauseNo: schema.requirements.clauseNo,
      title: schema.requirements.title,
      paraphrasedText: schema.requirements.paraphrasedText,
      category: schema.requirements.category,
      expectedEvidence: schema.requirementGuidance.expectedEvidence,
      auditCriteria: schema.requirementGuidance.auditCriteria,
    })
    .from(schema.requirements)
    .leftJoin(
      schema.requirementGuidance,
      eq(schema.requirementGuidance.requirementId, schema.requirements.id),
    )
    .where(eq(schema.requirements.standardId, params.standardId))
    .orderBy(asc(schema.requirements.sortOrder));

  if (clauses.length === 0) {
    throw new Error("La norma no tiene cláusulas cargadas en el catálogo.");
  }

  const userPrompt = buildUserPrompt(companyContext, clauses);

  const result = await invokeModel([{ role: "user", content: userPrompt }], {
    system: SYSTEM_PROMPT,
    // 28 cláusulas × justificación breve entran holgadas en 8000 tokens.
    maxTokens: 8000,
  });

  const validClauseNos = new Set(clauses.map((c) => c.clauseNo));
  const assessments = parseAssessments(result.text, validClauseNos);

  return {
    assessments,
    raw: result.text,
    modelId: result.modelId,
    provider: result.provider,
    usage: result.usage,
    clauseCount: clauses.length,
  };
}
