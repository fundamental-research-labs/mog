import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FormulaAIContextCellValue,
  FormulaAIExplainContext,
  FormulaAIExplainSource,
  FormulaAIService,
} from '@mog-sdk/contracts/services';
import { toA1, cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import {
  useActiveCell,
  useActiveSheetId,
  useEditorState,
  useSelectionRanges,
  useSpreadsheetEmbedRuntimeOptional,
  useSpreadsheetFormulaAIOptional,
  useUIStore,
  useWorkbook,
} from '../../internal-api';
import { extractFormulaRanges } from '../../domain/editor/formula-range-parser';
import { NLFormulaBar } from './NLFormulaBar';

const MAX_CONTEXT_HEADERS = 24;
const MAX_CONTEXT_CELLS = 80;
const MAX_REFERENCED_ROWS = 24;
const MAX_REFERENCED_COLUMNS = 8;
const MAX_ROW_LABEL_COLUMNS = 2;
const CONTEXT_RADIUS = 1;
const MAX_EXPLANATION_CHARS = 240;

type ExplainTarget = {
  readonly formula: string;
  readonly source: FormulaAIExplainSource;
  readonly sheetId: string;
  readonly sheetName: string;
  readonly row: number;
  readonly col: number;
  readonly cellAddress: string;
  readonly selectionRange?: string;
};

type ActiveCellKey = {
  readonly sheetId: string;
  readonly row: number;
  readonly col: number;
};

type ActiveFormulaState = ActiveCellKey & {
  readonly formula: string;
};

type CellChangeEvent = {
  readonly row?: number;
  readonly col?: number;
  readonly changes?: readonly { readonly row: number; readonly col: number }[];
};

type ContextCell = { address: string; value: FormulaAIContextCellValue };

type ExplainResponseScope = {
  readonly targetKey: string;
  readonly provider: FormulaAIService;
};

interface NLFormulaBarContainerProps {
  readonly enabled?: boolean;
}

function isFormulaText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().startsWith('=');
}

function cellChangeTouchesCell(event: CellChangeEvent, row: number, col: number): boolean {
  if (typeof event.row === 'number' && typeof event.col === 'number') {
    return event.row === row && event.col === col;
  }
  return event.changes?.some((change) => change.row === row && change.col === col) ?? false;
}

function toContextCellValue(value: unknown): FormulaAIContextCellValue | undefined {
  if (value == null) return null;
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function normalizeExplanation(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  const firstSentence = collapsed.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? collapsed;
  if (firstSentence.length <= MAX_EXPLANATION_CHARS) return firstSentence;
  return `${firstSentence.slice(0, MAX_EXPLANATION_CHARS - 1).trimEnd()}.`;
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  return 'Could not explain this formula.';
}

function NLFormulaBarContainerImpl({ enabled = true }: NLFormulaBarContainerProps) {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const { row: activeCellRow, col: activeCellCol } = useActiveCell();
  const selectionRanges = useSelectionRanges();
  const editorState = useEditorState();
  const embedRuntime = useSpreadsheetEmbedRuntimeOptional();
  const formulaAI = useSpreadsheetFormulaAIOptional();

  const nlExplainResult = useUIStore((s) => s.nlExplainResult);
  const nlExplainLoading = useUIStore((s) => s.nlExplainLoading);
  const nlExplainError = useUIStore((s) => s.nlExplainError);
  const nlSubmitExplain = useUIStore((s) => s.nlSubmitExplain);
  const nlExplainResponseSuccess = useUIStore((s) => s.nlExplainResponseSuccess);
  const nlExplainResponseError = useUIStore((s) => s.nlExplainResponseError);
  const nlExplainDismiss = useUIStore((s) => s.nlExplainDismiss);

  const ws = useMemo(() => wb.getSheetById(activeSheetId), [wb, activeSheetId]);
  const [structureVersion, setStructureVersion] = useState(0);
  const [activeFormula, setActiveFormula] = useState<ActiveFormulaState | null>(null);
  const [activeFormulaHiddenCell, setActiveFormulaHiddenCell] = useState<ActiveCellKey | null>(
    null,
  );
  const [activeFormulaLoading, setActiveFormulaLoading] = useState(false);
  const [explainResponseScope, setExplainResponseScope] = useState<ExplainResponseScope | null>(
    null,
  );
  const activeRequestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const abortActiveRequest = useCallback(() => {
    activeRequestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    const refreshFormulaMetadata = () => {
      abortActiveRequest();
      setExplainResponseScope(null);
      nlExplainDismiss();
      setStructureVersion((v) => v + 1);
    };
    const refreshIfActiveCellChanged = (event: CellChangeEvent) => {
      if (cellChangeTouchesCell(event, activeCellRow, activeCellCol)) {
        refreshFormulaMetadata();
      }
    };
    const unsubscribeWorkbookStructure = wb.on('structureChanged', refreshFormulaMetadata);
    const unsubscribeWorkbookProtection = wb.on('protectionChanged', refreshFormulaMetadata);
    const unsubscribeSheetSettings = wb.on('sheet:settings-changed', refreshFormulaMetadata);
    const unsubscribeCellFormat = wb.on('cell:format-changed', refreshFormulaMetadata);
    const unsubscribeCellChanged = ws.on('cellChanged', refreshIfActiveCellChanged);
    const unsubscribeRowHidden = ws.on('row:hidden', refreshFormulaMetadata);
    const unsubscribeRowShown = ws.on('row:shown', refreshFormulaMetadata);
    const unsubscribeRowsHidden = ws.on('rows:hidden', refreshFormulaMetadata);
    const unsubscribeRowsUnhidden = ws.on('rows:unhidden', refreshFormulaMetadata);
    const unsubscribeColumnHidden = ws.on('column:hidden', refreshFormulaMetadata);
    const unsubscribeColumnShown = ws.on('column:shown', refreshFormulaMetadata);
    const unsubscribeColumnsHidden = ws.on('columns:hidden', refreshFormulaMetadata);
    const unsubscribeColumnsUnhidden = ws.on('columns:unhidden', refreshFormulaMetadata);

    return () => {
      unsubscribeWorkbookStructure();
      unsubscribeWorkbookProtection();
      unsubscribeSheetSettings();
      unsubscribeCellFormat();
      unsubscribeCellChanged();
      unsubscribeRowHidden();
      unsubscribeRowShown();
      unsubscribeRowsHidden();
      unsubscribeRowsUnhidden();
      unsubscribeColumnHidden();
      unsubscribeColumnShown();
      unsubscribeColumnsHidden();
      unsubscribeColumnsUnhidden();
    };
  }, [abortActiveRequest, activeCellCol, activeCellRow, nlExplainDismiss, wb, ws]);

  useEffect(() => {
    let cancelled = false;
    setActiveFormulaLoading(true);
    setActiveFormula(null);
    setActiveFormulaHiddenCell(null);
    void (async () => {
      try {
        await ws.refreshActiveCellData(activeCellRow, activeCellCol);
        const activeCellData = ws.viewport.getActiveCellData();
        if (activeCellData?.isFormulaHidden) {
          if (!cancelled) {
            setActiveFormula(null);
            setActiveFormulaHiddenCell({
              sheetId: activeSheetId,
              row: activeCellRow,
              col: activeCellCol,
            });
            setActiveFormulaLoading(false);
          }
          return;
        }
        const rawData = await ws.getRawCellData(activeCellRow, activeCellCol, true);
        if (!cancelled) {
          setActiveFormulaHiddenCell(null);
          setActiveFormula(
            isFormulaText(rawData.formula)
              ? {
                  sheetId: activeSheetId,
                  row: activeCellRow,
                  col: activeCellCol,
                  formula: rawData.formula.trim(),
                }
              : null,
          );
          setActiveFormulaLoading(false);
        }
      } catch {
        if (!cancelled) {
          setActiveFormula(null);
          setActiveFormulaHiddenCell(null);
          setActiveFormulaLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, activeSheetId, activeCellRow, activeCellCol, structureVersion]);

  const selectionRange = useMemo(() => {
    if (selectionRanges.length === 0) return undefined;
    const range = selectionRanges[0];
    const isSingleCell = range.startRow === range.endRow && range.startCol === range.endCol;
    return isSingleCell ? undefined : cellRangeToA1(range);
  }, [selectionRanges]);

  const explainTarget = useMemo<ExplainTarget | null>(() => {
    const hiddenCell = activeFormulaHiddenCell;
    const activeCellFormulaHidden =
      hiddenCell != null &&
      hiddenCell.sheetId === activeSheetId &&
      hiddenCell.row === activeCellRow &&
      hiddenCell.col === activeCellCol;
    if (activeCellFormulaHidden) return null;

    const formulaState = activeFormula;
    const activeCellFormula =
      formulaState != null &&
      formulaState.sheetId === activeSheetId &&
      formulaState.row === activeCellRow &&
      formulaState.col === activeCellCol
        ? formulaState.formula
        : null;

    const sheetName = ws.name ?? 'Sheet1';
    const editorMatchesActiveCell =
      editorState.sheetId === activeSheetId &&
      editorState.editingCell?.row === activeCellRow &&
      editorState.editingCell?.col === activeCellCol;
    const typedFormula =
      editorMatchesActiveCell && isFormulaText(editorState.value) ? editorState.value.trim() : null;
    if (typedFormula) {
      const row = editorState.editingCell?.row ?? activeCellRow;
      const col = editorState.editingCell?.col ?? activeCellCol;
      return {
        formula: typedFormula,
        source: 'typed',
        sheetId: editorState.sheetId ?? activeSheetId,
        sheetName,
        row,
        col,
        cellAddress: toA1(row, col),
        selectionRange,
      };
    }
    if (!activeCellFormula) return null;
    return {
      formula: activeCellFormula,
      source: 'active-cell',
      sheetId: activeSheetId,
      sheetName,
      row: activeCellRow,
      col: activeCellCol,
      cellAddress: toA1(activeCellRow, activeCellCol),
      selectionRange,
    };
  }, [
    activeCellCol,
    activeCellRow,
    activeFormula,
    activeFormulaHiddenCell,
    activeSheetId,
    editorState.editingCell,
    editorState.isEditing,
    editorState.sheetId,
    editorState.value,
    selectionRange,
    ws.name,
  ]);

  const explainTargetKey = explainTarget
    ? [
        explainTarget.source,
        explainTarget.sheetId,
        explainTarget.row,
        explainTarget.col,
        explainTarget.formula,
        explainTarget.selectionRange ?? '',
      ].join('|')
    : 'none';

  const currentExplainScopeRef = useRef<{
    targetKey: string;
    provider: FormulaAIService | undefined;
  }>({ targetKey: 'none', provider: undefined });
  currentExplainScopeRef.current = { targetKey: explainTargetKey, provider: formulaAI };

  useEffect(() => {
    abortActiveRequest();
    setExplainResponseScope(null);
    nlExplainDismiss();
  }, [abortActiveRequest, explainTargetKey, formulaAI, nlExplainDismiss]);

  useEffect(() => {
    return () => abortActiveRequest();
  }, [abortActiveRequest]);

  useEffect(() => {
    if (enabled) return;
    abortActiveRequest();
    setExplainResponseScope(null);
    nlExplainDismiss();
  }, [abortActiveRequest, enabled, nlExplainDismiss]);

  const isCellVisibleForAI = useCallback(
    async (row: number, col: number): Promise<boolean> => {
      try {
        const [rowHidden, columnHidden] = await Promise.all([
          ws.layout.isRowHidden(row),
          ws.layout.isColumnHidden(col),
        ]);
        return !rowHidden && !columnHidden;
      } catch {
        return false;
      }
    },
    [ws],
  );

  const refreshTargetPrivacy = useCallback(
    async (target: ExplainTarget): Promise<boolean> => {
      if (!(await isCellVisibleForAI(target.row, target.col))) {
        setActiveFormula(null);
        setActiveFormulaHiddenCell(null);
        return false;
      }

      await ws.refreshActiveCellData(target.row, target.col);
      const activeCellData = ws.viewport.getActiveCellData();
      if (activeCellData?.isFormulaHidden) {
        setActiveFormula(null);
        setActiveFormulaHiddenCell({
          sheetId: target.sheetId,
          row: target.row,
          col: target.col,
        });
        return false;
      }

      if (target.source === 'active-cell') {
        const rawData = await ws.getRawCellData(target.row, target.col, true);
        const currentFormula = isFormulaText(rawData.formula) ? rawData.formula.trim() : null;
        if (currentFormula !== target.formula) {
          setActiveFormula(
            currentFormula
              ? {
                  sheetId: target.sheetId,
                  row: target.row,
                  col: target.col,
                  formula: currentFormula,
                }
              : null,
          );
          setActiveFormulaHiddenCell(null);
          return false;
        }
      }

      return true;
    },
    [isCellVisibleForAI, ws],
  );

  const buildExplainContext = useCallback(
    async (target: ExplainTarget): Promise<FormulaAIExplainContext> => {
      const headers: string[] = [];
      try {
        for (let col = 0; col < MAX_CONTEXT_HEADERS; col++) {
          if (!(await isCellVisibleForAI(0, col))) continue;
          const cell = await ws.getCell(0, col);
          const value = toContextCellValue(cell?.value);
          if (value == null || value === '') break;
          headers.push(String(value));
        }
      } catch {
        // Header extraction is best-effort.
      }

      const nearbyCells: ContextCell[] = [];
      const seenCells = new Set<string>();

      const addContextCell = async (row: number, col: number) => {
        if (nearbyCells.length >= MAX_CONTEXT_CELLS || row < 0 || col < 0) return;
        const address = toA1(row, col);
        if (seenCells.has(address)) return;
        try {
          if (!(await isCellVisibleForAI(row, col))) return;
          const cell = await ws.getCell(row, col);
          const value = toContextCellValue(cell?.value);
          if (value == null || value === '') return;
          seenCells.add(address);
          nearbyCells.push({ address, value });
        } catch {
          // Context extraction is best-effort.
        }
      };

      await addContextCell(target.row, target.col);

      for (const reference of extractFormulaRanges(target.formula)) {
        const { range, text } = reference;
        if (text.includes('!')) continue;

        const endRow = Math.min(range.endRow, range.startRow + MAX_REFERENCED_ROWS - 1);
        const endCol = Math.min(range.endCol, range.startCol + MAX_REFERENCED_COLUMNS - 1);
        const rowLabelEndCol = Math.min(range.startCol, MAX_ROW_LABEL_COLUMNS);

        for (let row = range.startRow; row <= endRow; row++) {
          for (let col = 0; col < rowLabelEndCol; col++) {
            await addContextCell(row, col);
          }
          for (let col = range.startCol; col <= endCol; col++) {
            await addContextCell(row, col);
          }
        }
      }

      for (
        let row = Math.max(0, target.row - CONTEXT_RADIUS);
        row <= target.row + CONTEXT_RADIUS;
        row++
      ) {
        for (
          let col = Math.max(0, target.col - CONTEXT_RADIUS);
          col <= target.col + CONTEXT_RADIUS;
          col++
        ) {
          await addContextCell(row, col);
        }
      }

      return {
        documentId: embedRuntime?.documentId,
        sheetId: target.sheetId,
        sheetName: target.sheetName,
        cellAddress: target.cellAddress,
        selectionRange: target.selectionRange,
        headers,
        nearbyCells,
      };
    },
    [embedRuntime?.documentId, isCellVisibleForAI, ws],
  );

  const handleExplain = useCallback(async () => {
    const responseScopeMatches =
      explainResponseScope?.targetKey === explainTargetKey &&
      explainResponseScope.provider === formulaAI;
    const responseAlreadySettled =
      responseScopeMatches &&
      (nlExplainLoading || nlExplainResult != null || nlExplainError != null);
    if (!enabled || !explainTarget || responseAlreadySettled || !formulaAI) return;

    const requestId = activeRequestIdRef.current + 1;
    const submittedTargetKey = explainTargetKey;
    const submittedProvider = formulaAI;
    activeRequestIdRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const targetStillExplainable = await refreshTargetPrivacy(explainTarget);
      if (
        !targetStillExplainable ||
        controller.signal.aborted ||
        activeRequestIdRef.current !== requestId
      ) {
        return;
      }
    } catch {
      if (controller.signal.aborted || activeRequestIdRef.current !== requestId) return;
      nlExplainResponseError('Could not explain this formula.');
      abortRef.current = null;
      return;
    }

    setExplainResponseScope({
      targetKey: submittedTargetKey,
      provider: submittedProvider,
    });
    nlSubmitExplain({
      requestId,
      source: explainTarget.source,
      cellAddress: explainTarget.cellAddress,
      sheetName: explainTarget.sheetName,
      selectionRange: explainTarget.selectionRange,
    });

    try {
      const context = await buildExplainContext(explainTarget);
      if (
        controller.signal.aborted ||
        activeRequestIdRef.current !== requestId ||
        currentExplainScopeRef.current.targetKey !== submittedTargetKey ||
        currentExplainScopeRef.current.provider !== submittedProvider
      ) {
        return;
      }

      const result = await submittedProvider.explainFormula(
        {
          formula: explainTarget.formula,
          source: explainTarget.source,
          context,
        },
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        activeRequestIdRef.current !== requestId ||
        currentExplainScopeRef.current.targetKey !== submittedTargetKey ||
        currentExplainScopeRef.current.provider !== submittedProvider
      ) {
        return;
      }

      const explanation = normalizeExplanation(result.explanation);
      if (!explanation) {
        nlExplainResponseError('Could not explain this formula.');
        return;
      }
      nlExplainResponseSuccess(explanation);
    } catch (error) {
      if (controller.signal.aborted || activeRequestIdRef.current !== requestId) return;
      const message = providerErrorMessage(error);
      if (message) nlExplainResponseError(message);
    } finally {
      if (activeRequestIdRef.current === requestId) {
        abortRef.current = null;
      }
    }
  }, [
    buildExplainContext,
    enabled,
    explainTarget,
    explainResponseScope,
    explainTargetKey,
    formulaAI,
    nlExplainError,
    nlExplainLoading,
    nlExplainResult,
    nlExplainResponseError,
    nlExplainResponseSuccess,
    nlSubmitExplain,
    refreshTargetPrivacy,
  ]);

  useEffect(() => {
    void handleExplain();
  }, [handleExplain]);

  const responseScopeMatches =
    explainResponseScope?.targetKey === explainTargetKey &&
    explainResponseScope.provider === formulaAI;

  return (
    <NLFormulaBar
      formulaPreview={explainTarget?.formula ?? null}
      checking={activeFormulaLoading}
      loading={responseScopeMatches && nlExplainLoading}
      result={responseScopeMatches ? nlExplainResult : null}
      error={responseScopeMatches ? nlExplainError : null}
    />
  );
}

export const NLFormulaBarContainer = memo(NLFormulaBarContainerImpl);
