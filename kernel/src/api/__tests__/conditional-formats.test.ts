/**
 * Conditional Formatting API — Unit Tests
 *
 * Tests for:
 * 1. changeRuleType() — change rule type/config preserving id and priority
 * 2. getItemAt() — get conditional format by zero-based index
 *
 * Each test directly instantiates the implementation class with a mock context
 * to avoid the heavy ESM import chain from WorksheetImpl.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { CFRuleInput, ConditionalFormat } from '@mog-sdk/contracts/api';
import { KernelError } from '../../errors';

// ---------------------------------------------------------------------------
// Mock transitive dependencies to prevent ESM import chain issues
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { WorksheetConditionalFormattingImpl } from '../worksheet/conditional-formats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('test-sheet-cf');

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

function createMockCtx(bridge?: ReturnType<typeof createMockComputeBridge>) {
  return {
    computeBridge: bridge ?? createMockComputeBridge(),
    writeGate: {
      assertWritable: jest.fn(),
    },
  } as any;
}

/** Helper to build a ConditionalFormat fixture. */
function makeFormat(overrides?: Partial<ConditionalFormat>): ConditionalFormat {
  return {
    id: 'fmt-1',
    ranges: [{ startRow: 0, startCol: 0, endRow: 10, endCol: 5 }],
    rules: [
      {
        id: 'rule-1',
        priority: 0,
        type: 'cellValue',
        operator: 'greaterThan',
        value1: 100,
        style: { backgroundColor: '#FF0000' },
      },
    ],
    ...overrides,
  };
}

function mockBridgeFormats(
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

function expectInvalidArrayDiagnostic(
  error: unknown,
  expected: string,
  path: string[],
  receivedType: string,
): void {
  expect(error).toBeInstanceOf(KernelError);
  const kernelError = error as KernelError;
  expect(kernelError.code).toBe('API_INVALID_ARGUMENT');
  expect(kernelError.path).toEqual(path);
  expect(kernelError.suggestion).toBeTruthy();
  expect(kernelError.context).toMatchObject({
    expected,
    issueCode: expect.any(String),
    path,
    receivedType,
  });
}

describe('CFOps — public read projection', () => {
  it('maps Rust/OOXML CF rule fields to the public SDK rule shape', async () => {
    const actualOps = jest.requireActual('../worksheet/operations/cf-operations') as {
      getConditionalFormats: (ctx: any, sheetId: typeof SHEET_ID) => Promise<ConditionalFormat[]>;
    };
    const bridge = createMockComputeBridge();
    bridge.getAllCfRules.mockResolvedValue([
      {
        id: 'fmt-1',
        ranges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
        rules: [
          {
            id: 'r-text',
            priority: 1,
            type: 'containsText',
            operator: 'containsText',
            text: 'alpha',
            style: {},
          },
          {
            id: 'r-top',
            priority: 2,
            type: 'top10',
            rank: 3,
            percent: false,
            bottom: false,
            style: {},
          },
          {
            id: 'r-duplicate',
            priority: 3,
            type: 'duplicateValues',
            unique: false,
            style: {},
          },
        ],
      },
    ] as any);

    const formats = await actualOps.getConditionalFormats(createMockCtx(bridge), SHEET_ID);

    expect(formats[0].rules).toEqual([
      expect.objectContaining({
        type: 'containsText',
        operator: 'contains',
        text: 'alpha',
      }),
      expect.objectContaining({
        type: 'top10',
        rank: 3,
        percent: false,
        bottom: false,
      }),
      expect.objectContaining({
        type: 'duplicateValues',
        unique: false,
      }),
    ]);
  });
});

const formulaRule = {
  type: 'formula',
  formula: '=A1>0',
  style: { backgroundColor: '#00FF00' },
} as CFRuleInput;

// =============================================================================
// Tests — public boundary input shape diagnostics
// =============================================================================

describe('WorksheetConditionalFormattingImpl — input shape diagnostics', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let ctx: any;
  let cf: WorksheetConditionalFormattingImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    ctx = createMockCtx(bridge);
    cf = new WorksheetConditionalFormattingImpl(ctx, SHEET_ID);
  });

  it('add rejects a non-array ranges argument before resolving ranges', async () => {
    let caught: unknown;

    try {
      await cf.add('A1:A10' as any, [formulaRule]);
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of range strings or CellRange objects',
      ['ranges'],
      'string',
    );
    expect(bridge.addCfRule).not.toHaveBeenCalled();
  });

  it('add rejects a non-array rules argument before rule normalization', async () => {
    let caught: unknown;

    try {
      await cf.add(['A1:A10'], formulaRule as any);
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of conditional format rules',
      ['rules'],
      'object',
    );
    expect(bridge.addCfRule).not.toHaveBeenCalled();
  });

  it('add preserves valid array inputs', async () => {
    const result = await cf.add(['A1:A10'], [formulaRule]);

    expect(bridge.addCfRule).toHaveBeenCalledTimes(1);
    expect(bridge.addCfRule.mock.calls[0][0]).toBe(SHEET_ID);
    expect(bridge.addCfRule.mock.calls[0][1]).toMatchObject({
      sheetId: SHEET_ID,
      ranges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
      rules: [expect.objectContaining({ ...formulaRule, priority: 0 })],
    });
    expect(result).toMatchObject({
      ranges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
    });
  });

  it('clearInRanges rejects a non-array ranges argument', async () => {
    let caught: unknown;

    try {
      await cf.clearInRanges('A1:A10' as any);
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of range strings or CellRange objects',
      ['ranges'],
      'string',
    );
    expect(bridge.getAllCfRules).not.toHaveBeenCalled();
  });

  it('clearInRanges preserves valid array inputs', async () => {
    bridge.getAllCfRules.mockResolvedValue([
      {
        id: 'fmt-1',
        ranges: [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }],
      },
    ] as any);

    await cf.clearInRanges(['A1:A10']);

    expect(bridge.getAllCfRules).toHaveBeenCalledWith(SHEET_ID);
    expect(bridge.deleteCfRule).toHaveBeenCalledWith(SHEET_ID, 'fmt-1');
  });

  it('update rejects a non-array updates.ranges field', async () => {
    let caught: unknown;

    try {
      await cf.update('fmt-1', { ranges: 'A1:A10' } as any);
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of CellRange objects',
      ['updates', 'ranges'],
      'string',
    );
    expect(bridge.updateCfRanges).not.toHaveBeenCalled();
    expect(bridge.updateCfRule).not.toHaveBeenCalled();
  });

  it('update rejects a non-array updates.rules field before applying stopIfTrue', async () => {
    let caught: unknown;

    try {
      await cf.update('fmt-1', { rules: formulaRule, stopIfTrue: true } as any);
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of conditional format rules',
      ['updates', 'rules'],
      'object',
    );
    expect(bridge.updateCfRanges).not.toHaveBeenCalled();
    expect(bridge.updateCfRule).not.toHaveBeenCalled();
  });

  it('update preserves valid array inputs', async () => {
    const ranges = [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }];

    await cf.update('fmt-1', { ranges, rules: [formulaRule], stopIfTrue: true } as any);

    expect(bridge.updateCfRanges).toHaveBeenCalledWith(SHEET_ID, 'fmt-1', ranges);
    expect(bridge.updateCfRule).toHaveBeenCalledWith(SHEET_ID, 'fmt-1', {
      rules: [{ ...formulaRule, stopIfTrue: true }],
    });
  });

  it('cloneForPaste rejects a non-array relativeCFs argument', async () => {
    let caught: unknown;

    try {
      await cf.cloneForPaste(
        SHEET_ID,
        { rules: [], rangeOffsets: [] } as any,
        { row: 0, col: 0 },
        false,
      );
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of relative conditional format objects',
      ['relativeCFs'],
      'object',
    );
    expect(bridge.addCfRule).not.toHaveBeenCalled();
  });

  it('cloneForPaste rejects a non-array relative format rules field', async () => {
    let caught: unknown;

    try {
      await cf.cloneForPaste(
        SHEET_ID,
        [{ rules: formulaRule, rangeOffsets: [] }] as any,
        { row: 0, col: 0 },
        false,
      );
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of conditional format rules',
      ['relativeCFs', '0', 'rules'],
      'object',
    );
    expect(bridge.addCfRule).not.toHaveBeenCalled();
  });

  it('cloneForPaste rejects a non-array relative format rangeOffsets field', async () => {
    let caught: unknown;

    try {
      await cf.cloneForPaste(
        SHEET_ID,
        [{ rules: [formulaRule], rangeOffsets: { startRowOffset: 0 } }] as any,
        { row: 0, col: 0 },
        false,
      );
    } catch (error) {
      caught = error;
    }

    expectInvalidArrayDiagnostic(
      caught,
      'an array of conditional format range offsets',
      ['relativeCFs', '0', 'rangeOffsets'],
      'object',
    );
    expect(bridge.addCfRule).not.toHaveBeenCalled();
  });

  it('cloneForPaste preserves valid array inputs', async () => {
    await cf.cloneForPaste(
      SHEET_ID,
      [
        {
          rules: [formulaRule],
          rangeOffsets: [
            {
              startRowOffset: 1,
              startColOffset: 2,
              endRowOffset: 3,
              endColOffset: 4,
            },
          ],
        },
      ],
      { row: 10, col: 20 },
      false,
    );

    expect(bridge.addCfRule).toHaveBeenCalledTimes(1);
    expect(bridge.addCfRule.mock.calls[0][1]).toMatchObject({
      sheetId: SHEET_ID,
      ranges: [{ startRow: 11, startCol: 22, endRow: 13, endCol: 24 }],
      rules: [expect.objectContaining({ ...formulaRule, priority: 0 })],
    });
  });
});

// =============================================================================
// Tests — changeRuleType
// =============================================================================

describe('WorksheetConditionalFormattingImpl — changeRuleType', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let ctx: any;
  let cf: WorksheetConditionalFormattingImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    ctx = createMockCtx(bridge);
    cf = new WorksheetConditionalFormattingImpl(ctx, SHEET_ID);
  });

  it('changes a cellValue rule to formula — old fields gone, new fields present, id/priority preserved', async () => {
    const format = makeFormat({
      rules: [
        {
          id: 'rule-1',
          priority: 5,
          type: 'cellValue',
          operator: 'greaterThan',
          value1: 100,
          style: { backgroundColor: '#FF0000' },
        },
      ],
    });
    mockBridgeFormats(bridge, [format]);

    const newRule = {
      type: 'formula',
      formula: '=A1>50',
      style: { backgroundColor: '#00FF00' },
    } as CFRuleInput;

    await cf.changeRuleType('fmt-1', 'rule-1', newRule);

    expect(bridge.updateCfRule).toHaveBeenCalledTimes(1);
    const [callSheetId, callFormatId, payload] = bridge.updateCfRule.mock.calls[0];
    expect(callSheetId).toBe(SHEET_ID);
    expect(callFormatId).toBe('fmt-1');

    const updatedRule = payload.rules[0];
    // id and priority preserved
    expect(updatedRule.id).toBe('rule-1');
    expect(updatedRule.priority).toBe(5);
    // new type and fields present
    expect(updatedRule.type).toBe('formula');
    expect(updatedRule.formula).toBe('=A1>50');
    expect(updatedRule.style).toEqual({ backgroundColor: '#00FF00' });
    // old cellValue fields gone
    expect(updatedRule.operator).toBeUndefined();
    expect(updatedRule.value1).toBeUndefined();
  });

  it('changes a colorScale rule to dataBar — visual rule types swap correctly', async () => {
    const format = makeFormat({
      rules: [
        {
          id: 'rule-2',
          priority: 1,
          type: 'colorScale',
          colorScale: {
            minPoint: { type: 'min', color: '#FF0000' },
            maxPoint: { type: 'max', color: '#00FF00' },
          },
        },
      ],
    });
    mockBridgeFormats(bridge, [format]);

    const newRule = {
      type: 'dataBar',
      dataBar: {
        minPoint: { type: 'min', color: '#000000' },
        maxPoint: { type: 'max', color: '#FFFFFF' },
        positiveColor: '#0000FF',
      },
    } as CFRuleInput;

    await cf.changeRuleType('fmt-1', 'rule-2', newRule);

    const updatedRule = bridge.updateCfRule.mock.calls[0][2].rules[0];
    expect(updatedRule.id).toBe('rule-2');
    expect(updatedRule.priority).toBe(1);
    expect(updatedRule.type).toBe('dataBar');
    expect(updatedRule.dataBar.positiveColor).toBe('#0000FF');
    // old colorScale field gone
    expect(updatedRule.colorScale).toBeUndefined();
  });

  it('changes rule in a multi-rule format — other rules untouched', async () => {
    const format = makeFormat({
      rules: [
        {
          id: 'rule-A',
          priority: 0,
          type: 'cellValue',
          operator: 'equal',
          value1: 42,
          style: { backgroundColor: '#AAA' },
        },
        {
          id: 'rule-B',
          priority: 1,
          type: 'formula',
          formula: '=B1>0',
          style: { backgroundColor: '#BBB' },
        },
        {
          id: 'rule-C',
          priority: 2,
          type: 'top10',
          rank: 10,
          style: { backgroundColor: '#CCC' },
        },
      ],
    });
    mockBridgeFormats(bridge, [format]);

    const newRule = {
      type: 'aboveAverage',
      aboveAverage: true,
      style: { backgroundColor: '#DDD' },
    } as CFRuleInput;

    await cf.changeRuleType('fmt-1', 'rule-B', newRule);

    const rules = bridge.updateCfRule.mock.calls[0][2].rules;
    expect(rules).toHaveLength(3);

    // rule-A untouched
    expect(rules[0]).toEqual(format.rules[0]);
    // rule-B changed
    expect(rules[1].id).toBe('rule-B');
    expect(rules[1].priority).toBe(1);
    expect(rules[1].type).toBe('aboveAverage');
    expect(rules[1].aboveAverage).toBe(true);
    // rule-C untouched
    expect(rules[2]).toEqual(format.rules[2]);
  });

  it('non-existent formatId — no-op, bridge NOT called', async () => {
    mockBridgeFormats(bridge, []);

    const newRule = {
      type: 'formula',
      formula: '=A1>0',
      style: {},
    } as CFRuleInput;

    await cf.changeRuleType('no-such-format', 'rule-1', newRule);

    expect(bridge.updateCfRule).not.toHaveBeenCalled();
  });

  it('non-existent ruleId — all rules untouched, bridge called with original rules', async () => {
    const format = makeFormat({
      rules: [
        {
          id: 'rule-1',
          priority: 0,
          type: 'cellValue',
          operator: 'greaterThan',
          value1: 50,
          style: {},
        },
      ],
    });
    mockBridgeFormats(bridge, [format]);

    const newRule = {
      type: 'formula',
      formula: '=Z1>0',
      style: {},
    } as CFRuleInput;

    await cf.changeRuleType('fmt-1', 'no-such-rule', newRule);

    expect(bridge.updateCfRule).toHaveBeenCalledTimes(1);
    const rules = bridge.updateCfRule.mock.calls[0][2].rules;
    // Original rules passed through unchanged
    expect(rules).toEqual(format.rules);
  });

  it('change rule type to same type with different config — config-only change works', async () => {
    const format = makeFormat({
      rules: [
        {
          id: 'rule-1',
          priority: 3,
          type: 'cellValue',
          operator: 'greaterThan',
          value1: 100,
          style: { backgroundColor: '#FF0000' },
        },
      ],
    });
    mockBridgeFormats(bridge, [format]);

    const newRule = {
      type: 'cellValue',
      operator: 'lessThan',
      value1: 50,
      style: { backgroundColor: '#00FF00' },
    } as CFRuleInput;

    await cf.changeRuleType('fmt-1', 'rule-1', newRule);

    const updatedRule = bridge.updateCfRule.mock.calls[0][2].rules[0];
    expect(updatedRule.id).toBe('rule-1');
    expect(updatedRule.priority).toBe(3);
    expect(updatedRule.type).toBe('cellValue');
    expect(updatedRule.operator).toBe('lessThan');
    expect(updatedRule.value1).toBe(50);
    expect(updatedRule.style).toEqual({ backgroundColor: '#00FF00' });
  });
});

// =============================================================================
// Tests — getItemAt
// =============================================================================

describe('WorksheetConditionalFormattingImpl — getItemAt', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let ctx: any;
  let cf: WorksheetConditionalFormattingImpl;

  const formats: ConditionalFormat[] = [
    {
      id: 'fmt-A',
      ranges: [{ startRow: 0, startCol: 0, endRow: 5, endCol: 5 }],
      rules: [
        { id: 'r-1', priority: 0, type: 'cellValue', operator: 'equal', value1: 1, style: {} },
      ],
    },
    {
      id: 'fmt-B',
      ranges: [{ startRow: 10, startCol: 0, endRow: 20, endCol: 5 }],
      rules: [{ id: 'r-2', priority: 1, type: 'formula', formula: '=TRUE', style: {} }],
    },
    {
      id: 'fmt-C',
      ranges: [{ startRow: 30, startCol: 0, endRow: 40, endCol: 5 }],
      rules: [{ id: 'r-3', priority: 2, type: 'top10', rank: 5, style: {} }],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    ctx = createMockCtx(bridge);
    cf = new WorksheetConditionalFormattingImpl(ctx, SHEET_ID);
    mockBridgeFormats(bridge, formats);
  });

  it('get first item (index 0) — returns correct format', async () => {
    const result = await cf.getItemAt(0);
    expect(result).toEqual(formats[0]);
  });

  it('get last item — returns correct format', async () => {
    const result = await cf.getItemAt(2);
    expect(result).toEqual(formats[2]);
  });

  it('out of bounds index — returns null', async () => {
    const result = await cf.getItemAt(99);
    expect(result).toBeNull();
  });

  it('negative index — returns null', async () => {
    const result = await cf.getItemAt(-1);
    expect(result).toBeNull();
  });

  it('empty list — returns null', async () => {
    mockBridgeFormats(bridge, []);
    const result = await cf.getItemAt(0);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Tests — removeRule
// =============================================================================

describe('WorksheetConditionalFormattingImpl — removeRule', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let ctx: any;
  let cf: WorksheetConditionalFormattingImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    ctx = createMockCtx(bridge);
    cf = new WorksheetConditionalFormattingImpl(ctx, SHEET_ID);
  });

  it('routes single-rule removal to the rule-level compute bridge', async () => {
    await cf.removeRule('fmt-1', 'rule-1');

    expect(bridge.deleteRuleFromCf).toHaveBeenCalledTimes(1);
    expect(bridge.deleteRuleFromCf).toHaveBeenCalledWith(SHEET_ID, 'fmt-1', 'rule-1');
    expect(bridge.deleteCfRule).not.toHaveBeenCalled();
  });
});
