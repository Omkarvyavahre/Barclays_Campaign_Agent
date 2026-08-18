export {
  aiBackend,
  buildGatewayCompletionsUrl,
  describeGatewayConfig,
  GatewayConfigError,
  isGeminiLive,
  normalizeGatewayBaseUrl,
  readGatewayConfig,
  type GatewayConfig,
  type GatewayStructuredOutput
} from './config';
export {
  GatewayError,
  gatewayErrorFromHttp,
  gatewayErrorFromTransport,
  type GatewayFailureCategory
} from './errors';
export {
  probeGatewayReachability,
  toPublicGatewayHealth,
  type GatewayPreflightResult
} from './preflight';
