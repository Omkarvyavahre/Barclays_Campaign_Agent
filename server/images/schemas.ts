/**
 * Inbound request validation for the image service.
 *
 * Reuses the AI layer's strict validator: both are server-only, and one strict
 * validator is better than two. Unknown keys are rejected so a mistyped or
 * hostile field can never reach the prompt builder.
 */

import { literalUnion, optional, parse, strictObject, string, type ValidationResult } from '../ai/validate.ts';
import type { ImageGenerationRequest } from './types.ts';

export const IMAGE_CHANNELS = ['linkedin', 'email'] as const;

const campaignContextValidator = strictObject({
  objective: string({ min: 1, max: 2000 }),
  audience: string({ min: 1, max: 2000 }),
  businessNeed: string({ min: 1, max: 2000 }),
  proposition: string({ min: 1, max: 2000 }),
  creativeDirection: string({ min: 1, max: 2000 }),
  constraints: optional(string({ min: 1, max: 2000 })),
});

const outputContextValidator = strictObject({
  headline: string({ min: 1, max: 400 }),
  cta: string({ min: 1, max: 200 }),
  format: optional(string({ min: 1, max: 200 })),
  dimensions: optional(string({ min: 1, max: 100 })),
});

export const imageRequestValidator = strictObject({
  channel: literalUnion(IMAGE_CHANNELS),
  campaignContext: campaignContextValidator,
  outputContext: outputContextValidator,
});

export function validateImageRequest(input: unknown): ValidationResult<ImageGenerationRequest> {
  return parse(imageRequestValidator, input);
}
