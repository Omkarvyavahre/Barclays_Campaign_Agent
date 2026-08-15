/**
 * @vitest-environment node
 *
 * Pure prompt-builder tests. Provider calls = 0.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGeminiImageEditPrompt,
  requestsTextRemoval
} from './imageEditPrompt';

describe('buildGeminiImageEditPrompt', () => {
  it('requires one final source-image edit and forbids comparison layouts', () => {
    const prompt = buildGeminiImageEditPrompt({
      userInstruction: 'Make the sky slightly brighter.'
    });

    expect(prompt).toContain('Edit the supplied source image directly.');
    expect(prompt).toContain(
      'This is an edit of the provided image, not a request to generate a new creative.'
    );
    expect(prompt).toContain('Return exactly one final edited image.');
    expect(prompt).toMatch(/split screen/i);
    expect(prompt).toMatch(/side-by-side layout/i);
    expect(prompt).toMatch(/contact sheet/i);
    expect(prompt).toMatch(/mockup/i);
    expect(prompt).toMatch(/browser or device presentation/i);
    expect(prompt).toMatch(/crop, framing, aspect ratio where supported/i);
  });

  it('preserves the marketer instruction exactly and keeps it authoritative', () => {
    const userInstruction =
      'Remove all visible text and logos while preserving the current composition.';
    const prompt = buildGeminiImageEditPrompt({ userInstruction });

    expect(prompt).toContain(`User edit instruction (authoritative):\n${userInstruction}`);
    expect(prompt.indexOf('Edit the supplied source image directly.')).toBeLessThan(
      prompt.indexOf(userInstruction)
    );
    expect(prompt.match(new RegExp(userInstruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);
  });

  it.each([
    'Remove text from the image.',
    'Remove all text.',
    'Remove the logo.',
    'Remove labels.',
    'Remove writing.',
    'Delete text.',
    'Use the image without text.'
  ])('adds strict text-removal constraints for: %s', (userInstruction) => {
    expect(requestsTextRemoval(userInstruction)).toBe(true);
    const prompt = buildGeminiImageEditPrompt({ userInstruction });

    expect(prompt).toMatch(/Remove all requested text, letters, numbers, logos, and labels completely/);
    expect(prompt).toMatch(/Reconstruct the removed areas using surrounding image content/);
    expect(prompt).toMatch(/readable text, pseudo-text, placeholder text, glyph-like artifacts/);
    expect(prompt).toMatch(/recreated logos, or replacement labels/);
  });

  it('does not add text-removal constraints to an unrelated edit', () => {
    const prompt = buildGeminiImageEditPrompt({
      userInstruction: 'Make the sky slightly brighter.'
    });

    expect(requestsTextRemoval('Make the sky slightly brighter.')).toBe(false);
    expect(prompt).not.toContain('Remove all requested text, letters, numbers');
    expect(prompt).not.toContain('pseudo-text');
  });

  it('appends existing guardrails without rewriting the user instruction', () => {
    const userInstruction = 'Make the background warmer.';
    const prompt = buildGeminiImageEditPrompt({
      userInstruction,
      guardrails: ['Do not generate or simulate Barclays logos.']
    });

    expect(prompt).toContain(`User edit instruction (authoritative):\n${userInstruction}`);
    expect(prompt).toContain(
      'Additional constraints: Do not generate or simulate Barclays logos.'
    );
  });
});
