/**
 * Workbook Event Mapping — Shared Constant
 *
 * Extracted from `workbook-impl.ts` so `sheets.ts` (a sub-API implementation
 * re-exported by the workbook barrel) can import it without creating an
 * `impl ↔ barrel` dependency cycle via the barrel re-export chain.
 *
 * The unified API defines simplified event type strings (e.g. 'sheetAdded').
 * The internal EventBus uses detailed event types (e.g. 'sheet:created').
 * This map bridges the two systems.
 */

/**
 * Canonical mapping from coarse event names to fine-grained internal event types.
 *
 * Callers of `wb.on(event, handler)` may use either:
 * - **Coarse** (`WorkbookEvent` or `SpreadsheetEventType`): e.g. `'sheetAdded'` → subscribes to `['sheet:created']`
 * - **Fine-grained**: e.g. `'sheet:created'` → direct pass-through to the event bus
 *
 * The handler always receives the raw internal event object — no wrapper.
 *
 * This is the single source of truth. The sheets sub-API's `on()` method
 * references the relevant subset of these mappings.
 */
export const EVENT_TO_INTERNAL: Record<string, string[]> = {
  // SpreadsheetEventType (coarse API events)
  cellChanged: ['cell:changed', 'cells:batch-changed'],
  rangeChanged: ['range:changed'],
  sheetAdded: ['sheet:created'],
  sheetRemoved: ['sheet:deleted'],
  sheetRenamed: ['sheet:renamed'],
  sheetMoved: ['sheet:moved'],
  activeSheetChanged: ['sheet:activated'],
  selectionChanged: ['selection:changed'],
  formatChanged: ['format:changed'],
  structureChanged: ['structure:changed'],
  tableChanged: ['table:changed', 'table:created', 'table:updated', 'table:deleted'],
  chartChanged: ['chart:changed'],
  filterChanged: [
    'filter:changed',
    'filter:created',
    'filter:updated',
    'filter:deleted',
    'filter:applied',
    'filter:cleared',
    'filter:column-changed',
  ],
  sortApplied: ['sort:applied'],
  undoRedoStateChanged: ['undo:stateChanged'],
  calculationComplete: ['calc:complete'],
  protectionChanged: ['protection:changed'],
  // WorkbookEvent (coarse workbook-level events)
  undoStackChanged: ['undo:stateChanged', 'undo:changed'],
  checkpointCreated: ['checkpoint:created'],
  namedRangeChanged: ['name:created', 'name:updated', 'name:deleted'],
  scenarioChanged: ['scenario:applied', 'scenario:deleted'],
  settingsChanged: ['workbook:settings-changed'],
  'cells:policy-preserved': ['workbook:policy-preserved'],
};
