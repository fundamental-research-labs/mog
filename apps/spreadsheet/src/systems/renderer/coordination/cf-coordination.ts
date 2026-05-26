/**
 * Conditional Formatting (CF) Coordination
 *
 * Feature coordination for conditional formatting event handling.
 * CF applies visual formatting to cells based on their values and rules.
 *
 * ARCHITECTURE:
 * - Delegates to EventSubscriptionResult.setCFConfig()
 * - EventSubscriptions module handles all CF events via EventBus
 * - This is a thin wrapper that connects coordinator config to event subscriptions
 *
 * Events handled (by EventSubscriptions):
 * - cell:changed → CF cache invalidation + renderer invalidation
 * - cells:batch-changed → CF cache invalidation + renderer invalidation
 * - cf:rule-changed → renderer invalidation (cache auto-invalidates)
 *
 * @see engine/src/state/coordinator/subscriptions/event-subscriptions.ts
 */

import type { ConditionalFormatCache } from '@mog-sdk/contracts/api';
import type { CleanupManager } from '../../shared/cleanup-manager';
import type { EventSubscriptionResult } from '../subscriptions/event-subscriptions';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for CF feature coordination.
 */
export interface CFCoordinationConfig {
  /** The CF manager instance */
  cfManager: ConditionalFormatCache;
  /** Get current sheet ID */
  getCurrentSheetId: () => string;
  /** Event subscription module (already set up) */
  eventSubscriptions: EventSubscriptionResult | null;
}

/**
 * Result of CF coordination setup.
 */
export interface CFCoordinationResult {
  /** Cleanup function */
  cleanup: () => void;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Build conditional formatting coordination feature.
 *
 * Wires ConditionalFormatCache to EventBus events via EventSubscriptions module.
 * This is a thin wrapper that delegates to EventSubscriptionResult.setCFConfig().
 *
 * Handles:
 * - Cell value changes → CF cache invalidation + renderer invalidation
 * - CF rule changes → renderer invalidation (cache auto-invalidates)
 *
 * IMPORTANT: Requires EventSubscriptions to be set up first.
 * If eventSubscriptions is null, this is a no-op.
 *
 * @param config - Configuration with CF manager and event subscriptions
 * @param cleanups - CleanupManager to register cleanup function
 * @returns CF coordination result
 */
export function buildCFCoordination(
  config: CFCoordinationConfig,
  cleanups: CleanupManager,
): CFCoordinationResult {
  const { cfManager, getCurrentSheetId, eventSubscriptions } = config;

  let cfCleanup: (() => void) | null = null;

  // If event subscriptions available, set up CF events
  if (eventSubscriptions) {
    cfCleanup = eventSubscriptions.setCFConfig({
      cfManager,
      getCurrentSheetId,
    });
  }

  const cleanup = () => {
    cfCleanup?.();
  };

  // Register cleanup with manager
  cleanups.register('cfCoordination', cleanup);

  return {
    cleanup,
  };
}
