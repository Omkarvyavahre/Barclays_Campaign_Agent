/**
 * Maps a validated brief result onto the V19 Stage 2 data model.
 *
 * The renderer owns the contract. A live result is only allowed to replace the
 * *values* of brief fields that V19 already defines; it can never add a field,
 * remove one, or change a label. Anything that does not fit is rejected whole,
 * leaving the deterministic fixture in place.
 */

import type { BriefResult } from '../bridge/types';
import type { V19BriefSection } from './runtimeAccess';

export const MAX_FIELD_LENGTH = 2000;

export type MappingRejection =
  | { ok: false; reason: 'no-sections' }
  | { ok: false; reason: 'missing-fields'; keys: string[] }
  | { ok: false; reason: 'unknown-fields'; keys: string[] }
  | { ok: false; reason: 'invalid-values'; keys: string[] };

export type MappingResult = { ok: true; updates: Map<string, string> } | MappingRejection;

export function collectBriefKeys(sections: V19BriefSection[]): string[] {
  const keys: string[] = [];
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      if (Array.isArray(field) && typeof field[0] === 'string') keys.push(field[0]);
    }
  }
  return keys;
}

/**
 * Validates a live brief against the runtime's own field list.
 *
 * This is deliberately a second check after server-side validation: the server
 * validates against a hand-maintained key list, while this validates against
 * the keys the loaded runtime actually has, so the two cannot drift apart
 * without the mapping failing safe.
 */
export function planBriefUpdate(brief: BriefResult, sections: V19BriefSection[] | undefined): MappingResult {
  if (!sections || sections.length === 0) return { ok: false, reason: 'no-sections' };

  const runtimeKeys = collectBriefKeys(sections);
  const provided = brief.fields ?? {};
  const providedKeys = Object.keys(provided);

  const unknown = providedKeys.filter((key) => !runtimeKeys.includes(key));
  if (unknown.length) return { ok: false, reason: 'unknown-fields', keys: unknown };

  const missing = runtimeKeys.filter((key) => !providedKeys.includes(key));
  if (missing.length) return { ok: false, reason: 'missing-fields', keys: missing };

  const invalid = providedKeys.filter((key) => {
    const value = provided[key];
    return typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_FIELD_LENGTH;
  });
  if (invalid.length) return { ok: false, reason: 'invalid-values', keys: invalid };

  const updates = new Map<string, string>();
  for (const key of runtimeKeys) updates.set(key, provided[key].trim());
  return { ok: true, updates };
}

/** Writes planned values into the runtime's own arrays, in place. */
export function applyBriefUpdate(sections: V19BriefSection[], updates: Map<string, string>): number {
  let applied = 0;
  for (const section of sections) {
    for (const field of section.fields ?? []) {
      const next = updates.get(field[0]);
      if (next !== undefined && field[2] !== next) {
        field[2] = next;
        applied += 1;
      }
    }
  }
  return applied;
}
