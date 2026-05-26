/**
 * Input Message Tooltip State Hook
 *
 * Computes tooltip visibility, content, and position based on active cell's
 * data validation rule. Shows Excel-style yellow tooltip when a cell with
 * an input message is selected (but not while editing).
 *
 * Migrated: ws.validations.get(row, col) replaces Schemas.getRangeSchema.
 * ValidationRule has showInputMessage, inputTitle, inputMessage fields directly.
 *
 * Data Validation Parity
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import { useEffect, useState } from 'react';
import { useEventBus, useWorkbook } from '../../../infra/context';

interface UseInputMessageTooltipOptions {
  /** Active cell position - only what's needed from selection state */
  activeCell: { row: number; col: number };
  activeSheetId: SheetId;
  isEditing: boolean;
}

export interface InputMessageTooltipState {
  visible: boolean;
  title?: string;
  message: string;
  position: { x: number; y: number };
}

const HIDDEN_STATE: InputMessageTooltipState = {
  visible: false,
  title: undefined,
  message: '',
  position: { x: 0, y: 0 },
};

/**
 * Hook to compute input message tooltip state for the active cell.
 *
 * Returns tooltip state with visibility, title, message, and position.
 * Position is a placeholder (0, 0) - actual position is computed during render
 * when the coordinate system is available.
 *
 * Uses ws.validations.get() (async) with useState+useEffect pattern.
 */
export function useInputMessageTooltip(
  options: UseInputMessageTooltipOptions,
): InputMessageTooltipState {
  const wb = useWorkbook();
  const eventBus = useEventBus();
  const [tooltipState, setTooltipState] = useState<InputMessageTooltipState>(HIDDEN_STATE);
  // Bumped whenever a validation rule on this sheet may have changed; gates the
  // re-fetch effect below so the tooltip reacts to rules added after the cell
  // was already active.
  const [ruleVersion, setRuleVersion] = useState(0);

  useEffect(() => {
    const bump = (sheetId: string | undefined) => {
      if (sheetId === undefined || sheetId === options.activeSheetId) {
        setRuleVersion((v) => v + 1);
      }
    };
    const unsubCreated = eventBus.on('range-schema:created', (e) => bump(e.sheetId));
    const unsubUpdated = eventBus.on('range-schema:updated', (e) => bump(e.sheetId));
    const unsubDeleted = eventBus.on('range-schema:deleted', (e) => bump(e.sheetId));
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
    };
  }, [eventBus, options.activeSheetId]);

  useEffect(() => {
    // Don't show input message while editing (editor has focus)
    if (options.isEditing) {
      setTooltipState(HIDDEN_STATE);
      return;
    }

    let cancelled = false;
    const ws = wb.getSheetById(options.activeSheetId);

    void ws.validations.get(options.activeCell.row, options.activeCell.col).then((rule) => {
      if (cancelled) return;

      if (!rule?.showInputMessage || !rule?.inputMessage) {
        setTooltipState(HIDDEN_STATE);
        return;
      }

      setTooltipState({
        visible: true,
        title: rule.inputTitle,
        message: rule.inputMessage,
        // Position placeholder - actual position computed during render with coordinate system
        position: { x: 0, y: 0 },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    wb,
    options.activeSheetId,
    options.activeCell.row,
    options.activeCell.col,
    options.isEditing,
    ruleVersion,
  ]);

  return tooltipState;
}
