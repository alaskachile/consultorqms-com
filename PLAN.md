# ConsultorQMS — Plan de construcción

Documento de proyecto. Dejalo en la raíz del repo (`PLAN.md`) para que Claude Code lo use como contexto en cada sesión. Junto con un `CLAUDE.md` de convenciones, es lo que mantiene el rumbo entre sesiones.

---

## 1. Visión del MVP

Un QMS guiado por un consultor IA que reemplaza el grueso del trabajo de una consultora ISO. **El producto NO emite el certificado** (eso lo hace una certificadora acreditada externa); el producto deja a la empresa **lista para auditar**.

Decisión clave de construcción: **se construye el motor sobre ISO 9001 y luego se reutiliza.** ISO 9001, 14001, 45001, 27001, 50001, 37001, 22301 y 20000-1 comparten estructura (Annex SL, cláusulas 4–10), así que agregar normas es sobre todo **cargar base de conocimiento**, no reescribir el sistema. 13485 y 22000 (estructura propia) van al final.

La entidad central es el **Proyecto ISO X**: una empresa persiguiendo una norma, con su diagnóstico, sus controles/requisitos, sus tareas, sus documentos, su evidencia, sus validaciones y su auditoría interna. Todo confluye en un **% de preparación para auditar**.

---

## 2. Stack y decisiones

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | Next.js (App Router) en Vercel | UI, chat, dashboards, editor de docs |
| Auth | Clerk **o** Amazon Cognito | Clerk = DX más simple con Vercel; Cognito = todo en AWS |
| API / orquestación | Lambda + API Gateway (framework Hono) | Acá vive el "método QMS" codificado |
| Jobs largos | Step Functions / SQS + Lambda | Diagnóstico y generación de docs son async |
| IA | Amazon Bedrock (modelo Claude) | Orquestación propia con tool-calling, **no** Bedrock Agents administrado al inicio |
| Conocimiento (RAG) | Bedrock Knowledge Bases + OpenSearch Serverless | Solo guía explicativa y ejemplos; **el checklist va en Postgres** |
| Datos | Aurora PostgreSQL Serverless v2 | Multi-tenant por `org_id` |
| Archivos | Amazon S3 | Evidencia y documentos, presigned URLs |
| Email | Amazon SES | Notificaciones, recordatorios de tareas |
| Pagos | Stripe | Suscripción mensual por norma + add-ons |
| IaC | AWS CDK (TypeScript) **o** SST | CDK = estándar; SST = mejor DX con Next |
| Repo / CI | GitHub + GitHub Actions | Monorepo |

> **ORM**: usar Drizzle o Prisma (Drizzle recomendado en Lambda por arranque más liviano).
> **Modelo de Bedrock**: verificá el ID vigente del modelo Claude en Bedrock al configurar (cambia con cada release). Para tareas masivas/baratas usá un modelo chico; para diagnóstico y auditoría, uno potente.

---

## 3. Estructura del monorepo

```
consultorqms/
├─ PLAN.md                 # este archivo
├─ CLAUDE.md               # convenciones para Claude Code
├─ apps/
│  └─ web/                 # Next.js (Vercel)
├─ packages/
│  ├─ api/                 # handlers Lambda (Hono) — la capa de orquestación
│  ├─ db/                  # schema Drizzle + migraciones + seeds
│  ├─ agents/              # capa de agentes IA (Bedrock) + prompts
│  ├─ knowledge/           # ingestión y consulta de la KB (RAG)
│  └─ shared/              # tipos, contratos, utilidades, dominio
└─ infra/                  # CDK o SST (Aurora, S3, Bedrock KB, OpenSearch, etc.)
```

Gestor: pnpm + Turborepo. Todo en TypeScript de punta a punta para compartir tipos entre frontend, API y agentes.

---

## 4. Modelo de dominio (el corazón)

Entidades y relaciones. Las de **catálogo** son globales (tu IP, iguales para todos los tenants). Las de **tenant** llevan `org_id` y son por cliente.

**Catálogo (global, tu IP):**
- `standards` — las normas (ISO 9001, 14001, …).
- `requirements` — los requisitos/controles de cada norma, parafraseados por vos (cláusula 7.1.5, etc.). Jerárquicos (parent_id).
- `requirement_guidance` — por requisito: qué evidencia se espera, qué documento lo cubre, criterio de auditoría.

**Tenant (por cliente):**
- `organizations` — la empresa cliente (rubro, tamaño, país).
- `users` — usuarios de la empresa (roles: admin, member) + revisores internos.
- `projects` — **Proyecto ISO X**: org + norma + alcance + estado + % preparación.
- `diagnostics` — por proyecto y requisito: estado (cumple / parcial / gap), respuesta, prioridad, notas IA.
- `tasks` — derivadas de los gaps (o de auditoría / manuales): responsable, vencimiento, estado.
- `documents` + `document_versions` — documentos del QMS (política, procedimiento, registro), generados o subidos, versionados.
- `evidence` — archivos que sube el cliente para demostrar cumplimiento, ligados a un requisito.
- `reviews` — **validación**: veredicto sobre un documento o evidencia (aceptado / requiere trabajo / rechazado), por IA o humano, con hallazgos.
- `internal_audits` + `audit_findings` + `corrective_actions` — auditoría interna simulada y sus no conformidades.
- `agent_runs` — log de cada corrida de agente (input, output, tokens, costo) para trazabilidad y control de gasto.

Flujo de un proyecto:
```
crear proyecto → definir alcance (entrevista) → diagnóstico por requisito
→ gaps → tareas → generar/subir documentos → subir evidencia
→ validación → auditoría interna → % listo para auditar
```

---

## 5. Modelo de datos (tablas)

Esquema de referencia (resumido). Toda tabla de tenant lleva `org_id` y se filtra **siempre** por el `org_id` derivado del token, nunca del cliente.

```
standards(id, code, name, version, structure_type)            -- catálogo
requirements(id, standard_id, clause_no, title,
             paraphrased_text, category, parent_id)           -- catálogo (IP)
requirement_guidance(id, requirement_id, expected_evidence,
             suggested_document_type, audit_criteria)         -- catálogo

organizations(id, name, industry, size, country, created_at)
users(id, org_id, email, name, role, created_at)

projects(id, org_id, standard_id, name, scope, status,
         readiness_pct, target_audit_date, created_at)

diagnostics(id, org_id, project_id, requirement_id, status,
            answer_text, priority, ai_notes, updated_at)

tasks(id, org_id, project_id, requirement_id?, title, description,
      assignee_id?, due_date?, status, source)

documents(id, org_id, project_id, requirement_id?, type, title,
          current_version_id?, origin, status)
document_versions(id, document_id, version_no, s3_key?,
          content_md?, created_by, created_at)

evidence(id, org_id, project_id, requirement_id, s3_key,
         filename, uploaded_by, uploaded_at)

reviews(id, org_id, project_id, target_type, target_id,
        reviewer_type, verdict, findings_json, reviewer_id?, created_at)

internal_audits(id, org_id, project_id, status, started_at,
        completed_at, summary)
audit_findings(id, audit_id, requirement_id, type, description, status)
corrective_actions(id, finding_id, action_text, owner_id?, due_date?, status)

agent_runs(id, org_id, project_id?, agent, input_json, output_json,
        tokens_in, tokens_out, cost_usd, created_at)
```

> **Cálculo de `readiness_pct`**: derivado de los `diagnostics` (peso por prioridad/criticidad del requisito) + evidencia validada. Es lógica de negocio en la capa API, no del modelo IA. Esto es lo que mueve la barra de progreso que le da confianza al cliente.

---

## 6. Capa de conocimiento (RAG)

Regla de oro: **no todo va a RAG.**

- **Estructurado → Postgres** (`requirements`, `requirement_guidance`): es lo que define el checklist, el progreso y los criterios de auditoría. Determinístico, citable, sin alucinación.
- **No estructurado → Bedrock KB**: guía explicativa, ejemplos por rubro, interpretaciones. Se consulta por RAG con metadata `{standard, clause}` para que cada respuesta cite la cláusula.

**Copyright (crítico):** el texto oficial de las normas ISO tiene derechos de autor y se vende. **Nunca** cargar el PDF oficial en la KB. Todo el contenido es parafraseado y original tuyo (idealmente revisado por un experto por norma). Esto es legal y producto a la vez.

Ingestión (Etapa 4): documentos propios de guía de ISO 9001 → chunking → embeddings → OpenSearch Serverless, con metadata de cláusula.

---

## 7. Capa de agentes IA

Orquestación propia (código tuyo llamando a Bedrock con tool-calling), no un prompt gigante. Cada agente tiene prompt propio, acceso acotado a herramientas y queda registrado en `agent_runs`.

1. **Agente de diagnóstico** — entrada: perfil de la empresa + respuestas de la entrevista. Herramientas: leer catálogo de requisitos, recuperar guía de la KB. Salida: por cada requisito → estado (cumple/parcial/gap) + prioridad + justificación citando la cláusula.
2. **Agente de documentación** — entrada: requisito + contexto del rubro. Herramientas: recuperar plantillas de la KB. Salida: borrador de documento (markdown) adaptado al rubro, no plantilla genérica.
3. **Agente auditor** — entrada: estado del proyecto + documentos + evidencia. Salida: preguntas tipo auditor, evaluación de evidencia y hallazgos (no conformidades).
4. **Agente coach** — conversacional, explica en lenguaje de pyme y guía el próximo paso. Herramienta: leer el estado del proyecto.

**Validación** = función que corre el agente auditor (o de documentación) sobre un target (evidencia o documento) y produce un `review` con veredicto estructurado. Toda recomendación debe poder citar la cláusula en que se basa → trazabilidad para la auditoría.

---

## 8. Capa API (endpoints principales)

REST sobre API Gateway + Lambda (Hono). Todo scoped por `org_id` del token.

```
POST   /projects                         crear Proyecto ISO X
GET    /projects                         listar (con readiness)
GET    /projects/:id                     detalle + checklist de requisitos
POST   /projects/:id/scope               entrevista de alcance
POST   /projects/:id/diagnostic/run      corre diagnóstico (async)
GET    /projects/:id/requirements        requisitos con su estado
POST   /requirements/:id/answer          responder un requisito
GET/POST /projects/:id/tasks             tareas
POST   /projects/:id/documents/generate  generar documento (async)
GET/PUT  /documents/:id                  documento + versiones
POST   /projects/:id/evidence            subir evidencia (presigned S3)
POST   /reviews                          correr validación sobre target
POST   /projects/:id/audit/run           auditoría interna simulada
POST   /chat                             agente coach (streaming)
```

---

## 9. Capa frontend (pantallas)

Next App Router en Vercel. Llama a la API de AWS.

```
/(auth)/login
/dashboard                          proyectos + progreso global
/projects/new                       crear proyecto + wizard de alcance
/projects/[id]                      overview: anillo de readiness + checklist
/projects/[id]/diagnostic           diagnóstico / GAP report
/projects/[id]/requirements/[rid]   detalle: estado, evidencia esperada,
                                    suba de docs, resultado de validación
/projects/[id]/tasks                tareas con responsables y vencimientos
/projects/[id]/documents            documentos y versiones
/projects/[id]/audit                auditoría interna y no conformidades
```
Más un widget de chat (coach) persistente.

---

## 10. Etapas de construcción

Cada etapa tiene objetivo, qué se construye y **Definition of Done (DoD)**. Las primeras son fundaciones por capa; de la 6 en adelante son features verticales.

### Etapa 0 — Fundaciones
- Monorepo (pnpm + Turborepo), repo en GitHub, GitHub Actions (lint, typecheck, deploy).
- Cuenta AWS + IaC inicial (CDK/SST). Manejo de secrets (Secrets Manager / env).
- App Next vacía desplegada en Vercel; stack AWS vacío desplegado.
- **DoD:** push a main → CI verde → web en Vercel y stack en AWS desplegados.

### Etapa 1 — Capa de datos
- Aurora Postgres Serverless v2. Schema Drizzle + migraciones.
- Seed de `standards` + `requirements` + `requirement_guidance` de **ISO 9001** (aunque arranque con contenido provisorio).
- Helper de scoping multi-tenant.
- **DoD:** migraciones corren; el catálogo de 9001 queda cargado y consultable.

### Etapa 2 — Auth + esqueleto API
- Clerk o Cognito integrado. API Gateway + Lambda (Hono).
- CRUD de organización y usuarios. Middleware que deriva `org_id` del token.
- **DoD:** usuario autenticado crea su organización; el scoping por tenant funciona y está testeado.

### Etapa 3 — Shell del frontend
- Next App Router con auth, layout, dashboard.
- Listado y creación de proyectos.
- **DoD:** login → crear "Proyecto ISO 9001" → verlo en el dashboard.

### Etapa 4 — Capa de conocimiento
- Bedrock KB + OpenSearch Serverless. Ingestión de la guía propia de 9001 con metadata por cláusula.
- **DoD:** una consulta por cláusula devuelve guía relevante y citable.

### Etapa 5 — Capa de agentes (orquestación)
- Wrapper de Bedrock (InvokeModel) + framework de tool-calling. Logging en `agent_runs`.
- Primer agente: **diagnóstico**.
- **DoD:** correr diagnóstico sobre un proyecto guarda estados por requisito con justificación citada.

### Etapa 6 — Feature: Diagnóstico / GAP (vertical completo)
- Entrevista de alcance → corrida de diagnóstico (async, Step Functions) → GAP report en UI → cálculo de `readiness_pct`.
- **DoD:** un cliente completa la entrevista y ve su informe de brechas con % de preparación.

### Etapa 7 — Feature: Tareas
- Generación automática de tareas desde los gaps, asignación, vencimientos, estados, recordatorios por SES.
- **DoD:** los gaps generan tareas accionables con responsable y fecha.

### Etapa 8 — Feature: Documentos
- Generación con el agente de documentación, versionado, editor en UI, posibilidad de subir documento propio.
- **DoD:** generar una política/procedimiento adaptado al rubro, editarlo y versionarlo.

### Etapa 9 — Feature: Suba de evidencia + validación
- Subida a S3 (presigned), ligada al requisito. Correr validación → `review` con veredicto y hallazgos en UI.
- **DoD:** subir evidencia para un requisito y recibir un veredicto trazable (aceptado / requiere trabajo + por qué).

### Etapa 10 — Feature: Auditoría interna simulada
- Agente auditor genera preguntas y hallazgos; no conformidades → acciones correctivas con seguimiento.
- **DoD:** correr una auditoría interna que produzca no conformidades y su plan de corrección.

### Etapa 11 — Coach + pulido del dashboard
- Chat coach persistente con contexto del proyecto. Anillo de readiness y resumen de estado.
- **DoD:** el usuario puede preguntarle al coach "¿qué me falta?" y recibir el próximo paso concreto.

### Etapa 12 — Pagos + multi-norma
- Stripe (suscripción + add-on de revisión humana). Expandir KB a ISO 14001 y 45001 (reúso de motor Annex SL).
- **DoD:** un cliente paga y abre un segundo proyecto de otra norma sin tocar el motor.

---

## 11. Infra AWS (servicios)

Aurora PostgreSQL Serverless v2 · S3 · Bedrock (runtime + Knowledge Bases) · OpenSearch Serverless (vector) · Lambda + API Gateway · Step Functions + SQS (jobs largos) · Cognito (si no usás Clerk) · SES · Secrets Manager · CloudWatch. Todo definido en `infra/` con CDK o SST. Frontend en Vercel (fuera de AWS).

---

## 12. Seguridad, multi-tenant y copyright

- **Aislamiento de tenant:** `org_id` en cada fila; el acceso a datos pasa siempre por una capa de repositorio que inyecta el `org_id` del token. Nunca confiar en un `org_id` que mande el cliente. Considerar Row-Level Security en Postgres como defensa en profundidad.
- **Archivos:** claves de S3 prefijadas por `org_id`; presigned URLs acotadas y de corta duración.
- **Trazabilidad:** toda recomendación/validación cita la cláusula y queda registrada (`agent_runs`, `reviews`). Es lo que vale en una auditoría.
- **Copyright:** la KB es contenido propio parafraseado; jamás el texto oficial de la norma.
- **Disclaimer de producto:** dejar explícito que ConsultorQMS prepara para auditar y no emite el certificado.

---

## 13. Próximo paso de build

Arrancar por **Etapa 0** y **Etapa 1**: scaffolding del monorepo + infra + schema de datos con el catálogo de ISO 9001. Es la base sobre la que se monta todo el resto.
