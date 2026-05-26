/**
 * Select Data Dialog
 *
 * Select Data Dialog for Charts
 *
 * Full dialog for editing chart data range and series management.
 * Implements Excel's "Select Data" dialog functionality:
 * - Data range input with range selector button
 * - Visual range highlight on sheet (via RangeSelectionMode)
 * - Add/Edit/Remove series functionality
 * - Move Up/Down series order
 * - Switch Row/Column toggle
 * - Hidden and empty cells options
 *
 * Architecture:
 * - All user interactions use dispatch() from Unified Action System
 * - Dialog state managed in UIStore (select-data-dialog slice)
 * - Range selection uses RangeSelectionMode slice for collapsed inputs
 * - Chart data updates go through Charts domain module via action handler
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Dialog patterns
 */

import { useCallback, useState } from 'react';
import {
  CollapsibleRangeInput,
  dispatch,
  MinimizableDialog,
  useActionDependencies,
  useUIStore,
} from '../../internal-api';

import {
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  Input,
  Label,
  Select,
} from '@mog/shell';

// =============================================================================
// Constants
// =============================================================================

const EMPTY_CELLS_OPTIONS = [
  { value: 'gaps', label: 'Gaps' },
  { value: 'zero', label: 'Zero' },
  { value: 'connect', label: 'Connect data points with line' },
];

// =============================================================================
// Component
// =============================================================================

export function SelectDataDialog() {
  const deps = useActionDependencies();

  // UI Store state
  const dialogState = useUIStore((s) => s.selectDataDialog);
  const { isOpen, chartId, dataRange, series, orientation, hiddenEmptyCells } = dialogState;

  // UI Store actions
  const setSelectDataRange = useUIStore((s) => s.setSelectDataRange);
  const addSelectDataSeries = useUIStore((s) => s.addSelectDataSeries);
  const updateSelectDataSeries = useUIStore((s) => s.updateSelectDataSeries);
  const removeSelectDataSeries = useUIStore((s) => s.removeSelectDataSeries);
  const moveSelectDataSeriesUp = useUIStore((s) => s.moveSelectDataSeriesUp);
  const moveSelectDataSeriesDown = useUIStore((s) => s.moveSelectDataSeriesDown);
  const toggleSelectDataOrientation = useUIStore((s) => s.toggleSelectDataOrientation);
  const updateSelectDataHiddenEmptyCells = useUIStore((s) => s.updateSelectDataHiddenEmptyCells);

  // Local state for edit series dialog
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editSeriesName, setEditSeriesName] = useState('');
  const [editSeriesRange, setEditSeriesRange] = useState('');
  const [editSeriesCategoryRange, setEditSeriesCategoryRange] = useState('');

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * Handle Cancel - close without applying changes
   */
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_SELECT_DATA_DIALOG', deps);
  }, [deps]);

  /**
   * Handle OK - apply changes and close
   */
  const handleOk = useCallback(() => {
    dispatch('APPLY_SELECT_DATA', deps);
  }, [deps]);

  /**
   * Handle data range change
   */
  const handleDataRangeChange = useCallback(
    (value: string) => {
      setSelectDataRange(value);
    },
    [setSelectDataRange],
  );

  /**
   * Add new series
   */
  const handleAddSeries = useCallback(() => {
    // Open mini dialog for series entry
    setEditingSeriesId('new');
    setEditSeriesName(`Series ${series.length + 1}`);
    setEditSeriesRange('');
    setEditSeriesCategoryRange('');
  }, [series.length]);

  /**
   * Edit existing series
   */
  const handleEditSeries = useCallback(
    (seriesId: string) => {
      const s = series.find((item: { id: string }) => item.id === seriesId);
      if (!s) return;

      setEditingSeriesId(seriesId);
      setEditSeriesName(s.name);
      setEditSeriesRange(s.range);
      setEditSeriesCategoryRange(s.categoryRange || '');
    },
    [series],
  );

  /**
   * Remove series
   */
  const handleRemoveSeries = useCallback(
    (seriesId: string) => {
      removeSelectDataSeries(seriesId);
    },
    [removeSelectDataSeries],
  );

  /**
   * Save series edit
   */
  const handleSaveSeriesEdit = useCallback(() => {
    if (!editingSeriesId) return;

    if (editingSeriesId === 'new') {
      // Add new series
      addSelectDataSeries({
        name: editSeriesName,
        range: editSeriesRange,
        categoryRange: editSeriesCategoryRange || undefined,
      });
    } else {
      // Update existing series
      updateSelectDataSeries(editingSeriesId, {
        name: editSeriesName,
        range: editSeriesRange,
        categoryRange: editSeriesCategoryRange || undefined,
      });
    }

    // Close edit dialog
    setEditingSeriesId(null);
  }, [
    editingSeriesId,
    editSeriesName,
    editSeriesRange,
    editSeriesCategoryRange,
    addSelectDataSeries,
    updateSelectDataSeries,
  ]);

  /**
   * Cancel series edit
   */
  const handleCancelSeriesEdit = useCallback(() => {
    setEditingSeriesId(null);
  }, []);

  /**
   * Move series up
   */
  const handleMoveSeriesUp = useCallback(
    (seriesId: string) => {
      moveSelectDataSeriesUp(seriesId);
    },
    [moveSelectDataSeriesUp],
  );

  /**
   * Move series down
   */
  const handleMoveSeriesDown = useCallback(
    (seriesId: string) => {
      moveSelectDataSeriesDown(seriesId);
    },
    [moveSelectDataSeriesDown],
  );

  /**
   * Toggle orientation
   */
  const handleToggleOrientation = useCallback(() => {
    toggleSelectDataOrientation();
  }, [toggleSelectDataOrientation]);

  /**
   * Handle empty cells option change
   */
  const handleEmptyCellsChange = useCallback(
    (value: string) => {
      updateSelectDataHiddenEmptyCells({
        emptyCells: value as 'gaps' | 'zero' | 'connect',
      });
    },
    [updateSelectDataHiddenEmptyCells],
  );

  /**
   * Handle show hidden data toggle
   */
  const handleShowHiddenDataToggle = useCallback(
    (checked: boolean) => {
      updateSelectDataHiddenEmptyCells({
        showHiddenData: checked,
      });
    },
    [updateSelectDataHiddenEmptyCells],
  );

  // Don't render if not open
  if (!isOpen || !chartId) return null;

  // ==========================================================================
  // Render Edit Series Dialog
  // ==========================================================================

  if (editingSeriesId) {
    return (
      <MinimizableDialog
        onEnterKeyDown={handleSaveSeriesEdit}
        open={true}
        onClose={handleCancelSeriesEdit}
        dialogId="edit-series-dialog"
        parentDialogId="select-data-dialog"
        title={editingSeriesId === 'new' ? 'Add Series' : 'Edit Series'}
        width={480}
      >
        <DialogHeader onClose={handleCancelSeriesEdit}>
          {editingSeriesId === 'new' ? 'Add Series' : 'Edit Series'}
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            {/* Series Name */}
            <div>
              <Label htmlFor="series-name">Series name</Label>
              <Input
                id="series-name"
                value={editSeriesName}
                onChange={(e) => setEditSeriesName(e.target.value)}
                placeholder="Series 1"
              />
            </div>

            {/* Series Values Range */}
            <div>
              <Label htmlFor="series-values-range">Series values</Label>
              <CollapsibleRangeInput
                id="series-values-range"
                value={editSeriesRange}
                onChange={(value) => setEditSeriesRange(value)}
                dialogId="edit-series-dialog"
                inputId="series-values-range"
                placeholder="Sheet1!$A$1:$A$10"
                label="Series values"
              />
            </div>

            {/* Category (X-axis) Range */}
            <div>
              <Label htmlFor="category-range">Category (X) labels (optional)</Label>
              <CollapsibleRangeInput
                id="category-range"
                value={editSeriesCategoryRange}
                onChange={(value) => setEditSeriesCategoryRange(value)}
                dialogId="edit-series-dialog"
                inputId="category-range"
                placeholder="Sheet1!$B$1:$B$10"
                label="Category (X) labels"
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={handleCancelSeriesEdit}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveSeriesEdit}>
            OK
          </Button>
        </DialogFooter>
      </MinimizableDialog>
    );
  }

  // ==========================================================================
  // Render Main Select Data Dialog
  // ==========================================================================

  return (
    <MinimizableDialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleCancel}
      dialogId="select-data-dialog"
      title="Select Data Source"
      width={720}
    >
      <DialogHeader onClose={handleCancel}>Select Data Source</DialogHeader>

      <DialogBody>
        <div className="space-y-6">
          {/* Chart data range */}
          <div>
            <Label htmlFor="chart-data-range">Chart data range</Label>
            <CollapsibleRangeInput
              id="chart-data-range"
              value={dataRange}
              onChange={handleDataRangeChange}
              dialogId="select-data-dialog"
              inputId="chart-data-range"
              placeholder="Sheet1!$A$1:$D$10"
              label="Chart data range"
            />
          </div>

          {/* Switch Row/Column */}
          <div className="flex items-center gap-4">
            <Button variant="secondary" size="sm" onClick={handleToggleOrientation}>
              Switch Row/Column
            </Button>
            <span className="text-body-sm text-ss-text-secondary">
              Data series in: <strong>{orientation === 'rows' ? 'Rows' : 'Columns'}</strong>
            </span>
          </div>

          {/* Series List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Legend Entries (Series)</Label>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleAddSeries}>
                  Add
                </Button>
              </div>
            </div>

            {/* Series List Table */}
            <div className="border border-ss-border rounded-ss-md">
              {series.length === 0 ? (
                <div className="p-4 text-center text-body-sm text-ss-text-secondary">
                  No series defined. Click Add to create one.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {series.map(
                    (
                      item: { id: string; name: string; range: string; categoryRange?: string },
                      index: number,
                    ) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 p-2 hover:bg-ss-surface-tertiary transition-colors"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-body-sm">{item.name}</div>
                          <div className="text-caption text-ss-text-secondary truncate">
                            {item.range}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <IconButton
                            icon="edit"
                            size="sm"
                            onClick={() => handleEditSeries(item.id)}
                            title="Edit series"
                          />
                          <IconButton
                            icon="delete"
                            size="sm"
                            onClick={() => handleRemoveSeries(item.id)}
                            title="Remove series"
                            disabled={series.length === 1}
                          />
                          <IconButton
                            icon="chevron-up"
                            size="sm"
                            onClick={() => handleMoveSeriesUp(item.id)}
                            title="Move up"
                            disabled={index === 0}
                          />
                          <IconButton
                            icon="chevron-down"
                            size="sm"
                            onClick={() => handleMoveSeriesDown(item.id)}
                            title="Move down"
                            disabled={index === series.length - 1}
                          />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Hidden and Empty Cell Settings */}
          <div className="border-t border-ss-border pt-4 space-y-3">
            <Label>Hidden and Empty Cell Settings</Label>

            <div>
              <Label htmlFor="empty-cells-option" className="text-body-sm">
                Show empty cells as
              </Label>
              <Select
                id="empty-cells-option"
                size="sm"
                value={hiddenEmptyCells.emptyCells}
                onChange={handleEmptyCellsChange}
                options={EMPTY_CELLS_OPTIONS}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="show-hidden-data"
                checked={hiddenEmptyCells.showHiddenData}
                onChange={handleShowHiddenDataToggle}
                label="Show data in hidden rows and columns"
              />
            </div>
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}
