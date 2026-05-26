/**
 * Flash Fill Module
 *
 * Pattern recognition engine for Flash Fill (Ctrl+E).
 * Detects data transformation patterns from user examples and
 * applies them to fill a column automatically.
 *
 */

// Types
export { DEFAULT_FLASH_FILL_CONFIG } from './types';
export type {
  CaseChangeType,
  ExtractionPosition,
  FlashFillConfig,
  FlashFillContext,
  FlashFillDetectionResult,
  FlashFillExample,
  FlashFillPattern,
  FlashFillPatternType,
  FlashFillPreview,
  TokenKind,
  TransformationStep,
} from './types';

// Engine functions
export { applyPattern, detectFlashFillPattern } from './flash-fill-engine';
