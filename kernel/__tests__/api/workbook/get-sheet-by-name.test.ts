/**
 * Regression test: getSheet is case-insensitive.
 *
 * The _resolveTarget method in WorkbookImpl uses .toLowerCase() comparison
 * when resolving sheet names. This test ensures that behaviour is preserved.
 */

import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../../../src/api/workbook/workbook-impl';
import type { DocumentContext } from '../../../src/context/types';
import type { KernelError } from '../../../src/errors';

// ---------------------------------------------------------------------------
// Mock the domain module that _resolveTarget depends on
// ---------------------------------------------------------------------------

const mockGetOrder = jest.fn<Promise<string[]>, []>();

jest.mock('../../../src/domain/sheets/sheet-meta', () => ({
  getOrder: (...args: unknown[]) => mockGetOrder(...(args as [])),
  getName: jest.fn(),
}));

// Mock the checkpoint service to avoid pulling in real dependencies
jest.mock('../../../src/services/checkpoint', () => ({
  createCheckpointManager: () => ({
    save: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    restore: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock DocumentContext with just enough for getSheet. */
function createMockCtx(): DocumentContext {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn(async () => ['sheet-1', 'sheet-2']),
      getSheetName: jest.fn(async (id: string) => {
        const names: Record<string, string> = {
          'sheet-1': 'MySheet',
          'sheet-2': 'Revenue Data',
        };
        return names[id] ?? null;
      }),
      isSheetHidden: jest.fn(async () => false),
      // Stubs for other methods that may be called during construction
      getAllNamedRanges: jest.fn().mockResolvedValue([]),
      getUndoState: jest.fn().mockReturnValue({ canUndo: false, canRedo: false }),
    },
    eventBus: {
      emit: jest.fn(),
      on: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      onAll: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      off: jest.fn(),
    },
    mirror: {
      getSheetIds: jest.fn(() => ['sheet-1', 'sheet-2']),
      getSheetMeta: jest.fn((id: string) => {
        const names: Record<string, string> = {
          'sheet-1': 'MySheet',
          'sheet-2': 'Revenue Data',
        };
        return { name: names[id] ?? id, hidden: false };
      }),
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
  } as unknown as DocumentContext;
}

function createConfig(ctx: DocumentContext): WorkbookConfig {
  return {
    ctx,
    eventBus: ctx.eventBus as WorkbookConfig['eventBus'],
  };
}

async function captureKernelError(promise: Promise<unknown>): Promise<KernelError> {
  try {
    await promise;
  } catch (error) {
    return error as KernelError;
  }
  throw new Error('Expected KernelError');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Dynamic import so mocks are in place before the module loads
let WorkbookImpl: typeof import('../../../src/api/workbook/workbook-impl').WorkbookImpl;

beforeAll(async () => {
  const mod = await import('../../../src/api/workbook/workbook-impl');
  WorkbookImpl = mod.WorkbookImpl;
});

describe('getSheet — case-insensitive lookup', () => {
  let ctx: DocumentContext;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    mockGetOrder.mockResolvedValue(['sheet-1', 'sheet-2']);
  });

  it('finds sheet with exact-case name', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const sheet = await wb.getSheet('MySheet');
    expect(sheet).toBeDefined();
    expect(sheet.getSheetId()).toBe('sheet-1');
  });

  it('finds sheet with all-lowercase name', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const sheet = await wb.getSheet('mysheet');
    expect(sheet).toBeDefined();
    expect(sheet.getSheetId()).toBe('sheet-1');
  });

  it('finds sheet with all-uppercase name', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const sheet = await wb.getSheet('MYSHEET');
    expect(sheet).toBeDefined();
    expect(sheet.getSheetId()).toBe('sheet-1');
  });

  it('finds sheet with mixed-case name', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const sheet = await wb.getSheet('mYsHeEt');
    expect(sheet).toBeDefined();
    expect(sheet.getSheetId()).toBe('sheet-1');
  });

  it('finds sheet with spaces using different casing', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const sheet = await wb.getSheet('revenue data');
    expect(sheet).toBeDefined();
    expect(sheet.getSheetId()).toBe('sheet-2');
  });

  it('all casings return the same sheet', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const exact = await wb.getSheet('MySheet');
    const lower = await wb.getSheet('mysheet');
    const upper = await wb.getSheet('MYSHEET');

    expect(exact.getSheetId()).toBe(lower.getSheetId());
    expect(lower.getSheetId()).toBe(upper.getSheetId());
  });

  it('throws for a name that does not exist regardless of casing', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    await expect(wb.getSheet('NonExistent')).rejects.toThrow();
  });

  it('shows invisible whitespace and trim-equivalent matches when a sheet name is missing', async () => {
    const names: Record<string, string> = {
      'sheet-1': 'Working Capital ',
      'sheet-2': 'Revenue Data',
    };
    (ctx.computeBridge.getSheetName as jest.Mock).mockImplementation(async (id: string) => {
      return names[id] ?? null;
    });
    (ctx.mirror.getSheetMeta as jest.Mock).mockImplementation((id: string) => ({
      name: names[id] ?? id,
      hidden: false,
    }));

    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const error = await captureKernelError(wb.getSheet('Working Capital'));

    expect(error.code).toBe('API_SHEET_NOT_FOUND');
    expect(error.message).toContain('"Working\\sCapital\\s"');
    expect(error.context).toEqual(
      expect.objectContaining({
        target: 'Working Capital',
        targetVisible: 'Working\\sCapital',
        knownSheetNames: ['Working Capital ', 'Revenue Data'],
        knownSheetNamesVisible: ['Working\\sCapital\\s', 'Revenue\\sData'],
      }),
    );
    expect(error.context.nearMatches).toEqual([
      expect.objectContaining({
        name: 'Working Capital ',
        visibleName: 'Working\\sCapital\\s',
        matchKind: 'trim-equivalent',
      }),
    ]);
  });

  it('suggests fuzzy near matches for typoed sheet names', async () => {
    const wb = new WorkbookImpl(createConfig(ctx));
    await wb._init();

    const error = await captureKernelError(wb.getSheet('Revenue Dtaa'));

    expect(error.code).toBe('API_SHEET_NOT_FOUND');
    expect(error.context.nearMatches).toEqual([
      expect.objectContaining({
        name: 'Revenue Data',
        visibleName: 'Revenue\\sData',
        matchKind: 'fuzzy',
      }),
    ]);
  });
});
