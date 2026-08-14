/**
 * Server-only barrel for the image generation layer.
 *
 * Nothing in this directory may be imported from `src/`. The browser reaches
 * this code only through the same-origin `/api/images/*` endpoints.
 */

export * from './approved.ts';
export * from './candidate.ts';
export * from './config.ts';
export * from './errors.ts';
export * from './generator.ts';
export * from './prompt.ts';
export * from './references.ts';
export * from './schemas.ts';
export * from './storage.ts';
export * from './types.ts';
export {
  clearTokenCache,
  downloadGeneratedImage,
  generateImage,
  requestAccessToken,
  uploadReferenceImage,
  type ImageDeps,
  type ImageFetch,
} from './firefly.ts';
