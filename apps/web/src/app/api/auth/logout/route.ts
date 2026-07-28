import { NextResponse } from "next/server";
import {
  ID_TOKEN_COOKIE,
  OAUTH_STATE_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getAuthEnv,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cierra la sesión local (borra las cookies) y manda al /logout del Hosted UI
 * para que Cognito también invalide su cookie de sesión; si no, el próximo
 * /api/auth/login volvería a entrar solo, sin pedir credenciales.
 *
 * `logout_uri` tiene que estar registrada como "Allowed sign-out URL" en el
 * App Client.
 */
function buildLogoutResponse(status: 307 | 303) {
  const env = getAuthEnv();

  const logoutUrl = new URL(`${env.hostedUiOrigin}/logout`);
  logoutUrl.searchParams.set("client_id", env.clientId);
  logoutUrl.searchParams.set("logout_uri", `${env.appUrl}/login`);

  const response = NextResponse.redirect(logoutUrl.toString(), status);
  response.cookies.delete(ID_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET() {
  return buildLogoutResponse(307);
}

/**
 * Permite cerrar sesión desde un `<form method="post">` sin JS de por medio.
 * Va con 303 a propósito: un 307 conservaría el método y el navegador haría
 * POST contra el /logout de Cognito, que solo responde a GET.
 */
export async function POST() {
  return buildLogoutResponse(303);
}
