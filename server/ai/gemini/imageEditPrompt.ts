export type GeminiImageEditPromptOptions = {
  userInstruction: string;
  /** Universal technical / identity constraints (not brand catalogue). */
  guardrails?: string[];
  /** Compatible Barclays KG brand rules — after the user instruction, before output quality. */
  brandGuardrails?: string[];
  sourceContext?: {
    channel?: string;
    format?: string;
  };
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

export function isMockupStyleSource(
  sourceContext: GeminiImageEditPromptOptions['sourceContext']
): boolean {
  const channel = sourceContext?.channel?.trim().toLowerCase() ?? '';
  const format = sourceContext?.format?.trim().toLowerCase() ?? '';
  return (
    channel === 'email' ||
    /\b(email|e-mail|html|banner|activation|mockup|mock-up|screenshot|browser|webpage|document)\b/.test(
      format
    )
  );
}

export function buildGeminiImageEditPrompt({
  userInstruction,
  guardrails = [],
  brandGuardrails = [],
  sourceContext
}: GeminiImageEditPromptOptions): string {
  const sections = [
    [
      'You are editing the supplied image itself.',
      'Edit the supplied source image directly.',
      'This is an edit of the provided image, not a request to generate a new creative.',
      'Treat the input as the only canvas.',
      'Modify pixels within this canvas.',
      'Return only the edited canvas.',
      'Do not explain, compare, demonstrate, or present the modification.',
      "Preserve the source image's crop, framing, aspect ratio where supported, perspective, composition, major subjects, and visual identity.",
      'Apply only the requested changes. Do not redesign the whole image unless the user explicitly asks for a redesign.'
    ].join(' ')
  ];

  if (isMockupStyleSource(sourceContext)) {
    sections.push(
      [
        'The browser, email, webpage, document, screenshot, or campaign frame already visible in the source is part of the single image being edited and may be preserved when the user did not ask to remove it.',
        'Do not reproduce the source twice.',
        'Do not show the original and edited versions together.',
        'Do not create a before-and-after comparison or side-by-side presentation.',
        'Do not add a second browser window, email client, webpage frame, document frame, device frame, presentation board, or mockup around the result.',
        'Preserve only the source elements the user did not ask to change.',
        'When moving requested text or a label, remove it from its original position, reconstruct the vacated area naturally, and place that same requested content in the requested destination without redesigning the rest of the image.',
        'Manipulate only the requested label or region; do not invent or recreate paragraphs of readable campaign body copy unless explicitly requested.'
      ].join(' ')
    );
  }

  sections.push(`User edit instruction (authoritative):\n${userInstruction}`);

  if (requestsTextRemoval(userInstruction)) {
    sections.push(
      [
        'Remove all requested text, letters, numbers, logos, and labels completely.',
        'Reconstruct the removed areas using surrounding image content.',
        'The final image must not contain readable text, pseudo-text, placeholder text, glyph-like artifacts, recreated logos, or replacement labels.'
      ].join(' ')
    );
  }

  const brandRules = brandGuardrails.filter(Boolean);
  if (brandRules.length) {
    sections.push(
      ['Applicable brand guidance:'].concat(brandRules.map((rule) => `- ${rule}`)).join('\n')
    );
  }

  const additionalConstraints = guardrails.filter(Boolean);
  if (additionalConstraints.length) {
    sections.push(`Additional constraints: ${additionalConstraints.join(' ')}`);
  }

  sections.push(
    [
      'Return exactly one final edited image.',
      'Return exactly one flattened final image occupying the full output canvas.',
      'Final output must contain exactly one coherent composition spanning the entire canvas.',
      'There must be no interior gutter separating multiple versions of the source.',
      'Do not create a before/after comparison, split screen, side-by-side layout, duplicate image, contact sheet, multiple variants, collage, or presentation layout.',
      'Do not place the result inside a new browser window, email client, device frame, document frame, presentation board, or mockup.'
    ].join(' ')
  );

  return sections.join('\n\n');
}
