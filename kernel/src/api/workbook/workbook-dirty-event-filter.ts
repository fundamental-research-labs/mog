const NON_MUTATING_WORKBOOK_EVENT_TYPES = new Set<string>([
  'chrome:theme-changed',
  'export:complete',
  'export:progress',
  'freeze:changed',
  'import:complete',
  'import:progress',
  'recalc:completed',
  'recalc:started',
  'selection:changed',
  'sheet:activated',
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
  'versioning:admission-diagnostic',
  'versioning:mutation-capture-error',
  'security:policies-reloaded',
]);

export function shouldTrackEventAsWorkbookDirty(event: unknown): boolean {
  if (!isSpreadsheetEventLike(event)) return false;
  if (hasSystemSource(event)) return false;
  return !NON_MUTATING_WORKBOOK_EVENT_TYPES.has(event.type);
}

interface EventLike {
  readonly type: string;
  readonly source?: unknown;
}

function isSpreadsheetEventLike(event: unknown): event is EventLike {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as { readonly type?: unknown }).type === 'string'
  );
}

function hasSystemSource(event: EventLike): boolean {
  return event.source === 'system';
}
