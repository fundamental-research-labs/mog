/**
 * Canvas Overlays
 *
 * DOM overlay components positioned over canvas-rendered interactive elements.
 * These provide the bridge between fast canvas rendering and DOM-based UI frameworks
 * like Radix that require real DOM elements for proper interaction handling.
 *
 * Architecture:
 * 1. Canvas renders visuals efficiently in a single draw call
 * 2. ISheetViewInteractiveElements capability emits element positions during render
 * 3. CanvasInteractiveOverlay subscribes to positions and renders DOM overlays
 * 4. Each overlay type handles its specific interaction (Popover, Select, etc.)
 *
 * @module @mog/spreadsheet/components/canvas-overlays
 */

// Main overlay container (renders all interactive element overlays)
export { CanvasInteractiveOverlay } from './CanvasInteractiveOverlay';
export type { CanvasInteractiveOverlayProps } from './CanvasInteractiveOverlay';

// Individual overlay components
export { CheckboxOverlay } from './CheckboxOverlay';
export { CommentIndicatorOverlay } from './CommentIndicatorOverlay';
export { FilterButtonOverlay } from './FilterButtonOverlay';
export { OutlineToggleOverlay } from './OutlineToggleOverlay';
export { ValidationDropdownOverlay } from './ValidationDropdownOverlay';
