import { describe, expect, it } from '@jest/globals';
import type { SpreadsheetEvent } from '@mog-sdk/contracts/events';

import { shouldTrackEventAsWorkbookDirty } from '../workbook-dirty-event-filter';

describe('shouldTrackEventAsWorkbookDirty', () => {
  it('does not dirty for sheet activation or system-origin runtime state', () => {
    expect(
      shouldTrackEventAsWorkbookDirty({
        type: 'sheet:activated',
        timestamp: 1,
        sheetId: 'sheet-1',
        name: 'Sheet1',
        source: 'user',
      }),
    ).toBe(false);

    expect(
      shouldTrackEventAsWorkbookDirty({
        type: 'workbook:settings-changed',
        timestamp: 1,
        changedKey: 'customSettings',
        settings: {},
        source: 'system',
      } as unknown as SpreadsheetEvent),
    ).toBe(false);
  });

  it('ignores malformed payloads and versioning diagnostics', () => {
    expect(shouldTrackEventAsWorkbookDirty('versioning:admission-diagnostic')).toBe(false);
    expect(shouldTrackEventAsWorkbookDirty({})).toBe(false);
    expect(
      shouldTrackEventAsWorkbookDirty({
        type: 'versioning:admission-diagnostic',
        timestamp: 1,
        diagnostic: {},
      }),
    ).toBe(false);
  });

  it('still dirties user-authored workbook mutations', () => {
    expect(
      shouldTrackEventAsWorkbookDirty({
        type: 'workbook:settings-changed',
        timestamp: 1,
        changedKey: 'customSettings',
        settings: {},
        source: 'user',
      } as unknown as SpreadsheetEvent),
    ).toBe(true);
    expect(shouldTrackEventAsWorkbookDirty({ type: 'test:dirty' })).toBe(true);
  });
});
