/**
 * Named Ranges Integration Module
 *
 * Previously handled recalculation triggers for named range changes.
 * Now a no-op — all recalculation is handled by Rust compute-core.
 */

import type { Workbook } from '@mog-sdk/contracts/api';

export interface NamedRangesIntegrationConfig {
  workbook: Workbook;
  getActiveSheetId: () => string | undefined;
}

/**
 * No-op: all recalculation on named range changes is handled by Rust compute-core.
 */
export function setupNamedRangesIntegration(_config: NamedRangesIntegrationConfig): () => void {
  return () => {};
}
