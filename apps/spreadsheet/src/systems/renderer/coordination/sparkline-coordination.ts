/**
 * Sparkline Coordination
 *
 * Feature coordination for sparkline event handling.
 * Sparklines are mini charts rendered within cells.
 *
 * ARCHITECTURE:
 * - Delegates to EventSubscriptionResult.setSparklineConfig()
 * - EventSubscriptions module handles all sparkline events via EventBus
 * - This is a thin wrapper that connects coordinator config to event subscriptions
 *
 * Events handled (by EventSubscriptions):
 * - sparkline:created
 * - sparkline:updated
 * - sparkline:deleted
 * - sparkline:data-changed
 *
 * @see engine/src/state/coordinator/subscriptions/event-subscriptions.ts
 */

import type { ISparklineManager as SparklineManager } from '@mog-sdk/contracts/sparklines';
import type { CleanupManager } from '../../shared/cleanup-manager';
import type { EventSubscriptionResult } from '../subscriptions/event-subscriptions';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for sparkline feature coordination.
 */
export interface SparklineCoordinationConfig {
  /** The sparkline manager instance */
  sparklineManager: SparklineManager;
  /** Get current sheet ID */
  getCurrentSheetId: () => string;
  /** Event subscription module (already set up) */
  eventSubscriptions: EventSubscriptionResult | null;
}

/**
 * Result of sparkline coordination setup.
 */
export interface SparklineCoordinationResult {
  /** Cleanup function */
  cleanup: () => void;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Build sparkline coordination feature.
 *
 * Wires SparklineManager to EventBus events via EventSubscriptions module.
 * This is a thin wrapper that delegates to EventSubscriptionResult.setSparklineConfig().
 *
 * IMPORTANT: Requires EventSubscriptions to be set up first.
 * If eventSubscriptions is null, this is a no-op.
 *
 * @param config - Configuration with sparkline manager and event subscriptions
 * @param cleanups - CleanupManager to register cleanup function
 * @returns Sparkline coordination result
 */
export function buildSparklineCoordination(
  config: SparklineCoordinationConfig,
  cleanups: CleanupManager,
): SparklineCoordinationResult {
  const { sparklineManager, getCurrentSheetId, eventSubscriptions } = config;

  let sparklineCleanup: (() => void) | null = null;

  // If event subscriptions available, set up sparkline events
  if (eventSubscriptions) {
    sparklineCleanup = eventSubscriptions.setSparklineConfig({
      sparklineManager,
      getCurrentSheetId,
    });
  }

  const cleanup = () => {
    sparklineCleanup?.();
  };

  // Register cleanup with manager
  cleanups.register('sparklineCoordination', cleanup);

  return {
    cleanup,
  };
}
