import type {
  SpreadsheetEvent as InternalSpreadsheetEvent,
  SpreadsheetEventType as InternalEventType,
} from '@mog-sdk/contracts/events';

const NON_MUTATING_WORKBOOK_EVENT_TYPES = new Set<InternalEventType>([
  'chrome:theme-changed',
  'export:complete',
  'export:progress',
  'freeze:changed',
  'import:complete',
  'import:progress',
  'recalc:completed',
  'recalc:started',
  'selection:changed',
  'scroll:changed',
  'split:position-changed',
  'split:removed',
  'store:ready',
  'store:sync-error',
  'view:options-changed',
  'view:selection-changed',
  'viewport:resized',
  'workbook:policy-preserved',
  'workbook:version-active-checkout-state-changed',
  'workbook:version-checkout-materialized',
  'workbook:version-dirty-status-changed',
  'security:policies-reloaded',
]);

export function shouldTrackEventAsWorkbookDirty(event: InternalSpreadsheetEvent): boolean {
  return !NON_MUTATING_WORKBOOK_EVENT_TYPES.has(event.type);
}
