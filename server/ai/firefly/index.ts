export type {
  FireflyClient,
  FireflyClientOptions,
  FireflyContentClass,
  FireflyGenerateRequest,
  FireflyGenerateResult,
  FireflyGeneratedImage,
  FireflyJobTelemetry,
  FireflyPromptInput,
  FireflyReferenceImage,
  FireflyReferenceSource
} from './types';

export {
  assertPromptNotRawMarketerText,
  buildFireflyPrompt,
  FIREFLY_PROMPT_MAX_CHARS,
  FIREFLY_PROMPT_TARGET_CHARS,
  measureLegacyFireflyPromptLength,
  promptContainsBannedContentInstructions,
  promptExcludesNonVisualMetadata,
  resolveFireflyContentClass,
  significantVisualIntentTokens
} from './prompt';

export { createFireflyClient, FireflyClientError, FIREFLY_JOB_TIMEOUT_MS, FIREFLY_POLL_INTERVAL_MS, extractFireflyOutputs, extractFirstImageUrl, normalizeFireflyJobStatus, parseAsyncJobAccepted } from './client';

export {
  clearGeneratedImageRegistry,
  detectImageFormatFromBytes,
  getDefaultGeneratedDir,
  getRegisteredGeneratedImage,
  listRegisteredGeneratedIds,
  loadHistoricalGeneratedImages,
  parseTrustworthyImageContentType,
  persistGeneratedImageBytes,
  readRegisteredGeneratedBytes,
  registerGeneratedImage,
  resolveImageFormat
} from './storage';

export type { DetectedImageFormat, GeneratedImageFileExtension, GeneratedImageRecord } from './storage';
