/**
 * InputMessageOverlay Component
 *
 * Renders the input message tooltip when a cell with data validation
 * input message is selected. The tooltip appears below the cell in
 * Excel-style yellow callout format.
 *
 * Data Validation Parity
 *
 * PERFORMANCE: This component is now SELF-SUFFICIENT for selection state.
 * It calls useActiveCell internally, isolating selection-triggered re-renders
 * to just this component instead of cascading through SpreadsheetGrid.
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { useRendererActions, useRendererStatus } from '../../../hooks';
import { useActiveCell } from '../../../hooks/selection/use-active-cell';
import { useInputMessageTooltip } from '../hooks/useInputMessageTooltip';
import { InputMessageTooltip } from '../InputMessageTooltip';

export interface InputMessageOverlayProps {
  /** Active sheet ID */
  activeSheetId: SheetId;
  /** Whether the cell editor is active */
  isEditing: boolean;
}

/**
 * InputMessageOverlay - Renders input message tooltip below selected cell
 *
 * RENDER ISOLATION: This component subscribes to activeCell internally via
 * useActiveCell(), preventing re-renders from cascading through SpreadsheetGrid.
 * Only this small component re-renders when the active cell changes.
 *
 * Calculates the screen position of the active cell and positions the tooltip
 * below and slightly to the right (Excel behavior).
 */
export function InputMessageOverlay({ activeSheetId, isEditing }: InputMessageOverlayProps) {
  // RENDER ISOLATION: Subscribe to activeCell here instead of in SpreadsheetGrid
  // This prevents the entire SpreadsheetGrid subtree from re-rendering on cell selection
  const { activeCell } = useActiveCell();

  // Compute input message tooltip state based on active cell's validation rule
  const inputMessageTooltipState = useInputMessageTooltip({
    activeCell,
    activeSheetId,
    isEditing,
  });

  // PERFORMANCE: Use granular hooks instead of full useRenderer()
  // useRendererStatus() only re-renders when isReady changes
  // useRendererActions() provides stable function references (no subscription)
  const { isReady } = useRendererStatus();
  const { getGeometry } = useRendererActions();

  // Early exit if not visible or renderer not ready
  const geometry = getGeometry();
  if (!inputMessageTooltipState.visible || !isReady || !geometry) {
    return null;
  }

  // Page-coord cell bounds via public geometry capability.
  const pageRect = geometry.getCellPageRect({ row: activeCell.row, col: activeCell.col });
  if (!pageRect) return null;

  // Position tooltip below and slightly to the right of the cell (Excel behavior).
  // The +4 offsets are visual padding choices.
  const tooltipPosition = {
    x: pageRect.x + 4,
    y: pageRect.y + pageRect.height + 4,
  };

  return (
    <InputMessageTooltip
      title={inputMessageTooltipState.title}
      message={inputMessageTooltipState.message}
      position={tooltipPosition}
      cellKey={`${activeCell.row},${activeCell.col}`}
    />
  );
}
