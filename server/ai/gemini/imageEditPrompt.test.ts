/**
 * @vitest-environment node
 *
 * Pure prompt-builder tests. Provider calls = 0.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGeminiImageEditPrompt,
  isMockupStyleSource,
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
    expect(prompt).toMatch(/new browser window/i);
    expect(prompt).toMatch(/crop, framing, aspect ratio where supported/i);
    expect(prompt).toContain('Treat the input as the only canvas.');
    expect(prompt).toContain('Modify pixels within this canvas.');
    expect(prompt).toContain('Return only the edited canvas.');
    expect(prompt).toContain(
      'Final output must contain exactly one coherent composition spanning the entire canvas.'
    );
    expect(prompt).toContain(
      'There must be no interior gutter separating multiple versions of the source.'
    );
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

  it('places brand guidance after the user instruction and before output-quality constraints', () => {
    const userInstruction = 'Move the wordmark to the bottom centre.';
    const prompt = buildGeminiImageEditPrompt({
      userInstruction,
      brandGuardrails: ['Use only owned Barclays logo assets.'],
      guardrails: ['Preserve the current asset identity unless the prompt explicitly requests a visual change.']
    });

    const userIdx = prompt.indexOf('User edit instruction (authoritative)');
    const brandIdx = prompt.indexOf('Applicable brand guidance:');
    const outputIdx = prompt.indexOf('Return exactly one final edited image.');
    expect(brandIdx).toBeGreaterThan(userIdx);
    expect(outputIdx).toBeGreaterThan(brandIdx);
    expect(prompt).toContain('- Use only owned Barclays logo assets.');
    expect(prompt).toContain(userInstruction);
  });

  it('hardens an Email HTML hero as a direct edit of one existing source frame', () => {
    const userInstruction = 'Move the Barclays iPortal text from the top to the bottom.';
    const prompt = buildGeminiImageEditPrompt({
      userInstruction,
      sourceContext: {
        channel: 'Email',
        format: 'HTML email hero'
      }
    });

    expect(prompt).toContain('You are editing the supplied image itself.');
    expect(prompt).toContain('Return exactly one flattened final image occupying the full output canvas.');
    expect(prompt).toMatch(/Do not show the original and edited versions together/i);
    expect(prompt).toMatch(/before-and-after comparison/i);
    expect(prompt).toMatch(/side-by-side presentation/i);
    expect(prompt).toMatch(/Do not reproduce the source twice/i);
    expect(prompt).toMatch(/Do not add a second browser window, email client/i);
    expect(prompt).toMatch(/frame already visible in the source is part of the single image/i);
    expect(prompt).toMatch(/may be preserved when the user did not ask to remove it/i);
    expect(prompt).toMatch(/remove it from its original position/i);
    expect(prompt).toMatch(/reconstruct the vacated area naturally/i);
    expect(prompt).toMatch(/without redesigning the rest of the image/i);
    expect(prompt).toMatch(/do not invent or recreate paragraphs/i);
    expect(prompt).toContain(`User edit instruction (authoritative):\n${userInstruction}`);
    expect(prompt.match(new RegExp(userInstruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);

    const baseIndex = prompt.indexOf('You are editing the supplied image itself.');
    const mockupIndex = prompt.indexOf('The browser, email, webpage');
    const userIndex = prompt.indexOf(userInstruction);
    const outputIndex = prompt.indexOf('Return exactly one flattened final image');
    expect(baseIndex).toBeLessThan(mockupIndex);
    expect(mockupIndex).toBeLessThan(userIndex);
    expect(userIndex).toBeLessThan(outputIndex);
  });

  it('keeps LinkedIn edits direct without adding Email source-frame semantics', () => {
    const userInstruction = 'Make the cyan ribbon slightly brighter.';
    const prompt = buildGeminiImageEditPrompt({
      userInstruction,
      sourceContext: {
        channel: 'LinkedIn',
        format: 'Sponsored content · mobile crop'
      }
    });

    expect(isMockupStyleSource({ channel: 'LinkedIn', format: 'Sponsored content' })).toBe(false);
    expect(prompt).toContain(`User edit instruction (authoritative):\n${userInstruction}`);
    expect(prompt).toContain('Treat the input as the only canvas.');
    expect(prompt).toContain('Return exactly one flattened final image');
    expect(prompt).not.toContain('The browser, email, webpage');
  });

  it.each([
    { channel: 'Email', format: 'HTML email hero' },
    { channel: 'Social', format: 'campaign mockup' },
    { channel: 'Web', format: 'browser screenshot' },
    { channel: 'CRM', format: 'activation banner' }
  ])('detects mockup-style source metadata: $channel / $format', (sourceContext) => {
    expect(isMockupStyleSource(sourceContext)).toBe(true);
  });
});
