/**
 * Shared Gemini gateway contracts.
 *
 * This is the first (and only) Gemini client in the project.
 * Coordinator / Brief agents should reuse this module later —
 * do not invent a second provider.
 */

export type GeminiJsonRequest = {
  system: string;
  user: string;
  /** Optional hint echoed into the request for structured JSON output. */
  responseMimeType?: 'application/json';
  /**
   * When the gateway is configured for `json_schema` structured output,
   * supply a JSON Schema object and a stable schema name.
   */
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
};

export type GeminiJsonResponse = {
  text: string;
  raw?: unknown;
  model?: string;
  latencyMs?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type GeminiImageEditRequest = {
  instruction: string;
  image: {
    bytes: Buffer;
    mimeType: string;
    assetId: string;
  };
  channel?: string;
  format?: string;
  dimensions?: string;
  guardrails: string[];
  authoritativeContent: {
    title: string;
    description: string;
    cta: string;
  };
};

export type GeminiImageEditResponse = {
  bytes: Buffer;
  mimeType: string;
  model?: string;
  provider?: 'gemini-image';
};

/**
 * Injectable port used by Creative Interpreter (and later agents).
 * Tests supply a mock; production supplies createGeminiClient().
 *
 * The current OpenAI-compatible gateway only implements generateJson.
 * editImage remains optional until an approved image-output endpoint is configured.
 */
export type GeminiJsonClient = {
  generateJson(request: GeminiJsonRequest): Promise<GeminiJsonResponse>;
  editImage?(request: GeminiImageEditRequest): Promise<GeminiImageEditResponse>;
};

export type GeminiClientOptions = {
  apiKey?: string;
  model?: string;
  /**
   * Live network calls are OFF unless this is true, AI_MODE=gemini, or
   * GEMINI_LIVE=1 — and gateway/API credentials are present.
   */
  live?: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};
