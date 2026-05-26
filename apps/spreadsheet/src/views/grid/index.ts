/**
 * Grid View Exports
 *
 * Exports GridCanvas as the primary configurable component.
 *
 */

// =============================================================================
// Primary Component Exports
// =============================================================================

// GridCanvas: Configurable grid component for apps
// This is the primary export for apps that want to embed a grid
export { GridCanvas, GridView } from './GridView';
export type { GridCanvasProps, GridViewProps } from './GridView';

// =============================================================================
// Coordinator & Infrastructure
// =============================================================================

export { GridCoordinator } from './coordinator/grid-coordinator';
export type { RendererDependencies, SheetCoordinatorConfig } from './coordinator/types';

// =============================================================================
// View Definition & Adapter
// =============================================================================

export { gridViewDefinition } from './definition';
export { GridViewAdapter } from './GridViewAdapter';
