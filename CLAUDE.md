# CLAUDE.md — Convenciones de ConsultorQMS

Leé siempre `PLAN.md` antes de trabajar. Es el mapa del proyecto.

## Qué es esto
QMS guiado por IA que prepara empresas para auditar normas ISO. La entidad central es el
**Proyecto ISO X** (una empresa persiguiendo una norma) con su ciclo: diagnóstico → controles →
documentos → evidencia → validación → auditoría interna → % de preparación.

> ConsultorQMS prepara para auditar; **NO emite el certificado** (eso lo hace una certificadora externa).

## Stack
- Frontend: Next.js (App Router) en Vercel.
- Backend/orquestación: Lambda + API Gateway (Hono), TypeScript.
- IA: Amazon Bedrock (modelo Claude) con orquestación propia y tool-calling. No usar Bedrock Agents administrado al inicio.
- RAG: Bedrock Knowledge Bases + OpenSearch Serverless. Solo guía explicativa; el checklist va en Postgres.
- Datos: Aurora PostgreSQL Serverless v2, multi-tenant por `org_id`. ORM: Drizzle.
- Archivos: S3 (presigned URLs). Auth: Amazon Cognito. Email: SES. Pagos: Stripe.
- Infra: AWS CDK (TypeScript) en `infra/`.

## Reglas de oro (no romper)
1. **Multi-tenant:** toda query a tablas de tenant se filtra por el `org_id` derivado del token, nunca del cliente. Usá la capa de repositorio; nunca confíes en un `org_id` recibido del frontend.
2. **Copyright:** la base de conocimiento es contenido propio parafraseado. NUNCA cargar el texto oficial de una norma ISO.
3. **Trazabilidad:** toda recomendación/validación cita la cláusula y se registra (`agent_runs`, `reviews`).
4. **Estructurado vs RAG:** los requisitos y criterios viven en Postgres (`requirements`, `requirement_guidance`); el RAG es solo para guía/ejemplos.
5. **Annex SL:** construir el motor sobre ISO 9001 y reutilizarlo. Agregar normas = cargar KB, no reescribir el motor.

## Orden de construcción
Seguir las Etapas de `PLAN.md`. Estado actual: Etapa 0 (fundaciones) + Etapa 1 (datos) scaffolded.
Próximo: Etapa 2 (auth + esqueleto API con Cognito).

## Convenciones de código
- TypeScript estricto en todo el monorepo. Tipos compartidos en `packages/shared`.
- Nombres de tablas y columnas en snake_case; tipos TS en camelCase.
- Cada agente vive en `packages/agents` con su prompt y sus herramientas declaradas.
