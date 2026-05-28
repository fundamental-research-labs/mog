/**
 * TextToColumnsDialogContainer
 *
 * Migrated to Worksheet API (ws.textToColumns).
 * Preview uses ViewportBuffer for source cell values + local split logic.
 *
 * Container component that wires TextToColumnsDialog to the selection and store.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 *
 * @see Stream-K-DATA-TOOLS.md - & 3
 */

import { useCallback } from 'react';
import { displayString } from '@mog-sdk/contracts/core';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import type { TextToColumnsDialogOptions } from '../data/TextToColumnsDialog';
import { TextToColumnsDialog } from '../data/TextToColumnsDialog';

export function TextToColumnsDialogContainer() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const range = useUIStore((s) => s.textToColumnsDialogRange);

  // Worksheet API: textToColumns via ws.textToColumns (async)
  const handleConvert = useCallback(
    async (options: TextToColumnsDialogOptions, destination: { row: number; col: number }) => {
      if (!range) {
        return { rowsProcessed: 0, columnsCreated: 0 };
      }
      const ws = wb.getSheetById(activeSheetId);
      // Build A1 range string for the source range
      const { colToLetter } = await import('@mog/spreadsheet-utils/a1');
      const rangeA1 = `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.startCol)}${range.endRow + 1}`;
      return ws.structure.textToColumns(rangeA1, {
        type: options.type,
        delimiters: options.delimiters,
        destination,
        treatConsecutiveAsOne: options.treatConsecutiveAsOne,
        textQualifier: options.textQualifier,
        fixedWidthBreaks: options.fixedWidthBreaks,
      });
    },
    [wb, activeSheetId, range],
  );

  const handleSourcePreview = useCallback(() => {
    if (!range) return [];
    const result: string[][] = [];
    for (let row = range.startRow; row <= range.endRow; row++) {
      const values: string[] = [];
      for (let col = range.startCol; col <= range.endCol; col++) {
        const cell = ws.viewport.getCellData(row, col);
        values.push(cell?.displayText ? displayString(cell.displayText) : '');
      }
      result.push(values);
    }
    return result;
  }, [ws.viewport, range]);

  // Preview using ViewportBuffer for source cell values + local split logic
  const handlePreview = useCallback(
    (options: TextToColumnsDialogOptions) => {
      if (!range) return [];
      const result: string[][] = [];
      for (let row = range.startRow; row <= range.endRow; row++) {
        const cell = ws.viewport.getCellData(row, range.startCol);
        const text = cell?.displayText ? displayString(cell.displayText) : '';
        if (options.type === 'fixedWidth') {
          const breaks = options.fixedWidthBreaks ?? [];
          if (breaks.length === 0) {
            result.push([text]);
          } else {
            const segments: string[] = [];
            let prev = 0;
            for (const offset of breaks) {
              segments.push(text.slice(prev, offset));
              prev = offset;
            }
            segments.push(text.slice(prev));
            result.push(segments);
          }
        } else if (options.type === 'delimited' && options.delimiters) {
          // Build delimiter chars
          const delims: string[] = [];
          if (options.delimiters.tab) delims.push('\t');
          if (options.delimiters.comma) delims.push(',');
          if (options.delimiters.semicolon) delims.push(';');
          if (options.delimiters.space) delims.push(' ');
          if (options.delimiters.other) delims.push(options.delimiters.other);
          if (delims.length === 0) {
            result.push([text]);
          } else {
            const regex = new RegExp(
              `[${delims.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}]`,
            );
            result.push(text.split(regex));
          }
        } else {
          result.push([text]);
        }
      }
      return result;
    },
    [ws.viewport, range],
  );

  return (
    <TextToColumnsDialog
      onConvert={handleConvert}
      range={range}
      onPreview={handlePreview}
      onSourcePreview={handleSourcePreview}
    />
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts TextToColumnsDialogContainer when the dialog is open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function TextToColumnsDialogContainerWrapper() {
  const isOpen = useUIStore((s) => s.textToColumnsDialogOpen);
  if (!isOpen) return null;
  return <TextToColumnsDialogContainer />;
}
