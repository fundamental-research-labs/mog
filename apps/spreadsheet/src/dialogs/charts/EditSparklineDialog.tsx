/**
 * Edit Sparkline Dialog
 *
 * A dialog for editing existing sparklines.
 * Allows users to modify visual settings, change data range,
 * or delete the sparkline.
 *
 * Features:
 * - Edit data range
 * - Change sparkline type
 * - Modify visual settings (colors, markers, axis)
 * - Delete sparkline
 * - Live preview panel
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CollapsibleRangeInput,
  MinimizableDialog,
  useActiveSheetId,
  useSparklineManager,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

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
import { letterToCol, toA1 } from '@mog/spreadsheet-utils/a1';
import type {
  Sparkline,
  SparklineAxisSettings,
  SparklineType,
  SparklineVisualSettings,
} from '@mog-sdk/contracts/sparklines';
// =============================================================================
// Types
// =============================================================================

interface EditSparklineDialogProps {
  /** Called after sparkline is successfully updated */
  onUpdated?: () => void;
  /** Called after sparkline is deleted */
  onDeleted?: () => void;
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
 * Parse a range string like "A1:E1" into row/col bounds.
 * Returns null if invalid.
 */
function parseRangeString(
  rangeStr: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  if (!rangeStr) return null;

  const trimmed = rangeStr.trim().toUpperCase();

  // Handle single cell (e.g., "A1")
  const singleMatch = trimmed.match(/^([A-Z]+)(\d+)$/);
  if (singleMatch) {
    const col = letterToCol(singleMatch[1]);
    const row = parseInt(singleMatch[2], 10) - 1;
    if (row >= 0 && col >= 0) {
      return { startRow: row, startCol: col, endRow: row, endCol: col };
    }
    return null;
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
 * Convert a CellRange to A1 range string.
 */
function rangeToString(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  if (range.startRow === range.endRow && range.startCol === range.endCol) {
    return toA1(range.startRow, range.startCol);
  }
  return `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
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

export function EditSparklineDialog({ onUpdated, onDeleted }: EditSparklineDialogProps) {
  const editSparklineDialog = useUIStore((s) => s.editSparklineDialog);
  const closeDialog = useUIStore((s) => s.closeEditSparklineDialog);
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const { sparklineManager } = useSparklineManager();

  const { isOpen, sparklineId, row, col } = editSparklineDialog;

  // Get the sparkline being edited
  const sparkline = useMemo<Sparkline | undefined>(() => {
    if (!sparklineId || !sparklineManager) return undefined;
    return sparklineManager.getSparkline(sparklineId);
  }, [sparklineId, sparklineManager]);

  // Get the group if the sparkline is part of one
  const sparklineGroup = useMemo(() => {
    if (!sparkline?.groupId || !sparklineManager) return undefined;
    return sparklineManager.getSparklineGroup(sparkline.groupId);
  }, [sparkline?.groupId, sparklineManager]);

  const isPartOfGroup = sparklineGroup !== undefined;
  const groupMemberCount = sparklineGroup?.sparklineIds.length ?? 0;

  // Local state
  const [dataRange, setDataRange] = useState('');
  const [dataRangeError, setDataRangeError] = useState<string | null>(null);
  const [sparklineType, setSparklineType] = useState<SparklineType>('line');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Visual settings
  const [visual, setVisual] = useState<SparklineVisualSettings>({ ...DEFAULT_VISUAL });
  const [showAxis, setShowAxis] = useState(false);
  const [displayEmptyCells, setDisplayEmptyCells] = useState<'gaps' | 'zero' | 'connect'>('gaps');

  // Preview canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize form when dialog opens
  useEffect(() => {
    if (isOpen && sparkline) {
      // Populate form with sparkline data
      const rangeStr = rangeToString({
        startRow: sparkline.dataRange.startRow,
        startCol: sparkline.dataRange.startCol,
        endRow: sparkline.dataRange.endRow,
        endCol: sparkline.dataRange.endCol,
      });
      setDataRange(rangeStr);
      setDataRangeError(null);
      setSparklineType(sparkline.type);
      setVisual({ ...sparkline.visual });

      setShowAxis(sparkline.axis.showAxis ?? false);
      if (sparkline.type === 'winLoss') {
        setDisplayEmptyCells('gaps');
      } else {
        setDisplayEmptyCells(sparkline.axis.displayEmptyCells ?? 'gaps');
      }

      setShowAdvanced(false);
    }
  }, [isOpen, sparkline]);

  // Get preview values from data range via Worksheet API
  const [previewValues, setPreviewValues] = useState<number[]>([]);

  useEffect(() => {
    const parsed = parseRangeString(dataRange);
    if (!parsed) {
      setPreviewValues([]);
      return;
    }

    const ws = wb.getSheetById(activeSheetId);
    void ws
      .getRange(parsed.startRow, parsed.startCol, parsed.endRow, parsed.endCol)
      .then((rangeData) => {
        const values: number[] = [];

        // rangeData is CellData[][] -- extract numeric values
        for (const row of rangeData) {
          for (const cell of row) {
            const val = cell.value;
            const num = typeof val === 'number' ? val : parseFloat(String(val ?? ''));
            if (!isNaN(num)) values.push(num);
          }
        }

        setPreviewValues(values);
      })
      .catch(() => {
        setPreviewValues([]);
      });
  }, [dataRange, activeSheetId, wb]);

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

  // Validate data range
  const validateDataRange = useCallback((): boolean => {
    const parsed = parseRangeString(dataRange);
    if (!parsed) {
      setDataRangeError('Invalid range. Use format like A1:E1 or A1:A10');
      return false;
    }
    setDataRangeError(null);
    return true;
  }, [dataRange]);

  // Handle OK button click
  const handleOk = useCallback(() => {
    if (!validateDataRange() || !sparklineId) return;

    const parsedData = parseRangeString(dataRange);
    if (!parsedData) return;

    // Determine data direction
    const dataInRows =
      parsedData.endCol - parsedData.startCol >= parsedData.endRow - parsedData.startRow;

    // Build axis settings
    const axisSettings: SparklineAxisSettings = {
      ...DEFAULT_AXIS,
      showAxis,
      displayEmptyCells,
    };

    // Update the sparkline — all types now share the same flat shape
    const resolvedVisual =
      sparklineType === 'winLoss'
        ? { ...visual, barGap: 0.1 }
        : sparklineType === 'column'
          ? { ...visual, columnGap: 0.1 }
          : visual;

    void sparklineManager.updateSparkline(sparklineId, {
      dataRange: {
        startRow: parsedData.startRow,
        startCol: parsedData.startCol,
        endRow: parsedData.endRow,
        endCol: parsedData.endCol,
      },
      dataInRows,
      type: sparklineType,
      visual: resolvedVisual,
      axis: axisSettings,
      updatedAt: Date.now(),
    });

    onUpdated?.();
    closeDialog();
  }, [
    validateDataRange,
    sparklineId,
    dataRange,
    sparklineManager,
    sparklineType,
    visual,
    showAxis,
    displayEmptyCells,
    onUpdated,
    closeDialog,
  ]);

  // Handle Delete button click
  const handleDelete = useCallback(() => {
    if (!sparklineId) return;

    void sparklineManager.deleteSparkline(sparklineId);
    onDeleted?.();
    closeDialog();
  }, [sparklineId, sparklineManager, onDeleted, closeDialog]);

  // Handle Apply to Group button click
  const handleApplyToGroup = useCallback(() => {
    if (!sparklineGroup) return;

    // Update the group's visual and axis settings
    void sparklineManager.updateSparklineGroup(sparklineGroup.id, {
      visual,
      axis: {
        ...DEFAULT_AXIS,
        showAxis,
        displayEmptyCells,
      },
      type: sparklineType,
    });

    onUpdated?.();
    closeDialog();
  }, [
    sparklineGroup,
    sparklineManager,
    visual,
    showAxis,
    displayEmptyCells,
    sparklineType,
    onUpdated,
    closeDialog,
  ]);

  // Handle Ungroup button click
  const handleUngroup = useCallback(() => {
    if (!sparklineGroup) return;

    void sparklineManager.ungroupSparklines(sparklineGroup.id);
    onUpdated?.();
    closeDialog();
  }, [sparklineGroup, sparklineManager, onUpdated, closeDialog]);

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

  if (!isOpen || !sparkline) return null;

  const isValid = dataRange.trim() !== '' && !dataRangeError;

  return (
    <MinimizableDialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleCancel}
      dialogId="edit-sparkline-dialog"
      title="Edit Sparkline"
      width={520}
    >
      <DialogHeader onClose={handleCancel}>Edit Sparkline</DialogHeader>

      <DialogBody className="max-h-[70vh] overflow-y-auto">
        <div>
          {/* Cell Location Info */}
          <div className="text-body-sm text-ss-text-secondary mb-4 px-3 py-2 bg-ss-surface-secondary rounded">
            Sparkline at cell <strong className="text-text">{toA1(row, col)}</strong>
          </div>

          {/* Group Info */}
          {isPartOfGroup && (
            <div className="text-body-sm text-ss-primary mb-4 px-3 py-2.5 bg-ss-primary-lighter rounded flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 5v14c0 1.1.9 2 2 2h6v-2H5V5h6V3H5c-1.1 0-2 .9-2 2zm16-2h-6v2h6v14h-6v2h6c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 9h6v2H9zm0 4h6v2H9z" />
                </svg>
                Part of group ({groupMemberCount} sparklines)
              </span>
              <button
                type="button"
                className="bg-transparent border border-ss-primary text-ss-primary px-3 py-1 rounded text-caption cursor-pointer font-medium hover:bg-ss-primary-lighter"
                onClick={handleUngroup}
              >
                Ungroup
              </button>
            </div>
          )}

          {/* Data Range */}
          <FormField
            label="Data Range"
            error={dataRangeError ?? undefined}
            helpText={!dataRangeError ? 'The data range for the sparkline values' : undefined}
          >
            <CollapsibleRangeInput
              value={dataRange}
              onChange={(value) => {
                setDataRange(value);
                setDataRangeError(null);
              }}
              onBlur={() => validateDataRange()}
              placeholder="A1:E1"
              error={!!dataRangeError}
              autoFocus
              dialogId="edit-sparkline-dialog"
              inputId="data-range"
              label="Data Range"
            />
          </FormField>

          {/* Type Selector */}
          <div className="mb-4">
            <Label className="mb-2">Type</Label>
            <div className="flex gap-3">
              <button
                type="button"
                className={`flex-1 flex flex-col items-center p-3 border-2 rounded-ss-lg cursor-pointer transition-colors ${
                  sparklineType === 'line'
                    ? 'border-ss-primary bg-ss-primary-lighter'
                    : 'border-ss-border hover:border-ss-border-hover'
                }`}
                onClick={() => setSparklineType('line')}
                aria-pressed={sparklineType === 'line'}
              >
                <div className="w-12 h-8 mb-2 flex items-end justify-center gap-0.5">
                  <LineIcon color={visual.color} />
                </div>
                <span className="text-body-sm font-medium text-text">Line</span>
              </button>

              <button
                type="button"
                className={`flex-1 flex flex-col items-center p-3 border-2 rounded-ss-lg cursor-pointer transition-colors ${
                  sparklineType === 'column'
                    ? 'border-ss-primary bg-ss-primary-lighter'
                    : 'border-ss-border hover:border-ss-border-hover'
                }`}
                onClick={() => setSparklineType('column')}
                aria-pressed={sparklineType === 'column'}
              >
                <div className="w-12 h-8 mb-2 flex items-end justify-center gap-0.5">
                  <ColumnIcon color={visual.color} />
                </div>
                <span className="text-body-sm font-medium text-text">Column</span>
              </button>

              <button
                type="button"
                className={`flex-1 flex flex-col items-center p-3 border-2 rounded-ss-lg cursor-pointer transition-colors ${
                  sparklineType === 'winLoss'
                    ? 'border-ss-primary bg-ss-primary-lighter'
                    : 'border-ss-border hover:border-ss-border-hover'
                }`}
                onClick={() => setSparklineType('winLoss')}
                aria-pressed={sparklineType === 'winLoss'}
              >
                <div className="w-12 h-8 mb-2 flex items-end justify-center gap-0.5">
                  <WinLossIcon color={visual.color} negativeColor={visual.negativeColor} />
                </div>
                <span className="text-body-sm font-medium text-text">Win/Loss</span>
              </button>
            </div>
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
            className="flex items-center gap-2 cursor-pointer py-2 text-body-sm font-medium text-ss-primary border-none bg-transparent w-full text-left hover:underline"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span>{showAdvanced ? '\u25BC' : '\u25B6'}</span>
            <span>Advanced Options</span>
          </button>

          {/* Advanced Options Panel */}
          {showAdvanced && (
            <div className="border border-ss-border rounded-ss-lg p-4 mt-2 mb-4">
              {/* Color Settings */}
              <div className="flex gap-4 mb-3">
                <div className="flex-1">
                  <Label>Color</Label>
                  <ColorInput
                    value={visual.color}
                    onChange={(e) => updateVisual('color', e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <Label>Negative Color</Label>
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
                    <Label>Line Weight</Label>
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
                      <Label>High Point</Label>
                      <ColorInput
                        value={visual.highPointColor ?? '#16a34a'}
                        onChange={(e) => updateVisual('highPointColor', e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <Label>Low Point</Label>
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
        </div>
      </DialogBody>

      <DialogFooter className="!justify-between">
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          {/* Apply to Group button (only show for grouped sparklines */}
          {isPartOfGroup && (
            <Button
              variant="secondary"
              onClick={handleApplyToGroup}
              title="Apply current settings to all sparklines in the group"
            >
              Apply to Group
            </Button>
          )}
          <Button variant="primary" onClick={handleOk} disabled={!isValid}>
            OK
          </Button>
        </div>
      </DialogFooter>
    </MinimizableDialog>
  );
}
