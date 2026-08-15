export type GeminiImageEditPromptOptions = {
  userInstruction: string;
  guardrails?: string[];
};

const TEXT_REMOVAL_PATTERNS = [
  /\bremove(?:\s+all)?\s+(?:visible\s+)?text\b/i,
  /\bremove(?:\s+all)?\s+(?:the\s+)?logos?\b/i,
  /\bremove(?:\s+all)?\s+(?:the\s+)?labels?\b/i,
  /\bremove(?:\s+all)?\s+(?:the\s+)?writing\b/i,
  /\bdelete(?:\s+all)?\s+(?:visible\s+)?text\b/i,
  /\bwithout\s+(?:any\s+)?text\b/i
];

export function requestsTextRemoval(userInstruction: string): boolean {
  return TEXT_REMOVAL_PATTERNS.some((pattern) => pattern.test(userInstruction));
}

export function buildGeminiImageEditPrompt({
  userInstruction,
  guardrails = []
}: GeminiImageEditPromptOptions): string {
  const sections = [
    [
      'Edit the supplied source image directly.',
      'This is an edit of the provided image, not a request to generate a new creative.',
      'Return exactly one final edited image.',
      'Do not create a before/after comparison, split screen, side-by-side layout, duplicate image, contact sheet, mockup, frame, browser or device presentation, multiple variants, or collage.',
      "Preserve the source image's crop, framing, aspect ratio where supported, perspective, composition, major subjects, and visual identity.",
      'Apply only the requested changes. Do not redesign the whole image unless the user explicitly asks for a redesign.'
    ].join(' '),
    `User edit instruction (authoritative):\n${userInstruction}`
  ];

  if (requestsTextRemoval(userInstruction)) {
    sections.push(
      [
        'Remove all requested text, letters, numbers, logos, and labels completely.',
        'Reconstruct the removed areas using surrounding image content.',
        'The final image must not contain readable text, pseudo-text, placeholder text, glyph-like artifacts, recreated logos, or replacement labels.'
      ].join(' ')
    );
  }

  const additionalConstraints = guardrails.filter(Boolean);
  if (additionalConstraints.length) {
    sections.push(`Additional constraints: ${additionalConstraints.join(' ')}`);
  }

  return sections.join('\n\n');
}
