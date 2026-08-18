export type {
  ChannelDerivativeFailure,
  ChannelGenerationTarget,
  DerivedCampaignAsset,
  ModifyAssetPublicResult,
  ModifyAssetRequest,
  ModifyAssetResult,
  ModifyContentUpdate,
  ModifyMode,
  ResolvedFireflyReference,
  SourceDamAssetReference
} from './types';

export {
  isForbiddenFallbackId,
  ReferenceResolutionError,
  resolveEditSourceImageBytes,
  resolveEditSourceReferenceImage,
  resolveModifyVisualReference
} from './resolveReference';

export { buildDerivedAsset } from './derivedAsset';

export { distributeCrossChannelCreatives } from './distributeCrossChannelCreatives';
export type {
  DistributeCrossChannelInput,
  DistributeCrossChannelResult
} from './distributeCrossChannelCreatives';

export {
  compositeOwnedLogo,
  DEFAULT_OWNED_LOGO_ENTRY_ID,
  LOGO_MARGIN_FRACTION,
  LOGO_MAX_WIDTH_FRACTION,
  MIN_COMPOSITION_CANVAS_PX,
  resolveOwnedLogoBytes
} from './compositeOwnedLogo';
export type {
  CompositeOwnedLogoInput,
  CompositeOwnedLogoResult,
  LogoCompositionMetadata,
  LogoCompositionPlacement
} from './compositeOwnedLogo';

export {
  adaptImageToChannelFormat,
  adaptImageToTarget,
  cropCandidates,
  formatDimensions,
  parseDimensions,
  readImageDimensions,
  resolveCropStrategy,
  type AdaptImageToTargetInput,
  type AdaptImageToTargetResult,
  type ChannelAdaptationOutcome,
  type CropPosition,
  type CropStrategy,
  type CropStrategySource,
  type ParsedDimensions
} from './adaptImageToTarget';

export {
  describeBlankBands,
  hasInteriorBlankBand,
  scanInteriorBlankBands,
  type BlankBand,
  type BlankBandScan
} from './blankBand';

export {
  inferRegenerationVisualFamily,
  ModifyAssetError,
  modifyAsset,
  toPublicModifyAssetResult,
  type ModifyAssetOptions
} from './modifyAsset';
