"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema, withEnumCasts } from "@/lib/db";
import { getDemoOrgId } from "@/lib/demo-org";
import { diagnoseCompany } from "@/lib/agents/diagnostic";
import { DIAGNOSTIC_STATUSES } from "@cqms/shared";

/**
 * Guarda (UPSERT) el estado de diagnóstico de UNA cláusula de un proyecto y
 * recalcula la preparación del proyecto.
 *
 * Reglas de CLAUDE.md respetadas:
 *  - Multi-tenant: el `org_id` sale SIEMPRE del helper demo, nunca del form.
 *    Antes de escribir verificamos que el proyecto sea de esta org y que el
 *    requisito pertenezca a la norma del proyecto.
 *  - DML acotado: solo INSERT/UPDATE sobre `diagnostics` y UPDATE de
 *    `readiness_pct` en `projects`. Sin DROP/ALTER/migraciones.
 *  - Enums casteados con `withEnumCasts` (la Data API manda texto plano).
 */
export async function saveDiagnostic(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const requirementId = String(formData.get("requirementId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const answerRaw = String(formData.get("answerText") ?? "").trim();

  if (!projectId) throw new Error("Falta el proyecto.");
  if (!requirementId) throw new Error("Falta el requisito.");
  if (!(DIAGNOSTIC_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Estado de diagnóstico inválido.");
  }

  const orgId = await getDemoOrgId();

  // Scoping multi-tenant: el proyecto tiene que ser de esta org.
  const [project] = await db
    .select({ id: schema.projects.id, standardId: schema.projects.standardId })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)))
    .limit(1);
  if (!project) throw new Error("Proyecto no encontrado.");

  // Integridad: el requisito tiene que pertenecer a la norma del proyecto.
  const [requirement] = await db
    .select({ id: schema.requirements.id })
    .from(schema.requirements)
    .where(
      and(
        eq(schema.requirements.id, requirementId),
        eq(schema.requirements.standardId, project.standardId),
      ),
    )
    .limit(1);
  if (!requirement) throw new Error("El requisito no pertenece a la norma del proyecto.");

  const answerText = answerRaw || null;

  // UPSERT manual: insert si no existe ese project_id + requirement_id; update si sí.
  const [existing] = await db
    .select({ id: schema.diagnostics.id })
    .from(schema.diagnostics)
    .where(
      and(
        eq(schema.diagnostics.projectId, projectId),
        eq(schema.diagnostics.requirementId, requirementId),
        eq(schema.diagnostics.orgId, orgId),
      ),
    )
    .limit(1);

  if (existing) {
    // Guardar a mano = el humano toma posesión de la cláusula: limpiamos `ai_notes`
    // para que deje de figurar como "sugerencia de IA pendiente" (su decisión
    // reemplaza a la propuesta). Así cuenta como confirmada en el readiness.
    await db
      .update(schema.diagnostics)
      .set(
        withEnumCasts(schema.diagnostics, {
          status,
          answerText,
          aiNotes: null,
          updatedAt: sql`now()`,
        }),
      )
      .where(and(eq(schema.diagnostics.id, existing.id), eq(schema.diagnostics.orgId, orgId)));
  } else {
    await db.insert(schema.diagnostics).values(
      withEnumCasts(schema.diagnostics, {
        orgId,
        projectId,
        requirementId,
        status,
        answerText,
      }),
    );
  }

  await recalcReadiness(projectId, project.standardId, orgId);

  // Refrescamos las tres vistas que muestran el dato.
  revalidatePath(`/projects/${projectId}/diagnostic`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}

/**
 * Una fila de diagnóstico está "sugerida por IA y pendiente de aceptar" cuando
 * tiene `ai_notes` cargado pero todavía NO tiene `answer_text` (nadie la confirmó
 * ni la editó a mano). Todo lo demás con `status` cuenta como "confirmado".
 *
 * Es el único criterio que distingue confirmado de sugerido con el schema actual,
 * sin columnas nuevas.
 */
function isPendingAiSuggestion(row: {
  aiNotes: string | null;
  answerText: string | null;
}): boolean {
  const hasAiNote = !!row.aiNotes && row.aiNotes.trim() !== "";
  const hasAnswer = !!row.answerText && row.answerText.trim() !== "";
  return hasAiNote && !hasAnswer;
}

/**
 * Recalcula `readiness_pct` = % de cláusulas APLICABLES **confirmadas** como
 * `compliant`.
 *
 * Solo cuentan las cláusulas confirmadas (respondidas a mano o con la sugerencia
 * de IA aceptada). Las sugerencias de IA pendientes NO suben la barra: cuentan
 * como "todavía no listas", igual que las no evaluadas. Así el % refleja solo lo
 * que un humano validó, y sube cuando el usuario acepta las sugerencias.
 *
 * Denominador = total de cláusulas de la norma − las CONFIRMADAS como `not_applicable`.
 * Si no hay cláusulas aplicables, queda en 0.
 */
async function recalcReadiness(projectId: string, standardId: string, orgId: string) {
  const reqRows = await db
    .select({ id: schema.requirements.id })
    .from(schema.requirements)
    .where(eq(schema.requirements.standardId, standardId));
  const totalReqs = reqRows.length;

  const diagRows = await db
    .select({
      status: schema.diagnostics.status,
      aiNotes: schema.diagnostics.aiNotes,
      answerText: schema.diagnostics.answerText,
    })
    .from(schema.diagnostics)
    .where(and(eq(schema.diagnostics.projectId, projectId), eq(schema.diagnostics.orgId, orgId)));

  const confirmed = diagRows.filter((d) => !isPendingAiSuggestion(d));
  const naCount = confirmed.filter((d) => d.status === "not_applicable").length;
  const compliantCount = confirmed.filter((d) => d.status === "compliant").length;
  const applicable = totalReqs - naCount;
  const pct = applicable > 0 ? (compliantCount / applicable) * 100 : 0;

  // numeric(5,2) → Drizzle espera string. No es enum: sin withEnumCasts.
  await db
    .update(schema.projects)
    .set({ readinessPct: pct.toFixed(2) })
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)));
}

/**
 * Resultado que la Server Action devuelve al cliente (patrón discriminado para
 * mostrar errores del agente sin romper la UI con un throw).
 */
export type DiagnosticAgentActionResult =
  | { ok: true; applied: number; skipped: number; total: number; modelId: string }
  | { ok: false; error: string };

/**
 * Server Action del AGENTE de diagnóstico.
 *
 * Corre el agente IA sobre el proyecto y, por cada cláusula propuesta, hace UPSERT
 * en `diagnostics` (por project_id + requirement_id) con el status sugerido y el
 * rationale en `ai_notes`. Todo scopeado por la org del helper demo.
 *
 * Criterio conservador (CLAUDE.md): si una cláusula YA tiene `answer_text` cargado
 * por el usuario, NO se pisa. Recalcula `readiness_pct` y registra la corrida en
 * `agent_runs` (input/output JSON) para trazabilidad y control de gasto.
 *
 * DML acotado: INSERT/UPDATE sobre `diagnostics`, UPDATE de `readiness_pct` en
 * `projects`, INSERT en `agent_runs`. Sin DROP/ALTER/migraciones.
 */
export async function runDiagnosticAgent(
  projectId: string,
  companyContext: string,
): Promise<DiagnosticAgentActionResult> {
  try {
    const context = companyContext?.trim() ?? "";
    if (!projectId?.trim()) throw new Error("Falta el proyecto.");
    if (!context) throw new Error("Escribí el contexto de la empresa antes de generar el diagnóstico.");

    const orgId = await getDemoOrgId();

    // Scoping multi-tenant: el proyecto tiene que ser de esta org.
    const [project] = await db
      .select({ id: schema.projects.id, standardId: schema.projects.standardId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId.trim()), eq(schema.projects.orgId, orgId)))
      .limit(1);
    if (!project) throw new Error("Proyecto no encontrado.");

    // Corre el agente (solo lee catálogo). Si el JSON viene mal, lanza y no escribimos nada.
    const agent = await diagnoseCompany({ standardId: project.standardId, companyContext: context });

    // Mapa clauseNo → requirementId (para la norma del proyecto, con integridad garantizada).
    const reqRows = await db
      .select({ id: schema.requirements.id, clauseNo: schema.requirements.clauseNo })
      .from(schema.requirements)
      .where(eq(schema.requirements.standardId, project.standardId));
    const reqIdByClause = new Map(reqRows.map((r) => [r.clauseNo, r.id]));

    // Diagnósticos existentes de ESTE proyecto (para decidir UPSERT y respetar lo manual).
    const existingRows = await db
      .select({
        requirementId: schema.diagnostics.requirementId,
        id: schema.diagnostics.id,
        answerText: schema.diagnostics.answerText,
        aiNotes: schema.diagnostics.aiNotes,
      })
      .from(schema.diagnostics)
      .where(
        and(
          eq(schema.diagnostics.projectId, project.id),
          eq(schema.diagnostics.orgId, orgId),
        ),
      );
    const existingByReq = new Map(existingRows.map((r) => [r.requirementId, r]));

    let applied = 0;
    let skipped = 0;

    for (const a of agent.assessments) {
      const requirementId = reqIdByClause.get(a.clauseNo);
      if (!requirementId) {
        skipped++;
        continue;
      }

      const existing = existingByReq.get(requirementId);

      // Conservador: solo (re)escribimos filas nuevas o sugerencias de IA pendientes.
      // Si el humano ya la confirmó (respondió a mano, o su status no tiene ai_notes),
      // NO la pisamos. Así el agente nunca sobreescribe una decisión humana.
      if (existing && !isPendingAiSuggestion(existing)) {
        skipped++;
        continue;
      }

      if (existing) {
        await db
          .update(schema.diagnostics)
          .set(
            withEnumCasts(schema.diagnostics, {
              status: a.status,
              aiNotes: a.rationale,
              updatedAt: sql`now()`,
            }),
          )
          .where(and(eq(schema.diagnostics.id, existing.id), eq(schema.diagnostics.orgId, orgId)));
      } else {
        await db.insert(schema.diagnostics).values(
          withEnumCasts(schema.diagnostics, {
            orgId,
            projectId: project.id,
            requirementId,
            status: a.status,
            aiNotes: a.rationale,
          }),
        );
      }
      applied++;
    }

    await recalcReadiness(project.id, project.standardId, orgId);

    // Trazabilidad: registramos la corrida del agente (input/output JSON + tokens).
    await db.insert(schema.agentRuns).values(
      withEnumCasts(schema.agentRuns, {
        orgId,
        projectId: project.id,
        agent: "diagnostic",
        inputJson: {
          companyContext: context,
          standardId: project.standardId,
          clauseCount: agent.clauseCount,
        },
        outputJson: {
          provider: agent.provider,
          modelId: agent.modelId,
          applied,
          skipped,
          assessments: agent.assessments,
        },
        tokensIn: agent.usage?.inputTokens ?? null,
        tokensOut: agent.usage?.outputTokens ?? null,
      }),
    );

    revalidatePath(`/projects/${project.id}/diagnostic`);
    revalidatePath(`/projects/${project.id}`);
    revalidatePath("/projects");

    return { ok: true, applied, skipped, total: agent.assessments.length, modelId: agent.modelId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type AcceptSuggestionsResult =
  | { ok: true; accepted: number }
  | { ok: false; error: string };

/**
 * Server Action: ACEPTA en masa las sugerencias de la IA de un proyecto.
 *
 * Confirma las cláusulas que están "sugeridas por IA y pendientes" (tienen
 * `ai_notes` y todavía sin `answer_text`): vuelca el rationale de la IA como
 * `answer_text`, con lo que dejan de estar pendientes y pasan a contar para el
 * `readiness_pct`. Se mantiene `ai_notes` para dejar visible que la respuesta
 * vino de una sugerencia de IA.
 *
 * No toca cláusulas ya respondidas a mano (tienen `answer_text`) → el usuario
 * puede seguir corrigiendo cláusula por cláusula antes o después de aceptar.
 *
 * DML acotado: UPDATE sobre `diagnostics` + UPDATE de `readiness_pct`. Sin DELETE
 * ni DROP/ALTER/migraciones.
 */
export async function acceptAiSuggestions(projectId: string): Promise<AcceptSuggestionsResult> {
  try {
    if (!projectId?.trim()) throw new Error("Falta el proyecto.");

    const orgId = await getDemoOrgId();

    // Scoping multi-tenant: el proyecto tiene que ser de esta org.
    const [project] = await db
      .select({ id: schema.projects.id, standardId: schema.projects.standardId })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId.trim()), eq(schema.projects.orgId, orgId)))
      .limit(1);
    if (!project) throw new Error("Proyecto no encontrado.");

    // Sugerencias pendientes = tienen ai_notes no vacío Y answer_text vacío.
    const pending = await db
      .select({ id: schema.diagnostics.id, aiNotes: schema.diagnostics.aiNotes })
      .from(schema.diagnostics)
      .where(
        and(
          eq(schema.diagnostics.projectId, project.id),
          eq(schema.diagnostics.orgId, orgId),
          isNotNull(schema.diagnostics.aiNotes),
          ne(schema.diagnostics.aiNotes, ""),
          or(isNull(schema.diagnostics.answerText), eq(schema.diagnostics.answerText, "")),
        ),
      );

    // Confirmamos cada una volcando su rationale (ai_notes) a answer_text. Valor
    // como parámetro (Data API friendly), sin referencias de columna en el SET.
    let accepted = 0;
    for (const row of pending) {
      await db
        .update(schema.diagnostics)
        .set({ answerText: row.aiNotes, updatedAt: sql`now()` })
        .where(and(eq(schema.diagnostics.id, row.id), eq(schema.diagnostics.orgId, orgId)));
      accepted++;
    }

    await recalcReadiness(project.id, project.standardId, orgId);

    revalidatePath(`/projects/${project.id}/diagnostic`);
    revalidatePath(`/projects/${project.id}`);
    revalidatePath("/projects");

    return { ok: true, accepted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
