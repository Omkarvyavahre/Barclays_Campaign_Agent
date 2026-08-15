/**
 * Curated knowledge catalogue extracted from the Barclays resource folder.
 *
 * Content and provenance come from the source files only.
 * No corporate/iPortal product or persona material was present in the pack,
 * so corporate-specific textual entries are intentionally absent.
 */

import type { TextualKnowledgeEntry, VisualKnowledgeEntry } from './types';

const PRODUCT_PDF = 'Barclays_Product_Descriptions.pdf';
const TOV_PDF = 'Barclays_Retail_Banking_Tone_of_Voice_Guidelines.pdf';
const PERSONA_PDF = 'Fresco Segments - User Personas.pdf';
const GS4PM_PPTX = 'Barclays x Adobe GS4PM.pptx';

export const TEXTUAL_ENTRIES: TextualKnowledgeEntry[] = [
  // —— Retail products (Barclays_Product_Descriptions.pdf) ——
  {
    id: 'txt-product-credit-cards',
    title: 'Barclays Credit Cards',
    category: 'product',
    businessDomain: 'retail',
    content:
      'Barclays offers a diverse range of credit cards tailored to different lifestyles — from travel and entertainment to everyday spending. Features include contactless payments and mobile wallet compatibility, personalised card designs, exclusive partner benefits (e.g. JetBlue, Xbox, Wyndham Hotels), no-annual-fee options, and credit-building cards.',
    tags: ['credit-cards', 'retail', 'rewards', 'barclaycard'],
    sourceFile: PRODUCT_PDF,
    page: 1,
    section: 'Barclays Credit Cards'
  },
  {
    id: 'txt-prop-credit-cards',
    title: 'Credit Cards — key value propositions',
    category: 'proposition',
    businessDomain: 'retail',
    content:
      'Reward Variety: earn points, miles, or cashback on everyday purchases, travel, dining, and retail. Introductory Offers: welcome bonuses such as bonus points or cashback after qualifying purchases. Flexible Payment Options: manage balances with low interest rates or promotional APRs. Security & Control: real-time fraud alerts, card freezing, and spending insights via the Barclays app.',
    tags: ['credit-cards', 'proposition', 'rewards', 'security'],
    sourceFile: PRODUCT_PDF,
    page: 1,
    section: 'Key Value Propositions'
  },
  {
    id: 'txt-msg-credit-cards',
    title: 'Credit Cards — messaging preferences',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Empowerment: “Choose the card that fits your life.” Simplicity: “Earn rewards effortlessly — just for spending.” Reassurance: “Your security is our priority.” Lifestyle Alignment: “From travel to tech, there’s a Barclaycard for you.”',
    tags: ['credit-cards', 'messaging', 'tone'],
    sourceFile: PRODUCT_PDF,
    page: 1,
    section: 'Messaging Preferences'
  },
  {
    id: 'txt-product-mortgages',
    title: 'Barclays Mortgages',
    category: 'product',
    businessDomain: 'retail',
    content:
      'Barclays mortgages are designed to support customers through every stage of home ownership — from first-time buyers onward. Features include mortgage calculators and affordability tools, dedicated mortgage advisors, options to overpay or take payment holidays (subject to terms), and remortgage packages with fee-free switching.',
    tags: ['mortgages', 'retail', 'home-ownership', 'first-time-buyers'],
    sourceFile: PRODUCT_PDF,
    page: 2,
    section: 'Barclays Mortgages'
  },
  {
    id: 'txt-prop-mortgages',
    title: 'Mortgages — key value propositions',
    category: 'proposition',
    businessDomain: 'retail',
    content:
      'Tailored Solutions: fixed, tracker, and offset mortgages to suit different financial goals. Digital Convenience: apply and manage your mortgage online or via the Barclays app. Support for First-Time Buyers: exclusive deals and guidance for those entering the property market. Green Home Incentives: preferential rates for energy-efficient properties.',
    tags: ['mortgages', 'proposition', 'digital', 'green-home'],
    sourceFile: PRODUCT_PDF,
    page: 2,
    section: 'Key Value Propositions'
  },
  {
    id: 'txt-msg-mortgages',
    title: 'Mortgages — messaging preferences',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Stability & Trust: “Helping you feel at home with your finances.” Clarity: “No jargon. Just straightforward advice.” Supportive Tone: “Whether it’s your first home or your next, we’re here to help.” Sustainability: “Better for your home, better for the planet.”',
    tags: ['mortgages', 'messaging', 'tone'],
    sourceFile: PRODUCT_PDF,
    page: 2,
    section: 'Messaging Preferences'
  },
  {
    id: 'txt-product-loans',
    title: 'Barclays Loans',
    category: 'product',
    businessDomain: 'retail',
    content:
      'Barclays personal loans offer fast, flexible funding for planned expenses or unexpected costs. Features include personalised loan offers based on credit profile, repayments managed via the Barclays app, loan protection options, and competitive interest rates for existing customers. Borrow from £1,000 to £50,000 over 1 to 5 years with no early repayment fees.',
    tags: ['loans', 'retail', 'personal-loans'],
    sourceFile: PRODUCT_PDF,
    page: 3,
    section: 'Barclays Loans'
  },
  {
    id: 'txt-prop-loans',
    title: 'Loans — key value propositions',
    category: 'proposition',
    businessDomain: 'retail',
    content:
      'Quick Decisions: instant online eligibility checks and fast approvals. Fixed Monthly Payments: predictable budgeting with no hidden fees. Flexible Terms: borrow from £1,000 to £50,000 over 1 to 5 years. No Early Repayment Fees: pay off your loan early without penalties.',
    tags: ['loans', 'proposition', 'transparency'],
    sourceFile: PRODUCT_PDF,
    page: 3,
    section: 'Key Value Propositions'
  },
  {
    id: 'txt-msg-loans',
    title: 'Loans — messaging preferences',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Transparency: “Know what you’ll pay — no surprises.” Empathy: “For life’s plans and life’s curveballs.” Confidence: “Borrow with a bank that puts you first.” Ease: “Apply in minutes. Get funds fast.”',
    tags: ['loans', 'messaging', 'tone'],
    sourceFile: PRODUCT_PDF,
    page: 3,
    section: 'Messaging Preferences'
  },

  // —— Retail tone of voice (Barclays_Retail_Banking_Tone_of_Voice_Guidelines.pdf) ——
  {
    id: 'txt-tov-retail',
    title: 'Barclays Retail Banking — tone of voice',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Barclays Retail Banking communicates with a tone that is: Reassuring and Professional (instils trust and confidence); Clear and Accessible (avoids jargon, speaks plainly); Empathetic and Supportive (recognises life’s financial ups and downs without judgement); Forward-Thinking and Empowering (encourages customers to take control of their financial futures). Examples: “We’re here to help you make the most of your money — today and tomorrow.” “Your goals matter. Let’s work together to reach them.”',
    tags: ['tone-of-voice', 'retail', 'brand'],
    sourceFile: TOV_PDF,
    page: 1,
    section: 'Tone of Voice'
  },
  {
    id: 'txt-brand-values-retail',
    title: 'Barclays Retail Banking — brand values',
    category: 'brand',
    businessDomain: 'retail',
    content:
      'Barclays Retail Banking is built on: 1. Integrity — acting with honesty and transparency. 2. Service — putting customers first in every interaction. 3. Innovation — delivering modern, digital-first solutions. 4. Simplicity — making banking easier and more intuitive. 5. Inclusivity — serving diverse communities with respect and fairness.',
    tags: ['brand', 'values', 'retail'],
    sourceFile: TOV_PDF,
    page: 2,
    section: 'Brand Values'
  },
  {
    id: 'txt-editorial-guidelines',
    title: 'Editorial guidelines',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Clarity: use plain English; avoid financial jargon unless essential — and explain it. Consistency: maintain tone across all channels and formats. Empathy: write with the customer’s perspective in mind. Action-Oriented: encourage positive financial behaviours. Compliance: ensure all content meets regulatory and legal standards.',
    tags: ['editorial', 'compliance', 'tone'],
    sourceFile: TOV_PDF,
    page: 3,
    section: 'Editorial Guidelines'
  },
  {
    id: 'txt-editorial-restrictions',
    title: 'Editorial restrictions',
    category: 'guardrail',
    businessDomain: 'retail',
    content:
      'Avoid fear-based messaging or urgency that pressures decision-making. Do not use slang, sarcasm, or overly casual language. Never make unsubstantiated claims or promises. Avoid complex sentence structures that hinder readability.',
    tags: ['guardrail', 'editorial', 'claims'],
    sourceFile: TOV_PDF,
    page: 4,
    section: 'Editorial Restrictions'
  },
  {
    id: 'txt-image-guidelines',
    title: 'Image guidelines',
    category: 'guardrail',
    businessDomain: 'retail',
    content:
      'Style: clean, modern, and inclusive; reflect real people and everyday moments. Tone: warm and optimistic; avoid overly staged or corporate imagery. Accessibility: ensure high contrast, alt text, and mobile responsiveness. Branding: use Barclays’ approved colour palette, typography, and logo placement.',
    tags: ['imagery', 'accessibility', 'logo-placement', 'guardrail'],
    sourceFile: TOV_PDF,
    page: 5,
    section: 'Image Guidelines'
  },
  {
    id: 'txt-email-guidelines',
    title: 'Email guidelines',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Use a warm, professional tone; personalise where possible; keep layout mobile-friendly. Subject lines: clear and benefit-led; avoid clickbait. Pre-header: expand on the subject and reinforce value. Headline: short and direct. Body: short paragraphs and bullet points; focus on benefits. CTA: one clear action per email; use active verbs (e.g. “Open your account now”).',
    tags: ['email', 'channel', 'cta'],
    sourceFile: TOV_PDF,
    page: 6,
    section: 'Email Guidelines'
  },
  {
    id: 'txt-meta-ads-guidelines',
    title: 'Meta Ads guidelines',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Keep copy concise and mobile-first; use emojis sparingly and only if aligned with tone. Headline: highlight the core benefit. Body: reinforce trust and simplicity. CTA: use platform-native CTAs like “Learn More” or “Sign Up”. Image text: keep text under 20% of image area; use brand fonts and colours; ensure legibility on mobile.',
    tags: ['meta', 'paid-media', 'channel'],
    sourceFile: TOV_PDF,
    page: 7,
    section: 'Meta Ads Guidelines'
  },
  {
    id: 'txt-display-ads-guidelines',
    title: 'Display Ads guidelines',
    category: 'tone-of-voice',
    businessDomain: 'retail',
    content:
      'Prioritise clarity and brand consistency; design for quick comprehension. Headline: bold and benefit-driven. Body: one sentence max. CTA: clear and direct (e.g. “Apply now”).',
    tags: ['display', 'paid-media', 'channel'],
    sourceFile: TOV_PDF,
    page: 8,
    section: 'Display Ads Guidelines'
  },

  // —— Personas (Fresco Segments - User Personas.pdf) ——
  // Note: source text references Nationwide in communication examples; domain is still retail segments.
  {
    id: 'txt-persona-rising-metropolitans',
    title: 'Rising Metropolitans',
    category: 'persona',
    businessDomain: 'retail',
    content:
      'Singles and couples, typically young professionals mostly aged under 35, living in London and other major conurbations often in areas of high property value. Mainly professionals and white-collar occupations; a high proportion are graduates. Financially savvy and likely managing a higher-than-average number of financial products; jobs often offer private healthcare and company pensions. High outgoings from rent and aspirational lifestyles mean they are more likely to have loans and credit cards. Computer savvy and time poor — manage and arrange products online where possible. Communication style: concise and efficient; aspirational tone highlighting travel benefits, digital banking features and smart financial tools; use testimonials, user reviews or influencer partnerships.',
    tags: ['persona', 'rising-metropolitans', 'urban', 'digital'],
    sourceFile: PERSONA_PDF,
    page: 1,
    section: 'Rising Metropolitans'
  },
  {
    id: 'txt-persona-asset-rich-greys',
    title: 'Asset Rich Greys',
    category: 'persona',
    businessDomain: 'retail',
    content:
      'Financially sophisticated older couples with high-value assets, approaching retirement or relatively recently retired. Own expensive detached houses; household incomes are high; many held directorships, senior managerial or professional positions. Largest proportion with very high savings and investments; ownership of bonds, stocks and shares significantly above average. Well covered with insurance; regularly read financial pages; comfortable researching and buying commoditised products such as insurance online; tend to spend freely on credit cards while usually paying off the balance monthly. Communication style: informative and trustworthy; professional tone; security-conscious messaging emphasising trust and data security; financial insights such as market briefings or investment newsletters.',
    tags: ['persona', 'asset-rich-greys', 'affluent', 'retirement'],
    sourceFile: PERSONA_PDF,
    page: 1,
    section: 'Asset Rich Greys'
  },
  {
    id: 'txt-persona-starting-out',
    title: 'Starting Out',
    category: 'persona',
    businessDomain: 'retail',
    content:
      'Young, single flat sharers learning to stand on their own two feet. Mostly privately renting flats or terraced housing after leaving the family home. Sometimes struggle financially and use overdrafts. Occupations include office or shop workers starting on the career ladder. Likely to open financial products online and in branch due to limited financial confidence and history; once they have accounts they manage them online via smartphone. Enjoy streaming and cinema; book tickets online. Communication style: supportive and educational; mobile-first; visual and interactive (videos, infographics, app-based tools); value-driven (low-cost or no-fee products, overdraft support, budgeting tools); relatable informal conversational tone with real-life examples.',
    tags: ['persona', 'starting-out', 'young', 'mobile-first'],
    sourceFile: PERSONA_PDF,
    page: 2,
    section: 'Starting Out'
  },

  // —— GenStudio guidance (Barclays x Adobe GS4PM.pptx) ——
  {
    id: 'txt-gs4pm-scope',
    title: 'GenStudio for Performance Marketing — initial scope',
    category: 'genstudio',
    businessDomain: 'cross-business',
    content:
      'Primary use case for Barclays UK: create email variations from pre-defined templates using approved imagery. Current process is manual with a 12-week lead time across multiple stakeholders. Predicted impact: reduction in time to create content and increase in number of variations. Exclusion: initial project will not integrate into Salesforce Marketing Cloud; workaround is export from GS4PM and import into ESP for activation.',
    tags: ['genstudio', 'gs4pm', 'email', 'barclays-uk'],
    sourceFile: GS4PM_PPTX,
    page: 2,
    section: 'Initial Scope of Work'
  },
  {
    id: 'txt-gs4pm-channels',
    title: 'GenStudio — available channels',
    category: 'genstudio',
    businessDomain: 'cross-business',
    content:
      'Owned Media — Email Campaigns: create and activate email experiences, leveraging integrations with Adobe Journey Optimizer and Marketo Engage. Paid Media — Meta Ads: generate and activate ads for Facebook and Instagram (standard and custom sizes); LinkedIn Ads: create and deploy LinkedIn ad experiences. Display Advertising — Display and Banner Ads: create and personalise on-brand display ads; Web Banners: generate web banner content tailored to campaigns and audiences.',
    tags: ['genstudio', 'email', 'meta', 'linkedin', 'display'],
    sourceFile: GS4PM_PPTX,
    page: 5,
    section: 'Available Channels'
  },
  {
    id: 'txt-gs4pm-definitions',
    title: 'GenStudio — brand, product and template definitions',
    category: 'genstudio',
    businessDomain: 'cross-business',
    content:
      'Brand: a comprehensive representation of an organisation, product, service or concept that distinguishes it from others; includes objective elements like logos and subjective elements such as tone of voice. Product: all elements that make up a specific product — imagery, descriptions and value propositions — for a cohesive brand representation. Templates: streamline the creative process while ensuring adherence to brand guidelines; customisable fields include preheaders, headlines, body text, CTAs, images and footers; adapted for different channels and media types.',
    tags: ['genstudio', 'brand', 'product', 'templates'],
    sourceFile: GS4PM_PPTX,
    page: 5,
    section: 'Definitions'
  },
  {
    id: 'txt-gs4pm-roles',
    title: 'GenStudio — user roles',
    category: 'genstudio',
    businessDomain: 'cross-business',
    content:
      'Power Users: Read/Write/Edit; can create, upload, edit and delete content; manage Brands, Campaigns and Content assets. Collaborator Users: Read-only; view and download content; involved in review and approval (e.g. legal, managers). Admin role is defined for brand administration.',
    tags: ['genstudio', 'roles', 'governance'],
    sourceFile: GS4PM_PPTX,
    page: 5,
    section: 'License Types / Roles'
  }
];

export const VISUAL_ENTRIES: VisualKnowledgeEntry[] = [
  {
    id: 'vis-logo-svg',
    title: 'Barclays wordmark (SVG)',
    category: 'logo',
    businessDomain: 'cross-business',
    assetPath: 'Barclays-Logo.wine.svg',
    mimeType: 'image/svg+xml',
    tags: ['logo', 'wordmark', 'brand'],
    sourceFile: 'Barclays-Logo.wine.svg',
    assetKind: 'logo'
  },
  {
    id: 'vis-logo-png',
    title: 'Barclays eagle logo (PNG)',
    category: 'logo',
    businessDomain: 'cross-business',
    assetPath: 'ESD_FY23_Academy-Resource.Barclays Logo.png',
    mimeType: 'image/png',
    tags: ['logo', 'eagle', 'brand'],
    sourceFile: 'ESD_FY23_Academy-Resource.Barclays Logo.png',
    assetKind: 'logo'
  },
  {
    id: 'vis-mortgagehub-hero',
    title: 'Mortgage hub desktop hero',
    category: 'visual-reference',
    businessDomain: 'retail',
    assetPath: 'hero_mortgagehub_desktop.jpg',
    mimeType: 'image/jpeg',
    tags: ['mortgage', 'lifestyle', 'family', 'digital'],
    sourceFile: 'hero_mortgagehub_desktop.jpg',
    assetKind: 'visual-reference',
    campaignType: 'mortgage',
    channel: 'web',
    visualFamily: 'lifestyle'
  },
  {
    id: 'vis-ftb-hero',
    title: 'First-time buyer hero',
    category: 'visual-reference',
    businessDomain: 'retail',
    assetPath: 'mortg-ftb-hero.jpg',
    mimeType: 'image/jpeg',
    tags: ['mortgage', 'first-time-buyer', 'lifestyle'],
    sourceFile: 'mortg-ftb-hero.jpg',
    assetKind: 'visual-reference',
    campaignType: 'mortgage',
    channel: 'web',
    visualFamily: 'lifestyle'
  },
  {
    id: 'vis-mort-fixed',
    title: 'Fixed-rate mortgage visual',
    category: 'visual-reference',
    businessDomain: 'retail',
    assetPath: 'mort_fixed_16_9.xxsmall.medium_quality.jpg',
    mimeType: 'image/jpeg',
    tags: ['mortgage', 'fixed-rate', '16-9'],
    sourceFile: 'mort_fixed_16_9.xxsmall.medium_quality.jpg',
    assetKind: 'product-visual',
    campaignType: 'mortgage',
    channel: 'digital',
    visualFamily: 'product-led'
  },
  {
    id: 'vis-mort-tracker',
    title: 'Tracker mortgage visual',
    category: 'visual-reference',
    businessDomain: 'retail',
    assetPath: 'mort_tracker_16_9.xxsmall.medium_quality.jpg',
    mimeType: 'image/jpeg',
    tags: ['mortgage', 'tracker', '16-9'],
    sourceFile: 'mort_tracker_16_9.xxsmall.medium_quality.jpg',
    assetKind: 'product-visual',
    campaignType: 'mortgage',
    channel: 'digital',
    visualFamily: 'product-led'
  },
  {
    id: 'vis-mort-interest-only',
    title: 'Interest-only mortgage visual',
    category: 'visual-reference',
    businessDomain: 'retail',
    assetPath: 'mort_int_only_16_9.xxsmall.medium_quality.jpg',
    mimeType: 'image/jpeg',
    tags: ['mortgage', 'interest-only', '16-9'],
    sourceFile: 'mort_int_only_16_9.xxsmall.medium_quality.jpg',
    assetKind: 'product-visual',
    campaignType: 'mortgage',
    channel: 'digital',
    visualFamily: 'product-led'
  },
  {
    id: 'vis-shared-ownership',
    title: 'Shared ownership visual',
    category: 'visual-reference',
    businessDomain: 'retail',
    assetPath: 'Shared_ownership_3_1.large.medium_quality.jpg',
    mimeType: 'image/jpeg',
    tags: ['mortgage', 'shared-ownership', '3-1'],
    sourceFile: 'Shared_ownership_3_1.large.medium_quality.jpg',
    assetKind: 'campaign-creative',
    campaignType: 'mortgage',
    channel: 'digital',
    visualFamily: 'lifestyle'
  },
  {
    id: 'vis-great-escape',
    title: 'Great Escape visual',
    category: 'visual-reference',
    businessDomain: 'unknown',
    assetPath: 'great_escape_16_9.xxsmall.medium_quality.jpg',
    mimeType: 'image/jpeg',
    tags: ['campaign', '16-9'],
    sourceFile: 'great_escape_16_9.xxsmall.medium_quality.jpg',
    assetKind: 'campaign-creative',
    campaignType: undefined,
    channel: 'digital',
    visualFamily: undefined
  }
];

export function loadCatalogue(): {
  textual: TextualKnowledgeEntry[];
  visual: VisualKnowledgeEntry[];
} {
  return {
    textual: TEXTUAL_ENTRIES,
    visual: VISUAL_ENTRIES
  };
}

export function getTextualEntry(id: string): TextualKnowledgeEntry | undefined {
  return TEXTUAL_ENTRIES.find((e) => e.id === id);
}

export function getVisualEntry(id: string): VisualKnowledgeEntry | undefined {
  return VISUAL_ENTRIES.find((e) => e.id === id);
}
