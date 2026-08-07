"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema, withEnumCasts } from "@/lib/db";
import { getOrgId } from "@/lib/org";

/**
 * Crea un Proyecto ISO X en la organización del usuario logueado.
 *
 * INSERT acotado a `projects` (permitido en Etapa 3). El `org_id` sale de la
 * sesión (`getOrgId()`), NUNCA del formulario (regla multi-tenant de CLAUDE.md:
 * el tenant jamás se confía desde el cliente).
 */
export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const standardId = String(formData.get("standardId") ?? "").trim();
  const scopeRaw = String(formData.get("scope") ?? "").trim();

  if (!name) throw new Error("El nombre del proyecto es obligatorio.");
  if (!standardId) throw new Error("Hay que seleccionar una norma.");

  // Validamos que la norma exista en el catálogo (no confiar en el cliente).
  const [standard] = await db
    .select({ id: schema.standards.id })
    .from(schema.standards)
    .where(eq(schema.standards.id, standardId))
    .limit(1);
  if (!standard) throw new Error("La norma seleccionada no existe.");

  const orgId = await getOrgId();

  const [created] = await db
    .insert(schema.projects)
    .values(
      withEnumCasts(schema.projects, {
        orgId,
        standardId,
        name,
        scope: scopeRaw || null,
        status: "draft",
        readinessPct: "0",
      }),
    )
    .returning({ id: schema.projects.id });

  if (!created) throw new Error("No se pudo crear el proyecto.");

  revalidatePath("/projects");
  redirect(`/projects/${created.id}`);
}
