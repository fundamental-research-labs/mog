import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';
import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Mocks
// =============================================================================

let mockSheetSettings = new Map<string, { isProtected: boolean }>();
const mockOn = jest.fn().mockReturnValue(jest.fn());

interface SheetSettingsChangedEvent {
  type: 'sheet:settings-changed';
  sheetId: string;
  changedKey: string;
  settings: { isProtected: boolean };
}

jest.unstable_mockModule('../../../infra/context', () => ({
  useWorkbook: () => ({
    mirror: {
      getSheetSettings: (sheetId: string) =>
        mockSheetSettings.get(sheetId) ?? { isProtected: false },
    },
    on: mockOn,
  }),
}));

const { useAllSheetsProtection } = await import('../use-sheet-protection');

// =============================================================================
// Tests
// =============================================================================

describe('useAllSheetsProtection', () => {
  const sheetId = 'sheet-1' as SheetId;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSheetSettings = new Map([['sheet-1', { isProtected: false }]]);
    mockOn.mockReturnValue(jest.fn());
  });

  it('re-renders when sheet protection options change', () => {
    let settingsChangedHandler: ((event: SheetSettingsChangedEvent) => void) | undefined;
    mockOn.mockImplementation(
      (eventType: string, handler: (event: SheetSettingsChangedEvent) => void) => {
        if (eventType === 'sheet:settings-changed') {
          settingsChangedHandler = handler;
        }
        return jest.fn();
      },
    );

    const { result } = renderHook(() => useAllSheetsProtection());
    expect(result.current.isSheetProtected(sheetId)).toBe(false);

    act(() => {
      mockSheetSettings.set('sheet-1', { isProtected: true });
      settingsChangedHandler!({
        type: 'sheet:settings-changed',
        sheetId: 'sheet-1',
        changedKey: 'protectionOptions',
        settings: { isProtected: true },
      });
    });

    expect(result.current.isSheetProtected(sheetId)).toBe(true);
    expect(result.current.protectionVersion).toBe(1);
  });
});
