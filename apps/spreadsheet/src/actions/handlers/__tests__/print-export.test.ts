/**
 * Print/Export Handler Tests — 01 the related wiring migrations only.
 *
 * Verifies that QUICK_PRINT calls `window.print()` directly instead of
 * routing through the UIStore callback / onUIAction.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import * as PrintExportHandlers from '../print-export';
import { createMockPlatform, createMockShellService } from './test-helpers';

function createMockDeps(overrides: Partial<ActionDependencies> = {}): ActionDependencies {
  return {
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    uiStore: { getState: () => ({}) },
    workbook: {} as any,
    getActiveSheetId: () => 'sheet1' as any,
    accessors: {} as any,
    commands: {} as any,
    ...overrides,
  } as unknown as ActionDependencies;
}

describe('print-export handler migrations', () => {
  let originalPrint: any;

  beforeEach(() => {
    originalPrint = window.print;
  });
  afterEach(() => {
    (window as any).print = originalPrint;
  });

  describe('QUICK_PRINT', () => {
    it('calls window.print() directly when Mog owns print', async () => {
      const printSpy = jest.fn();
      (window as any).print = printSpy;
      const result = await PrintExportHandlers.QUICK_PRINT(createMockDeps());
      expect(result.handled).toBe(true);
      expect(printSpy).toHaveBeenCalled();
    });

    it('delegates to hostCommands when the host owns print', async () => {
      const printSpy = jest.fn();
      const hostCommands = {
        getOwner: jest.fn(() => 'host' as const),
        request: jest.fn(async () => ({ status: 'handled' as const })),
      };
      (window as any).print = printSpy;

      const result = await PrintExportHandlers.QUICK_PRINT(createMockDeps({ hostCommands }));

      expect(result.handled).toBe(true);
      expect(hostCommands.getOwner).toHaveBeenCalledWith('print');
      expect(hostCommands.request).toHaveBeenCalledWith({ command: 'print', source: 'keyboard' });
      expect(printSpy).not.toHaveBeenCalled();
    });

    it('does not call window.print() when hostCommands disables print', async () => {
      const printSpy = jest.fn();
      const hostCommands = {
        getOwner: jest.fn(() => 'disabled' as const),
        request: jest.fn(),
      };
      (window as any).print = printSpy;

      const result = await PrintExportHandlers.QUICK_PRINT(createMockDeps({ hostCommands }));

      expect(result).toEqual({ handled: false, reason: 'disabled' });
      expect(hostCommands.request).not.toHaveBeenCalled();
      expect(printSpy).not.toHaveBeenCalled();
    });

    it('returns blocked when the host denies print', async () => {
      const hostCommands = {
        getOwner: jest.fn(() => 'host' as const),
        request: jest.fn(async () => ({ status: 'denied' as const, reason: 'read-only' })),
      };

      const result = await PrintExportHandlers.QUICK_PRINT(createMockDeps({ hostCommands }));

      expect(result).toEqual({ handled: false, reason: 'blocked', error: 'read-only' });
    });
  });
});
