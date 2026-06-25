import { jest } from '@jest/globals';

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import { WorkbookSheetsImpl, type WorkbookSheetsDeps } from '../sheets';
import { createBridgeFixture } from './version-operation-context-helpers-bridge';
import { SECOND_SHEET_ID, SHEET_ID } from './version-operation-context-helpers-constants';

export function createSheetsFixture() {
  const bridgeFixture = createBridgeFixture();
  const names = new Map<SheetId, string>([
    [SHEET_ID, 'Sheet1'],
    [SECOND_SHEET_ID, 'Sheet2'],
  ]);
  bridgeFixture.bridge.getAllSheetIds = jest.fn(async () => [SHEET_ID, SECOND_SHEET_ID]) as any;
  bridgeFixture.bridge.getSheetOrder = jest.fn(async () => [SECOND_SHEET_ID]) as any;
  bridgeFixture.bridge.getSheetName = jest.fn(async (id: SheetId) => names.get(id) ?? null) as any;

  const workbook = {
    _getOrCreateWorksheet: jest.fn((id: SheetId, name?: string) => ({ id, name })),
    refreshSheetMetadata: jest.fn(async () => undefined),
  };
  const deps: WorkbookSheetsDeps = {
    ctx: bridgeFixture.ctx as any,
    resolveTarget: jest.fn(async (target: number | string) => {
      if (typeof target === 'number') return [SHEET_ID, SECOND_SHEET_ID][target];
      for (const [id, name] of names) {
        if (name.toLowerCase() === target.toLowerCase()) return id;
      }
      return toSheetId(String(target));
    }),
    getSheetName: jest.fn(async (id: SheetId) => names.get(id)),
    getSheetCount: jest.fn(async () => names.size - 1),
    setActiveSheetId: jest.fn(),
    workbook: workbook as any,
  };
  const sheets = new WorkbookSheetsImpl(deps);
  return { ...bridgeFixture, deps, sheets };
}
