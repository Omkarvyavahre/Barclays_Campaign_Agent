/**
 * Shared Gemini / gateway failure taxonomy (reference-aligned).
 * Client-facing detail never includes credentials or raw upstream bodies.
 */

export type GatewayFailureCategory =
  | 'configuration_error'
  | 'auth_error'
  | 'forbidden'
  | 'rate_limited'
  | 'timeout'
  | 'network_error'
  | 'upstream_error'
  | 'invalid_response'
  | 'bad_request';

const STATUS_BY_CATEGORY: Record<GatewayFailureCategory, number> = {
  configuration_error: 503,
  auth_error: 502,
  forbidden: 502,
  rate_limited: 429,
  timeout: 504,
  network_error: 503,
  upstream_error: 502,
  invalid_response: 502,
  bad_request: 400
};

export class GatewayError extends Error {
  readonly status: number;

  constructor(
    readonly category: GatewayFailureCategory,
    message: string,
    readonly options: { logSummary?: string } = {}
  ) {
    super(message);
    this.name = 'GatewayError';
    this.status = STATUS_BY_CATEGORY[category];
  }
}

export function gatewayErrorFromHttp(status: number, bodyLength: number): GatewayError {
  const logSummary = `gateway http ${status}, ${bodyLength} byte body`;
  if (status === 401) {
    return new GatewayError('auth_error', 'The AI gateway rejected this server’s credential.', {
      logSummary
    });
  }
  if (status === 403) {
    return new GatewayError('forbidden', 'This server is not permitted to use the AI model.', {
      logSummary
    });
  }
  if (status === 429) {
    return new GatewayError('rate_limited', 'The AI gateway is rate limited. Try again shortly.', {
      logSummary
    });
  }
  if (status >= 500) {
    return new GatewayError('upstream_error', 'The AI gateway is unavailable. Try again.', {
      logSummary
    });
  }
  if (status === 400 || status === 404 || status === 415) {
    return new GatewayError('bad_request', 'The AI gateway rejected the request.', { logSummary });
  }
  return new GatewayError('upstream_error', 'The AI gateway rejected the request.', { logSummary });
}

export function gatewayErrorFromTransport(error: unknown, timeoutMs: number, host: string): GatewayError {
  const name = error instanceof Error ? error.name : 'Error';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new GatewayError('timeout', `The AI gateway timed out after ${timeoutMs}ms.`, {
      logSummary: `host=${host} timeout=${timeoutMs}ms`
    });
  }

  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);

  return new GatewayError(
    'network_error',
    `AI service unavailable. Check corporate network/VPN connection.`,
    {
      logSummary: `${message} (host ${host})${code ? ` · ${code}` : ''}${
        cause?.message ? ` · ${cause.message}` : ''
      }`
    }
  );
}
