/**
 * Wire and domain types for reference-guided image generation.
 *
 * Firefly produces the VISUAL ONLY. Headline, body copy, CTA, audience and all
 * campaign reasoning stay owned by Gemini and existing V19 state; they appear
 * here purely as semantic context for the prompt.
 */

export type ImageProvider = 'mock' | 'firefly';

/** Channels the existing V19 Stage 7 output package renders. */
export type ImageChannel = 'linkedin' | 'email';

/** Which approved local reference PNG a channel maps to. Never a path. */
export type ReferenceSlot = 1 | 2;

/**
 * The two content classes Adobe documents for /v3/images/generate. Kept as a
 * closed union so no undocumented value can ever be sent.
 */
export type ImageContentClass = 'photo' | 'art';

/** Accepted brief context. Supplied by the caller, never invented server-side. */
export interface CampaignImageContext {
  objective: string;
  audience: string;
  businessNeed: string;
  proposition: string;
  creativeDirection: string;
  constraints?: string;
}

/** Channel copy used as tone context only; it must never be rendered as text. */
export interface OutputImageContext {
  headline: string;
  cta: string;
  format?: string;
  dimensions?: string;
}

export interface ImageGenerationRequest {
  channel: ImageChannel;
  campaignContext: CampaignImageContext;
  outputContext: OutputImageContext;
}

/** Firefly's documented output dimensions for a channel slot. */
export interface ImageSize {
  width: number;
  height: number;
}

/**
 * What the browser is allowed to learn about a generated image: an app-relative
 * URL and its dimensions. No filesystem path, no Adobe URL, no upload id.
 */
export interface GeneratedImageAsset {
  id: string;
  url: string;
  channel: ImageChannel;
  width: number;
  height: number;
  bytes: number;
}

/**
 * `source: 'mock'` always carries `asset: null`, meaning "keep the existing V19
 * creative". Stage 7 therefore looks identical in mock mode.
 */
export interface ImageGenerationOutcome {
  source: ImageProvider;
  asset: GeneratedImageAsset | null;
  referenceSlot: ReferenceSlot;
  model?: string;
  seed?: number;
  /** The content class the provider reports having applied, e.g. `art`. */
  contentClass?: string;
}
