import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CognitoJwtVerifier } from "aws-jwt-verify";

/**
 * Etapa 2 — Paso A: sesión de Cognito (Hosted UI + Authorization Code flow).
 *
 * El intercambio `code -> token` corre server-side con un client confidencial
 * (con secret). Los tokens viven en cookies httpOnly; el navegador nunca los ve
 * desde JS.
 *
 * ⚠️ Paso A solamente: acá NO se deriva todavía el `org_id`. El scoping por
 * organización (y el borrado de `getDemoOrgId()`) es el Paso B.
 */

/** Nombres de las cookies de sesión. */
export const ID_TOKEN_COOKIE = "cqms_id_token";
export const REFRESH_TOKEN_COOKIE = "cqms_refresh_token";
export const OAUTH_STATE_COOKIE = "cqms_oauth_state";

export type Session = {
  /** `sub` del usuario en Cognito: identificador estable. */
  sub: string;
  email: string;
};

type AuthEnv = {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret: string;
  /** Origen del Hosted UI, ya normalizado y sin barra final. */
  hostedUiOrigin: string;
  /** URL pública de la app, sin barra final. */
  appUrl: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta ${name} en el entorno. Se carga desde el .env de la raíz del monorepo (ver next.config.mjs).`,
    );
  }
  return value;
}

/**
 * Normaliza `COGNITO_DOMAIN` al origen completo del Hosted UI.
 * Acepta las tres formas habituales: URL completa, host `xxx.auth.<region>.amazoncognito.com`,
 * o solo el prefijo del dominio.
 */
function normalizeHostedUiOrigin(domain: string, region: string): string {
  const trimmed = domain.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".")) return `https://${trimmed}`;
  return `https://${trimmed}.auth.${region}.amazoncognito.com`;
}

/**
 * Lectura perezosa del entorno: si falta una variable, falla al usarse y no al
 * importarse (si no, `next build` revienta al pre-renderizar, mismo problema
 * que ya arrastramos en `db.ts`).
 */
let cachedEnv: AuthEnv | null = null;

export function getAuthEnv(): AuthEnv {
  if (cachedEnv) return cachedEnv;

  const region = required("COGNITO_REGION");
  cachedEnv = {
    region,
    userPoolId: required("COGNITO_USER_POOL_ID"),
    clientId: required("COGNITO_CLIENT_ID"),
    clientSecret: required("COGNITO_CLIENT_SECRET"),
    hostedUiOrigin: normalizeHostedUiOrigin(required("COGNITO_DOMAIN"), region),
    appUrl: required("APP_URL").replace(/\/+$/, ""),
  };
  return cachedEnv;
}

/** URI de callback registrada en el App Client de Cognito. */
export function getRedirectUri(): string {
  return `${getAuthEnv().appUrl}/api/auth/callback`;
}

/**
 * Verifier de `aws-jwt-verify`, cacheado a nivel módulo: descarga el JWKS del
 * user pool una sola vez y lo reutiliza entre requests (crearlo por request
 * significaría un fetch del JWKS por request).
 */
let cachedVerifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier() {
  if (cachedVerifier) return cachedVerifier;
  const env = getAuthEnv();
  cachedVerifier = CognitoJwtVerifier.create({
    userPoolId: env.userPoolId,
    tokenUse: "id",
    clientId: env.clientId,
  });
  return cachedVerifier;
}

/** `true` en producción: las cookies de sesión van marcadas `secure`. */
export function useSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Devuelve la sesión del usuario logueado, o `null` si no hay cookie o el
 * id_token no verifica (expirado, firma inválida, otro client id, etc.).
 */
export async function getSession(): Promise<Session | null> {
  const token = cookies().get(ID_TOKEN_COOKIE)?.value;
  if (!token) return null;

  try {
    const payload = await getVerifier().verify(token);
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) return null;
    return { sub: payload.sub, email };
  } catch {
    // Token inválido o vencido: se trata como "sin sesión". No logueamos el
    // token ni su contenido.
    return null;
  }
}

/**
 * Igual que `getSession()`, pero corta el render y manda a /login cuando no hay
 * sesión válida.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * `true` si el error es el que lanza `redirect()` de Next (no es un fallo: es
 * control de flujo, Next lo usa para cortar el render y navegar).
 *
 * Hace falta en las Server Actions que envuelven todo en `try/catch` y devuelven
 * `{ ok: false, error }`: sin esto, una sesión vencida se tragaría el redirect a
 * `/login` y el usuario vería un mensaje de error en vez de ir a loguearse.
 */
export function isRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
