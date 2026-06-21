import { jest } from '@jest/globals';

import type { CFRuleInput, ConditionalFormat } from '@mog-sdk/contracts/api';
import { sheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

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

const SHEET_ID = sheetId('test-sheet-cf-admission');
const TEST_NOW = Date.UTC(2025, 0, 2, 3, 4, 5);

const formulaRule = {
  type: 'formula',
  formula: '=A1>0',
  style: { backgroundColor: '#00FF00' },
} as CFRuleInput;

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
    clock: {
      now: jest.fn(() => TEST_NOW),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'test-user',
      requestingSessionId: 'test-session',
      requestingDocumentId: 'test-workbook',
    })),
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

function expectConditionalFormattingAdmissionOptions(
  options: unknown,
  operationIdPrefix: string,
): VersionOperationContext {
  const operationContext = (options as { operationContext?: VersionOperationContext })
    ?.operationContext;
  expect(operationContext).toMatchObject({
    kind: 'mutation',
    author: {
      authorId: 'test-user',
      actorKind: 'user',
      sessionId: 'test-session',
    },
    createdAt: new Date(TEST_NOW).toISOString(),
    workbookId: 'test-workbook',
    sheetIds: [SHEET_ID],
    domainIds: ['conditional-formatting'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  });
  expect(operationContext?.operationId).toEqual(
    expect.stringMatching(new RegExp(`^${escapeRegExp(operationIdPrefix)}:`)),
  );
  return operationContext!;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('WorksheetConditionalFormattingImpl — mutation admission options', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let cf: WorksheetConditionalFormattingImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConditionalFormat.mockReset();
    mockGetConditionalFormats.mockReset();
    bridge = createMockComputeBridge();
    cf = new WorksheetConditionalFormattingImpl(createMockCtx(bridge), SHEET_ID);
  });

  it('threads conditional-formatting context through add', async () => {
    await cf.add(['A1:A10'], [formulaRule]);

    expect(bridge.addCfRule).toHaveBeenCalledTimes(1);
    expectConditionalFormattingAdmissionOptions(
      bridge.addCfRule.mock.calls[0][2],
      'conditionalFormats.add',
    );
  });

  it('threads conditional-formatting context through addFormula', async () => {
    await cf.addFormula('A1:A10', '=A1>0', { backgroundColor: '#00FF00' });

    expect(bridge.addCfRule).toHaveBeenCalledTimes(1);
    expectConditionalFormattingAdmissionOptions(
      bridge.addCfRule.mock.calls[0][2],
      'conditionalFormats.addFormula',
    );
  });

  it('threads grouped context through update calls that emit multiple bridge mutations', async () => {
    const ranges = [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }];
    mockBridgeFormats(bridge, [makeFormat()]);

    await cf.update('fmt-1', { ranges, stopIfTrue: true });

    const rangeContext = expectConditionalFormattingAdmissionOptions(
      bridge.updateCfRanges.mock.calls[0][3],
      'conditionalFormats.update',
    );
    const ruleContext = expectConditionalFormattingAdmissionOptions(
      bridge.updateCfRule.mock.calls[0][3],
      'conditionalFormats.update',
    );
    expect(rangeContext.groupId).toBeTruthy();
    expect(ruleContext.groupId).toBe(rangeContext.groupId);
    expect(ruleContext.operationId).not.toBe(rangeContext.operationId);
  });

  it('threads conditional-formatting context through remove', async () => {
    mockBridgeFormats(bridge, [makeFormat()]);

    await cf.remove('fmt-1');

    expectConditionalFormattingAdmissionOptions(
      bridge.deleteCfRule.mock.calls[0][2],
      'conditionalFormats.remove',
    );
  });

  it('threads grouped context through clear multi-delete calls', async () => {
    bridge.getAllCfRules.mockResolvedValue([
      makeFormat({ id: 'fmt-1' }),
      makeFormat({
        id: 'fmt-2',
        ranges: [{ startRow: 20, startCol: 0, endRow: 29, endCol: 0 }],
        rules: [
          {
            id: 'rule-2',
            priority: 1,
            type: 'formula',
            formula: '=B1>0',
            style: { backgroundColor: '#ddebf7' },
          },
        ],
      }),
    ] as any);

    await cf.clear();

    expect(bridge.deleteCfRule).toHaveBeenCalledTimes(2);
    const firstContext = expectConditionalFormattingAdmissionOptions(
      bridge.deleteCfRule.mock.calls[0][2],
      'conditionalFormats.clear',
    );
    const secondContext = expectConditionalFormattingAdmissionOptions(
      bridge.deleteCfRule.mock.calls[1][2],
      'conditionalFormats.clear',
    );
    expect(firstContext.groupId).toBeTruthy();
    expect(secondContext.groupId).toBe(firstContext.groupId);
    expect(secondContext.operationId).not.toBe(firstContext.operationId);
  });

  it('threads conditional-formatting context through clearInRanges deletes', async () => {
    bridge.getAllCfRules.mockResolvedValue([makeFormat()] as any);

    await cf.clearInRanges(['A1:A10']);

    expectConditionalFormattingAdmissionOptions(
      bridge.deleteCfRule.mock.calls[0][2],
      'conditionalFormats.clearInRanges',
    );
  });

  it('threads conditional-formatting context through reorder', async () => {
    mockBridgeFormats(bridge, [makeFormat({ id: 'fmt-1' }), makeFormat({ id: 'fmt-2' })]);

    await cf.reorder(['fmt-2', 'fmt-1']);

    expectConditionalFormattingAdmissionOptions(
      bridge.reorderCfRules.mock.calls[0][2],
      'conditionalFormats.reorder',
    );
  });
});
