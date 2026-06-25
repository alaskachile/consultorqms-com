# apps/web — Frontend (Next.js en Vercel)

Esta carpeta es el frontend. Se desarrolla en VS Code con Claude Code y se despliega en Vercel
conectando este repositorio.

## Inicializar (Etapa 3)
```bash
cd apps/web
pnpm create next-app@latest . --ts --app --tailwind --eslint
```

Luego en Vercel:
1. Importar el repositorio de GitHub.
2. Root Directory: `apps/web`.
3. Variables de entorno: las de Cognito y la URL de la API (ver `.env.example` en la raíz).

Ver Etapa 3 en `PLAN.md`.
