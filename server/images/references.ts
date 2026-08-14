/**
 * Approved local reference images.
 *
 * The two PNGs are read from `server/assets/firefly-references/` and are server
 * inputs only: they are never copied into `public/`, `src/` or `dist/`, never
 * served, and their filesystem paths never reach the browser. Only the logical
 * slot number (1 or 2) is ever exposed.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ImageServiceError } from './errors.ts';
import type { ImageChannel, ReferenceSlot } from './types.ts';

/** Resolved from the module URL so it is independent of the process cwd. */
const REFERENCE_DIRECTORY = fileURLToPath(new URL('../assets/firefly-references/', import.meta.url));

export const REFERENCE_FILENAMES: Record<ReferenceSlot, string> = {
  1: 'firefly_reference_1.png',
  2: 'firefly_reference_2.png',
};

/**
 * Deterministic channel mapping, both channels on reference 1.
 *
 * Both approved references are finished Barclays layouts carrying lettering, so
 * the reference contributes composition as well as palette. Reference 1 is the
 * deep-navy treatment and produced a clean abstract result; reference 2 is the
 * lighter treatment and reproduced its own wording as pseudo-text. Until an
 * abstract plate exists for slot 2, both channels use the treatment that is
 * known to behave. Change this map to re-assign.
 */
export const CHANNEL_REFERENCE_SLOT: Record<ImageChannel, ReferenceSlot> = {
  linkedin: 1,
  email: 1,
};

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface LoadedReference {
  slot: ReferenceSlot;
  bytes: Buffer;
  contentType: 'image/png';
}

/** Server-side only. Exposed for tests and never returned over HTTP. */
export function referenceDirectory(): string {
  return REFERENCE_DIRECTORY;
}

/** Server-side only. Exposed for tests and never returned over HTTP. */
export function referencePath(slot: ReferenceSlot): string {
  return fileURLToPath(new URL(REFERENCE_FILENAMES[slot], new URL('../assets/firefly-references/', import.meta.url)));
}

export function referenceSlotForChannel(channel: ImageChannel): ReferenceSlot {
  const slot = CHANNEL_REFERENCE_SLOT[channel];
  if (!slot) throw new ImageServiceError('bad_request', `no reference mapping for channel ${channel}`);
  return slot;
}

export function referenceExists(slot: ReferenceSlot): boolean {
  const path = referencePath(slot);
  return existsSync(path) && statSync(path).isFile();
}

export function allReferencesAvailable(): boolean {
  return referenceExists(1) && referenceExists(2);
}

/**
 * Reads an approved reference. The PNG signature is checked so a truncated or
 * substituted file fails here rather than as an opaque Adobe upload rejection.
 */
export function loadReference(slot: ReferenceSlot): LoadedReference {
  if (!referenceExists(slot)) {
    throw new ImageServiceError('configuration_error', `reference image ${REFERENCE_FILENAMES[slot]} is missing`);
  }

  const bytes = readFileSync(referencePath(slot));
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ImageServiceError('configuration_error', `reference image ${REFERENCE_FILENAMES[slot]} is not a PNG`);
  }

  return { slot, bytes, contentType: 'image/png' };
}
