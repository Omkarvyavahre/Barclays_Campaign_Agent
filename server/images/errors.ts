/**
 * Safe error taxonomy for the image service.
 *
 * Deliberately separate from the AI taxonomy: this one adds `storage_error`,
 * and the two services fail for different reasons. As with the AI layer, Adobe
 * response bodies never leave the server — every failure collapses into a fixed
 * category with a non-revealing message.
 */

export type ImageErrorCategory =
  | 'configuration_error'
  | 'auth_error'
  | 'forbidden'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_response'
  | 'storage_error'
  | 'bad_request';

const SAFE_MESSAGES: Record<ImageErrorCategory, string> = {
  configuration_error: 'The image generation service is not configured correctly.',
  auth_error: 'The image generation service rejected the service credentials.',
  forbidden: 'The image generation service refused this request.',
  timeout: 'The image generation service did not respond in time.',
  upstream_error: 'The image generation service could not complete the request.',
  invalid_response: 'The image generation response did not match the expected structure.',
  storage_error: 'The generated image could not be stored.',
  bad_request: 'The request to the image generation service was not valid.',
};

const HTTP_STATUS: Record<ImageErrorCategory, number> = {
  configuration_error: 500,
  auth_error: 502,
  forbidden: 502,
  timeout: 504,
  upstream_error: 502,
  invalid_response: 502,
  storage_error: 500,
  bad_request: 400,
};

export interface SafeImageErrorPayload {
  ok: false;
  error: { category: ImageErrorCategory; message: string };
}

export class ImageServiceError extends Error {
  readonly category: ImageErrorCategory;
  /** Retained for server logs only. Never serialised to the browser. */
  readonly internalDetail?: string;

  constructor(category: ImageErrorCategory, internalDetail?: string) {
    super(SAFE_MESSAGES[category]);
    this.name = 'ImageServiceError';
    this.category = category;
    this.internalDetail = internalDetail;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.category];
  }

  toSafePayload(): SafeImageErrorPayload {
    return { ok: false, error: { category: this.category, message: SAFE_MESSAGES[this.category] } };
  }
}

export function classifyImageHttpStatus(status: number): ImageErrorCategory {
  if (status === 401) return 'auth_error';
  if (status === 403) return 'forbidden';
  if (status === 408 || status === 504) return 'timeout';
  return 'upstream_error';
}

export function classifyImageTransportError(error: unknown): ImageErrorCategory {
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  return 'upstream_error';
}

export function toImageServiceError(error: unknown): ImageServiceError {
  if (error instanceof ImageServiceError) return error;
  return new ImageServiceError('upstream_error', error instanceof Error ? error.message : String(error));
}

export function safeImageErrorPayload(error: unknown): SafeImageErrorPayload {
  return toImageServiceError(error).toSafePayload();
}
