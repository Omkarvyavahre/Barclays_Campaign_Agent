/**
 * The human-approved background per channel.
 *
 * Generation can be checked objectively — it either succeeded, decoded to a
 * supported format, measured at the expected size, stored and read back, or it
 * failed with a category. None of that says anything about pseudo-text,
 * logo-like artefacts or composition quality, and there is no visual classifier
 * here to judge those. So a new generation is never promoted automatically:
 * Stage 7 composes against the id pinned below until somebody looks at a new
 * asset, signs it off and edits this file.
 *
 * A channel left null has no approved asset yet and falls back to the most
 * recent stored one, which is what makes iterating on a new channel practical.
 * A pinned id whose file is missing resolves to nothing rather than to the
 * newest file, so a fresh checkout shows the untouched V19 visual instead of
 * silently promoting whatever happens to be lying in `.generated/firefly/`.
 */

import type { ImageChannel } from './types.ts';

export const APPROVED_ASSETS: Record<ImageChannel, string | null> = {
  linkedin: 'linkedin-f1bca403-4fd1-4246-8789-50bbd52f2bec',
  email: 'email-8781d5ae-a62f-43c7-b41b-e3524ff0f0b3',
};
