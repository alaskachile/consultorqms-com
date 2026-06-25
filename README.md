# ConsultorQMS

QMS guiado por un consultor IA que prepara empresas para auditar normas ISO.

- Plan completo y arquitectura: [`PLAN.md`](./PLAN.md)
- Convenciones para Claude Code: [`CLAUDE.md`](./CLAUDE.md)

## Estado
Scaffold de Etapa 0 (fundaciones) + Etapa 1 (capa de datos con catálogo ISO 9001).

## Setup rápido
```bash
pnpm install
cp .env.example .env        # completar credenciales
pnpm db:generate            # genera migraciones desde el schema Drizzle
pnpm db:migrate             # aplica migraciones a Aurora
pnpm db:seed                # carga el catálogo de ISO 9001
```

## Estructura
```
apps/web/        Next.js (Vercel)         — frontend (se desarrolla en VS Code)
packages/db/     Drizzle schema + seeds   — capa de datos (CORAZÓN)
packages/shared/ tipos y dominio
packages/api/    handlers Lambda (Hono)   — orquestación
packages/agents/ agentes Bedrock
packages/knowledge/ ingestión y consulta RAG
infra/           AWS CDK                  — Aurora, S3, Cognito, etc.
```

## Próximo paso
Etapa 2: integrar Cognito y levantar el esqueleto de API. Ver `PLAN.md`.
