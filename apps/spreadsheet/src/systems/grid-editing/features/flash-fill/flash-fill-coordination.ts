/**
 * Flash Fill Coordinator
 *
 * Coordinates Flash Fill pattern detection and preview display.
 * Detects when user is typing in a column that could benefit from Flash Fill
 * and shows ghosted preview values in cells below.
 *
 * Architecture:
 * - Subscribes to editor machine state transitions
 * - Detects pattern matches when user commits cell edits
 * - Shows preview via UIStore flashFillPreview state
 * - Coordinator owns side effects; flash-fill-engine is pure pattern detection
 *
 * Flow:
 * 1. User types in a cell adjacent to data columns
 * 2. On commit (Tab/Enter), coordinator analyzes for patterns
 * 3. If pattern detected with sufficient confidence, show preview
 * 4. Preview values rendered as ghosted text in cells-layer
 * 5. Accept (Enter/Tab) applies values, Reject (Escape/continue typing) dismisses
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md Section 4: State Machine / Coordinator Pattern
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { StoreApi } from 'zustand';

import type { FlashFillPreviewValue } from '@mog-sdk/contracts/fill';
import {
  DEFAULT_FLASH_FILL_CONFIG,
  detectFlashFillPattern,
  type FlashFillContext,
  type FlashFillExample,
} from '../../../../domain/fill/flash-fill';
import type { GridEditingUIStore } from '../../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for Flash Fill Coordinator.
 */
export interface FlashFillCoordinatorDependencies {
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** UI Store for preview state */
  uiStore: StoreApi<GridEditingUIStore>;
  /** Get active sheet ID */
  getActiveSheetId: () => SheetId;
}

/**
 * Configuration for Flash Fill detection.
 */
export interface FlashFillDetectionConfig {
  /** Minimum number of examples required before showing preview */
  minExamples: number;
  /** Minimum confidence threshold (0-1) to show preview */
  minConfidence: number;
  /** Maximum source columns to analyze */
  maxSourceColumns: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_DETECTION_CONFIG: FlashFillDetectionConfig = {
  // Auto-preview is intentionally stricter than explicit Ctrl+E Flash Fill.
  // A single example is enough when the user asks for Flash Fill; passive
  // suggestions need a second example to avoid surfacing during ordinary entry.
  minExamples: 2,
  minConfidence: 0.8,
  maxSourceColumns: 5,
};

// =============================================================================
// Flash Fill Coordinator Class
// =============================================================================

/**
 * FlashFillCoordinator - Coordinates Flash Fill Preview Display
 *
 * Usage:
 * ```typescript
 * const coordinator = new FlashFillCoordinator();
 * coordinator.setDependencies({ ctx, uiStore, getActiveSheetId });
 *
 * // Check for patterns after cell edit
 * coordinator.checkForPatternOnCellCommit(row, col);
 *
 * // Accept preview
 * coordinator.acceptPreview();
 *
 * // Reject preview
 * coordinator.rejectPreview();
 *
 * // Cleanup
 * coordinator.dispose();
 * ```
 */
export class FlashFillCoordinator {
  private deps: FlashFillCoordinatorDependencies | null = null;
  private config: FlashFillDetectionConfig = DEFAULT_DETECTION_CONFIG;
  private detectionGeneration = 0;

  constructor(config?: Partial<FlashFillDetectionConfig>) {
    if (config) {
      this.config = { ...DEFAULT_DETECTION_CONFIG, ...config };
    }
  }

  // ===========================================================================
  // Dependency Injection
  // ===========================================================================

  /**
   * Set dependencies for the coordinator.
   */
  setDependencies(deps: FlashFillCoordinatorDependencies): void {
    this.deps = deps;
  }

  /**
   * Check if dependencies are set.
   */
  hasDependencies(): boolean {
    return this.deps !== null;
  }

  /**
   * Clean up the coordinator.
   */
  dispose(): void {
    this.hidePreview();
    this.deps = null;
  }

  // ===========================================================================
  // Pattern Detection
  // ===========================================================================

  /**
   * Check for Flash Fill patterns after a cell is committed.
   * Called by editor-execution when user commits a cell edit.
   *
   * @param row - Row of the committed cell
   * @param col - Column of the committed cell
   */
  checkForPatternOnCellCommit(row: number, col: number): void {
    if (!this.deps) return;

    const { uiStore, getActiveSheetId } = this.deps;
    const sheetId = getActiveSheetId();
    const generation = this.beginDetection();

    // Check if there's already a preview showing - if user is typing in same column, keep it
    const currentPreview = uiStore.getState().flashFillPreview;
    if (currentPreview.isShowingPreview && currentPreview.targetColumn === col) {
      // User is typing in the preview column - re-check pattern
      void this.detectAndShowPreview(sheetId, col, row, generation);
      return;
    }

    // New cell commit - check for patterns
    void this.detectAndShowPreview(sheetId, col, row, generation);
  }

  /**
   * Detect Flash Fill pattern and show preview if found.
   *
   * Uses fallback logic for header rows: if initial pattern detection fails
   * and we have 2+ examples, retry without the first example (possible header).
   */
  private async detectAndShowPreview(
    sheetId: SheetId,
    targetCol: number,
    activeRow: number,
    generation: number,
  ): Promise<void> {
    if (!this.deps) return;

    const { uiStore } = this.deps;

    // Determine source columns (adjacent columns)
    const sourceColumns = this.getSourceColumns(targetCol);
    if (sourceColumns.length === 0) {
      this.hidePreviewForCurrentDetection(generation, sheetId);
      return;
    }

    // Find data extent
    const { startRow, endRow } = await this.findColumnDataExtent(
      sheetId,
      sourceColumns[0],
      activeRow,
    );
    if (!this.isCurrentDetection(generation, sheetId)) return;
    if (startRow === endRow) {
      this.hidePreviewForCurrentDetection(generation, sheetId);
      return;
    }

    // Collect examples (rows with values in target column)
    const examples = await this.collectExamples(
      sheetId,
      targetCol,
      startRow,
      endRow,
      sourceColumns,
    );
    if (!this.isCurrentDetection(generation, sheetId)) return;
    if (examples.length < this.config.minExamples) {
      // Not enough examples - hide any existing preview
      this.hidePreviewForCurrentDetection(generation, sheetId);
      return;
    }

    // Collect source data for all rows
    const sourceData = await this.collectSourceData(sheetId, sourceColumns, startRow, endRow);
    if (!this.isCurrentDetection(generation, sheetId)) return;

    // Build context for pattern detection
    const context: FlashFillContext = {
      targetColumn: targetCol,
      startRow,
      endRow,
      examples,
      sourceData,
      sheetId,
    };

    // Track effective start row for fallback logic
    let effectiveStartRow = startRow;

    // Detect pattern
    let result = detectFlashFillPattern(context, {
      ...DEFAULT_FLASH_FILL_CONFIG,
      minExamples: this.config.minExamples,
      minConfidence: this.config.minConfidence,
    });

    // Fallback logic: if pattern detection failed and we have 2+ examples,
    // retry without the first example (possible header row)
    if (!result.success && examples.length >= 2) {
      effectiveStartRow = startRow + 1;
      const fallbackExamples = examples.slice(1);

      // Recollect source data with new start row (critical for correct array indexing)
      const fallbackSourceData = await this.collectSourceData(
        sheetId,
        sourceColumns,
        effectiveStartRow,
        endRow,
      );
      if (!this.isCurrentDetection(generation, sheetId)) return;

      const fallbackContext: FlashFillContext = {
        targetColumn: targetCol,
        startRow: effectiveStartRow,
        endRow,
        examples: fallbackExamples,
        sourceData: fallbackSourceData,
        sheetId,
      };

      result = detectFlashFillPattern(fallbackContext, {
        ...DEFAULT_FLASH_FILL_CONFIG,
        minExamples: this.config.minExamples,
        minConfidence: this.config.minConfidence,
      });
    }

    if (!result.success || !result.values || !result.filledRows) {
      // No pattern detected - hide preview
      this.hidePreviewForCurrentDetection(generation, sheetId);
      return;
    }

    // Convert to preview values
    // Use effectiveStartRow for correct row alignment when fallback was used
    const previewValues: FlashFillPreviewValue[] = [];
    for (let i = 0; i < result.filledRows.length; i++) {
      const row = result.filledRows[i];
      const valueIndex = row - effectiveStartRow;
      const value = result.values[valueIndex];
      if (value !== undefined && value !== '') {
        previewValues.push({ row, col: targetCol, value });
      }
    }

    if (previewValues.length === 0) {
      this.hidePreviewForCurrentDetection(generation, sheetId);
      return;
    }

    if (!this.isCurrentDetection(generation, sheetId)) return;

    // Show preview
    // Note: startRow/endRow in preview state use original values for UI consistency
    uiStore.getState().showFlashFillPreview({
      sheetId,
      sourceColumn: sourceColumns[0],
      targetColumn: targetCol,
      previewValues,
      patternDescription: result.pattern?.description || 'Pattern detected',
      confidence: result.pattern?.confidence || 0,
      startRow,
      endRow,
    });
  }

  // ===========================================================================
  // Accept/Reject Preview
  // ===========================================================================

  /**
   * Accept the current Flash Fill preview and apply values.
   * Returns the values that were applied.
   */
  acceptPreview(): FlashFillPreviewValue[] | null {
    if (!this.deps) return null;

    const { uiStore } = this.deps;
    const preview = uiStore.getState().flashFillPreview;

    if (!preview.isShowingPreview) return null;

    // Get the values to apply
    const values = [...preview.previewValues];

    // Hide the preview
    this.hidePreview();

    return values;
  }

  /**
   * Reject/hide the current Flash Fill preview.
   */
  rejectPreview(): void {
    this.hidePreview();
  }

  /**
   * Hide the Flash Fill preview.
   */
  hidePreview(): void {
    this.detectionGeneration += 1;
    if (!this.deps) return;
    this.deps.uiStore.getState().hideFlashFillPreview();
  }

  /**
   * Check if preview is currently showing.
   */
  isPreviewShowing(): boolean {
    if (!this.deps) return false;
    return this.deps.uiStore.getState().flashFillPreview.isShowingPreview;
  }

  /**
   * Get current preview values.
   */
  getPreviewValues(): FlashFillPreviewValue[] {
    if (!this.deps) return [];
    return this.deps.uiStore.getState().flashFillPreview.previewValues;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get source columns (adjacent columns to the target).
   */
  private getSourceColumns(targetCol: number): number[] {
    const sourceColumns: number[] = [];

    // Add columns to the left (most likely sources)
    for (let i = 1; i <= this.config.maxSourceColumns && targetCol - i >= 0; i++) {
      sourceColumns.push(targetCol - i);
    }

    // Add columns to the right as fallback
    for (let i = 1; i <= this.config.maxSourceColumns - sourceColumns.length; i++) {
      sourceColumns.push(targetCol + i);
    }

    return sourceColumns;
  }

  private beginDetection(): number {
    this.detectionGeneration += 1;
    return this.detectionGeneration;
  }

  private isCurrentDetection(generation: number, sheetId: SheetId): boolean {
    if (!this.deps || generation !== this.detectionGeneration) return false;
    return this.deps.getActiveSheetId() === sheetId;
  }

  private hidePreviewForCurrentDetection(generation: number, sheetId: SheetId): void {
    if (!this.isCurrentDetection(generation, sheetId)) return;
    this.hidePreview();
  }

  /**
   * Find the extent of data in a column.
   * Uses Worksheet API getCell() to scan for data extent.
   */
  private async findColumnDataExtent(
    sheetId: SheetId,
    col: number,
    activeRow: number,
  ): Promise<{ startRow: number; endRow: number }> {
    if (!this.deps?.workbook) return { startRow: activeRow, endRow: activeRow };
    const ws = this.deps.workbook.getSheetById(sheetId);
    const MAX_SCAN = 1000;

    // Scan upward from activeRow
    let startRow = activeRow;
    for (let i = 0; i < MAX_SCAN; i++) {
      const row = activeRow - i - 1;
      if (row < 0) break;
      const cellData = await ws.getCell(row, col);
      const value = cellData.value;
      if (value === null || value === undefined || value === '') break;
      startRow = row;
    }

    // Scan downward from activeRow
    let endRow = activeRow;
    for (let i = 0; i < MAX_SCAN; i++) {
      const row = activeRow + i + 1;
      const cellData = await ws.getCell(row, col);
      const value = cellData.value;
      if (value === null || value === undefined || value === '') break;
      endRow = row;
    }

    return { startRow, endRow };
  }

  /**
   * Collect examples (rows with values in target column).
   * Uses a single ws.getRange() call to fetch the entire rectangular region.
   */
  private async collectExamples(
    sheetId: SheetId,
    targetCol: number,
    startRow: number,
    endRow: number,
    sourceColumns: number[],
  ): Promise<FlashFillExample[]> {
    if (!this.deps?.workbook) return [];
    const ws = this.deps.workbook.getSheetById(sheetId);
    const examples: FlashFillExample[] = [];

    // Fetch the entire region (target column + source columns) in one IPC call
    const allCols = [targetCol, ...sourceColumns];
    const minCol = Math.min(...allCols);
    const maxCol = Math.max(...allCols);
    const rangeData = await ws.getRange(startRow, minCol, endRow, maxCol);

    for (let row = startRow; row <= endRow; row++) {
      const rowOffset = row - startRow;
      const outputCell = rangeData[rowOffset]?.[targetCol - minCol];
      const outputValue = outputCell?.value;

      // Skip empty cells
      if (outputValue === null || outputValue === undefined || outputValue === '') {
        continue;
      }

      // Collect source values
      const sourceValues: CellValue[] = [];
      let hasSource = false;

      for (const sourceCol of sourceColumns) {
        const srcCell = rangeData[rowOffset]?.[sourceCol - minCol];
        const srcValue = srcCell?.value;
        const cellValue: CellValue = srcValue === undefined ? null : srcValue;
        sourceValues.push(cellValue);
        if (srcValue !== null && srcValue !== undefined && srcValue !== '') {
          hasSource = true;
        }
      }

      // Only include rows with both output and at least one source
      if (hasSource) {
        examples.push({
          source: sourceValues,
          output: outputValue,
          row,
        });
      }
    }

    return examples;
  }

  /**
   * Collect source data for all rows.
   * Uses a single ws.getRange() call to fetch the entire source region.
   */
  private async collectSourceData(
    sheetId: SheetId,
    sourceColumns: number[],
    startRow: number,
    endRow: number,
  ): Promise<Map<number, CellValue[]>> {
    if (!this.deps?.workbook) return new Map();
    const ws = this.deps.workbook.getSheetById(sheetId);
    const sourceData = new Map<number, CellValue[]>();

    // Fetch the entire source region in one IPC call
    const minCol = Math.min(...sourceColumns);
    const maxCol = Math.max(...sourceColumns);
    const rangeData = await ws.getRange(startRow, minCol, endRow, maxCol);

    for (const col of sourceColumns) {
      const colOffset = col - minCol;
      const values: CellValue[] = [];
      for (let row = startRow; row <= endRow; row++) {
        const rowOffset = row - startRow;
        const cellData = rangeData[rowOffset]?.[colOffset];
        const val = cellData?.value;
        values.push(val === undefined ? null : val);
      }
      sourceData.set(col, values);
    }

    return sourceData;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Flash Fill coordinator instance.
 */
export function createFlashFillCoordinator(
  config?: Partial<FlashFillDetectionConfig>,
): FlashFillCoordinator {
  return new FlashFillCoordinator(config);
}

// =============================================================================
// Setup Function (Coordinator Pattern)
// =============================================================================

/**
 * Setup Flash Fill coordination.
 * Returns a cleanup function.
 *
 * This follows the coordinator setup pattern from ARCHITECTURE-CHECKLIST.md Section 10.
 */
export function setupFlashFillCoordination(deps: FlashFillCoordinatorDependencies): {
  coordinator: FlashFillCoordinator;
  cleanup: () => void;
} {
  const coordinator = createFlashFillCoordinator();
  coordinator.setDependencies(deps);

  return {
    coordinator,
    cleanup: () => coordinator.dispose(),
  };
}
