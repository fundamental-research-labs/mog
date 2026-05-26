/**
 * Render Context — Re-exports
 *
 * This file previously contained the monolithic RenderContext interface and
 * createRenderContext() factory. Those have been retired in favor of typed
 * data source adapters (see @mog-sdk/contracts/rendering).
 *
 * What remains here are re-exports consumed by downstream packages.
 *
 * @module canvas/renderer/render-context
 */

// =============================================================================
// Selection State (re-exported from contracts)
// =============================================================================

/**
 * Re-export SelectionErrorType from contracts.
 * @see @mog-sdk/contracts/rendering/render-context
 */
export type { SelectionErrorType, SelectionRenderState } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Floating Object Render State (re-exported from contracts)
// =============================================================================

/**
 * Re-export FloatingObjectRenderState, ObjectBounds, and EffectiveObjectState from contracts.
 * @see @mog-sdk/contracts/rendering/render-context
 * @see @mog-sdk/contracts/rendering/hit-test
 */
export type {
  EffectiveObjectState,
  FloatingObjectRenderState,
  ObjectBounds,
} from '@mog-sdk/contracts/rendering';

// =============================================================================
// Render Context Config (re-exported from contracts)
// =============================================================================

/**
 * Re-export RenderContextConfig from contracts.
 * Used by grid-renderer.ts for the updateContext() and applyConfig() signatures.
 * @see @mog-sdk/contracts/rendering/render-context
 */
export type { RenderContextConfig } from '@mog-sdk/contracts/rendering';
