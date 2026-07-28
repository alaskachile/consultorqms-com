import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { OAUTH_STATE_COOKIE, getAuthEnv, getRedirectUri, useSecureCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inicio del Authorization Code flow: manda al Hosted UI de Cognito con un
 * `state` aleatorio que además guardamos en cookie httpOnly. El callback exige
 * que ambos coincidan (anti-CSRF).
 */
export async function GET() {
  const env = getAuthEnv();
  const state = randomBytes(32).toString("base64url");

  const authorizeUrl = new URL(`${env.hostedUiOrigin}/oauth2/authorize`);
  authorizeUrl.searchParams.set("client_id", env.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  // Solo lo que necesitamos: `email` es el claim que muestra /projects.
  authorizeUrl.searchParams.set("scope", "openid email");
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutos: solo tiene que sobrevivir al viaje al Hosted UI.
  });

  return response;
}
