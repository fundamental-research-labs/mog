import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useActiveCell,
  useActiveSheetId,
  useSelectionRanges,
  useUIStore,
  useWorkbook,
  type CellRange,
} from '../../internal-api';
import { toA1, cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import { requestFormulaBarRefresh } from '../../infra/events/formula-bar-refresh';
import { NLFormulaBar } from './NLFormulaBar';

function NLFormulaBarContainerImpl() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const { row: activeCellRow, col: activeCellCol } = useActiveCell();
  const selectionRanges = useSelectionRanges();

  // Generate slice state
  const nlPrompt = useUIStore((s) => s.nlPrompt);
  const nlResult = useUIStore((s) => s.nlResult);
  const nlRequest = useUIStore((s) => s.nlRequest);
  const nlLoading = useUIStore((s) => s.nlLoading);
  const nlError = useUIStore((s) => s.nlError);
  const setNLPrompt = useUIStore((s) => s.setNLPrompt);
  const nlSubmitPrompt = useUIStore((s) => s.nlSubmitPrompt);
  const nlResponseError = useUIStore((s) => s.nlResponseError);
  const nlAcceptFormula = useUIStore((s) => s.nlAcceptFormula);
  const nlRetry = useUIStore((s) => s.nlRetry);
  const nlDismiss = useUIStore((s) => s.nlDismiss);

  // Explain slice state
  const nlExplainResult = useUIStore((s) => s.nlExplainResult);
  const nlExplainRequest = useUIStore((s) => s.nlExplainRequest);
  const nlExplainLoading = useUIStore((s) => s.nlExplainLoading);
  const nlExplainError = useUIStore((s) => s.nlExplainError);
  const nlSubmitExplain = useUIStore((s) => s.nlSubmitExplain);
  const nlExplainResponseError = useUIStore((s) => s.nlExplainResponseError);
  const nlExplainDismiss = useUIStore((s) => s.nlExplainDismiss);

  // Context extraction
  const ws = useMemo(() => wb.getSheetById(activeSheetId), [wb, activeSheetId]);

  // Read active cell's formula
  const [activeFormula, setActiveFormula] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rawData = await ws.getRawCellData(activeCellRow, activeCellCol, true);
        if (!cancelled) {
          setActiveFormula(rawData.formula ?? null);
        }
      } catch {
        if (!cancelled) setActiveFormula(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, activeCellRow, activeCellCol]);

  // Shared context extraction helper
  const extractContext = useCallback(async () => {
    const cellAddress = toA1(activeCellRow, activeCellCol);
    const sheetName = ws.name ?? 'Sheet1';

    const headers: string[] = [];
    try {
      for (let col = 0; col < 26; col++) {
        const cell = await ws.getCell(0, col);
        if (cell?.value != null && cell.value !== '') {
          headers.push(String(cell.value));
        } else {
          break;
        }
      }
    } catch {
      // Header extraction is best-effort
    }

    // Include selected range if it's more than a single cell
    let selectionRange: string | undefined;
    if (selectionRanges.length > 0) {
      const range = selectionRanges[0];
      const isSingleCell = range.startRow === range.endRow && range.startCol === range.endCol;
      if (!isSingleCell) {
        selectionRange = cellRangeToA1(range);
      }
    }

    // Include current formula if the active cell has one
    const currentFormula = activeFormula ?? undefined;

    return { cellAddress, sheetName, headers, dataTypes: {}, selectionRange, currentFormula };
  }, [activeCellRow, activeCellCol, ws, selectionRanges, activeFormula]);

  const handleSubmit = useCallback(async () => {
    const context = await extractContext();
    nlSubmitPrompt(context);
  }, [extractContext, nlSubmitPrompt]);

  // Track the cell and range that were active when the prompt was submitted,
  // so we write back to the correct location even if selection moves.
  const submitCellRef = useRef<{ row: number; col: number } | null>(null);
  const submitRangeRef = useRef<CellRange | null>(null);

  const handleSubmitWithCapture = useCallback(async () => {
    submitCellRef.current = { row: activeCellRow, col: activeCellCol };
    // Capture the range if it's more than a single cell
    if (selectionRanges.length > 0) {
      const range = selectionRanges[0];
      const isSingleCell = range.startRow === range.endRow && range.startCol === range.endCol;
      submitRangeRef.current = isSingleCell ? null : range;
    } else {
      submitRangeRef.current = null;
    }
    await handleSubmit();
  }, [activeCellRow, activeCellCol, selectionRanges, handleSubmit]);

  useEffect(() => {
    if (!nlRequest || !nlLoading) return;
    const timeout = window.setTimeout(() => {
      nlResponseError(
        'Natural-language formula generation is unavailable because no formula provider is configured.',
      );
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [nlRequest, nlLoading, nlResponseError]);

  useEffect(() => {
    if (!nlExplainRequest || !nlExplainLoading) return;
    const timeout = window.setTimeout(() => {
      nlExplainResponseError(
        'Natural-language formula explanation is unavailable because no formula provider is configured.',
      );
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [nlExplainRequest, nlExplainLoading, nlExplainResponseError]);

  /** Write the formula to either the captured range or single cell. */
  const writeFormula = useCallback(
    async (formula: string): Promise<CellRange> => {
      const range = submitRangeRef.current;
      if (range) {
        const rows = range.endRow - range.startRow + 1;
        const cols = range.endCol - range.startCol + 1;
        const values = Array.from({ length: rows }, () =>
          Array.from({ length: cols }, () => formula),
        );
        await ws.setRange(range, values);
        submitCellRef.current = null;
        submitRangeRef.current = null;
        return range;
      } else {
        const target = submitCellRef.current ?? { row: activeCellRow, col: activeCellCol };
        await ws.setCell(target.row, target.col, formula);
        submitCellRef.current = null;
        submitRangeRef.current = null;
        return {
          startRow: target.row,
          startCol: target.col,
          endRow: target.row,
          endCol: target.col,
        };
      }
    },
    [ws, activeCellRow, activeCellCol],
  );

  const handleAccept = useCallback(async () => {
    const formula = nlResult?.formula;
    if (!formula) return;
    const range = await writeFormula(formula);
    requestFormulaBarRefresh({ sheetIds: [activeSheetId], ranges: [range] });
    nlAcceptFormula();
  }, [writeFormula, nlResult, activeSheetId, nlAcceptFormula]);

  const handleExplain = useCallback(async () => {
    if (!activeFormula) return;
    const context = await extractContext();
    nlSubmitExplain(activeFormula, context);
  }, [activeFormula, extractContext, nlSubmitExplain]);

  return (
    <NLFormulaBar
      prompt={nlPrompt}
      onPromptChange={setNLPrompt}
      onSubmit={handleSubmitWithCapture}
      onAccept={handleAccept}
      onRetry={nlRetry}
      onDismiss={nlDismiss}
      loading={nlLoading}
      result={nlResult}
      error={nlError}
      activeFormula={activeFormula}
      onExplain={handleExplain}
      explainLoading={nlExplainLoading}
      explainResult={nlExplainResult}
      explainError={nlExplainError}
      onExplainDismiss={nlExplainDismiss}
    />
  );
}

export const NLFormulaBarContainer = memo(NLFormulaBarContainerImpl);
