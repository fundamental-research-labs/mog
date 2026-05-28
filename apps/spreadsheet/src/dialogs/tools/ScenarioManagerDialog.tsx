/**
 * Scenario Manager Dialog
 *
 * Scenarios: Scenario Manager
 *
 * A dialog that allows users to create, edit, delete, and apply scenarios.
 * Scenarios let users save different sets of input values and switch between
 * them to compare outcomes.
 *
 * Spreadsheet compatibility: Data > Scenarios > Scenario Manager
 *
 * All operations go through the unified Workbook API (ONE API):
 * - wb.applyScenario(id) — applies values + saves originals
 * - wb.restoreScenario(originals) — restores + deactivates
 * - wb.updateScenario(id, config) — updates name/comment
 * - wb.createScenario(config), wb.deleteScenario(id), wb.getScenarios()
 *
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveCell, useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';
import type { OriginalCellValue, Scenario } from '@mog-sdk/contracts/api';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import { toA1 } from '@mog/spreadsheet-utils/a1';
import type { EditingChangingCell, OriginalValueEntry } from '../../ui-store/slices';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format cell value for display.
 */
function formatValue(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return value.value;
  }
  return String(value);
}

function parseScenarioValue(input: string): CellValue {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  const numeric = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(numeric)) return numeric;
  return input;
}

/**
 * Merge new original values from applyScenario() into the existing Map.
 * Only adds entries for cells not already tracked (preserves first-ever originals).
 */
function mergeOriginals(
  existing: Map<string, OriginalValueEntry>,
  newOriginals: OriginalCellValue[],
): Map<string, OriginalValueEntry> {
  const merged = new Map(existing);
  for (const orig of newOriginals) {
    const key = `${orig.sheetId}:${orig.cellId}`;
    if (!merged.has(key)) {
      merged.set(key, {
        sheetId: orig.sheetId as SheetId,
        cellId: toCellId(orig.cellId),
        value: orig.value as CellValue,
        formula: orig.formula,
      });
    }
  }
  return merged;
}

/**
 * Convert the original values Map to OriginalCellValue[] for the Workbook API.
 */
function mapToOriginalCellValues(map: Map<string, OriginalValueEntry>): OriginalCellValue[] {
  return Array.from(map.values()).map(({ sheetId, cellId, value, formula }) => ({
    sheetId,
    cellId,
    value: value as string | number | boolean | null,
    formula,
  }));
}

// =============================================================================
// Sub-Components
// =============================================================================

interface ScenarioListProps {
  scenarios: Scenario[];
  selectedId: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Scenario list with selection highlighting.
 */
function ScenarioList({ scenarios, selectedId, activeId, onSelect }: ScenarioListProps) {
  if (scenarios.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-ss-text-secondary text-body-sm">
        No scenarios defined
      </div>
    );
  }

  return (
    <div className="h-32 overflow-y-auto border border-ss-border rounded">
      {scenarios.map((scenario) => (
        <div
          key={scenario.id}
          className={`px-3 py-1.5 cursor-pointer hover:bg-ss-bg-surface-hover
 ${selectedId === scenario.id ? 'bg-ss-bg-surface-selected' : ''}
 ${activeId === scenario.id ? 'font-semibold' : ''}`}
          onClick={() => onSelect(scenario.id)}
        >
          <div className="flex items-center gap-2">
            <span className="text-body-sm">{scenario.name}</span>
            {activeId === scenario.id && (
              <span className="text-body-xs text-ss-text-secondary">(shown)</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ChangingCellsDisplayProps {
  changingCells: CellId[];
  values: CellValue[];
}

/**
 * Display changing cells and their values for a scenario.
 */
function ChangingCellsDisplay({ changingCells, values }: ChangingCellsDisplayProps) {
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const changingCellsKey = changingCells.join('\0');

  useEffect(() => {
    let cancelled = false;
    const ws = workbook.getSheetById(activeSheetId);
    void Promise.all(
      changingCells.map(async (cellId) => {
        const pos = await ws._internal.getCellPosition(cellId);
        return [cellId, pos ? toA1(pos.row, pos.col) : '(deleted)'] as const;
      }),
    ).then((entries) => {
      if (!cancelled) {
        setLabels(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeSheetId, changingCellsKey, workbook]);

  if (changingCells.length === 0) {
    return <span className="text-ss-text-secondary">None</span>;
  }

  return (
    <div className="flex flex-col gap-1 max-h-20 overflow-y-auto">
      {changingCells.map((cellId, index) => (
        <div key={cellId} className="flex justify-between text-body-sm">
          <span className="text-ss-text-secondary">{labels[cellId] ?? 'Resolving...'}:</span>
          <span>{formatValue(values[index])}</span>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ScenarioManagerDialog() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const activeCell = useActiveCell();

  // Get state from UIStore
  const isOpen = useUIStore((s) => s.scenarioManagerDialog.isOpen);
  const selectedScenarioId = useUIStore((s) => s.scenarioManagerDialog.selectedScenarioId);
  const mode = useUIStore((s) => s.scenarioManagerDialog.mode);
  const editingName = useUIStore((s) => s.scenarioManagerDialog.editingName);
  const editingComment = useUIStore((s) => s.scenarioManagerDialog.editingComment);
  const editingChangingCells = useUIStore((s) => s.scenarioManagerDialog.editingChangingCells);
  const originalValuesBeforeScenario = useUIStore(
    (s) => s.scenarioManagerDialog.originalValuesBeforeScenario,
  );
  const activelyShownScenarioId = useUIStore(
    (s) => s.scenarioManagerDialog.activelyShownScenarioId,
  );
  const validationErrors = useUIStore((s) => s.scenarioManagerDialog.validationErrors);
  const isProcessing = useUIStore((s) => s.scenarioManagerDialog.isProcessing);

  // Get actions from UIStore
  const closeDialog = useUIStore((s) => s.closeScenarioManagerDialog);
  const selectScenario = useUIStore((s) => s.selectScenario);
  const startAddingScenario = useUIStore((s) => s.startAddingScenario);
  const startEditingScenario = useUIStore((s) => s.startEditingScenario);
  const cancelEditingScenario = useUIStore((s) => s.cancelEditingScenario);
  const setEditingName = useUIStore((s) => s.setEditingName);
  const setEditingComment = useUIStore((s) => s.setEditingComment);
  const setEditingChangingCells = useUIStore((s) => s.setEditingChangingCells);
  const updateEditingChangingCellValue = useUIStore((s) => s.updateEditingChangingCellValue);
  const setValidationError = useUIStore((s) => s.setValidationError);
  const clearAllValidationErrors = useUIStore((s) => s.clearAllValidationErrors);
  const storeOriginalValues = useUIStore((s) => s.storeOriginalValues);
  const setActivelyShownScenarioId = useUIStore((s) => s.setActivelyShownScenarioId);
  const clearOriginalValues = useUIStore((s) => s.clearOriginalValues);
  const setProcessing = useUIStore((s) => s.setProcessing);

  // Load scenarios from Workbook API (async)
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const refreshScenarios = useCallback(async () => {
    const data = await wb.scenarios.list();
    setScenarios(data as Scenario[]);
    return data as Scenario[];
  }, [wb]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function loadScenarios() {
      try {
        const data = await refreshScenarios();
        if (!cancelled) setScenarios(data as Scenario[]);
      } catch (err) {
        console.error('Failed to load scenarios:', err);
      }
    }
    loadScenarios();
    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshScenarios]);

  // Get selected scenario details
  const selectedScenario = useMemo(() => {
    if (!selectedScenarioId) return null;
    return scenarios.find((s) => s.id === selectedScenarioId) ?? null;
  }, [scenarios, selectedScenarioId]);

  // Auto-select first scenario when dialog opens
  useEffect(() => {
    if (isOpen && !selectedScenarioId && scenarios.length > 0) {
      selectScenario(scenarios[0].id);
    }
  }, [isOpen, selectedScenarioId, scenarios, selectScenario]);

  // Handle close
  const handleClose = useCallback(() => {
    closeDialog();
    clearAllValidationErrors();
  }, [closeDialog, clearAllValidationErrors]);

  // Handle Add button
  const handleAdd = useCallback(async () => {
    startAddingScenario();
    clearAllValidationErrors();
    try {
      const ws = wb.getSheetById(activeSheetId);
      const cellId = await ws._internal.getOrCreateCellId(activeCell.row, activeCell.col);
      const cell = await ws.getCell(activeCell.row, activeCell.col);
      setEditingChangingCells([
        {
          cellId: toCellId(cellId),
          sheetId: activeSheetId,
          displayRef: toA1(activeCell.row, activeCell.col),
          value: (cell.value ?? null) as CellValue,
        },
      ]);
    } catch (err) {
      setValidationError('general', String(err));
    }
  }, [
    activeCell.col,
    activeCell.row,
    activeSheetId,
    clearAllValidationErrors,
    setEditingChangingCells,
    setValidationError,
    startAddingScenario,
    wb,
  ]);

  // Handle Delete button
  const handleDelete = useCallback(async () => {
    if (!selectedScenarioId) return;

    setProcessing(true);
    try {
      // If deleting the active scenario, restore original values first.
      if (selectedScenarioId === activelyShownScenarioId) {
        await wb.scenarios.restore(mapToOriginalCellValues(originalValuesBeforeScenario));
        clearOriginalValues();
      }
      await wb.scenarios.remove(selectedScenarioId);
      const next = await refreshScenarios();
      selectScenario(next[0]?.id ?? null);
    } catch (err) {
      setValidationError('general', String(err));
    } finally {
      setProcessing(false);
    }
  }, [
    selectedScenarioId,
    wb,
    activelyShownScenarioId,
    originalValuesBeforeScenario,
    clearOriginalValues,
    selectScenario,
    refreshScenarios,
    setProcessing,
    setValidationError,
  ]);

  // Handle Edit button
  const handleEdit = useCallback(() => {
    if (!selectedScenario) return;
    startEditingScenario(selectedScenario);
  }, [selectedScenario, startEditingScenario]);

  // Handle Show button (apply scenario)
  const handleShow = useCallback(async () => {
    if (!selectedScenario) return;

    setProcessing(true);

    try {
      const result = await wb.scenarios.apply(selectedScenario.id);

      // Merge new originals with any already saved (preserves first-ever originals)
      const merged = mergeOriginals(originalValuesBeforeScenario, result.originalValues);
      storeOriginalValues(merged);
      setActivelyShownScenarioId(selectedScenario.id);
    } catch (err) {
      setValidationError('general', String(err));
    }

    setProcessing(false);
  }, [
    selectedScenario,
    wb,
    originalValuesBeforeScenario,
    storeOriginalValues,
    setActivelyShownScenarioId,
    setProcessing,
    setValidationError,
  ]);

  // Handle Restore button
  const handleRestore = useCallback(async () => {
    setProcessing(true);

    try {
      await wb.scenarios.restore(mapToOriginalCellValues(originalValuesBeforeScenario));
      clearOriginalValues();
    } catch (err) {
      setValidationError('general', String(err));
    }

    setProcessing(false);
  }, [wb, originalValuesBeforeScenario, clearOriginalValues, setProcessing, setValidationError]);

  // Handle Save (for add/edit mode)
  const handleSave = useCallback(async () => {
    // Validate
    if (!editingName.trim()) {
      setValidationError('name', 'Scenario name is required');
      return;
    }

    if (mode === 'add' && editingChangingCells.length === 0) {
      setValidationError('changingCells', 'At least one changing cell is required');
      return;
    }

    clearAllValidationErrors();
    setProcessing(true);

    try {
      if (mode === 'add') {
        const scenarioId = await wb.scenarios.add({
          name: editingName.trim(),
          comment: editingComment,
          changingCells: editingChangingCells.map((cell: EditingChangingCell) => cell.cellId),
          values: editingChangingCells.map((cell: EditingChangingCell) => cell.value),
        });
        const next = await refreshScenarios();
        selectScenario(scenarioId || next[0]?.id || null);
      } else if (mode === 'edit' && selectedScenarioId) {
        await wb.scenarios.update(selectedScenarioId, {
          name: editingName.trim(),
          comment: editingComment,
        });
        await refreshScenarios();
      }
      cancelEditingScenario();
    } catch (err) {
      setValidationError('general', String(err));
    } finally {
      setProcessing(false);
    }
  }, [
    wb,
    mode,
    editingName,
    editingComment,
    editingChangingCells,
    selectedScenarioId,
    selectScenario,
    setValidationError,
    clearAllValidationErrors,
    cancelEditingScenario,
    refreshScenarios,
    setProcessing,
  ]);

  // Handle Cancel (for add/edit mode)
  const handleCancel = useCallback(() => {
    cancelEditingScenario();
    clearAllValidationErrors();
  }, [cancelEditingScenario, clearAllValidationErrors]);

  if (!isOpen) return null;

  const nameError = validationErrors.get('name');
  const generalError = validationErrors.get('general');
  const hasActiveScenario = activelyShownScenarioId !== null;
  const canShow = selectedScenario !== null && !isProcessing;
  const canDelete = selectedScenario !== null && !isProcessing;
  const canEdit = selectedScenario !== null && !isProcessing;

  return (
    <Dialog
      onEnterKeyDown={handleClose}
      open={isOpen}
      onClose={handleClose}
      dialogId="scenario-manager-dialog"
      width="md"
    >
      <DialogHeader onClose={handleClose}>Scenario Manager</DialogHeader>

      <DialogBody>
        {mode === 'view' ? (
          // View mode - show scenario list and details
          <div className="flex flex-col gap-4">
            {/* Scenario list */}
            <div className="flex flex-col gap-1">
              <label className="text-body-sm text-ss-text-secondary font-medium">Scenarios:</label>
              <ScenarioList
                scenarios={scenarios}
                selectedId={selectedScenarioId}
                activeId={activelyShownScenarioId}
                onSelect={selectScenario}
              />
            </div>

            {/* Action buttons for list */}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleAdd} disabled={isProcessing}>
                Add...
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDelete} disabled={!canDelete}>
                Delete
              </Button>
              <Button variant="secondary" size="sm" onClick={handleEdit} disabled={!canEdit}>
                Edit...
              </Button>
            </div>

            {/* Selected scenario details */}
            {selectedScenario && (
              <div className="flex flex-col gap-2 border-t border-ss-border pt-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-body-xs text-ss-text-secondary">Comment:</span>
                  <span className="text-body-sm">{selectedScenario.comment || '(none)'}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-body-xs text-ss-text-secondary">Changing cells:</span>
                  <ChangingCellsDisplay
                    changingCells={selectedScenario.changingCells.map(toCellId)}
                    values={selectedScenario.values}
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {generalError && <div className="text-body-sm text-ss-text-error">{generalError}</div>}
          </div>
        ) : (
          // Add/Edit mode - show form
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="scenario-name" className="text-body-sm text-ss-text-secondary">
                Scenario Name:
              </label>
              <Input
                id="scenario-name"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                placeholder="Enter scenario name"
                autoFocus
              />
              {nameError && <span className="text-body-xs text-ss-text-error">{nameError}</span>}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="scenario-comment" className="text-body-sm text-ss-text-secondary">
                Comment:
              </label>
              <Input
                id="scenario-comment"
                value={editingComment}
                onChange={(e) => setEditingComment(e.target.value)}
                placeholder="Enter a description (optional)"
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-body-sm text-ss-text-secondary">Changing cells:</span>
              {editingChangingCells.length === 0 ? (
                <div className="text-body-xs text-ss-text-error">
                  Select a cell in the grid before adding a scenario.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {editingChangingCells.map((cell: EditingChangingCell, index: number) => (
                    <div key={cell.cellId} className="grid grid-cols-[96px_1fr] items-center gap-2">
                      <span className="text-body-sm text-ss-text-secondary">{cell.displayRef}</span>
                      <Input
                        value={formatValue(cell.value)}
                        onChange={(e) =>
                          updateEditingChangingCellValue(index, parseScenarioValue(e.target.value))
                        }
                        aria-label={`Value for ${cell.displayRef}`}
                      />
                    </div>
                  ))}
                </div>
              )}
              {validationErrors.get('changingCells') && (
                <span className="text-body-xs text-ss-text-error">
                  {validationErrors.get('changingCells')}
                </span>
              )}
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        {mode === 'view' ? (
          <>
            <Button variant="primary" onClick={handleShow} disabled={!canShow}>
              Show
            </Button>
            {hasActiveScenario && (
              <Button variant="secondary" onClick={handleRestore} disabled={isProcessing}>
                Restore
              </Button>
            )}
            <Button variant="secondary" onClick={handleClose}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={handleSave} disabled={isProcessing}>
              {mode === 'add' ? 'Add' : 'OK'}
            </Button>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
