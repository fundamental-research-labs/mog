/**
 * Insert Sparkline Dialog
 *
 * A dialog for inserting sparklines into cells.
 * Supports line, column, and win/loss sparkline types.
 *
 * Features:
 * - Data range input with validation
 * - Location range input (where sparklines will be placed)
 * - Type selector (Line, Column, Win/Loss)
 * - Live preview panel
 * - Advanced options (colors, markers, axis settings)
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CollapsibleRangeInput,
  MinimizableDialog,
  useActiveSheetId,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import { letterToCol, toA1 } from '@mog/spreadsheet-utils/a1';
import type {
  SparklineAxisSettings,
  SparklineType,
  SparklineVisualSettings,
} from '@mog-sdk/contracts/sparklines';
// Removed Cells import — using ViewportBuffer for cell reads
import { useSparklineManager } from '../../hooks/data/use-sparkline-manager';
// PERFORMANCE: Use granular hooks instead of useSelection() to avoid re-renders
// on every mouse move during selection drag. Dialogs only need selection data
// when opened, not real-time updates during drag operations.
import {
  Button,
  Checkbox,
  ColorInput,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Label,
  Select,
} from '@mog/shell';
import { useActiveCell } from '../../hooks/selection/use-active-cell';
import { useSelectionRanges } from '../../hooks/selection/use-granular-selection';

// =============================================================================
// Types
// =============================================================================

interface InsertSparklineDialogProps {
  /** Called after sparkline is successfully created */
  onCreated?: () => void;
}

// =============================================================================
// Default Visual Settings
// =============================================================================

const DEFAULT_VISUAL: SparklineVisualSettings = {
  color: 'var(--color-ss-primary)', // design token
  negativeColor: 'var(--color-ss-error)', // design token
  showMarkers: false,
  markerColor: 'var(--color-ss-primary)',
  highPointColor: 'var(--color-ss-success)', // design token
  lowPointColor: 'var(--color-ss-error)', // design token
  firstPointColor: 'var(--color-ss-primary)',
  lastPointColor: 'var(--color-ss-primary)',
  lineWeight: 1.5,
};

const DEFAULT_AXIS_COLOR = '#9ca3af'; // gray-400

const DEFAULT_AXIS: SparklineAxisSettings = {
  minValue: 'auto',
  maxValue: 'auto',
  showAxis: false,
  axisColor: DEFAULT_AXIS_COLOR,
  displayEmptyCells: 'gaps',
  rightToLeft: false,
};

// =============================================================================
// Sparkline Type Icons (SVG)
// =============================================================================

function LineIcon({ color = '#2563eb' }: { color?: string }) {
  return (
    <svg width="48" height="32" viewBox="0 0 48 32">
      <polyline
        points="4,24 12,16 20,20 28,8 36,14 44,10"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ColumnIcon({ color = '#2563eb' }: { color?: string }) {
  return (
    <svg width="48" height="32" viewBox="0 0 48 32">
      <rect x="2" y="16" width="6" height="14" fill={color} rx="1" />
      <rect x="10" y="8" width="6" height="22" fill={color} rx="1" />
      <rect x="18" y="12" width="6" height="18" fill={color} rx="1" />
      <rect x="26" y="4" width="6" height="26" fill={color} rx="1" />
      <rect x="34" y="10" width="6" height="20" fill={color} rx="1" />
      <rect x="42" y="6" width="4" height="24" fill={color} rx="1" />
    </svg>
  );
}

function WinLossIcon({
  color = '#2563eb',
  negativeColor = '#dc2626',
}: {
  color?: string;
  negativeColor?: string;
}) {
  return (
    <svg width="48" height="32" viewBox="0 0 48 32">
      <rect x="2" y="4" width="6" height="12" fill={color} rx="1" />
      <rect x="10" y="4" width="6" height="12" fill={color} rx="1" />
      <rect x="18" y="16" width="6" height="12" fill={negativeColor} rx="1" />
      <rect x="26" y="4" width="6" height="12" fill={color} rx="1" />
      <rect x="34" y="16" width="6" height="12" fill={negativeColor} rx="1" />
      <rect x="42" y="4" width="4" height="12" fill={color} rx="1" />
    </svg>
  );
}

// =============================================================================
// Preview Renderer
// =============================================================================

function renderPreview(
  ctx: CanvasRenderingContext2D,
  type: SparklineType,
  values: number[],
  visual: SparklineVisualSettings,
  showAxis: boolean,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);

  if (values.length === 0) {
    // Draw placeholder
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data to preview', width / 2, height / 2 + 4);
    return;
  }

  const padding = 8;
  const drawX = padding;
  const drawY = padding;
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;

  // Calculate min/max
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  // Calculate axis position
  const axisY = minValue < 0 && maxValue > 0 ? drawY + drawHeight * (maxValue / range) : undefined;

  // Draw axis if enabled
  if (showAxis && axisY !== undefined) {
    ctx.strokeStyle = DEFAULT_AXIS_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(drawX, axisY);
    ctx.lineTo(drawX + drawWidth, axisY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (type === 'line') {
    // Draw line
    ctx.strokeStyle = visual.color;
    ctx.lineWidth = visual.lineWeight ?? 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i < values.length; i++) {
      const x = drawX + (i / (values.length - 1 || 1)) * drawWidth;
      const normalizedY = (values[i] - minValue) / range;
      const y = drawY + drawHeight * (1 - normalizedY);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw markers if enabled
    if (visual.showMarkers) {
      for (let i = 0; i < values.length; i++) {
        const x = drawX + (i / (values.length - 1 || 1)) * drawWidth;
        const normalizedY = (values[i] - minValue) / range;
        const y = drawY + drawHeight * (1 - normalizedY);

        // Determine marker color
        let markerColor = visual.markerColor ?? visual.color;
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);
        if (values[i] === maxVal && visual.highPointColor) {
          markerColor = visual.highPointColor;
        } else if (values[i] === minVal && visual.lowPointColor) {
          markerColor = visual.lowPointColor;
        } else if (i === 0 && visual.firstPointColor) {
          markerColor = visual.firstPointColor;
        } else if (i === values.length - 1 && visual.lastPointColor) {
          markerColor = visual.lastPointColor;
        }

        ctx.fillStyle = markerColor;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (type === 'column') {
    // Draw columns
    const barWidth = (drawWidth / values.length) * 0.7;
    const gap = (drawWidth / values.length) * 0.3;

    for (let i = 0; i < values.length; i++) {
      const x = drawX + (i / values.length) * drawWidth + gap / 2;
      const normalizedY = (values[i] - minValue) / range;
      const barHeight = normalizedY * drawHeight;

      // Color based on positive/negative
      ctx.fillStyle = values[i] >= 0 ? visual.color : (visual.negativeColor ?? '#dc2626');

      if (minValue >= 0) {
        // All positive - draw from bottom
        ctx.fillRect(x, drawY + drawHeight - barHeight, barWidth, barHeight);
      } else if (maxValue <= 0) {
        // All negative - draw from top
        ctx.fillRect(x, drawY, barWidth, barHeight);
      } else {
        // Mixed - draw from axis
        const zeroY = drawY + drawHeight * (maxValue / range);
        if (values[i] >= 0) {
          const h = (values[i] / range) * drawHeight;
          ctx.fillRect(x, zeroY - h, barWidth, h);
        } else {
          const h = Math.abs(values[i] / range) * drawHeight;
          ctx.fillRect(x, zeroY, barWidth, h);
        }
      }
    }
  } else if (type === 'winLoss') {
    // Draw win/loss bars (equal height, position indicates positive/negative)
    const barWidth = (drawWidth / values.length) * 0.7;
    const gap = (drawWidth / values.length) * 0.3;
    const barHeight = drawHeight * 0.4;
    const centerY = drawY + drawHeight / 2;

    for (let i = 0; i < values.length; i++) {
      const x = drawX + (i / values.length) * drawWidth + gap / 2;
      ctx.fillStyle = values[i] >= 0 ? visual.color : (visual.negativeColor ?? '#dc2626');

      if (values[i] >= 0) {
        ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
      } else {
        ctx.fillRect(x, centerY, barWidth, barHeight);
      }
    }

    // Draw axis line
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(drawX, centerY);
    ctx.lineTo(drawX + drawWidth, centerY);
    ctx.stroke();
  }
}

// =============================================================================
// Range Parsing
// =============================================================================

/**
 * Parse a single A1 cell reference like "A1" into row/col.
 * Returns null if invalid (safe version of parseCellAddress).
 */
function parseA1Reference(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;

  const col = letterToCol(match[1]);
  const row = parseInt(match[2], 10) - 1;

  if (row >= 0 && col >= 0) {
    return { row, col };
  }
  return null;
}

/**
 * Parse a range string like "A1:E1" into row/col bounds.
 * Returns null if invalid.
 */
function parseRangeString(
  rangeStr: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  if (!rangeStr) return null;

  const trimmed = rangeStr.trim().toUpperCase();

  // Handle single cell (e.g., "A1")
  const singleRef = parseA1Reference(trimmed);
  if (singleRef) {
    return {
      startRow: singleRef.row,
      startCol: singleRef.col,
      endRow: singleRef.row,
      endCol: singleRef.col,
    };
  }

  // Handle range (e.g., "A1:E1")
  const rangeMatch = trimmed.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (rangeMatch) {
    const startCol = letterToCol(rangeMatch[1]);
    const startRow = parseInt(rangeMatch[2], 10) - 1;
    const endCol = letterToCol(rangeMatch[3]);
    const endRow = parseInt(rangeMatch[4], 10) - 1;

    if (startRow >= 0 && startCol >= 0 && endRow >= 0 && endCol >= 0) {
      return {
        startRow: Math.min(startRow, endRow),
        startCol: Math.min(startCol, endCol),
        endRow: Math.max(startRow, endRow),
        endCol: Math.max(startCol, endCol),
      };
    }
  }

  return null;
}

/**
 * Convert selection to A1 range string.
 */
function selectionToRangeString(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  if (startRow === endRow && startCol === endCol) {
    return toA1(startRow, startCol);
  }
  return `${toA1(startRow, startCol)}:${toA1(endRow, endCol)}`;
}

// =============================================================================
// Empty Cells Options
// =============================================================================

const EMPTY_CELLS_OPTIONS = [
  { value: 'gaps', label: 'Gaps' },
  { value: 'zero', label: 'Zero' },
  { value: 'connect', label: 'Connect data points' },
];

// =============================================================================
// Component
// =============================================================================

export function InsertSparklineDialog({ onCreated }: InsertSparklineDialogProps) {
  const sparklineDialog = useUIStore((s) => s.sparklineDialog);
  const closeDialog = useUIStore((s) => s.closeSparklineDialog);
  const setSparklineType = useUIStore((s) => s.setSparklineType);
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);
  // PERFORMANCE: Use granular hooks - only subscribe to what we need
  const { activeCell } = useActiveCell();
  const ranges = useSelectionRanges();
  const { sparklineManager } = useSparklineManager();

  const {
    isOpen,
    sparklineType,
    dataRange: initialDataRange,
    locationRange: initialLocationRange,
  } = sparklineDialog;

  // Local state
  const [dataRange, setDataRange] = useState('');
  const [locationRange, setLocationRange] = useState('');
  const [dataRangeError, setDataRangeError] = useState<string | null>(null);
  const [locationRangeError, setLocationRangeError] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Visual settings
  const [visual, setVisual] = useState<SparklineVisualSettings>({ ...DEFAULT_VISUAL });
  const [showAxis, setShowAxis] = useState(false);
  const [displayEmptyCells, setDisplayEmptyCells] = useState<'gaps' | 'zero' | 'connect'>('gaps');

  // Group axis settings
  const [useSameAxis, setUseSameAxis] = useState(true);

  // Preview canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Auto-populate from current selection (using granular state)
      if (ranges.length > 0) {
        const range = ranges[0];
        const rangeStr = selectionToRangeString(
          range.startRow,
          range.startCol,
          range.endRow,
          range.endCol,
        );

        // If selection is a single cell, use it as location
        // Otherwise use it as data range
        if (range.startRow === range.endRow && range.startCol === range.endCol) {
          setDataRange(initialDataRange || '');
          setLocationRange(rangeStr);
        } else {
          setDataRange(rangeStr);
          // Default location to one cell after the data range
          const nextCol = Math.max(range.endCol + 1, range.startCol + 1);
          setLocationRange(toA1(range.startRow, nextCol));
        }
      } else {
        setDataRange(initialDataRange || '');
        setLocationRange(initialLocationRange || toA1(activeCell.row, activeCell.col));
      }

      setDataRangeError(null);
      setLocationRangeError(null);
      setCreationError(null);
      setIsCreating(false);
      setShowAdvanced(false);
      setVisual({ ...DEFAULT_VISUAL });
      setShowAxis(false);
      setDisplayEmptyCells('gaps');
      setUseSameAxis(true);
    }
  }, [isOpen, ranges, activeCell, initialDataRange, initialLocationRange]);

  // Check if creating a group (multiple location cells)
  const isCreatingGroup = useMemo(() => {
    const parsedLocation = parseRangeString(locationRange);
    if (!parsedLocation) return false;
    const rowCount = parsedLocation.endRow - parsedLocation.startRow + 1;
    const colCount = parsedLocation.endCol - parsedLocation.startCol + 1;
    return rowCount * colCount > 1;
  }, [locationRange]);

  // Get preview values from Worksheet.viewport (sync, O(1) per cell)
  // Falls back gracefully if cells are outside viewport (returns empty array)
  const previewValues = useMemo(() => {
    const parsed = parseRangeString(dataRange);
    if (!parsed) return [];

    const values: number[] = [];
    const isRow = parsed.endCol - parsed.startCol >= parsed.endRow - parsed.startRow;

    if (isRow) {
      // Data in row (iterate columns)
      for (let col = parsed.startCol; col <= parsed.endCol; col++) {
        const vpCell = ws.viewport.getCellData(parsed.startRow, col);
        if (typeof vpCell?.value === 'number') values.push(vpCell.value);
      }
    } else {
      // Data in column (iterate rows)
      for (let row = parsed.startRow; row <= parsed.endRow; row++) {
        const vpCell = ws.viewport.getCellData(row, parsed.startCol);
        if (typeof vpCell?.value === 'number') values.push(vpCell.value);
      }
    }

    return values;
  }, [dataRange, ws]);

  // Render preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    renderPreview(ctx, sparklineType, previewValues, visual, showAxis, rect.width, rect.height);
  }, [sparklineType, previewValues, visual, showAxis]);

  // Validate ranges
  const validateRanges = useCallback((): boolean => {
    let valid = true;

    const parsedData = parseRangeString(dataRange);
    if (!parsedData) {
      setDataRangeError('Invalid range. Use format like A1:E1 or A1:A10');
      valid = false;
    } else {
      setDataRangeError(null);
    }

    const parsedLocation = parseRangeString(locationRange);
    if (!parsedLocation) {
      setLocationRangeError('Invalid range. Use format like F1 or F1:F10');
      valid = false;
    } else {
      setLocationRangeError(null);
    }

    return valid;
  }, [dataRange, locationRange]);

  // Handle OK button click
  const handleOk = useCallback(async () => {
    if (isCreating) return;
    if (!validateRanges()) return;

    const parsedData = parseRangeString(dataRange);
    const parsedLocation = parseRangeString(locationRange);

    if (!parsedData || !parsedLocation) return;
    setCreationError(null);
    setIsCreating(true);

    // Determine data direction
    const dataInRows =
      parsedData.endCol - parsedData.startCol >= parsedData.endRow - parsedData.startRow;

    // Get location cells
    const locationCells: Array<{ row: number; col: number }> = [];
    for (let row = parsedLocation.startRow; row <= parsedLocation.endRow; row++) {
      for (let col = parsedLocation.startCol; col <= parsedLocation.endCol; col++) {
        locationCells.push({ row, col });
      }
    }

    try {
      // Create sparklines through the same manager/render-state path used by the grid.
      if (locationCells.length === 1) {
        await sparklineManager.createSparkline(
          activeSheetId,
          { sheetId: activeSheetId, ...locationCells[0] },
          {
            startRow: parsedData.startRow,
            startCol: parsedData.startCol,
            endRow: parsedData.endRow,
            endCol: parsedData.endCol,
          },
          sparklineType,
          {
            dataInRows,
            visual,
            axis: {
              ...DEFAULT_AXIS,
              showAxis,
              displayEmptyCells,
            },
          },
        );
      } else {
        // Multiple sparklines - create as group with individual data ranges
        const cells = locationCells.map((c) => c);
        const dataRanges = locationCells.map((_, i) => {
          if (dataInRows) {
            // Each sparkline gets a row
            const row = parsedData.startRow + i;
            return {
              startRow: row,
              startCol: parsedData.startCol,
              endRow: row,
              endCol: parsedData.endCol,
            };
          } else {
            // Each sparkline gets a column
            const col = parsedData.startCol + i;
            return {
              startRow: parsedData.startRow,
              startCol: col,
              endRow: parsedData.endRow,
              endCol: col,
            };
          }
        });

        const cellAddresses = cells.map((c) => ({ sheetId: activeSheetId, ...c }));
        await sparklineManager.createSparklineGroup(
          activeSheetId,
          cellAddresses,
          dataRanges,
          sparklineType,
          {
            dataInRows,
            visual,
            axis: {
              ...DEFAULT_AXIS,
              showAxis,
              displayEmptyCells,
              // Use 'same' for group axis scaling when enabled
              minValue: useSameAxis ? 'same' : 'auto',
              maxValue: useSameAxis ? 'same' : 'auto',
            },
          },
        );
      }

      onCreated?.();
      closeDialog();
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : 'Could not create sparkline');
    } finally {
      setIsCreating(false);
    }
  }, [
    isCreating,
    validateRanges,
    dataRange,
    locationRange,
    sparklineManager,
    activeSheetId,
    sparklineType,
    visual,
    showAxis,
    displayEmptyCells,
    useSameAxis,
    onCreated,
    closeDialog,
  ]);

  // Handle Cancel
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Update visual setting
  const updateVisual = useCallback(
    (key: keyof SparklineVisualSettings, value: string | number | boolean) => {
      setVisual((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  if (!isOpen) return null;

  const isValid =
    dataRange.trim() !== '' &&
    locationRange.trim() !== '' &&
    !dataRangeError &&
    !locationRangeError;

  return (
    <MinimizableDialog
      onEnterKeyDown={() => void handleOk()}
      open={isOpen}
      onClose={handleCancel}
      dialogId="insert-sparkline-dialog"
      title="Insert Sparklines"
      width={520}
    >
      <DialogHeader onClose={handleCancel}>Insert Sparklines</DialogHeader>

      <DialogBody>
        {/* Data Range */}
        <FormField
          label="Data Range"
          error={dataRangeError ?? undefined}
          helpText={!dataRangeError ? 'Select the data range for the sparkline values' : undefined}
        >
          <CollapsibleRangeInput
            value={dataRange}
            onChange={(value) => {
              setDataRange(value);
              setDataRangeError(null);
              setCreationError(null);
            }}
            onBlur={() => validateRanges()}
            placeholder="A1:E1"
            error={!!dataRangeError}
            autoFocus
            dialogId="insert-sparkline-dialog"
            inputId="data-range"
            label="Data Range"
          />
        </FormField>

        {/* Location Range */}
        <FormField
          label="Location Range"
          error={locationRangeError ?? undefined}
          helpText={!locationRangeError ? 'Where the sparkline(s) will be placed' : undefined}
        >
          <CollapsibleRangeInput
            value={locationRange}
            onChange={(value) => {
              setLocationRange(value);
              setLocationRangeError(null);
              setCreationError(null);
            }}
            onBlur={() => validateRanges()}
            placeholder="F1"
            error={!!locationRangeError}
            dialogId="insert-sparkline-dialog"
            inputId="location-range"
            label="Location Range"
          />
        </FormField>

        {/* Type Selector */}
        <Label className="mb-2">Type</Label>
        <div className="flex gap-3 mb-4">
          {(['line', 'column', 'winLoss'] as SparklineType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={`flex-1 flex flex-col items-center p-3 border-2 rounded-ss-lg cursor-pointer transition-colors ${
                sparklineType === type
                  ? 'border-ss-primary bg-ss-primary-lighter'
                  : 'border-ss-border hover:border-ss-border-focus'
              }`}
              onClick={() => setSparklineType(type)}
              aria-pressed={sparklineType === type}
            >
              <div className="w-12 h-8 mb-2 flex items-end justify-center gap-0.5">
                {type === 'line' && <LineIcon color={visual.color} />}
                {type === 'column' && <ColumnIcon color={visual.color} />}
                {type === 'winLoss' && (
                  <WinLossIcon color={visual.color} negativeColor={visual.negativeColor} />
                )}
              </div>
              <span className="text-body-sm font-medium text-text">
                {type === 'line' ? 'Line' : type === 'column' ? 'Column' : 'Win/Loss'}
              </span>
            </button>
          ))}
        </div>

        {/* Preview */}
        <div className="border border-ss-border rounded-ss-lg p-4 mb-4 bg-ss-surface-secondary">
          <div className="text-caption text-ss-text-secondary mb-2">Preview</div>
          <canvas
            ref={canvasRef}
            className="w-full h-[60px] bg-ss-surface border border-ss-border-light rounded"
          />
        </div>

        {/* Advanced Options Toggle */}
        <button
          type="button"
          className="flex items-center gap-2 cursor-pointer py-2 text-body font-medium text-ss-primary border-none bg-transparent w-full text-left"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>{showAdvanced ? '▼' : '▶'}</span>
          <span>Advanced Options</span>
        </button>

        {/* Advanced Options Panel */}
        {showAdvanced && (
          <div className="border border-ss-border rounded-ss-lg p-4 mt-2 mb-4">
            {/* Color Settings */}
            <div className="flex gap-4 mb-3">
              <div className="flex-1">
                <Label className="mb-1">Color</Label>
                <ColorInput
                  value={visual.color}
                  onChange={(e) => updateVisual('color', e.target.value)}
                />
              </div>
              <div className="flex-1">
                <Label className="mb-1">Negative Color</Label>
                <ColorInput
                  value={visual.negativeColor ?? '#dc2626'}
                  onChange={(e) => updateVisual('negativeColor', e.target.value)}
                />
              </div>
            </div>

            {/* Line-specific settings */}
            {sparklineType === 'line' && (
              <>
                <div className="mb-3">
                  <Checkbox
                    checked={visual.showMarkers ?? false}
                    onChange={(checked) => updateVisual('showMarkers', checked)}
                    label="Show markers"
                  />
                </div>

                <div className="mb-3">
                  <Label className="mb-1">Line Weight</Label>
                  <input
                    type="range"
                    min="0.5"
                    max="4"
                    step="0.5"
                    value={visual.lineWeight ?? 1.5}
                    onChange={(e) => updateVisual('lineWeight', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                {/* Point Colors */}
                <div className="flex gap-4 mb-3">
                  <div className="flex-1">
                    <Label className="mb-1">High Point</Label>
                    <ColorInput
                      value={visual.highPointColor ?? '#16a34a'}
                      onChange={(e) => updateVisual('highPointColor', e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="mb-1">Low Point</Label>
                    <ColorInput
                      value={visual.lowPointColor ?? '#dc2626'}
                      onChange={(e) => updateVisual('lowPointColor', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Axis Settings */}
            <div className="mb-3">
              <Checkbox
                checked={showAxis}
                onChange={(checked) => setShowAxis(checked)}
                label="Show axis"
              />
            </div>

            {/* Group Axis Settings (only show for groups */}
            {isCreatingGroup && (
              <div className="mb-3">
                <Checkbox
                  checked={useSameAxis}
                  onChange={(checked) => setUseSameAxis(checked)}
                  label="Use same axis for all sparklines in group"
                />
              </div>
            )}

            {/* Empty Cells */}
            <FormField label="Empty cells as">
              <Select
                options={EMPTY_CELLS_OPTIONS}
                value={displayEmptyCells}
                onChange={(value) => setDisplayEmptyCells(value as 'gaps' | 'zero' | 'connect')}
              />
            </FormField>
          </div>
        )}
      </DialogBody>

      {creationError && (
        <div className="mx-5 mb-3 rounded border border-ss-error bg-ss-error-bg px-3 py-2 text-body-sm text-ss-error">
          {creationError}
        </div>
      )}

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel} disabled={isCreating}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleOk()} disabled={!isValid || isCreating}>
          {isCreating ? 'Creating...' : 'OK'}
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts InsertSparklineDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function InsertSparklineDialogWrapper() {
  const isOpen = useUIStore((s) => s.sparklineDialog.isOpen);
  if (!isOpen) return null;
  return <InsertSparklineDialog />;
}
