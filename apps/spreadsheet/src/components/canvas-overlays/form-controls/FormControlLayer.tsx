/**
 * FormControlLayer
 *
 * Renders all form controls for the active sheet as absolutely-positioned
 * HTML overlays. Controls are positioned in DOCUMENT SPACE - the parent
 * container handles scroll via CSS transform.
 *
 * Architecture:
 * - Controls are positioned using anchor cell -> pixel coordinate resolution
 * - Container has pointer-events-none; individual controls have pointer-events-auto
 * - Each control type dispatches to its specific overlay component
 * - Cell values are read from ViewportBuffer (sync reads for rendering performance)
 *
 * @see contracts/src/editor/form-controls.ts - Type contracts
 * @module components/canvas-overlays/form-controls
 */

import React, { memo, useCallback } from 'react';

import { isDev } from '@mog/env';
import type { FormControl } from '@mog-sdk/contracts/form-controls';

import { ButtonOverlayControl } from './ButtonOverlayControl';
import { CheckboxOverlayControl } from './CheckboxOverlayControl';
import { ComboBoxOverlayControl } from './ComboBoxOverlayControl';
import { ListBoxOverlayControl } from './ListBoxOverlayControl';
import { NumericOverlayControl } from './NumericOverlayControl';

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved form control with pixel position and current cell value.
 * Position resolution happens in the container; this layer just renders.
 */
export interface ResolvedFormControl {
  /** The form control definition */
  control: FormControl;
  /** Document-space X position (pixels) */
  x: number;
  /** Document-space Y position (pixels) */
  y: number;
  /** Current value from the linked cell */
  cellValue: unknown;
  /** Rendered width after resolving the anchor cell's current geometry */
  width: number;
  /** Rendered height after resolving the anchor cell's current geometry */
  height: number;
  /** Linked cell position, when the control stores its value in a cell. */
  linkedCellPosition?: { row: number; col: number };
  /** Resolved items for comboBox controls (from static or dynamic source) */
  resolvedItems?: string[];
}

export interface FormControlLayerProps {
  /** Resolved form controls with positions and cell values */
  controls: ResolvedFormControl[];
  /** Callback to write a value to a control's linked cell */
  onCellValueChange: (controlId: string, value: unknown) => void;
}

// =============================================================================
// Control Renderer
// =============================================================================

interface ControlRendererProps {
  resolved: ResolvedFormControl;
  onCellValueChange: (controlId: string, value: unknown) => void;
}

/**
 * Renders the appropriate overlay component for each control type.
 * Wraps each control in an absolute-positioned container at its document-space position.
 */
const ControlRenderer = memo(
  function ControlRenderer({ resolved, onCellValueChange }: ControlRendererProps) {
    const { control, x, y, cellValue, width, height, linkedCellPosition, resolvedItems } = resolved;

    let content: React.ReactNode;

    switch (control.type) {
      case 'checkbox':
        content = (
          <CheckboxOverlayControl
            control={control}
            cellValue={cellValue}
            width={width}
            height={height}
            onCellValueChange={onCellValueChange}
            linkedCellPosition={linkedCellPosition}
          />
        );
        break;

      case 'button':
        content = (
          <ButtonOverlayControl
            control={control}
            cellValue={cellValue}
            width={width}
            height={height}
            onCellValueChange={onCellValueChange}
          />
        );
        break;

      case 'comboBox':
        content = (
          <ComboBoxOverlayControl
            control={control}
            cellValue={cellValue}
            width={width}
            height={height}
            resolvedItems={resolvedItems ?? control.items ?? []}
            onCellValueChange={onCellValueChange}
          />
        );
        break;

      case 'listBox':
        content = (
          <ListBoxOverlayControl
            control={control}
            cellValue={cellValue}
            width={width}
            height={height}
            resolvedItems={resolvedItems ?? control.items ?? []}
            onCellValueChange={onCellValueChange}
          />
        );
        break;

      case 'scrollBar':
      case 'slider':
      case 'spinner':
        content = (
          <NumericOverlayControl
            control={control}
            cellValue={cellValue}
            width={width}
            height={height}
            onCellValueChange={onCellValueChange}
          />
        );
        break;

      default:
        if (isDev()) {
          console.warn(
            `[FormControlLayer] Unknown control type: ${(control as FormControl).type}`,
            control,
          );
        }
        return null;
    }

    return (
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          zIndex: control.zIndex,
          pointerEvents: 'auto',
        }}
        data-no-grid-pointer="true"
        data-form-control-id={control.id}
        data-form-control-type={control.type}
        data-form-control-linked-row={linkedCellPosition?.row}
        data-form-control-linked-col={linkedCellPosition?.col}
      >
        {content}
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison: re-render only when control, position, or value changes
    return (
      prev.resolved.control === next.resolved.control &&
      prev.resolved.x === next.resolved.x &&
      prev.resolved.y === next.resolved.y &&
      prev.resolved.width === next.resolved.width &&
      prev.resolved.height === next.resolved.height &&
      prev.resolved.cellValue === next.resolved.cellValue &&
      prev.resolved.resolvedItems === next.resolved.resolvedItems
    );
  },
);

// =============================================================================
// Component
// =============================================================================

/**
 * Renders all form controls positioned in DOCUMENT SPACE.
 * The parent container handles scroll via CSS transform.
 */
export const FormControlLayer = memo(function FormControlLayer({
  controls,
  onCellValueChange,
}: FormControlLayerProps) {
  // Stable callback ref for background click (deselect)
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    // Only handle clicks on the background container itself
    if (e.target !== e.currentTarget) return;
    // Future: deselect active form control
  }, []);

  return (
    <div
      onClick={handleBackgroundClick}
      className="absolute pointer-events-none"
      data-testid="form-control-layer"
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      {controls.map((resolved) => (
        <ControlRenderer
          key={resolved.control.id}
          resolved={resolved}
          onCellValueChange={onCellValueChange}
        />
      ))}
    </div>
  );
});
