/**
 * Factory Function for SheetCoordinator
 *
 * Extracted from sheet-coordinator.ts as part of the coordinator decomposition.
 *
 * @see COORDINATOR-DECOMPOSITION.md
 * @see 07-SHEET-COORDINATOR-DECOMPOSITION.md
 */

import { SheetCoordinator } from './sheet-coordinator';
import type { SheetCoordinatorConfig } from './types';

/**
 * Create a new SheetCoordinator instance.
 *
 * Config now accepts optional dependency interfaces for keyboard,
 * clipboard, and editor coordination. In these will become required
 * to enable constructor-only initialization.
 *
 * @param config - Configuration including initial sheet ID, doc, and dependencies
 * @returns A fully initialized SheetCoordinator instance
 */
export function createSheetCoordinator(config: SheetCoordinatorConfig): SheetCoordinator {
  return new SheetCoordinator(config);
}
