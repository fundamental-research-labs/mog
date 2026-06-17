import assert from 'node:assert/strict';
import test from 'node:test';

import { isWorkbookMutationEvent, shouldTrackWorkbookDirtyEvent } from '../dirty-events';

test('dirty classifier only treats workbook mutation events as dirty', () => {
  for (const type of [
    'cell:changed',
    'cells:batch-changed',
    'formula:changed',
    'sheet:renamed',
    'table:updated',
    'range:sorted',
  ]) {
    assert.equal(isWorkbookMutationEvent({ type }), true, `${type} should dirty the workbook`);
  }
});

test('dirty classifier keeps read, render, trace, and UI lifecycle events clean', () => {
  for (const type of [
    'export:progress',
    'export:complete',
    'import:progress',
    'import:complete',
    'recalc:started',
    'recalc:completed',
    'validation:recalc-annotations',
    'selection:changed',
    'sheet:activated',
    'scroll:changed',
    'viewport:resized',
    'chart:selected',
    'floatingObject:selectionChanged',
    'store:ready',
    'diagnostics:formula-references-read',
    'screenshot:captured',
    'workbook:inspected',
  ]) {
    assert.equal(isWorkbookMutationEvent({ type }), false, `${type} should remain clean`);
  }
});

test('dirty classifier ignores malformed events', () => {
  assert.equal(isWorkbookMutationEvent(null), false);
  assert.equal(isWorkbookMutationEvent({}), false);
  assert.equal(isWorkbookMutationEvent({ type: 123 }), false);
});

test('dirty tracker ignores deferred import materialization for clean workbooks', () => {
  assert.equal(
    shouldTrackWorkbookDirtyEvent(
      { type: 'sheet:created', source: 'user' },
      { workbookAlreadyDirty: false, importDurabilityPending: true },
    ),
    false,
  );
  assert.equal(
    shouldTrackWorkbookDirtyEvent(
      { type: 'workbook:settings-changed', changedKey: 'selectedSheetIds' },
      { workbookAlreadyDirty: false, importDurabilityPending: true },
    ),
    false,
  );
});

test('dirty tracker still tracks normal and already-dirty mutations', () => {
  assert.equal(
    shouldTrackWorkbookDirtyEvent(
      { type: 'cell:changed' },
      { workbookAlreadyDirty: false, importDurabilityPending: false },
    ),
    true,
  );
  assert.equal(
    shouldTrackWorkbookDirtyEvent(
      { type: 'sheet:created' },
      { workbookAlreadyDirty: true, importDurabilityPending: true },
    ),
    true,
  );
  assert.equal(
    shouldTrackWorkbookDirtyEvent(
      { type: 'selection:changed' },
      { workbookAlreadyDirty: false, importDurabilityPending: true },
    ),
    false,
  );
});
