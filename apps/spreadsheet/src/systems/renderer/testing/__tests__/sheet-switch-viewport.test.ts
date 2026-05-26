/**
 * Reproduction test for the sheet-switch viewport buffer bug.
 *
 * In renderer-execution.ts (lines 522-598), the `switchingSheet` case calls
 * renderer.switchSheet(targetSheetId) BEFORE capturing the old sheet ID via
 * renderer.getCurrentSheetId(). Because switchSheet immediately mutates the
 * current sheet, getCurrentSheetId() returns the NEW sheet ID, causing the
 * guard `oldSheetId !== targetSheetId` to always evaluate to false. As a
 * result, viewportAPI.resetSheetRegions(oldSheetId) is never called, leaving
 * stale viewport buffer regions from the previous sheet.
 *
 * The fix is to capture oldSheetId BEFORE calling switchSheet.
 */

import { jest } from '@jest/globals';

describe('sheet switch viewport reset ordering', () => {
  it('BUG: getCurrentSheetId returns new sheet after switchSheet, preventing resetSheetRegions', () => {
    // Simulate the GridRenderer's behavior
    let currentSheetId = 'sheet-1';

    const renderer = {
      switchSheet: (sheetId: string) => {
        currentSheetId = sheetId;
      },
      getCurrentSheetId: () => currentSheetId,
    };

    const resetSheetRegions = jest.fn();
    const viewportAPI = { resetSheetRegions };

    const targetSheetId = 'sheet-2';

    // --- Reproduce the exact sequence from renderer-execution.ts lines 522-574 ---

    // Line 525: switchSheet FIRST (sets currentSheetId to new sheet)
    renderer.switchSheet(targetSheetId);

    // Line 565: try to get "old" sheet ID (but it's already the new one!)
    const oldSheetId = renderer.getCurrentSheetId();

    // Line 566-568: guard condition
    if (oldSheetId && oldSheetId !== targetSheetId) {
      viewportAPI.resetSheetRegions(oldSheetId);
    }

    // BUG: resetSheetRegions was never called because oldSheetId === targetSheetId
    expect(resetSheetRegions).not.toHaveBeenCalled(); // This PASSES -- demonstrating the bug

    // What SHOULD happen: resetSheetRegions('sheet-1') should have been called
    // expect(resetSheetRegions).toHaveBeenCalledWith('sheet-1'); // This would FAIL
  });

  it('CORRECT: capturing oldSheetId before switchSheet allows resetSheetRegions to fire', () => {
    let currentSheetId = 'sheet-1';

    const renderer = {
      switchSheet: (sheetId: string) => {
        currentSheetId = sheetId;
      },
      getCurrentSheetId: () => currentSheetId,
    };

    const resetSheetRegions = jest.fn();
    const viewportAPI = { resetSheetRegions };

    const targetSheetId = 'sheet-2';

    // --- FIXED sequence: capture old ID BEFORE switchSheet ---

    // Capture old sheet ID FIRST
    const oldSheetId = renderer.getCurrentSheetId();

    // THEN switch
    renderer.switchSheet(targetSheetId);

    // Now the guard works correctly
    if (oldSheetId && oldSheetId !== targetSheetId) {
      viewportAPI.resetSheetRegions(oldSheetId);
    }

    // resetSheetRegions fires with the correct old sheet ID
    expect(resetSheetRegions).toHaveBeenCalledWith('sheet-1');
  });
});

describe('switchSheet immediate mutation', () => {
  it('switchSheet changes currentSheetId immediately (not deferred)', () => {
    let currentSheetId = 'sheet-1';
    const switchSheet = (id: string) => {
      currentSheetId = id;
    };

    expect(currentSheetId).toBe('sheet-1');
    switchSheet('sheet-2');
    expect(currentSheetId).toBe('sheet-2');
  });
});
