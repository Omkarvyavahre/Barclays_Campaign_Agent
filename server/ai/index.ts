/**
 * Server-only AI barrel.
 *
 * Nothing under `server/` may be imported from `src/`. The bundle-safety test
 * enforces that rule.
 */

export { loadAiConfig, toPublicAiConfig, assertLiveConfig, DEFAULT_TIMEOUT_MS } from './config.ts';
export type { AiConfig, PublicAiConfig, AiMode, AiBackend, GatewayProtocol } from './config.ts';

export { AiServiceError, safeErrorPayload, classifyHttpStatus, classifyTransportError } from './errors.ts';
export type { AiErrorCategory, SafeErrorPayload } from './errors.ts';

export { requestStructuredCompletion, normalizeChatCompletion } from './gateway.ts';
export type { NormalizedAiResult, AiUsage, GatewayDeps, FetchLike } from './gateway.ts';

export { analyseDiscussion, buildDiscussionTranscript } from './coordinator.ts';
export type { AgentOutcome } from './coordinator.ts';

export { generateBrief } from './briefAgent.ts';

export {
  BRIEF_FIELD_KEYS,
  BRIEF_JSON_SCHEMA,
  COORDINATOR_JSON_SCHEMA,
  RECOMMENDATIONS,
  validateAnalyseRequest,
  validateBriefRequest,
  validateBriefResult,
  validateCoordinatorResult,
} from './schemas.ts';
export type {
  AnalyseRequest,
  BriefFieldKey,
  BriefRequest,
  BriefResult,
  CoordinatorResult,
  DiscussionContext,
} from './schemas.ts';
