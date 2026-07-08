import type { SheetId } from '@mog-sdk/contracts/core';
import {
  DocumentMaterializationTracker,
  materializedSheetIdsForDeferredImport,
} from '../materialization-tracker';

const sheetId = (id: string) => id as SheetId;

describe('DocumentMaterializationTracker', () => {
  it('tracks only non-critical sheets from a deferred import', () => {
    const tracker = new DocumentMaterializationTracker();

    tracker.markDeferredImport([sheetId('critical'), sheetId('deferred')], [sheetId('critical')]);

    expect(tracker.requiresDeferredHydration(sheetId('critical'))).toBe(false);
    expect(tracker.requiresDeferredHydration(sheetId('deferred'))).toBe(true);
    expect(tracker.requiresDeferredHydration(sheetId('added-after-import'))).toBe(false);
    expect(tracker.requiresDeferredHydration('allSheets')).toBe(true);
  });

  it('clears deferred scope when all sheets are materialized or state resets', () => {
    const tracker = new DocumentMaterializationTracker();
    tracker.markDeferredImport([sheetId('critical'), sheetId('deferred')], [sheetId('critical')]);

    tracker.markAllMaterialized();
    expect(tracker.requiresDeferredHydration(sheetId('deferred'))).toBe(false);
    expect(tracker.requiresDeferredHydration('allSheets')).toBe(false);

    tracker.markDeferredImport([sheetId('critical'), sheetId('deferred')], [sheetId('critical')]);
    tracker.reset();
    expect(tracker.requiresDeferredHydration(sheetId('deferred'))).toBe(false);
    expect(tracker.requiresDeferredHydration('allSheets')).toBe(false);
  });

  it('uses selected sheet ids as materialized deferred-import scope', () => {
    const tracker = new DocumentMaterializationTracker();
    tracker.markDeferredImport([sheetId('first'), sheetId('active')], [sheetId('active')]);
    expect(tracker.requiresDeferredHydration(sheetId('first'))).toBe(true);
    expect(tracker.requiresDeferredHydration(sheetId('active'))).toBe(false);

    expect(
      materializedSheetIdsForDeferredImport(
        [sheetId('first'), sheetId('active')],
        [sheetId('active')],
      ),
    ).toEqual([sheetId('active')]);

    expect(materializedSheetIdsForDeferredImport([sheetId('first')], [])).toEqual([
      sheetId('first'),
    ]);
    expect(materializedSheetIdsForDeferredImport([sheetId('first')], [sheetId('stale')])).toEqual([
      sheetId('first'),
    ]);
  });
});
