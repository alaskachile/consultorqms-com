# ConsultorQMS — Roadmap de lo que falta

Complemento del `PLAN.md`. Estado a la fecha y pasos restantes para pasar del núcleo funcionando a un SaaS vendible en producción.

---

## Estado actual (hecho ✓)

- Monorepo + GitHub + Aurora PostgreSQL en AWS (Data API) con las 16 tablas y el catálogo ISO 9001 (28 cláusulas).
- App Next.js: catálogo, crear/gestionar **Proyectos ISO X** + dashboard.
- **Diagnóstico** manual + **agente IA de diagnóstico** (evalúa las 28 cláusulas leyendo el contexto de la empresa; humano acepta/corrige; calcula `readiness_pct`).
- **Tareas** generadas desde los gaps.
- **Agente IA de documentación** (genera borradores de procedimientos/políticas adaptados al rubro).

Dos agentes IA en serie sobre la capa de modelo intercambiable (`ai.ts`, Bedrock / z.ai listo).

---

## Cómo leer este roadmap

Los pasos están en **4 bloques**. No es estrictamente secuencial entre bloques, pero **sí hay dependencias marcadas**. Cada paso indica: objetivo, qué incluye, tipo de trabajo (código / consola-ops / contenido-legal) y "Definition of Done" (DoD).

Prioridad general recomendada: **housekeeping rápido → completar flujo de agentes → multi-cliente (Cognito) → producción (deploy) → negocio (Stripe/KB) → UI/UX final.**

---

## Bloque 0 — Housekeeping (rápido, sacar ruido)

### 0.1 Arreglar el CI de GitHub Actions
- **Tipo:** código (workflow).
- **Qué:** el `ci.yml` falla en cada push (probablemente el `build` requiere credenciales/.env que no existen en CI). Ajustarlo para que corra solo `typecheck` (o build sin dependencias de red), sin exponer secretos.
- **DoD:** el push no dispara mails de fallo; el check queda verde.

---

## Bloque 1 — Completar el flujo de consultoría (features + agentes)

> Dependencia clave: la **validación de evidencia** necesita primero **subir archivos (S3)**. Ese es el orden.

### 1.1 Subir documentos y evidencia a S3
- **Tipo:** código + consola (crear bucket / permisos).
- **Qué:** que el cliente cargue los documentos que ya tiene (manual, procedimientos, registros) y la evidencia por cláusula. Subida a S3 con presigned URLs, ligada a `requirement_id` en la tabla `evidence` (ya existe). Claves S3 prefijadas por `org_id`.
- **DoD:** subir un archivo desde una cláusula, verlo listado y poder descargarlo.

### 1.2 Validación de evidencia (agente / lógica)
- **Tipo:** código (reutiliza `ai.ts`).
- **Qué:** dado un documento/evidencia subido + la cláusula, la IA (o una revisión) emite un veredicto (aceptado / requiere trabajo / rechazado) con hallazgos, guardado en la tabla `reviews` (ya existe). Trazable: cita la cláusula.
- **Depende de:** 1.1.
- **DoD:** subir un documento, correr la validación y recibir un veredicto con justificación.

### 1.3 Agente auditor — auditoría interna simulada
- **Tipo:** código (reutiliza `ai.ts`).
- **Qué:** el agente auditor recorre el estado del proyecto y genera preguntas tipo auditor + detecta **no conformidades**, guardadas en `internal_audits` / `audit_findings`, con sus **acciones correctivas** (`corrective_actions`). Todas las tablas ya existen.
- **DoD:** correr una auditoría interna que produzca hallazgos y su plan de corrección.

### 1.4 Agente coach — chat guía en lenguaje pyme
- **Tipo:** código (reutiliza `ai.ts`, con streaming).
- **Qué:** chat persistente que responde "¿qué me falta?", explica cláusulas en lenguaje simple y sugiere el próximo paso, con contexto del proyecto.
- **DoD:** el usuario pregunta y recibe una respuesta útil contextualizada al proyecto.

---

## Bloque 2 — Multi-cliente (de "demo" a "plataforma")

### 2.1 Cognito — autenticación real
- **Tipo:** código + consola (user pool).
- **Qué:** reemplazar el helper temporal `getDemoOrgId()` por el usuario logueado. Al registrarse, crear su organización; todo el scoping por `org_id` pasa a derivarse del token de Cognito, nunca del cliente.
- **Estado:** hecho. Paso A = login con Hosted UI (`lib/auth.ts`); Paso B = `getOrgId()` en `lib/org.ts`, una org por usuario, creada al primer ingreso. `getDemoOrgId()` eliminado.
- **DoD:** dos empresas distintas se registran, cada una ve solo sus proyectos, login/logout funciona.

### 2.2 Aislamiento multi-tenant probado
- **Tipo:** código (revisión de seguridad).
- **Qué:** verificar que ninguna query pueda devolver datos de otra org. Considerar Row-Level Security en Postgres como defensa en profundidad. Test explícito de fuga entre tenants.
- **Depende de:** 2.1.
- **DoD:** un usuario de la org A no puede acceder por URL a un proyecto de la org B (devuelve 404/403).

---

## Bloque 3 — Producción (que exista en internet)

### 3.1 Deploy del frontend en Vercel + dominio
- **Tipo:** consola-ops.
- **Qué:** conectar el repo a Vercel, root `apps/web`, y apuntar `consultorqms.com` ahí.
- **Depende de:** que las credenciales estén en 3.2 (no en `.env` local).
- **DoD:** la app abre en `consultorqms.com` y funciona contra Aurora/Bedrock.

### 3.2 Credenciales y config de producción
- **Tipo:** consola-ops + código.
- **Qué:** mover ARNs y llaves AWS a variables de entorno de Vercel / Secrets Manager (nunca en el repo). Cerrar el acceso público de Aurora que abrimos para desarrollo (la Data API no lo necesita). Un usuario IAM con permisos mínimos (solo `rds-data` + `bedrock:InvokeModel` + leer el secret).
- **DoD:** producción funciona sin ningún secreto en el código ni en el `.env` versionado.

### 3.3 Límites de uso y robustez
- **Tipo:** código.
- **Qué:** tope de uso por cliente (que nadie dispare miles de diagnósticos y queme créditos), rate limiting de las llamadas a los agentes, y manejo robusto de errores de Bedrock (reintentos, mensajes claros, que nunca se rompa la pantalla). El logging ya existe en `agent_runs`.
- **DoD:** un cliente no puede pasar un límite configurado; un fallo del modelo muestra un error claro, no una pantalla rota.

---

## Bloque 4 — Negocio (que se pueda cobrar y sea confiable)

### 4.1 Stripe — suscripción
- **Tipo:** código + consola (Stripe).
- **Qué:** suscripción mensual (no pago único; el QMS se mantiene todos los años). Plan por norma + add-ons. Gating de features según plan.
- **Depende de:** 2.1 (Cognito, para saber quién paga).
- **DoD:** un cliente se suscribe, paga, y accede; sin pago, acceso limitado.

### 4.2 Base de conocimiento curada por experto ISO 9001
- **Tipo:** contenido (corre en paralelo, no bloquea código).
- **Qué:** las 28 cláusulas y su guía hoy están parafraseadas rápido para el scaffold. Para producción, un experto en ISO 9001 debe revisarlas norma por norma. Es tu activo defendible y lo que hace confiable el diagnóstico. Recordá: **nunca** el texto oficial de la norma (copyright), solo contenido propio.
- **DoD:** el catálogo de 9001 revisado y validado por alguien con criterio ISO.

### 4.3 Disclaimers legales
- **Tipo:** contenido-legal.
- **Qué:** dejar explícito en la app y en los términos que ConsultorQMS **prepara para auditar** pero **no emite el certificado** (eso lo hace una certificadora acreditada externa).
- **DoD:** disclaimer visible en la app y en los términos de servicio.

---

## Bloque 5 — UI/UX profesional (al final, sobre todo funcionando)

### 5.1 Pasada de diseño SaaS
- **Tipo:** código (diseño).
- **Qué:** una sola pasada de diseño profesional a todo junto (Tailwind + shadcn/ui recomendado), en vez de pulir pantallas que aún cambian. Incluye un **renderer de markdown completo** (hoy las tablas de los documentos generados se ven con `|` crudos).
- **DoD:** la app tiene aspecto de producto SaaS terminado, consistente y presentable a un cliente.

---

## Orden recomendado (camino más corto a "un cliente pagando")

1. **0.1** CI (sacar ruido) — rápido.
2. **1.1** S3 (subir documentos) → **1.2** validación de evidencia.
3. **2.1** Cognito (multi-cliente) → **2.2** aislamiento probado.
4. **3.1–3.2** Deploy en Vercel + credenciales de producción + dominio.
5. **4.1** Stripe.
6. **1.3 / 1.4** Auditor y coach (completan el flujo; se pueden intercalar antes según demanda).
7. **4.2 / 4.3** KB curada + disclaimers (en paralelo, es contenido).
8. **5.1** UI/UX profesional al final.

**Dependencias que no se saltan:** S3 antes de validación · Cognito antes de Stripe y antes de multi-cliente real · credenciales de producción antes (o junto) al deploy.

**Lo difícil ya está hecho** (los dos agentes IA sobre AWS). Lo que queda es sumar ladrillos: parte código, parte ops de consola, parte contenido/legal.
