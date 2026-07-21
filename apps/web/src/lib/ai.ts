import "server-only";

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Capa de modelo intercambiable.
 *
 * `invokeModel(messages, options)` abstrae el proveedor detrás de la variable de
 * entorno `AI_PROVIDER` (default "bedrock"). El resto del código (agentes) no sabe
 * qué backend corre por debajo: recibe texto y devuelve texto.
 *
 * Backends:
 *  - "bedrock"          → Amazon Bedrock InvokeModel (formato nativo Anthropic).
 *  - "anthropic-compat" → estructura lista para z.ai/GLM u otro endpoint compatible
 *                         con la Messages API (ANTHROPIC_BASE_URL + key). NO activo aún.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface InvokeOptions {
  /** Prompt de sistema (instrucciones de rol). */
  system?: string;
  /** Tope de tokens de salida. Default 4096. */
  maxTokens?: number;
}

export interface InvokeResult {
  /** Texto plano concatenado de los bloques de respuesta. */
  text: string;
  /** Modelo efectivamente usado (puede diferir del pedido si se aplicó prefijo us.). */
  modelId: string;
  provider: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_BEDROCK_MODEL_ID = "anthropic.claude-sonnet-4-6";

export async function invokeModel(
  messages: ChatMessage[],
  options: InvokeOptions = {},
): Promise<InvokeResult> {
  const provider = process.env.AI_PROVIDER ?? "bedrock";

  switch (provider) {
    case "bedrock":
      return invokeBedrock(messages, options);
    case "anthropic-compat":
      return invokeAnthropicCompat(messages, options);
    default:
      throw new Error(
        `AI_PROVIDER desconocido: "${provider}". Valores válidos: "bedrock", "anthropic-compat".`,
      );
  }
}

// ───────────────────────────── Bedrock ─────────────────────────────

/**
 * Detecta el error típico de Bedrock cuando un modelo requiere un *inference
 * profile* en vez de throughput on-demand. El mensaje suele ser:
 * "Invocation of model ID ... with on-demand throughput isn't supported. Retry
 *  your request with the ID or ARN of an inference profile".
 */
function needsInferenceProfile(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("inference profile") || msg.includes("on-demand throughput");
}

async function invokeBedrock(
  messages: ChatMessage[],
  options: InvokeOptions,
): Promise<InvokeResult> {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("Falta AWS_REGION en el entorno para invocar Bedrock.");
  }

  const baseModelId = process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID;

  // Credenciales por la cadena AWS por defecto (perfil/SSO/variables AWS_*),
  // igual que el RDSDataClient del proyecto.
  const client = new BedrockRuntimeClient({ region });

  // Formato nativo Bedrock para modelos Anthropic. En sonnet-4-6, omitir
  // `thinking` corre sin razonamiento → salida directa y parseable.
  const body: Record<string, unknown> = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (options.system) body.system = options.system;

  // Si el modelo pide inference profile, reintentamos con prefijo "us."
  // (ej. "us.anthropic.claude-sonnet-4-6"). No duplicamos si ya viene prefijado.
  const candidates =
    baseModelId.startsWith("us.") || baseModelId.startsWith("eu.") || baseModelId.startsWith("apac.")
      ? [baseModelId]
      : [baseModelId, `us.${baseModelId}`];

  let lastErr: unknown;
  for (const [i, modelId] of candidates.entries()) {
    try {
      const res = await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify(body),
        }),
      );

      const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const text = (decoded.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");

      return {
        text,
        modelId,
        provider: "bedrock",
        usage: {
          inputTokens: decoded.usage?.input_tokens,
          outputTokens: decoded.usage?.output_tokens,
        },
      };
    } catch (err) {
      lastErr = err;
      const hasNext = i + 1 < candidates.length;
      // Solo saltamos al candidato con prefijo si el error es el de inference profile.
      if (hasNext && needsInferenceProfile(err)) continue;
      throw err;
    }
  }
  throw lastErr;
}

// ───────────────────────────── anthropic-compat (z.ai / GLM) ─────────────────────────────

/**
 * Backend para endpoints compatibles con la Messages API de Anthropic (z.ai/GLM,
 * gateways propios, etc.). Estructura lista pero NO activa: requiere setear
 * ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY. Hasta entonces, lanza un error claro.
 */
async function invokeAnthropicCompat(
  messages: ChatMessage[],
  options: InvokeOptions,
): Promise<InvokeResult> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const modelId = process.env.ANTHROPIC_MODEL_ID || "claude-sonnet-4-6";

  if (!baseUrl || !apiKey) {
    throw new Error(
      "AI_PROVIDER=anthropic-compat requiere ANTHROPIC_BASE_URL y ANTHROPIC_API_KEY. " +
        "Este backend está preparado pero no activado.",
    );
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(options.system ? { system: options.system } : {}),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`anthropic-compat respondió ${res.status}: ${detail.slice(0, 500)}`);
  }

  const decoded = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (decoded.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  return {
    text,
    modelId,
    provider: "anthropic-compat",
    usage: {
      inputTokens: decoded.usage?.input_tokens,
      outputTokens: decoded.usage?.output_tokens,
    },
  };
}
