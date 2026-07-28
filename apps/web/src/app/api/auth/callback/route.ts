import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  ID_TOKEN_COOKIE,
  OAUTH_STATE_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getAuthEnv,
  getRedirectUri,
  useSecureCookies,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comparación de `state` en tiempo constante. */
function statesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

type TokenResponse = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

/** Vuelve a /login marcando el motivo, sin filtrar detalles del proveedor. */
function failTo(env: ReturnType<typeof getAuthEnv>, reason: string) {
  const response = NextResponse.redirect(`${env.appUrl}/login?error=${reason}`);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

/**
 * Callback del Hosted UI: valida el `state`, canjea el `code` por tokens contra
 * `/oauth2/token` (client confidencial → Authorization: Basic) y deja
 * `id_token` + `refresh_token` en cookies httpOnly.
 */
export async function GET(request: NextRequest) {
  const env = getAuthEnv();
  const params = request.nextUrl.searchParams;

  // Cognito puede volver con error (usuario canceló, client mal configurado...).
  if (params.get("error")) return failTo(env, "oauth");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code) return failTo(env, "missing_code");
  if (!state || !expectedState || !statesMatch(state, expectedState)) {
    return failTo(env, "bad_state");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.clientId,
    code,
    redirect_uri: getRedirectUri(),
  });

  // Client confidencial: las credenciales van en el header Basic, nunca en el body.
  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");

  const tokenResponse = await fetch(`${env.hostedUiOrigin}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    // El cuerpo del error puede traer datos sensibles: no se loguea.
    return failTo(env, "token_exchange");
  }

  const tokens = (await tokenResponse.json()) as TokenResponse;
  if (!tokens.id_token) return failTo(env, "no_id_token");

  const response = NextResponse.redirect(`${env.appUrl}/projects`);
  const secure = useSecureCookies();

  response.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    // La vida real de la sesión la manda el `exp` del token: la cookie solo
    // acompaña. Si el token vence, `getSession()` devuelve null igual.
    maxAge: tokens.expires_in ?? 60 * 60,
  });

  if (tokens.refresh_token) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
