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

export type BridgeErrorCategory =
  | 'auth_error'
  | 'forbidden'
  | 'upstream_error'
  | 'timeout'
  | 'invalid_response'
  | 'configuration_error'
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

export interface BarclaysServices {
  readonly version: string;
  health(): Promise<BridgeResponse<AiHealth>>;
  agents: {
    analyseDiscussion(discussion: DiscussionContext): Promise<BridgeResponse<AgentOutcome<CoordinatorResult>>>;
    generateBrief(request: BriefRequestPayload): Promise<BridgeResponse<AgentOutcome<BriefResult>>>;
  };
}

declare global {
  interface Window {
    __BARCLAYS_SERVICES__?: BarclaysServices;
  }
}
