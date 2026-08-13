# ConsultorQMS — Documento de Contexto (Handoff)

Este documento le da a una conversación nueva (u otra IA) todo lo necesario para entender el proyecto y continuarlo. Léelo entero antes de proponer o construir nada. En el repo conviven además `PLAN.md` (arquitectura y etapas), `ROADMAP.md` (lo que falta) y `CLAUDE.md` (convenciones para Claude Code).

---

## 1. Qué es el producto

**ConsultorQMS** (consultorqms.com) es un SaaS que usa IA para reemplazar al consultor humano de certificación ISO. Guía a pymes por la preparación para certificar (empezando por **ISO 9001**) a una fracción del costo de una consultora tradicional (que cobra ~2.000–3.000 USD).

**Propuesta de valor:** un "consultor IA con base de conocimiento" que diagnostica, detecta brechas, genera las tareas y escribe los documentos que la empresa necesita para estar lista para auditar.

**Límite crítico (legal y de expectativas):** el producto **prepara para auditar, NO emite el certificado**. El certificado lo da una certificadora acreditada externa (Bureau Veritas, SGS, TÜV, etc.). Esto debe quedar explícito en la app y los términos.

**Rol esperado de la IA que asista:** actuar como **cofundador técnico**, no como asistente pasivo. Dueño de las decisiones de arquitectura, directo, una sola vía clara por vez (no listas de opciones), respetando las reglas de abajo.

---

## 2. Estado actual — qué está construido y funcionando ✓

De idea a producto real, en varias sesiones. Funcionando de punta a punta:

- **Infra/datos:** Aurora PostgreSQL Serverless v2 en AWS (con **RDS Data API**), 16 tablas multi-tenant + catálogo **ISO 9001 (28 cláusulas, 4.1 a 10.3)** cargado.
- **App Next.js (App Router):**
  - `/requirements` — lista las 28 cláusulas.
  - `/projects` — dashboard, crear y ver **Proyectos ISO X**.
  - `/projects/[id]` — detalle del proyecto (norma, estado, `readiness_pct`, links).
  - `/projects/[id]/diagnostic` — **diagnóstico**: marca cumple/parcial/gap/no-aplica por cláusula, calcula `readiness_pct`. Incluye **diagnóstico asistido por IA** (agente que evalúa las 28 cláusulas leyendo un texto de contexto de la empresa; el humano acepta/corrige) y, por cláusula, el **panel de evidencia** (subir / listar / descargar / borrar archivos en S3).
  - `/projects/[id]/tasks` — **tareas** generadas desde los gaps + tareas manuales.
  - `/projects/[id]/documents` + `/documents/[docId]` — **documentos generados por IA** (borradores de procedimientos/políticas adaptados al rubro).
- **Dos agentes IA funcionando** sobre una capa de modelo intercambiable:
  1. **Agente de diagnóstico** — propone estado + justificación por cláusula.
  2. **Agente de documentación** — genera el borrador del documento que falta.

El flujo del consultor IA está andando: **diagnostica → detecta gaps → genera tareas → escribe documentos**. Con humano-en-el-loop (la IA propone, el usuario confirma).

---

## 3. Arquitectura y stack

- **Frontend:** Next.js (App Router, TypeScript). Server Components + **Server Actions** para escritura. Hoy corre en local; deploy previsto en **Vercel**.
- **Datos:** Aurora PostgreSQL Serverless v2, accedida por **RDS Data API** (HTTPS, sin VPC/red). ORM **Drizzle**. Multi-tenant por `org_id`.
- **IA:** **Amazon Bedrock**, modelo `anthropic.claude-sonnet-4-6`. Orquestación propia con tool-calling / mensajes (NO Bedrock Agents administrado). Capa de modelo **intercambiable** en `apps/web/src/lib/ai.ts`.
- **Archivos:** **S3 funcionando** para evidencia. Bucket privado; la subida va **directa del navegador a S3** con presigned URL (el archivo nunca pasa por el server de Next: Vercel tiene límite de body y cobra tránsito). Claves prefijadas por `org_id/project_id/requirement_id/`. El listado sale siempre de la tabla `evidence`, nunca de `s3:ListBucket`. Ver `lib/s3.ts` y `lib/evidence-files.ts`.
- **Auth:** Amazon Cognito (Hosted UI + Authorization Code, cookies httpOnly). El `org_id` sale de la sesión vía `getOrgId()`. Una organización por usuario; invitaciones y multi-usuario, pendientes.
- **Monorepo:** pnpm + Turborepo.
- **Repo:** `github.com/alaskachile/consultorqms-com` (privado; se hace público solo temporalmente para clonar cuando hace falta). Email de commits: `desarrollo@alaskachile.cl`.

---

## 4. Estructura del monorepo

```
consultorqms-com/
├─ PLAN.md · ROADMAP.md · CLAUDE.md · CONTEXTO.md
├─ apps/web/            # Next.js (Vercel) — TODO el frontend + agentes viven acá
│  └─ src/
│     ├─ lib/db.ts               # cliente Drizzle por Data API + helper withEnumCasts
│     ├─ lib/auth.ts             # sesión de Cognito (requireSession, cookies)
│     ├─ lib/org.ts              # getOrgId(): org del usuario logueado (la crea si no existe)
│     ├─ lib/ai.ts               # capa de modelo intercambiable (Bedrock / z.ai)
│     ├─ lib/s3.ts               # presigned URLs de subida/descarga, claves por org_id
│     ├─ lib/evidence-files.ts   # validación de archivos (tipo, tamaño, nombre)
│     ├─ lib/agents/diagnostic.ts     # agente 1
│     ├─ lib/agents/documentation.ts  # agente 2
│     └─ app/...                 # rutas (requirements, projects, diagnostic, tasks, documents)
├─ packages/db/         # schema Drizzle + seed ISO 9001 (@cqms/db)
├─ packages/shared/     # tipos y enums de dominio (@cqms/shared)
├─ infra/               # AWS CDK (existe, pero la base se creó a mano por consola)
└─ .github/workflows/   # CI (hoy falla, pendiente arreglar)
```

---

## 5. Modelo de datos (resumen)

Catálogo global (IP propia): `standards`, `requirements`, `requirement_guidance`.
Por tenant (`org_id`): `organizations`, `users`, `projects`, `diagnostics`, `tasks`, `documents`, `document_versions`, `evidence`, `reviews`, `internal_audits`, `audit_findings`, `corrective_actions`, `agent_runs`.

- `readiness_pct` = cláusulas **compliant** / (aplicables − not_applicable). Se recalcula al guardar. Las cláusulas sin evaluar cuentan como "no listas" (correcto para compliance).
- `agent_runs` registra cada corrida de agente (input/output/tokens) → trazabilidad y control de costo.

---

## 6. Los agentes IA — cómo funcionan

- **Capa `ai.ts`:** función `invokeModel(...)` con proveedor por variable `AI_PROVIDER` (default `bedrock`). Backend Bedrock usa `@aws-sdk/client-bedrock-runtime`; si el modelo pide inference profile, reintenta con prefijo `us.` (ej. `us.anthropic.claude-sonnet-4-6`). Estructura lista para z.ai/GLM (Anthropic-compatible) sin activar. **Todo agente nuevo reutiliza esta capa, no crea otra conexión.**
- **Agente de diagnóstico:** recibe contexto de la empresa + las 28 cláusulas con su guía; devuelve JSON `[{clauseNo, status, rationale}]`; UPSERT en `diagnostics` (rationale → `ai_notes`); no pisa lo que el usuario editó a mano.
- **Agente de documentación:** recibe una cláusula (gap/partial) + guía + contexto; devuelve markdown; inserta en `documents` + `document_versions`.
- **Salida validada** antes de tocar la base; **humano-en-el-loop** siempre (la IA propone, el usuario acepta/corrige).

---

## 7. Referencias de infraestructura AWS

- **Cuenta:** `426192959582` · **Usuario IAM:** `gobernanza-admin` · **Región:** `us-east-1`.
- **Cluster Aurora:** `database-2` · **ARN:** `arn:aws:rds:us-east-1:426192959582:cluster:database-2`.
- **Secret (credenciales maestras):** `arn:aws:secretsmanager:us-east-1:426192959582:secret:rds!cluster-c13adef2-f598-4ea3-b6cb-324ed45f33fa-EXQYdu` · **DB:** `postgres`.
- **Modelo Bedrock:** `anthropic.claude-sonnet-4-6` (con reintento `us.` si pide inference profile).
- **Nota importante:** el `.env` local contiene `DB_CLUSTER_ARN`, `DB_SECRET_ARN`, `DB_NAME`, `AWS_REGION`. Las **llaves AWS y la contraseña de la base NO están en el repo ni en este documento** — viven en `aws configure` local y en Secrets Manager. El `.env` está en `.gitignore`.

---

## 8. Aprendizajes clave y gotchas (NO regresionar)

- **Bug de enums en Data API:** el driver manda los valores enum como texto plano → error `type mismatch` tanto en INSERT como en comparaciones WHERE (`operator does not exist: enum = text`). Solución: helper **`withEnumCasts`** para INSERT y cast explícito `valor::tipo_enum` en los WHERE. Aplicar siempre; ya nos rompió dos veces.
- **CDK evitado para crear la base:** el cluster Aurora se creó **a mano por la consola** con Data API, lo que eliminó toda la fricción de VPC/red. No reintroducir complejidad de CDK sin razón fuerte.
- **Data API = clave del stack:** al ser HTTPS, elimina VPC, security groups, psql, connection strings. Es lo que hace que Next → Drizzle → Aurora funcione sin pelear con red. Frontend y agentes hablan por acá.
- **Provider portable:** `AI_PROVIDER` mantiene el modelo intercambiable Bedrock ↔ z.ai/GLM. z.ai expone API compatible con Anthropic (cambiar `ANTHROPIC_BASE_URL` + key). Preservar esta abstracción. Bedrock/Claude ahora (mejor calidad, cubierto por créditos AWS); z.ai/GLM como palanca de costo a escala.
- **Checksum del SDK de S3 rompe TODA subida prefirmada:** desde `@aws-sdk/client-s3` **v3.729** el SDK agrega por defecto un checksum (`x-amz-checksum-crc32`) al `PutObject`. En una URL prefirmada ese header queda **firmado**, el navegador nunca lo manda y S3 devuelve **403 en cada subida** (sin pista de por qué). Solución: crear el `S3Client` con **`requestChecksumCalculation: "WHEN_REQUIRED"`** (`lib/s3.ts`). No sacarlo.
- **El presigner NO firma `content-type`:** `s3-request-presigner` firma `content-length;host` — el `ContentLength` va firmado (el PUT tiene que traer exactamente ese tamaño, es lo que impide reusar una URL de 2 MB para subir 2 GB), pero el `content-type` está en `unsignableHeaders` a propósito (el navegador puede reescribirlo y rompería la firma). O sea: el tipo declarado al pedir la URL **no es garantía** de lo que se subió. Por eso la descarga fuerza `ResponseContentDisposition: attachment` en vez de confiar en él (evita ejecutar HTML/SVG subido bajo el dominio de S3).
- **Copyright ISO:** el texto oficial de las normas NUNCA se almacena; solo contenido propio parafraseado. Restricción dura.
- **Estructurado vs RAG:** el checklist de requisitos y el cálculo de readiness viven en Postgres (determinístico, citable). El RAG queda reservado solo para guía/ejemplos explicativos (aún no construido).
- **Humano-en-el-loop:** la IA propone estados/documentos; el humano confirma antes de que cuenten para `readiness_pct`. Es intencional y arquitectónicamente aplicado (compliance).
- **Settings de Claude Code / GLM:** un `settings.json` con bloque `env` puede redirigir Claude Code a z.ai (fake Anthropic URLs) y hacer que "Opus/Sonnet" sean GLM. Si hay problemas de auth o aparece `glm`, revisar y limpiar ese `env`. Usar login con cuenta Anthropic, NO API key.

---

## 9. Entorno de desarrollo y patrones de trabajo

- **SO:** Windows con **PowerShell**. PowerShell viejo **no acepta `&&`** para encadenar → usar `;` o comandos separados. Si bloquea scripts (`npm`), usar **CMD** o `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Herramientas confirmadas:** Node v24, pnpm 9, AWS CLI 2.36+, `@anthropic-ai/claude-code` v2.1.x.
- **Claude Code es la herramienta principal de desarrollo.** El usuario aprueba acciones una por una.
  - **Aprobar:** creación/edición de archivos en `apps/web`, typecheck, comandos read-only, instalar deps, `pnpm add`.
  - **Rechazar:** volcados de `env` completo (exponen secretos), y todo lo que toque `packages/db/src/schema.ts`, `infra/` o `.env`.
- **`.env` NO se versiona** (está en `.gitignore`). En una máquina nueva hay que recrearlo + `aws configure` + login de Claude Code.
- **Estilo de interacción preferido:** brevedad y dirección. Una vía clara, no menú de opciones. Sin explicaciones largas salvo que se pidan. Reconocer los hitos.

---

## 10. Cómo levantar el proyecto (máquina ya configurada)

```
pnpm install                       # si es checkout nuevo
pnpm --filter @cqms/web dev        # levanta la app en localhost:3000
```
Verificar salud: abrir `localhost:3000/projects`. Aurora Serverless puede pausarse por inactividad; la primera consulta tarda unos segundos en "despertar".

Máquina nueva: clonar de GitHub (el repo está completo; los backups por carpeta pueden venir sin `packages/`), recrear `.env` con los ARNs de la sección 7, `aws configure`, e instalar/loguear Claude Code (cuenta Anthropic).

---

## 11. Qué falta — próximos pasos (ver ROADMAP.md para el detalle)

Orden recomendado hacia "un cliente pagando":
1. **Arreglar el CI** de GitHub Actions (falla en cada push; sacar ruido).
2. ~~**Subir evidencia a S3**~~ (hecho) → **validación de evidencia** por IA (ahora sí se puede: ya hay archivos que validar).
3. ~~**Cognito** (login real, reemplazar Demo Org)~~ (hecho) → **aislamiento multi-tenant probado**.
4. **Deploy en Vercel** + dominio + credenciales de producción (sacar secretos del `.env` local; cerrar acceso público de Aurora).
5. **Stripe** (suscripción).
6. **Agente auditor** (auditoría interna simulada) y **agente coach** (chat guía) — completan el flujo.
7. **KB curada por experto ISO 9001** + **disclaimers legales** (contenido, en paralelo).
8. **UI/UX profesional** al final (Tailwind + shadcn; renderer markdown completo — hoy las tablas se ven con `|` crudos).

**Lo difícil ya está hecho** (dos agentes IA sobre AWS). Lo que resta es sumar ladrillos: código, ops de consola y contenido/legal.

---

## 12. Cómo continuar

- Antes de construir: confirmar que la app levanta y muestra los proyectos (no construir sobre algo dormido).
- Cada feature nueva se le pasa a **Claude Code** con un prompt que: referencia `PLAN.md`/`CLAUDE.md`, da contexto del estado, marca claramente **qué NO tocar** (schema, infra, `.env`, red), acota los permisos de escritura a las tablas necesarias, y pide frenar antes de cualquier comando destructivo.
- Reutilizar siempre lo que ya existe: la capa `ai.ts` para agentes nuevos, `withEnumCasts` para enums, `getOrgId()` para el tenant.
- Guardar en git al cerrar cada avance (`git add . ; git commit -m "..." ; git push`).
