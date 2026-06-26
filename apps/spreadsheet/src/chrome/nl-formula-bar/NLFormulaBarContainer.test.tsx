import '@testing-library/jest-dom';
import { jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { create } from 'zustand';

import type { FormulaAIService } from '@mog-sdk/contracts/services';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import { FeatureGatesProvider } from '../../infra/context/feature-gates-context';
import { createNLFormulaBarSlice } from '../../ui-store/slices/nl-formula/nl-formula-bar';

type MockState = {
  activeCell: { row: number; col: number };
  activeSheetId: string;
  activeCellData: { isFormulaHidden?: boolean } | null;
  hiddenCols: readonly number[];
  hiddenRows: readonly number[];
  rawFormula: string | undefined;
  editorState: {
    isEditing: boolean;
    value: string;
    editingCell: { row: number; col: number } | null;
    sheetId: string | null;
  };
  formulaAI?: FormulaAIService;
};

let mockUiStore = create(createNLFormulaBarSlice);
let mockState: MockState;
let NLFormulaBarContainer: ComponentType<{ enabled?: boolean; version?: number }>;
let worksheetHandlers = new Map<string, Set<(event: unknown) => void>>();

function emitWorksheetEvent(event: string, payload: unknown) {
  for (const handler of worksheetHandlers.get(event) ?? []) {
    handler(payload);
  }
}

const mockGetCell = jest.fn(async (row: number, col: number) => ({
  value: row === 0 ? ['Region', 'Revenue', 'Cost'][col] : row + col,
}));

const mockWorksheet = {
  name: 'Sheet1',
  refreshActiveCellData: jest.fn(async () => undefined),
  viewport: {
    getActiveCellData: jest.fn(() => mockState.activeCellData),
  },
  layout: {
    isRowHidden: jest.fn(async (row: number) => mockState.hiddenRows.includes(row)),
    isColumnHidden: jest.fn(async (col: number) => mockState.hiddenCols.includes(col)),
  },
  getRawCellData: jest.fn(async () => ({ value: 6, formula: mockState.rawFormula })),
  getCell: mockGetCell,
  on: jest.fn((event: string, handler: (payload: unknown) => void) => {
    let handlers = worksheetHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      worksheetHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers?.delete(handler);
  }),
};

const mockWorkbook = {
  getSheetById: jest.fn(() => mockWorksheet),
  on: jest.fn(() => () => undefined),
};

jest.unstable_mockModule('../../internal-api', () => ({
  useActiveCell: () => mockState.activeCell,
  useActiveSheetId: () => mockState.activeSheetId,
  useEditorState: () => mockState.editorState,
  useSelectionRanges: () => [],
  useSpreadsheetEmbedRuntimeOptional: () => ({ documentId: 'doc-1' }),
  useSpreadsheetFormulaAIOptional: () => mockState.formulaAI,
  useUIStore: (selector: (state: ReturnType<typeof mockUiStore.getState>) => unknown) =>
    mockUiStore(selector),
  useWorkbook: () => mockWorkbook,
}));

beforeAll(async () => {
  ({ NLFormulaBarContainer } = await import('./NLFormulaBarContainer'));
});

function resetMocks(overrides: Partial<MockState> = {}) {
  mockUiStore = create(createNLFormulaBarSlice);
  worksheetHandlers = new Map();
  mockState = {
    activeCell: { row: 3, col: 0 },
    activeSheetId: 'sheet-1',
    activeCellData: { isFormulaHidden: false },
    hiddenCols: [],
    hiddenRows: [],
    rawFormula: '=SUM(A1:A3)',
    editorState: {
      isEditing: false,
      value: '',
      editingCell: null,
      sheetId: null,
    },
    formulaAI: {
      explainFormula: jest.fn(async () => ({
        explanation: 'This formula adds the values in the range. It ignores blanks.',
      })),
    },
    ...overrides,
  };
  mockWorksheet.refreshActiveCellData.mockReset();
  mockWorksheet.refreshActiveCellData.mockImplementation(async () => undefined);
  mockWorksheet.viewport.getActiveCellData.mockClear();
  mockWorksheet.layout.isRowHidden.mockClear();
  mockWorksheet.layout.isColumnHidden.mockClear();
  mockWorksheet.getRawCellData.mockReset();
  mockWorksheet.getRawCellData.mockImplementation(async () => ({
    value: 6,
    formula: mockState.rawFormula,
  }));
  mockGetCell.mockReset();
  mockGetCell.mockImplementation(async (row: number, col: number) => ({
    value: row === 0 ? ['Region', 'Revenue', 'Cost'][col] : row + col,
  }));
  mockWorkbook.getSheetById.mockClear();
  mockWorkbook.on.mockClear();
  mockWorksheet.on.mockClear();
}

function renderContainer(gates: FeatureGates = {}) {
  return render(
    <FeatureGatesProvider gates={gates}>
      <NLFormulaBarContainer />
    </FeatureGatesProvider>,
  );
}

describe('NLFormulaBarContainer', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('calls the formula AI service and renders one plain sentence', async () => {
    renderContainer();

    await waitFor(() => {
      expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledTimes(1);
    });
    expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledWith(
      expect.objectContaining({
        formula: '=SUM(A1:A3)',
        source: 'active-cell',
        context: expect.objectContaining({
          documentId: 'doc-1',
          sheetId: 'sheet-1',
          sheetName: 'Sheet1',
          cellAddress: 'A4',
          headers: ['Region', 'Revenue', 'Cost'],
        }),
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(await screen.findByTestId('nl-explain-result')).toHaveTextContent(
      'This formula adds the values in the range.',
    );
  });

  it('uses typed formula text only when the editor matches the active cell', async () => {
    resetMocks({
      editorState: {
        isEditing: true,
        value: '=AVERAGE(B1:B3)',
        editingCell: { row: 3, col: 0 },
        sheetId: 'sheet-1',
      },
    });
    renderContainer();

    await waitFor(() => {
      expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledWith(
        expect.objectContaining({ formula: '=AVERAGE(B1:B3)', source: 'typed' }),
        expect.anything(),
      );
    });
  });

  it('disables explanation when no provider is configured', async () => {
    resetMocks({ formulaAI: undefined });
    renderContainer();

    expect(await screen.findByTestId('nl-formula-target')).toHaveTextContent('=SUM(A1:A3)');
    expect(mockState.formulaAI).toBeUndefined();
  });

  it('does not expose or send hidden protected formulas', async () => {
    resetMocks({ activeCellData: { isFormulaHidden: true } });
    renderContainer();

    await waitFor(() => {
      expect(mockWorksheet.refreshActiveCellData).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('nl-formula-target')).not.toBeInTheDocument();
    expect(screen.getByTestId('nl-formula-placeholder')).toHaveTextContent(
      'Select a cell with a formula to get an explanation.',
    );
    expect(mockState.formulaAI?.explainFormula).not.toHaveBeenCalled();
  });

  it('rechecks hidden formula state immediately before dispatch', async () => {
    mockWorksheet.refreshActiveCellData.mockImplementation(async () => {
      if (mockWorksheet.refreshActiveCellData.mock.calls.length >= 2) {
        mockState = {
          ...mockState,
          activeCellData: { isFormulaHidden: true },
        };
      }
    });
    renderContainer();

    await waitFor(() => {
      expect(mockWorksheet.refreshActiveCellData).toHaveBeenCalledTimes(2);
    });
    expect(mockState.formulaAI?.explainFormula).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('nl-formula-target')).not.toBeInTheDocument();
    });
  });

  it('does not include hidden rows or columns in provider context', async () => {
    resetMocks({ hiddenCols: [1], hiddenRows: [2] });
    renderContainer();

    await waitFor(() => {
      expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledTimes(1);
    });
    expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          headers: ['Region', 'Cost'],
          nearbyCells: expect.not.arrayContaining([
            expect.objectContaining({ address: 'A3' }),
            expect.objectContaining({ address: 'B4' }),
          ]),
        }),
      }),
      expect.anything(),
    );
  });

  it('does not reuse the previous formula while a new active cell is loading', async () => {
    resetMocks({ formulaAI: undefined });
    const { rerender } = renderContainer();

    expect(await screen.findByTestId('nl-formula-target')).toHaveTextContent('=SUM(A1:A3)');

    mockWorksheet.getRawCellData.mockImplementation(() => new Promise(() => undefined));
    mockState = {
      ...mockState,
      activeCell: { row: 4, col: 0 },
      rawFormula: '=SUM(A1:A4)',
    };
    rerender(
      <FeatureGatesProvider gates={{}}>
        <NLFormulaBarContainer version={1} />
      </FeatureGatesProvider>,
    );

    expect(screen.queryByTestId('nl-formula-target')).not.toBeInTheDocument();
    expect(screen.getByTestId('nl-formula-placeholder')).toHaveTextContent(
      'Select a cell with a formula to get an explanation.',
    );
    expect(mockState.formulaAI).toBeUndefined();
  });

  it('refreshes the active formula when the selected cell changes in place', async () => {
    renderContainer();

    await waitFor(() => {
      expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledWith(
        expect.objectContaining({ formula: '=SUM(A1:A3)' }),
        expect.anything(),
      );
    });
    jest.mocked(mockState.formulaAI!.explainFormula).mockClear();
    mockState = {
      ...mockState,
      rawFormula: '=AVERAGE(A1:A3)',
    };

    act(() => {
      emitWorksheetEvent('cellChanged', { row: 3, col: 0 });
    });

    await waitFor(() => {
      expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledWith(
        expect.objectContaining({ formula: '=AVERAGE(A1:A3)' }),
        expect.anything(),
      );
    });
  });

  it('aborts and suppresses an in-flight request when the selected cell changes in place', async () => {
    const capturedSignals: AbortSignal[] = [];
    const requestResolvers: ((value: { explanation: string }) => void)[] = [];
    resetMocks({
      formulaAI: {
        explainFormula: jest.fn((_request, options) => {
          if (options?.signal) capturedSignals.push(options.signal);
          return new Promise((resolve) => {
            requestResolvers.push(resolve);
          });
        }),
      },
    });
    renderContainer();

    await waitFor(() => expect(capturedSignals[0]).toBeDefined());

    mockState = {
      ...mockState,
      rawFormula: '=AVERAGE(A1:A3)',
    };
    act(() => {
      emitWorksheetEvent('cellChanged', { row: 3, col: 0 });
    });

    await waitFor(() => {
      expect(capturedSignals[0]?.aborted).toBe(true);
    });
    await act(async () => {
      requestResolvers[0]?.({ explanation: 'Old same-cell response should not render.' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Old same-cell response should not render.')).not.toBeInTheDocument();
    await waitFor(() => expect(requestResolvers[1]).toBeDefined());
    expect(mockState.formulaAI?.explainFormula).toHaveBeenCalledWith(
      expect.objectContaining({ formula: '=AVERAGE(A1:A3)' }),
      expect.anything(),
    );
  });

  it('aborts an in-flight request when the explain target changes', async () => {
    const capturedSignals: AbortSignal[] = [];
    const requestResolvers: ((value: { explanation: string }) => void)[] = [];
    resetMocks({
      formulaAI: {
        explainFormula: jest.fn((_request, options) => {
          if (options?.signal) capturedSignals.push(options.signal);
          return new Promise((resolve) => {
            requestResolvers.push(resolve);
          });
        }),
      },
    });
    const { rerender } = renderContainer();

    await waitFor(() => expect(capturedSignals[0]).toBeDefined());

    mockState = {
      ...mockState,
      editorState: {
        isEditing: true,
        value: '=SUM(A1:A4)',
        editingCell: { row: 3, col: 0 },
        sheetId: 'sheet-1',
      },
    };
    rerender(
      <FeatureGatesProvider gates={{}}>
        <NLFormulaBarContainer version={1} />
      </FeatureGatesProvider>,
    );

    await waitFor(() => {
      expect(capturedSignals[0]?.aborted).toBe(true);
    });

    await act(async () => {
      requestResolvers[0]?.({ explanation: 'Old response should not render.' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Old response should not render.')).not.toBeInTheDocument();
    await waitFor(() => expect(requestResolvers[1]).toBeDefined());
  });

  it('aborts an in-flight request when the provider changes', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveOldRequest: ((value: { explanation: string }) => void) | undefined;
    const nextProvider: FormulaAIService = {
      explainFormula: jest.fn(async () => ({ explanation: 'New provider response.' })),
    };
    resetMocks({
      formulaAI: {
        explainFormula: jest.fn((_request, options) => {
          capturedSignal = options?.signal;
          return new Promise((resolve) => {
            resolveOldRequest = resolve;
          });
        }),
      },
    });
    const { rerender } = renderContainer();

    await waitFor(() => expect(capturedSignal).toBeDefined());

    mockState = {
      ...mockState,
      formulaAI: nextProvider,
    };
    rerender(
      <FeatureGatesProvider gates={{}}>
        <NLFormulaBarContainer version={1} />
      </FeatureGatesProvider>,
    );

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });
    await act(async () => {
      resolveOldRequest?.({ explanation: 'Old provider response should not render.' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Old provider response should not render.')).not.toBeInTheDocument();
    expect(await screen.findByTestId('nl-explain-result')).toHaveTextContent(
      'New provider response.',
    );
    expect(nextProvider.explainFormula).toHaveBeenCalledTimes(1);
  });
});
