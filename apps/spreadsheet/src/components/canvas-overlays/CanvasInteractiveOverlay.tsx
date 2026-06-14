/**
 * Canvas Interactive Overlay
 *
 * Renders invisible DOM elements over canvas-rendered interactive elements.
 * This provides the bridge between fast canvas rendering and DOM-based UI
 * frameworks like Radix that require real DOM elements.
 *
 * ## Architecture
 *
 * 1. Canvas renders visuals efficiently (filter buttons, checkboxes, etc.)
 * 2. ISheetViewInteractiveElements capability emits element positions during each render frame
 * 3. This component subscribes to positions and renders DOM overlays
 * 4. Each overlay type handles its specific interaction (Popover, Select, etc.)
 *
 * ## Why This Exists
 *
 * Canvas pixels cannot be DOM elements. But UI libraries like Radix Popover,
 * screen readers, and keyboard navigation require real DOM elements. This
 * overlay layer creates invisible DOM elements at canvas positions, solving:
 *
 * - Radix Popover triggering (click-outside detection)
 * - Accessibility (screen reader announcements)
 * - Keyboard navigation (focus management)
 * - Touch event handling
 *
 * ## Coordinate System
 *
 * The overlay container is positioned relative to the grid viewport (after headers).
 * Element bounds from the capability are in viewport-relative coordinates,
 * so they can be directly used as CSS left/top positions.
 *
 * @module components/canvas-overlays/CanvasInteractiveOverlay
 * @see CANVAS-INTERACTIVE-ELEMENT-LAYER.md
 */

import { memo } from 'react';

import { isDev } from '@mog/env';
import type { ISheetViewInteractiveElements, InteractiveElementInfo } from '@mog-sdk/sheet-view';
import { useInteractiveElementPositions } from '../../hooks/view/use-interactive-element-positions';
import { CheckboxOverlay } from './CheckboxOverlay';
import { CommentIndicatorOverlay } from './CommentIndicatorOverlay';
import { FilterButtonOverlay } from './FilterButtonOverlay';
import { ValidationDropdownOverlay } from './ValidationDropdownOverlay';

export interface CanvasInteractiveOverlayProps {
  /** The interactive elements capability from SheetView */
  interactiveElements: ISheetViewInteractiveElements | null | undefined;
  /** Offset to account for row/column headers */
  headerOffset: { x: number; y: number };
}

/**
 * Renders invisible DOM elements over canvas interactive elements.
 * These provide proper DOM triggers for Radix popovers, accessibility,
 * and keyboard navigation.
 *
 * This solves the fundamental mismatch between canvas-rendered buttons
 * and DOM-based interaction systems.
 *
 * @example
 * ```tsx
 * <ScrollContainer ... />
 * <CanvasInteractiveOverlay
 * interactiveElements={rendererActions.getInteractiveElements}
 * headerOffset={{ x: rowHeaderWidth, y: colHeaderHeight }}
 * />
 * <OverlayLayers />
 * ```
 */
export const CanvasInteractiveOverlay = memo(function CanvasInteractiveOverlay({
  interactiveElements,
  headerOffset,
}: CanvasInteractiveOverlayProps) {
  const elements = useInteractiveElementPositions(interactiveElements);

  if (elements.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        // Position relative to grid viewport (after headers)
        left: headerOffset.x,
        top: headerOffset.y,
        // Don't extend beyond the grid viewport
        right: 0,
        bottom: 0,
        // Canvas layers are appended imperatively after React renders. Keep
        // DOM input triggers above those canvases for real pointer hit-testing.
        zIndex: 1,
      }}
      aria-hidden="true" // Container is decorative, children have their own a11y
    >
      {elements.map((element) => (
        <InteractiveElementRenderer key={element.id} element={element} />
      ))}
    </div>
  );
});

/**
 * Renders the appropriate overlay component for each element type.
 * This acts as a factory that dispatches to type-specific overlays.
 */
const InteractiveElementRenderer = memo(function InteractiveElementRenderer({
  element,
}: {
  element: InteractiveElementInfo;
}) {
  switch (element.type) {
    case 'filter-button':
      return <FilterButtonOverlay element={element} />;

    case 'checkbox':
      return <CheckboxOverlay element={element} />;

    case 'comment-indicator':
      return <CommentIndicatorOverlay element={element} />;

    case 'validation-dropdown':
      return <ValidationDropdownOverlay element={element} />;

    // Future element types:
    // case 'sparkline-edit':
    // return <SparklineEditOverlay element={element} />;
    // case 'hyperlink':
    // return <HyperlinkOverlay element={element} />;

    default:
      // Unknown element type - log in development
      if (isDev()) {
        console.warn(`[CanvasInteractiveOverlay] Unknown element type: ${element.type}`, element);
      }
      return null;
  }
});
