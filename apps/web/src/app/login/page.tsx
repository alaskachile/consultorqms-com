// Página mínima a propósito: el diseño viene después. Lo único que tiene que
// hacer es mandar al Hosted UI vía /api/auth/login.
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  oauth: "Cognito rechazó el inicio de sesión.",
  missing_code: "La respuesta de Cognito no trajo el código de autorización.",
  bad_state: "La sesión de login expiró o no coincide. Intentá de nuevo.",
  token_exchange: "No se pudieron canjear los tokens.",
  no_id_token: "Cognito no devolvió un id_token.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const error = searchParams.error ? (ERROR_MESSAGES[searchParams.error] ?? "No se pudo iniciar sesión.") : null;

  return (
    <main>
      <h1>ConsultorQMS</h1>
      {error && <p style={{ color: "#fca5a5" }}>{error}</p>}
      <p>
        <a href="/api/auth/login">Iniciar sesión</a>
      </p>
    </main>
  );
}
