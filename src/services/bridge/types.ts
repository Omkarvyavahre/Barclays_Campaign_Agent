/**
 * Wire contract between the browser and our own server API.
 *
 * These types intentionally duplicate the server-side shapes rather than
 * importing them. `server/` must never appear in the client import graph, and
 * a duplicated wire contract is the boundary that guarantees it.
 */

export const AI_API_BASE_PATH = '/api/ai';

export const AI_ENDPOINTS = {
  health: `${AI_API_BASE_PATH}/health`,
  analyse: `${AI_API_BASE_PATH}/coordinator/analyse`,
  brief: `${AI_API_BASE_PATH}/brief/generate`,
} as const;

export const IMAGES_API_BASE_PATH = '/api/images';

export const IMAGE_ENDPOINTS = {
  health: `${IMAGES_API_BASE_PATH}/health`,
  generate: `${IMAGES_API_BASE_PATH}/generate`,
  latest: `${IMAGES_API_BASE_PATH}/latest`,
} as const;

export type BridgeErrorCategory =
  | 'auth_error'
  | 'forbidden'
  | 'upstream_error'
  | 'timeout'
  | 'invalid_response'
  | 'configuration_error'
  | 'storage_error'
  | 'bad_request'
  | 'network_error';

export interface BridgeError {
  category: BridgeErrorCategory;
  message: string;
}

export type BridgeResponse<T> = { ok: true; data: T } | { ok: false; error: BridgeError };

export interface DiscussionMessage {
  author: string;
  role?: string;
  text: string;
}

export interface DiscussionContext {
  channel: string;
  connectedSources: string[];
  messages: DiscussionMessage[];
}

export interface AudienceCohort {
  name: string;
  rationale: string;
}

export type Recommendation = 'proceed' | 'proceed_with_conditions' | 'do_not_proceed';

export interface CoordinatorResult {
  campaignOpportunity: boolean;
  challenge: string;
  opportunity: string;
  audienceCohorts: AudienceCohort[];
  evidenceGaps: string[];
  recommendation: Recommendation;
  recommendationRationale: string;
  confidence?: number;
}

export interface BriefResult {
  campaignName: string;
  fields: Record<string, string>;
}

/** `source: 'mock'` always carries `result: null`, meaning "keep the V19 fixture". */
export interface AgentOutcome<T> {
  source: 'mock' | 'live';
  result: T | null;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
}

export interface AiHealth {
  mode: 'mock' | 'gemini';
  backend: string;
  protocol: string;
  gatewayConfigured: boolean;
  modelConfigured: boolean;
}

export interface BriefRequestPayload {
  discussion: DiscussionContext;
  coordinator?: CoordinatorResult;
  campaignName?: string;
}

/* ------------------------------------------------------------------ *
 * Image generation
 * ------------------------------------------------------------------ */

export type ImageChannel = 'linkedin' | 'email';

/** Accepted brief context. The server derives the creative prompt from this. */
export interface CampaignImageContext {
  objective: string;
  audience: string;
  businessNeed: string;
  proposition: string;
  creativeDirection: string;
  constraints?: string;
}

/** Channel copy passed as tone context only; it is never rendered into the image. */
export interface OutputImageContext {
  headline: string;
  cta: string;
  format?: string;
  dimensions?: string;
}

export interface ImageRequestPayload {
  channel: ImageChannel;
  campaignContext: CampaignImageContext;
  outputContext: OutputImageContext;
}

/** An app-relative URL only. No provider URL, filesystem path or upload id. */
export interface GeneratedImageAsset {
  id: string;
  url: string;
  channel: ImageChannel;
  width: number;
  height: number;
  bytes: number;
}

/** `source: 'mock'` always carries `asset: null`, meaning "keep the V19 creative". */
export interface ImageOutcome {
  source: 'mock' | 'firefly';
  asset: GeneratedImageAsset | null;
  referenceSlot: 1 | 2;
  model?: string;
  seed?: number;
  contentClass?: string;
}

export interface ImageHealth {
  provider: 'mock' | 'firefly';
  credentialsConfigured: boolean;
  referencesAvailable: boolean;
}

/** The most recent generated background for a channel, if one exists. */
export interface LatestImage {
  channel: ImageChannel;
  asset: GeneratedImageAsset | null;
}

export interface BarclaysServices {
  readonly version: string;
  health(): Promise<BridgeResponse<AiHealth>>;
  agents: {
    analyseDiscussion(discussion: DiscussionContext): Promise<BridgeResponse<AgentOutcome<CoordinatorResult>>>;
    generateBrief(request: BriefRequestPayload): Promise<BridgeResponse<AgentOutcome<BriefResult>>>;
  };
  images: {
    health(): Promise<BridgeResponse<ImageHealth>>;
    generate(request: ImageRequestPayload): Promise<BridgeResponse<ImageOutcome>>;
    latest(channel: ImageChannel): Promise<BridgeResponse<LatestImage>>;
  };
}

declare global {
  interface Window {
    __BARCLAYS_SERVICES__?: BarclaysServices;
  }
}
