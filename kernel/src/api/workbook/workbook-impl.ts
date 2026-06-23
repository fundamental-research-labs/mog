/**
 * WorkbookImpl — Unified Workbook Implementation
 *
 * THE single implementation of the Workbook interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * Absorbs functionality from:
 * - SpreadsheetAPI (kernel/src/api/spreadsheet-api.ts)
 * - External API WorkbookImpl (kernel/src/external/workbook.ts)
 *
 * Design decisions:
 * 1. getSheetById(sheetId) is SYNC — constructs WorksheetImpl directly.
 *    getSheet/getSheetByIndex are ASYNC — reads from Rust.
 *    No JS-side sheet cache. Rust is the single source of truth.
 * 2. canUndo()/canRedo() are SYNC — delegated to UndoService's cached state.
 * 3. undoGroup() wraps operations in beginUndoGroup/endUndoGroup for undo grouping.
 *    Each mutation triggers its own recalc — no deferred calc accumulation.
 * 4. Errors are thrown, not returned as OperationResult. This is simpler
 *    for LLM code generation (try/catch beats checking .success).
 *
 * @see contracts/src/api/workbook.ts — Interface definition
 */

import type { Workbook, WorkbookInternal } from '@mog-sdk/contracts/api';
import type { WorkbookConfig } from './types';
import { WorkbookImplSubApis } from './workbook-impl-sub-apis';

export type { CreateWorkbookOptions, WorkbookConfig } from './types';

// Event mapping — extracted to `event-mapping.ts` so `sheets.ts` can import it
// without going through the barrel (which would re-introduce the cycle).
export { EVENT_TO_INTERNAL } from './event-mapping';

// =============================================================================
// WorkbookImpl
// =============================================================================

export class WorkbookImpl extends WorkbookImplSubApis implements WorkbookInternal {}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a WorkbookImpl from a pre-existing WorkbookConfig.
 *
 * This is the power-user path where the caller provides a pre-existing kernel
 * context, event bus, and (optionally) active sheet callbacks.
 *
 * Exported so that `document-factory.ts` can consume it directly without going
 * through the overloaded `createWorkbook()` dispatcher — which would require
 * importing from `./create-workbook.ts`, which itself imports `document-factory`
 * (re-introducing the impl↔factory cycle).
 */
export async function createWorkbookFromConfig(config: WorkbookConfig): Promise<Workbook> {
  const wb = new WorkbookImpl(config);
  await wb._init();
  return wb;
}
