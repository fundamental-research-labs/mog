/**
 * Layers Barrel Export
 *
 * Re-exports all grid-renderer layer classes and their factory functions.
 *
 * @module grid-renderer/layers
 */

// Base
export { BaseLayer } from './base-layer';
export type { BaseLayerConfig } from './base-layer';

// Cells (z: 100)
export { CellsLayer, createCellsLayer } from './cells';
export type { CellsLayerConfig } from './cells';

// Background (z: 0)
export { BackgroundLayer, createBackgroundLayer } from './background';
export type { BackgroundLayerConfig } from './background';

// Selection (z: 200)
export { SelectionLayer, createSelectionLayer } from './selection';
export type { SelectionLayerConfig } from './selection';

// UI Layer
export { UILayer, createUILayer } from './ui';
export type { UILayerConfig } from './ui';

// Specialized Layers (per-region, canvas: 0)

// Validation Circles (z: 125)
export { ValidationCirclesLayer, createValidationCirclesLayer } from './validation-circles';
export type { ValidationCirclesLayerConfig } from './validation-circles';

// Page Breaks (z: 150)
export { PageBreakLayer, createPageBreakLayer } from './page-breaks';
export type { PageBreakLayerConfig } from './page-breaks';

// Trace Arrows (z: 250)
export { TraceArrowsLayer, createTraceArrowsLayer } from './trace-arrows';
export type { TraceArrowsLayerConfig } from './trace-arrows';

// Remote Cursors (z: 300)
export { RemoteCursorsLayer, createRemoteCursorsLayer } from './remote-cursors';
export type { RemoteCursorsLayerConfig } from './remote-cursors';

// Sticky Headers (z: 700)
export { StickyHeadersLayer, createStickyHeadersLayer } from './sticky-headers';
export type { StickyHeadersLayerConfig } from './sticky-headers';

// Headers & Dividers (once, canvas: 0)

// Headers (z: 800)
export { HeadersLayer, createHeadersLayer } from './headers';
export type { HeadersLayerConfig } from './headers';

// Dividers (z: 900)
export { DividersLayer, createDividersLayer } from './dividers';
export type { DividersLayerConfig } from './dividers';
