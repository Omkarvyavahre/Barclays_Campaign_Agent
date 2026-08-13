/**
 * Safe error taxonomy for the AI service layer.
 *
 * Raw provider errors never leave the server. Every failure is collapsed into
 * one of a small set of categories with a fixed, non-revealing message so that
 * gateway hostnames, auth headers and upstream payloads cannot leak to the
 * browser through an error path.
 */

export type AiErrorCategory =
  | 'auth_error'
  | 'forbidden'
  | 'upstream_error'
  | 'timeout'
  | 'invalid_response'
  | 'configuration_error'
  | 'bad_request';

const SAFE_MESSAGES: Record<AiErrorCategory, string> = {
  auth_error: 'The AI gateway rejected the service credentials.',
  forbidden: 'The AI gateway refused this request.',
  upstream_error: 'The AI gateway could not complete the request.',
  timeout: 'The AI gateway did not respond in time.',
  invalid_response: 'The AI response did not match the expected structure.',
  configuration_error: 'The AI service is not configured correctly.',
  bad_request: 'The request to the AI service was not valid.',
};

const HTTP_STATUS: Record<AiErrorCategory, number> = {
  auth_error: 502,
  forbidden: 502,
  upstream_error: 502,
  timeout: 504,
  invalid_response: 502,
  configuration_error: 500,
  bad_request: 400,
};

export interface SafeErrorPayload {
  ok: false;
  error: { category: AiErrorCategory; message: string };
}

export class AiServiceError extends Error {
  readonly category: AiErrorCategory;
  /** Detail retained for server logs only. Never serialised to the browser. */
  readonly internalDetail?: string;

  constructor(category: AiErrorCategory, internalDetail?: string) {
    super(SAFE_MESSAGES[category]);
    this.name = 'AiServiceError';
    this.category = category;
    this.internalDetail = internalDetail;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.category];
  }

  toSafePayload(): SafeErrorPayload {
    return { ok: false, error: { category: this.category, message: SAFE_MESSAGES[this.category] } };
  }
}

export function classifyHttpStatus(status: number): AiErrorCategory {
  if (status === 401) return 'auth_error';
  if (status === 403) return 'forbidden';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 400 && status < 500) return 'upstream_error';
  return 'upstream_error';
}

export function classifyTransportError(error: unknown): AiErrorCategory {
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  return 'upstream_error';
}

/** Collapses anything thrown inside the service layer into a safe error. */
export function toAiServiceError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error;
  return new AiServiceError('upstream_error', error instanceof Error ? error.message : String(error));
}

export function safeErrorPayload(error: unknown): SafeErrorPayload {
  return toAiServiceError(error).toSafePayload();
}
