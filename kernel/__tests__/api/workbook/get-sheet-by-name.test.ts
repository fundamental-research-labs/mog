/**
 * Regression test: getSheet is case-insensitive.
 *
 * The _resolveTarget method in WorkbookImpl uses .toLowerCase() comparison
 * when resolving sheet names. This test ensures that behaviour is preserved.
 */

import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../../../src/api/workbook/workbook-impl';
import type { DocumentContext } from '../../../src/context/types';

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
});
