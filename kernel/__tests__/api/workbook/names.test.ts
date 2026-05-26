/**
 * WorkbookNamesImpl Tests
 *
 * Tests for the named range public API methods: get(), getRange(), list(), update().
 * Uses a mock DocumentContext with stub ComputeBridge and NamedRanges domain module.
 */

import { jest } from '@jest/globals';

import { sheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { WorkbookNamesDeps } from '../../../src/api/workbook/names';
import type { DocumentContext } from '../../../src/context/types';

// =============================================================================
// Mock the NamedRanges domain module
// =============================================================================

const mockGetByName = jest.fn();
const mockGetRefersToA1 = jest.fn();
const mockExportNames = jest.fn();
const mockUpdate = jest.fn();

jest.unstable_mockModule('../../../src/domain/formulas/named-ranges', () => ({
  getByName: (...args: unknown[]) => mockGetByName(...args),
  getRefersToA1: (...args: unknown[]) => mockGetRefersToA1(...args),
  exportNames: (...args: unknown[]) => mockExportNames(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
}));

const { WorkbookNamesImpl } = await import('../../../src/api/workbook/names');

// =============================================================================
// Helpers
// =============================================================================

function createMockDeps(overrides?: Partial<WorkbookNamesDeps>): WorkbookNamesDeps {
  const ctx = {
    computeBridge: {
      getAllNamedRanges: jest.fn().mockResolvedValue([]),
      setNamedRange: jest.fn(),
      removeNamedRange: jest.fn(),
      getAllSheetIds: jest.fn().mockResolvedValue(['sheet-1']),
      getNamedRangeTypedValue: jest.fn(),
      toA1Display: jest.fn(),
      toIdentityFormula: jest.fn(),
    },
    eventBus: {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    },
  } as unknown as DocumentContext;

  return {
    ctx,
    getActiveSheetId: () => sheetId('sheet-1'),
    resolveSheetNameToId: async (nameLower: string) => {
      if (nameLower === 'sheet1') return sheetId('sheet-1');
      if (nameLower === 'sheet2') return sheetId('sheet-2');
      return undefined;
    },
    getSheetName: async (sheetId: SheetId) => {
      if (sheetId === 'sheet-1') return 'Sheet1';
      if (sheetId === 'sheet-2') return 'Sheet2';
      return undefined;
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('WorkbookNamesImpl', () => {
  let deps: WorkbookNamesDeps;
  let names: WorkbookNamesImpl;

  beforeEach(() => {
    mockGetByName.mockReset();
    mockGetRefersToA1.mockReset();
    mockExportNames.mockReset();
    mockUpdate.mockReset();
    deps = createMockDeps();
    names = new WorkbookNamesImpl(deps);
  });

  // ---------------------------------------------------------------------------
  // get()
  // ---------------------------------------------------------------------------

  describe('get()', () => {
    it('returns info for an existing named range', async () => {
      const definedName = {
        id: 'nr-1',
        name: 'Revenue',
        refersTo: { template: '{0}', refs: [] },
        scope: undefined,
        comment: 'Total revenue',
        visible: true,
      };

      mockGetByName.mockResolvedValue(definedName);
      mockGetRefersToA1.mockResolvedValue('=Sheet1!$A$1:$B$10');

      const result = await names.get('Revenue');

      expect(result).toEqual({
        name: 'Revenue',
        reference: 'Sheet1!$A$1:$B$10',
        scope: undefined,
        comment: 'Total revenue',
        visible: true,
      });
      expect(mockGetByName).toHaveBeenCalledWith(deps.ctx, 'Revenue', undefined);
    });

    it('returns null for a non-existent name', async () => {
      mockGetByName.mockResolvedValue(undefined);

      const result = await names.get('DoesNotExist');

      expect(result).toBeNull();
    });

    it('resolves scope from sheet name to sheet ID', async () => {
      const definedName = {
        id: 'nr-2',
        name: 'LocalName',
        refersTo: { template: '{0}', refs: [] },
        scope: 'sheet-1',
        comment: undefined,
        visible: false,
      };

      mockGetByName.mockResolvedValue(definedName);
      mockGetRefersToA1.mockResolvedValue('=Sheet1!$C$5');

      const result = await names.get('LocalName', 'Sheet1');

      expect(result).toEqual({
        name: 'LocalName',
        reference: 'Sheet1!$C$5',
        scope: 'Sheet1',
        comment: undefined,
        visible: false,
      });
      expect(mockGetByName).toHaveBeenCalledWith(deps.ctx, 'LocalName', 'sheet-1');
    });

    it('includes visible field in results', async () => {
      const definedName = {
        id: 'nr-3',
        name: 'HiddenName',
        refersTo: { template: '{0}', refs: [] },
        scope: undefined,
        comment: undefined,
        visible: false,
      };

      mockGetByName.mockResolvedValue(definedName);
      mockGetRefersToA1.mockResolvedValue('=Sheet1!$A$1');

      const result = await names.get('HiddenName');

      expect(result).not.toBeNull();
      expect(result!.visible).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getRange()
  // ---------------------------------------------------------------------------

  describe('getRange()', () => {
    it('returns parsed reference for a valid sheet!range', async () => {
      const definedName = {
        id: 'nr-1',
        name: 'Revenue',
        refersTo: { template: '{0}', refs: [] },
        scope: undefined,
      };

      mockGetByName.mockResolvedValue(definedName);
      mockGetRefersToA1.mockResolvedValue('=Sheet1!$A$1:$B$10');

      const result = await names.getRange('Revenue');

      expect(result).toEqual({
        sheetName: 'Sheet1',
        range: '$A$1:$B$10',
      });
    });

    it('returns null for a non-existent name', async () => {
      mockGetByName.mockResolvedValue(undefined);

      const result = await names.getRange('DoesNotExist');

      expect(result).toBeNull();
    });

    it('returns null for a non-range formula (no "!" separator)', async () => {
      const definedName = {
        id: 'nr-4',
        name: 'Constant',
        refersTo: { template: '42', refs: [] },
        scope: undefined,
      };

      mockGetByName.mockResolvedValue(definedName);
      mockGetRefersToA1.mockResolvedValue('=42');

      const result = await names.getRange('Constant');

      expect(result).toBeNull();
    });

    it('resolves scope for scoped names', async () => {
      const definedName = {
        id: 'nr-5',
        name: 'ScopedRange',
        refersTo: { template: '{0}', refs: [] },
        scope: 'sheet-2',
      };

      mockGetByName.mockResolvedValue(definedName);
      mockGetRefersToA1.mockResolvedValue('=Sheet2!$D$1:$D$100');

      const result = await names.getRange('ScopedRange', 'Sheet2');

      expect(result).toEqual({
        sheetName: 'Sheet2',
        range: '$D$1:$D$100',
      });
      expect(mockGetByName).toHaveBeenCalledWith(deps.ctx, 'ScopedRange', 'sheet-2');
    });
  });

  // ---------------------------------------------------------------------------
  // list() — visible field
  // ---------------------------------------------------------------------------

  describe('list()', () => {
    it('includes visible field in list results', async () => {
      mockExportNames.mockResolvedValue([
        {
          id: 'nr-1',
          name: 'Visible',
          refersToA1: '=Sheet1!$A$1',
          scope: undefined,
          comment: undefined,
          visible: true,
        },
        {
          id: 'nr-2',
          name: 'Hidden',
          refersToA1: '=Sheet1!$B$1',
          scope: undefined,
          comment: undefined,
          visible: false,
        },
      ]);

      const result = await names.list();

      expect(result).toHaveLength(2);
      expect(result[0].visible).toBe(true);
      expect(result[1].visible).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // update() — visible field
  // ---------------------------------------------------------------------------

  describe('update()', () => {
    it('passes visible field through to domain update', async () => {
      mockGetByName.mockResolvedValue({
        id: 'nr-1',
        name: 'Revenue',
        refersTo: { template: '{0}', refs: [] },
        scope: undefined,
      });

      await names.update('Revenue', { visible: false });

      expect(mockGetByName).toHaveBeenCalledWith(deps.ctx, 'Revenue', undefined);
      expect(mockUpdate).toHaveBeenCalledWith(
        deps.ctx,
        'nr-1',
        {
          name: undefined,
          refersToA1: undefined,
          comment: undefined,
          visible: false,
        },
        'sheet-1',
      );
    });

    it('passes all update fields including visible', async () => {
      mockGetByName.mockResolvedValue({
        id: 'nr-2',
        name: 'OldName',
        refersTo: { template: '{0}', refs: [] },
        scope: undefined,
      });

      await names.update('OldName', {
        name: 'NewName',
        reference: 'Sheet1!$C$1:$C$10',
        comment: 'Updated comment',
        visible: true,
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        deps.ctx,
        'nr-2',
        {
          name: 'NewName',
          refersToA1: '=Sheet1!$C$1:$C$10',
          comment: 'Updated comment',
          visible: true,
        },
        'sheet-1',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getValueAsJson()
  // ---------------------------------------------------------------------------

  describe('getValueAsJson()', () => {
    it('returns typed value for a named range', async () => {
      const mockBridge = (deps.ctx as any).computeBridge;
      mockBridge.getNamedRangeTypedValue.mockResolvedValue(42);

      const result = await names.getValueAsJson('Revenue');

      expect(result).toBe(42);
      expect(mockBridge.getNamedRangeTypedValue).toHaveBeenCalledWith('Revenue', null);
    });

    it('returns null for non-existent name', async () => {
      const mockBridge = (deps.ctx as any).computeBridge;
      mockBridge.getNamedRangeTypedValue.mockResolvedValue(null);

      const result = await names.getValueAsJson('DoesNotExist');

      expect(result).toBeNull();
    });

    it('passes scope as currentSheet parameter', async () => {
      const mockBridge = (deps.ctx as any).computeBridge;
      mockBridge.getNamedRangeTypedValue.mockResolvedValue('hello');

      const result = await names.getValueAsJson('LocalName', 'Sheet1');

      expect(result).toBe('hello');
      expect(mockBridge.getNamedRangeTypedValue).toHaveBeenCalledWith('LocalName', 'Sheet1');
    });

    it('returns string value for constants', async () => {
      const mockBridge = (deps.ctx as any).computeBridge;
      mockBridge.getNamedRangeTypedValue.mockResolvedValue('constant text');

      const result = await names.getValueAsJson('MyConstant');

      expect(result).toBe('constant text');
    });

    it('returns boolean values', async () => {
      const mockBridge = (deps.ctx as any).computeBridge;
      mockBridge.getNamedRangeTypedValue.mockResolvedValue(true);

      const result = await names.getValueAsJson('BoolName');

      expect(result).toBe(true);
    });
  });
});
