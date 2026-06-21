import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { CFRule, ConditionalFormat } from '@mog-sdk/contracts/api';

const mockGetConditionalFormat = jest.fn();
const mockGetConditionalFormats = jest.fn();

jest.mock('../worksheet/operations/cf-operations', () => {
  const actual = jest.requireActual('../worksheet/operations/cf-operations') as Record<string, any>;
  return {
    ...actual,
    getConditionalFormat: (...args: any[]) => mockGetConditionalFormat(...args),
    getConditionalFormats: (...args: any[]) => mockGetConditionalFormats(...args),
  };
});

import { WorksheetConditionalFormattingImpl } from '../worksheet/conditional-formats';

const SHEET_ID = sheetId('test-sheet-cf-receipts');

function createMockComputeBridge() {
  return {
    updateCfRule: jest.fn().mockResolvedValue({ data: null }),
    deleteCfRule: jest.fn().mockResolvedValue(undefined),
    deleteRuleFromCf: jest.fn().mockResolvedValue(undefined),
    addCfRule: jest.fn().mockResolvedValue(undefined),
    getAllCfRules: jest.fn().mockResolvedValue([]),
    updateCfRanges: jest.fn().mockResolvedValue(undefined),
    reorderCfRules: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockCtx(bridge = createMockComputeBridge()) {
  return {
    computeBridge: bridge,
    writeGate: {
      assertWritable: jest.fn(),
    },
  } as any;
}

function makeFormat(overrides?: Partial<ConditionalFormat>): ConditionalFormat {
  return {
    id: 'fmt-1',
    ranges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
    rules: [
      {
        id: 'rule-1',
        priority: 0,
        type: 'formula',
        formula: '=A1>0',
        style: { backgroundColor: '#fff2cc' },
      },
    ],
    ...overrides,
  };
}

function mockFormatReads(
  bridge: ReturnType<typeof createMockComputeBridge>,
  formats: ConditionalFormat[],
): void {
  bridge.getAllCfRules.mockResolvedValue(formats as any);
  mockGetConditionalFormat.mockImplementation(
    (_ctx: unknown, _sheetId: unknown, formatId: string) =>
      Promise.resolve(formats.find((format) => format.id === formatId) ?? null),
  );
  mockGetConditionalFormats.mockResolvedValue(formats);
}

describe('WorksheetConditionalFormattingImpl — mutation receipts', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let cf: WorksheetConditionalFormattingImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConditionalFormat.mockReset();
    mockGetConditionalFormats.mockReset();
    bridge = createMockComputeBridge();
    cf = new WorksheetConditionalFormattingImpl(createMockCtx(bridge), SHEET_ID);
  });

  it('add returns an applied receipt with created object, changed CF, and range effects', async () => {
    const receipt = await cf.add(
      ['A1:A10'],
      [{ type: 'formula', formula: '=A1>0', style: { backgroundColor: '#fff2cc' } }],
    );
    const created = bridge.addCfRule.mock.calls[0][1] as ConditionalFormat;

    expect(receipt).toMatchObject({
      kind: 'conditionalFormat.add',
      status: 'applied',
      id: created.id,
      formatIds: [created.id],
      ruleIds: [created.rules[0].id],
      formatCount: 1,
      ruleCount: 1,
      format: expect.objectContaining({ id: created.id }),
      ranges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
    });
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'createdObject', sheetId: SHEET_ID, objectId: created.id }),
        expect.objectContaining({
          type: 'changedConditionalFormat',
          sheetId: SHEET_ID,
          objectId: created.id,
        }),
        expect.objectContaining({ type: 'changedRange', sheetId: SHEET_ID, range: 'A1:A10' }),
      ]),
    );
  });

  it('addFormula keeps the created format fields while changing the receipt kind', async () => {
    const receipt = await cf.addFormula('B2:B10', 'B2>100', { backgroundColor: '#ddebf7' });
    const created = bridge.addCfRule.mock.calls[0][1] as ConditionalFormat;

    expect(receipt).toMatchObject({
      kind: 'conditionalFormat.addFormula',
      status: 'applied',
      id: created.id,
      formatIds: [created.id],
      ruleIds: [created.rules[0].id],
      ranges: [{ startRow: 1, startCol: 1, endRow: 9, endCol: 1 }],
    });
  });

  it('update applies stopIfTrue to existing rules and returns an updated receipt', async () => {
    const before = makeFormat();
    const updatedRule = { ...before.rules[0], stopIfTrue: true } as CFRule;
    const after = makeFormat({ rules: [updatedRule] });
    bridge.getAllCfRules
      .mockResolvedValueOnce([before] as any)
      .mockResolvedValueOnce([after] as any);

    const receipt = await cf.update('fmt-1', { stopIfTrue: true });

    expect(bridge.updateCfRule).toHaveBeenCalledWith(
      SHEET_ID,
      'fmt-1',
      {
        rules: [updatedRule],
      },
      expect.any(Object),
    );
    expect(receipt).toMatchObject({
      kind: 'conditionalFormat.update',
      status: 'applied',
      formatIds: ['fmt-1'],
      ruleIds: ['rule-1'],
      ruleCount: 1,
      format: after,
    });
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedObject', sheetId: SHEET_ID, objectId: 'fmt-1' }),
        expect.objectContaining({ type: 'changedRange', sheetId: SHEET_ID, range: 'A1:A10' }),
      ]),
    );
  });

  it('removeRule reports the removed rule without deleting the whole format path', async () => {
    const format = makeFormat();
    mockFormatReads(bridge, [format]);

    const receipt = await cf.removeRule('fmt-1', 'rule-1');

    expect(bridge.deleteRuleFromCf).toHaveBeenCalledWith(
      SHEET_ID,
      'fmt-1',
      'rule-1',
      expect.any(Object),
    );
    expect(bridge.deleteCfRule).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      kind: 'conditionalFormat.removeRule',
      status: 'applied',
      formatIds: ['fmt-1'],
      ruleIds: ['rule-1'],
      rules: [format.rules[0]],
      ruleCount: 1,
    });
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removedObject', sheetId: SHEET_ID, objectId: 'rule-1' }),
        expect.objectContaining({
          type: 'changedConditionalFormat',
          sheetId: SHEET_ID,
          objectId: 'fmt-1',
        }),
      ]),
    );
  });

  it('clear returns a no-op receipt when no conditional formats exist', async () => {
    bridge.getAllCfRules.mockResolvedValue([]);

    const receipt = await cf.clear();

    expect(bridge.deleteCfRule).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      kind: 'conditionalFormat.clear',
      status: 'noOp',
      formatIds: [],
      ruleIds: [],
      formatCount: 0,
      ruleCount: 0,
      effects: [{ type: 'worksheetUnchanged', sheetId: SHEET_ID }],
      diagnostics: [],
    });
  });

  it('clearInRanges reports requested ranges and removed conditional formats', async () => {
    bridge.getAllCfRules.mockResolvedValue([makeFormat()] as any);

    const receipt = await cf.clearInRanges(['A1:A10']);

    expect(bridge.deleteCfRule).toHaveBeenCalledWith(SHEET_ID, 'fmt-1', expect.any(Object));
    expect(receipt).toMatchObject({
      kind: 'conditionalFormat.clearInRanges',
      status: 'applied',
      formatIds: ['fmt-1'],
      ruleIds: ['rule-1'],
      requestedRanges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
    });
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removedObject', sheetId: SHEET_ID, objectId: 'fmt-1' }),
        expect.objectContaining({ type: 'changedRange', sheetId: SHEET_ID, range: 'A1:A10' }),
      ]),
    );
  });

  it('includes diagnostics for unsupported preserved/imported rule shells', async () => {
    const format = makeFormat({
      rules: [
        {
          id: 'rule-imported',
          priority: 0,
          type: 'unsupportedImported',
          unsupportedPreserved: true,
          unsupportedReasons: ['extLst'],
        } as any,
      ],
    });
    mockFormatReads(bridge, [format]);

    const receipt = await cf.remove('fmt-1');

    expect(bridge.deleteCfRule).toHaveBeenCalledWith(SHEET_ID, 'fmt-1', expect.any(Object));
    expect(receipt.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'CONDITIONAL_FORMAT_UNSUPPORTED_IMPORTED_RULE',
        target: { sheetId: SHEET_ID, objectId: 'fmt-1' },
        details: expect.objectContaining({
          formatId: 'fmt-1',
          ruleId: 'rule-imported',
          ruleType: 'unsupportedImported',
          unsupportedReasons: expect.arrayContaining([
            'extLst',
            'unsupportedPreserved',
            'unsupportedRuleType:unsupportedImported',
          ]),
        }),
      }),
    ]);
  });
});
