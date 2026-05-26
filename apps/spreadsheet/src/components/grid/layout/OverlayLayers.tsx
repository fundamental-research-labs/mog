/**
 * OverlayLayers Component
 *
 * Renders the DOM overlay layers that sit on top of the canvas grid.
 * These layers handle features that require DOM rendering for interactivity
 * or complex styling that's difficult to achieve with canvas.
 *
 * Layers:
 * - Chart Title Editor: Modal dialog for editing chart titles
 * - Pivot Layer: Renders pivot tables as DOM overlays with scroll sync
 * - Slicer Layer: Renders slicers as DOM overlays with scroll sync
 * - Form Control Layer: Renders checkboxes, buttons, comboboxes as DOM overlays
 * - Paste Options Button: Floating button after paste operations (G3)
 * - Split Dividers Layer: Draggable dividers for split view (
 *
 * NOTE: Charts now render on canvas via ChartLayer in canvas-renderer.
 * The DOM-based ChartLayerContainer has been removed, but ChartDOMMarkers
 * emits one invisible sentinel element per chart so DOM queries / app-eval
 * scenarios can detect chart presence without reading canvas pixels.
 */

import type React from 'react';

import { useActiveSheetId } from '../../../infra/context';
import { useFloatingObjectsInSheet } from '../../../hooks/objects/use-floating-objects-in-sheet';
import { FormControlLayerContainer } from '../../canvas-overlays/form-controls';
import { ChartTitleEditor } from '../../charts';
import { PivotLayerContainer } from '../../pivot';
import { SlicerLayerContainer } from '../../slicers';
import { PasteOptionsButton } from '../PasteOptionsButton';
import { SplitDividersLayer } from './SplitDividersLayer';

/**
 * Renders one invisible 1×1 px sentinel element per chart in the active sheet.
 *
 * Charts paint on canvas and have no DOM representation. Tooling (app-eval,
 * devtools, accessibility assertions) that needs to confirm a chart exists can
 * query `[data-chart-id]` and check `getBoundingClientRect().width > 0`.
 * The elements are `position:fixed` off-screen so they never interfere with
 * layout or pointer events.
 */
function ChartDOMMarkers(): React.JSX.Element | null {
  const activeSheetId = useActiveSheetId();
  const floatingObjects = useFloatingObjectsInSheet(activeSheetId);
  const charts = floatingObjects.filter((obj) => obj.type === 'chart');
  if (charts.length === 0) return null;
  return (
    <>
      {charts.map((chart) => (
        <div
          key={chart.id}
          data-chart-id={chart.id}
          style={{
            position: 'fixed',
            left: '-9999px',
            top: '-9999px',
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
            opacity: 0,
          }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * OverlayLayers - Renders pivot, slicer, form control, paste options, split divider overlays, and chart title editor
 *
 * These overlays are positioned absolutely and sync with scroll/zoom
 * to maintain proper alignment with the underlying canvas grid.
 */
export function OverlayLayers() {
  return (
    <>
      {/* Chart Title Editor - Modal dialog for editing chart titles */}
      <ChartTitleEditor />

      {/* Chart DOM Markers - invisible sentinels for DOM-based chart detection */}
      <ChartDOMMarkers />

      {/* Pivot Layer - renders pivot tables as DOM overlays with scroll sync */}
      <PivotLayerContainer />

      {/* Slicer Layer - renders slicers as DOM overlays with scroll sync */}
      <SlicerLayerContainer />

      {/* Form Control Layer - renders checkboxes, buttons, comboboxes as DOM overlays */}
      <FormControlLayerContainer />

      {/* Paste Options Button - G3: Floating button after paste operations */}
      <PasteOptionsButton />

      {/* Split Dividers Layer - Draggable dividers for split view */}
      <SplitDividersLayer />
    </>
  );
}
