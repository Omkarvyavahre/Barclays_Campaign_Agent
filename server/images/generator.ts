/**
 * Domain orchestration for reference-guided image generation.
 *
 * The order here is the contract:
 *   channel -> approved local reference -> safe prompt -> Firefly -> local
 *   storage -> app-relative URL.
 *
 * In mock mode this returns before touching the network at all, and carries
 * `asset: null`, which means "keep the existing V19 creative". Stage 7 is
 * therefore byte-identical in mock mode.
 */

import { assertPromotableCandidate } from './candidate.ts';
import type { ImageConfig } from './config.ts';
import { assertLiveImageConfig } from './config.ts';
import {
  downloadGeneratedImage,
  generateImage,
  requestAccessToken,
  uploadReferenceImage,
  type ImageDeps,
} from './firefly.ts';
import { buildCreativePrompt } from './prompt.ts';
import { loadReference, referenceSlotForChannel } from './references.ts';
import { removeGeneratedImage, saveGeneratedImage } from './storage.ts';
import type { ImageGenerationOutcome, ImageGenerationRequest } from './types.ts';

export async function generateChannelImage(
  config: ImageConfig,
  request: ImageGenerationRequest,
  deps: ImageDeps = {},
): Promise<ImageGenerationOutcome> {
  const referenceSlot = referenceSlotForChannel(request.channel);

  if (config.provider === 'mock') {
    return { source: 'mock', asset: null, referenceSlot };
  }

  assertLiveImageConfig(config);

  const reference = loadReference(referenceSlot);
  const plan = buildCreativePrompt(request, referenceSlot);

  const { token } = await requestAccessToken(config, deps);
  const uploadId = await uploadReferenceImage(config, token, reference.bytes, reference.contentType, deps);
  const generation = await generateImage(
    config,
    token,
    {
      prompt: plan.prompt,
      size: plan.size,
      uploadId,
      styleStrength: plan.styleStrength,
      contentClass: plan.contentClass,
    },
    deps,
  );

  const bytes = await downloadGeneratedImage(config, generation.imageUrl, deps);
  const asset = saveGeneratedImage(bytes, { channel: request.channel, requestedSize: plan.size });

  // A candidate only leaves this layer if it passes every objective check, so a
  // caller can promote what it receives without inspecting it again. A rejected
  // candidate is discarded rather than left behind for something else to find.
  try {
    assertPromotableCandidate(asset, plan.size, request.channel);
  } catch (error) {
    removeGeneratedImage(asset.id);
    throw error;
  }

  return {
    source: 'firefly',
    asset,
    referenceSlot,
    ...(generation.seed !== undefined ? { seed: generation.seed } : {}),
    ...(generation.contentClass !== undefined ? { contentClass: generation.contentClass } : {}),
  };
}
