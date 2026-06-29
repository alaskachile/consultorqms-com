"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, withEnumCasts } from "@/lib/db";
import { getDemoOrgId } from "@/lib/demo-org";
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
    await db
      .update(schema.diagnostics)
      .set(withEnumCasts(schema.diagnostics, { status, answerText, updatedAt: sql`now()` }))
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
 * Recalcula `readiness_pct` = % de cláusulas APLICABLES marcadas como `compliant`.
 *
 * Denominador = total de cláusulas de la norma − las marcadas `not_applicable`.
 * Numerador   = cláusulas `compliant`. Las no evaluadas cuentan como NO listas
 * (son aplicables pero todavía sin cumplir), así la barra sube a medida que se
 * cierran gaps. Si no hay cláusulas aplicables, queda en 0.
 */
async function recalcReadiness(projectId: string, standardId: string, orgId: string) {
  const reqRows = await db
    .select({ id: schema.requirements.id })
    .from(schema.requirements)
    .where(eq(schema.requirements.standardId, standardId));
  const totalReqs = reqRows.length;

  const diagRows = await db
    .select({ status: schema.diagnostics.status })
    .from(schema.diagnostics)
    .where(and(eq(schema.diagnostics.projectId, projectId), eq(schema.diagnostics.orgId, orgId)));

  const naCount = diagRows.filter((d) => d.status === "not_applicable").length;
  const compliantCount = diagRows.filter((d) => d.status === "compliant").length;
  const applicable = totalReqs - naCount;
  const pct = applicable > 0 ? (compliantCount / applicable) * 100 : 0;

  // numeric(5,2) → Drizzle espera string. No es enum: sin withEnumCasts.
  await db
    .update(schema.projects)
    .set({ readinessPct: pct.toFixed(2) })
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)));
}
