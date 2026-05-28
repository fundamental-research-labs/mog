/**
 * Text to Columns Dialog
 *
 * A 3-step wizard that allows users to split text in a column into multiple columns.
 * - Step 1: Choose data type (delimited or fixed width)
 * - Step 2: Set delimiters or fixed width positions with preview
 * - Step 3: Choose destination and see final preview
 *
 * Matches Excel's Text to Columns wizard for familiarity.
 *
 * Uses FocusTrap for proper keyboard event isolation.
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md
 */

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  RadioGroup,
  SectionLabel,
  Select,
} from '@mog/shell';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { TextToColumnsResult } from '@mog-sdk/contracts/api';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUIStore } from '../../internal-api';

/** Dialog form model for text-to-columns conversion. */
export interface TextToColumnsDialogOptions {
  /** Split type: 'delimited' or 'fixedWidth' */
  type: 'delimited' | 'fixedWidth';
  /** Delimiters to use (for delimited type) */
  delimiters?: {
    tab: boolean;
    semicolon: boolean;
    comma: boolean;
    space: boolean;
    other?: string;
  };
  /** Whether to treat consecutive delimiters as one */
  treatConsecutiveAsOne?: boolean;
  /** Text qualifier character for quoted values */
  textQualifier?: '"' | "'" | 'none';
  /** Column positions for fixed width splitting */
  fixedWidthBreaks?: number[];
}

// =============================================================================
// Types
// =============================================================================

type WizardStep = 1 | 2 | 3;
type DataType = 'delimited' | 'fixedWidth';
type TextQualifier = '"' | "'" | 'none';

interface DelimiterState {
  tab: boolean;
  semicolon: boolean;
  comma: boolean;
  space: boolean;
  other: boolean;
  otherChar: string;
}

// =============================================================================
// Constants
// =============================================================================

const DATA_TYPE_OPTIONS = [
  {
    value: 'delimited',
    label: 'Delimited',
    description: 'Characters such as commas or tabs separate each field',
  },
  {
    value: 'fixedWidth',
    label: 'Fixed width',
    description: 'Fields are aligned in columns with spaces between them',
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a range as A1 notation.
 */
function formatRangeA1(range: CellRange): string {
  return `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.endCol)}${range.endRow + 1}`;
}

/**
 * Format a cell reference as A1 notation.
 */
function formatCellA1(row: number, col: number): string {
  return `${colToLetter(col)}${row + 1}`;
}

/**
 * Parse a comma/whitespace-separated list of zero-based character offsets,
 * returning the unique sorted positive subset. Invalid tokens are ignored.
 */
function parseFixedWidthBreaks(raw: string): number[] {
  const seen = new Set<number>();
  for (const token of raw.split(/[,\s]+/)) {
    if (!token) continue;
    const n = Number(token);
    if (!Number.isInteger(n) || n <= 0) continue;
    seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Parse A1 notation to row/col.
 */
function parseCellA1(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;

  const colLetters = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10);

  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64);
  }
  col -= 1; // Convert to 0-based

  return { row: rowNum - 1, col };
}

// =============================================================================
// Component
// =============================================================================

interface TextToColumnsDialogProps {
  /** Called when text should be split to columns */
  onConvert: (
    options: TextToColumnsDialogOptions,
    destination: { row: number; col: number },
  ) => TextToColumnsResult | Promise<TextToColumnsResult>;
  /** The current selection range (single column expected) */
  range: CellRange | null;
  /** Preview function to show split result without applying */
  onPreview: (options: TextToColumnsDialogOptions) => string[][];
  /** Raw selected source cells before delimiter or fixed-width splitting */
  onSourcePreview: () => string[][];
}

export function TextToColumnsDialog({
  onConvert,
  range,
  onPreview,
  onSourcePreview,
}: TextToColumnsDialogProps) {
  const isOpen = useUIStore((s) => s.textToColumnsDialogOpen);
  const closeDialog = useUIStore((s) => s.closeTextToColumnsDialog);

  // Wizard state
  const [step, setStep] = useState<WizardStep>(1);
  const [dataType, setDataType] = useState<DataType>('delimited');
  const [delimiters, setDelimiters] = useState<DelimiterState>({
    tab: false,
    semicolon: false,
    comma: true,
    space: false,
    other: false,
    otherChar: '',
  });
  const [treatConsecutiveAsOne, setTreatConsecutiveAsOne] = useState(false);
  const [textQualifier, setTextQualifier] = useState<TextQualifier>('"');
  const [destination, setDestination] = useState('');
  const [result, setResult] = useState<TextToColumnsResult | null>(null);
  const [fixedWidthBreaksRaw, setFixedWidthBreaksRaw] = useState('');

  const fixedWidthBreaks = useMemo(
    () => parseFixedWidthBreaks(fixedWidthBreaksRaw),
    [fixedWidthBreaksRaw],
  );

  // Memoized options for preview
  const previewOptions: TextToColumnsDialogOptions = useMemo(
    () => ({
      type: dataType,
      delimiters:
        dataType === 'delimited'
          ? {
              tab: delimiters.tab,
              semicolon: delimiters.semicolon,
              comma: delimiters.comma,
              space: delimiters.space,
              other: delimiters.other ? delimiters.otherChar : undefined,
            }
          : undefined,
      treatConsecutiveAsOne,
      textQualifier: textQualifier === 'none' ? 'none' : textQualifier,
      fixedWidthBreaks: dataType === 'fixedWidth' ? fixedWidthBreaks : undefined,
    }),
    [dataType, delimiters, treatConsecutiveAsOne, textQualifier, fixedWidthBreaks],
  );

  // Get preview data
  const previewData = useMemo(() => {
    if (!isOpen || !range) return [];
    return onPreview(previewOptions);
  }, [isOpen, range, onPreview, previewOptions]);

  const sourcePreviewData = useMemo(() => {
    if (!isOpen || !range) return [];
    return onSourcePreview();
  }, [isOpen, range, onSourcePreview]);

  // Calculate destination columns that will be affected
  const parsedDestination = useMemo(() => {
    if (!destination) return null;
    return parseCellA1(destination);
  }, [destination]);

  const columnsNeeded = useMemo(() => {
    if (previewData.length === 0) return 0;
    return Math.max(...previewData.map((row) => row.length));
  }, [previewData]);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen && range) {
      setStep(1);
      setDataType('delimited');
      setDelimiters({
        tab: false,
        semicolon: false,
        comma: true,
        space: false,
        other: false,
        otherChar: '',
      });
      setTreatConsecutiveAsOne(false);
      setTextQualifier('"');
      setFixedWidthBreaksRaw('');
      // Excel defaults the destination to the source top-left cell, so the
      // split overwrites the source column and expands rightward.
      setDestination(formatCellA1(range.startRow, range.startCol));
      setResult(null);
    }
  }, [isOpen, range]);

  // Handle delimiter checkbox change
  const handleDelimiterChange = useCallback(
    (key: keyof DelimiterState, value: boolean | string) => {
      setDelimiters((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [],
  );

  // Navigation
  const handleBack = useCallback(() => {
    setStep((prev) => (prev > 1 ? ((prev - 1) as WizardStep) : prev));
  }, []);

  const handleNext = useCallback(() => {
    setStep((prev) => (prev < 3 ? ((prev + 1) as WizardStep) : prev));
  }, []);

  // Handle Finish button
  const handleFinish = useCallback(async () => {
    if (!parsedDestination) return;

    const convertResult = await onConvert(previewOptions, parsedDestination);
    setResult(convertResult);
  }, [onConvert, previewOptions, parsedDestination]);

  // Handle OK button after seeing result
  const handleOk = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Handle Cancel
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Confirm handler — wizard navigation: Next on steps 1-2, Finish on step 3, OK after result
  const handleConfirm = useCallback(() => {
    if (step < 3) {
      handleNext();
    } else if (!result && parsedDestination) {
      void handleFinish();
    } else if (result) {
      handleOk();
    }
  }, [step, handleNext, handleFinish, handleOk, result, parsedDestination]);

  if (!range) return null;

  // Check if at least one delimiter is selected
  const hasDelimiter =
    dataType === 'fixedWidth' ||
    delimiters.tab ||
    delimiters.semicolon ||
    delimiters.comma ||
    delimiters.space ||
    (delimiters.other && delimiters.otherChar.length > 0);

  const canFinish = parsedDestination !== null && !result;

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={closeDialog}
      dialogId="text-to-columns-dialog"
      width={520}
    >
      {/* Custom header with step indicator */}
      <DialogHeader onClose={handleCancel} className="flex-col items-start">
        <span className="block">Convert Text to Columns</span>
        <span className="text-body-sm text-ss-text-secondary font-normal">Step {step} of 3</span>
      </DialogHeader>

      <DialogBody>
        <div>
          {/* Step 1: Choose Data Type */}
          {step === 1 && (
            <>
              <div className="text-body-sm text-ss-text-secondary mb-4 leading-relaxed">
                The wizard helps you split text in one column into multiple columns.
                <br />
                Source: <strong>{formatRangeA1(range)}</strong>
              </div>

              <div className="mb-4">
                <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                  Choose the data type that best describes your data:
                </SectionLabel>
                <RadioGroup
                  name="dataType"
                  value={dataType}
                  onChange={(value) => setDataType(value as DataType)}
                  options={DATA_TYPE_OPTIONS}
                  aria-label="Data type selection"
                />
              </div>

              {/* Preview of source data */}
              <div className="mt-4">
                <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                  Preview of selected data:
                </SectionLabel>
                <div className="border border-ss-border rounded overflow-hidden max-h-[180px] overflow-y-auto">
                  <table className="w-full border-collapse text-caption">
                    <tbody>
                      {sourcePreviewData.slice(0, 5).map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {row.map((cell, cellIdx) => (
                            <td
                              key={cellIdx}
                              className={`px-2 py-1.5 border-b border-r border-ss-border bg-ss-surface whitespace-nowrap max-w-[150px] overflow-hidden text-ellipsis ${
                                cellIdx === row.length - 1 ? 'border-r-0' : ''
                              }`}
                            >
                              {cell || '\u00A0'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Step 2: Set Delimiters */}
          {step === 2 && (
            <>
              <div className="text-body-sm text-ss-text-secondary mb-4 leading-relaxed">
                {dataType === 'delimited'
                  ? 'Set the delimiters your data contains.'
                  : 'Set column break lines in the preview below.'}
              </div>

              {dataType === 'delimited' && (
                <>
                  <div className="mb-4">
                    <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                      Delimiters:
                    </SectionLabel>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 mb-3">
                      <Checkbox
                        checked={delimiters.tab}
                        onChange={(checked) => handleDelimiterChange('tab', checked)}
                        label="Tab"
                        className="min-w-[90px]"
                      />
                      <Checkbox
                        checked={delimiters.semicolon}
                        onChange={(checked) => handleDelimiterChange('semicolon', checked)}
                        label="Semicolon"
                        className="min-w-[90px]"
                      />
                      <Checkbox
                        checked={delimiters.comma}
                        onChange={(checked) => handleDelimiterChange('comma', checked)}
                        label="Comma"
                        className="min-w-[90px]"
                      />
                      <Checkbox
                        checked={delimiters.space}
                        onChange={(checked) => handleDelimiterChange('space', checked)}
                        label="Space"
                        className="min-w-[90px]"
                      />
                      <div className="flex items-center gap-1.5 min-w-[90px]">
                        <Checkbox
                          checked={delimiters.other}
                          onChange={(checked) => handleDelimiterChange('other', checked)}
                          label="Other:"
                        />
                        <Input
                          type="text"
                          value={delimiters.otherChar}
                          onChange={(e) =>
                            handleDelimiterChange('otherChar', e.target.value.slice(0, 1))
                          }
                          className="w-10 h-7 px-1.5 py-0"
                          maxLength={1}
                          disabled={!delimiters.other}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <Checkbox
                      checked={treatConsecutiveAsOne}
                      onChange={(checked) => setTreatConsecutiveAsOne(checked)}
                      label="Treat consecutive delimiters as one"
                    />
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-body-sm text-ss-text-secondary">Text qualifier:</span>
                    <Select
                      value={textQualifier}
                      onChange={(value) => setTextQualifier(value as TextQualifier)}
                      size="sm"
                      options={[
                        { value: '"', label: '" (double quote)' },
                        { value: "'", label: "' (single quote)" },
                        { value: 'none', label: 'None' },
                      ]}
                    />
                  </div>
                </>
              )}

              {dataType === 'fixedWidth' && (
                <div className="mb-4">
                  <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                    Break positions:
                  </SectionLabel>
                  <Input
                    type="text"
                    value={fixedWidthBreaksRaw}
                    onChange={(e) => setFixedWidthBreaksRaw(e.target.value)}
                    placeholder="e.g., 3, 9"
                    aria-label="Fixed width break positions"
                    className="w-full h-8 px-2 py-0"
                  />
                  <div className="text-caption text-ss-text-tertiary mt-1">
                    Zero-based character offsets, separated by commas. Each row will be split into{' '}
                    {fixedWidthBreaks.length + 1} segment{fixedWidthBreaks.length === 0 ? '' : 's'}.
                  </div>
                </div>
              )}

              {/* Data preview */}
              <div className="mt-4">
                <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                  Data preview:
                </SectionLabel>
                <div className="border border-ss-border rounded overflow-hidden max-h-[180px] overflow-y-auto">
                  <table className="w-full border-collapse text-caption">
                    <tbody>
                      {previewData.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {row.map((cell, cellIdx) => (
                            <td
                              key={cellIdx}
                              className={`px-2 py-1.5 border-b border-r border-ss-border bg-ss-surface whitespace-nowrap max-w-[150px] overflow-hidden text-ellipsis ${
                                cellIdx === row.length - 1 ? 'border-r-0' : ''
                              }`}
                            >
                              {cell || '\u00A0'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Destination */}
          {step === 3 && (
            <>
              <div className="text-body-sm text-ss-text-secondary mb-4 leading-relaxed">
                Choose where to put the converted data.
              </div>

              <div className="mt-4">
                <div className="flex items-center gap-3">
                  <span className="text-body-sm text-ss-text-secondary">Destination:</span>
                  <Input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value.toUpperCase())}
                    className="w-[100px] h-8 px-2 py-0"
                    placeholder="e.g., B1"
                  />
                </div>

                {columnsNeeded > 1 && parsedDestination && (
                  <div className="mt-3 px-3 py-2.5 bg-ss-warning-bg rounded text-caption text-ss-warning-text flex items-start gap-2">
                    <span className="text-body-sm">⚠️</span>
                    <span>
                      This will write to columns {colToLetter(parsedDestination.col)} through{' '}
                      {colToLetter(parsedDestination.col + columnsNeeded - 1)}. Existing data may be
                      overwritten.
                    </span>
                  </div>
                )}
              </div>

              {/* Final preview */}
              <div className="mt-4">
                <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                  Final preview:
                </SectionLabel>
                <div className="border border-ss-border rounded overflow-hidden max-h-[180px] overflow-y-auto">
                  <table className="w-full border-collapse text-caption">
                    <tbody>
                      {previewData.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {row.map((cell, cellIdx) => (
                            <td
                              key={cellIdx}
                              className={`px-2 py-1.5 border-b border-r border-ss-border bg-ss-surface whitespace-nowrap max-w-[150px] overflow-hidden text-ellipsis ${
                                cellIdx === row.length - 1 ? 'border-r-0' : ''
                              }`}
                            >
                              {cell || '\u00A0'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Result message */}
              {result && (
                <div className="mt-3 px-3 py-2.5 bg-ss-success-bg rounded text-body-sm text-ss-success-text">
                  Split {result.rowsProcessed} row{result.rowsProcessed !== 1 ? 's' : ''} into{' '}
                  {result.columnsCreated} column{result.columnsCreated !== 1 ? 's' : ''}.
                </div>
              )}
            </>
          )}
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
        <div className="flex gap-2">
          {step > 1 && !result && (
            <Button variant="secondary" onClick={handleBack}>
              ← Back
            </Button>
          )}
          {step < 3 && (
            <Button variant="primary" onClick={handleNext} disabled={!hasDelimiter}>
              Next →
            </Button>
          )}
          {step === 3 && !result && (
            <Button variant="primary" onClick={handleFinish} disabled={!canFinish}>
              Finish
            </Button>
          )}
          {result && (
            <Button variant="primary" onClick={handleOk}>
              OK
            </Button>
          )}
        </div>
      </DialogFooter>
    </Dialog>
  );
}
