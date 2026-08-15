/**
 * Shared Adobe Firefly Services contracts.
 *
 * This is the first (and only) Firefly client in the project.
 * Do not invent a second provider or unsupported API fields.
 */

import type { CreativeSpecification } from '../creative/types';

export type FireflyContentClass = 'photo' | 'art';

export type FireflyReferenceSource = 'knowledge-graph' | 'source-dam-asset';

/** Injectable reference image for style guidance (uploadId or url). */
export type FireflyReferenceImage = {
  uploadId?: string;
  url?: string;
  /** Local bytes used only for upload — never returned to the client. */
  bytes?: Buffer;
  mimeType?: string;
  /** Provenance id (KG entry id or DAM asset id) — never a filesystem path. */
  referenceId?: string;
};

export type FireflyGenerateRequest = {
  prompt: string;
  contentClass?: FireflyContentClass;
  numVariations?: number;
  /** Style reference strength 1–100 (Firefly default 50 when omitted). */
  styleStrength?: number;
  referenceImage?: FireflyReferenceImage | null;
  size?: { width: number; height: number };
};

export type FireflyGeneratedImage = {
  id: string;
  /** Public app-relative URL for the persisted image (no filesystem paths). */
  imageUrl: string;
  /** Optional remote Firefly pre-signed URL (internal only). */
  remoteUrl?: string;
  seed?: number;
  contentClass?: FireflyContentClass;
};

export type FireflyJobTelemetry = {
  fireflyJobId?: string;
  initialResponseStatus: number;
  statusUrlUsed: boolean;
  pollCount: number;
  statusTransitions: string[];
  finalJobStatus?: string;
  generatedImageAvailable: boolean;
};

export type FireflyGenerateResult = {
  images: FireflyGeneratedImage[];
  jobId?: string;
  latencyMs?: number;
  jobTelemetry?: FireflyJobTelemetry;
};

/**
 * Injectable port used by Modify orchestration.
 * Tests supply a mock; production supplies createFireflyClient().
 */
export type FireflyClient = {
  generateImage(request: FireflyGenerateRequest): Promise<FireflyGenerateResult>;
};

export type FireflyClientOptions = {
  clientId?: string;
  clientSecret?: string;
  /**
   * Live network calls are OFF unless this is true OR FIREFLY_LIVE=1,
   * and Adobe credentials are present.
   */
  live?: boolean;
  fetchImpl?: typeof fetch;
  /** Directory for persisted session generations (not auto-loaded into Asset Library). */
  generatedDir?: string;
  /** Register a persisted file for GET /api/ai/generated/:id serving. */
  registerGenerated?: (id: string, absolutePath: string, mimeType: string) => void;
  /** Poll interval override (tests). Default FIREFLY_POLL_INTERVAL_MS. */
  pollIntervalMs?: number;
  /** Job timeout override (tests). Default FIREFLY_JOB_TIMEOUT_MS. */
  jobTimeoutMs?: number;
  /** Injectable delay for tests (default setTimeout). */
  sleep?: (ms: number) => Promise<void>;
};

export type FireflyPromptInput = {
  specification: CreativeSpecification;
  referenceSource: FireflyReferenceSource;
};
