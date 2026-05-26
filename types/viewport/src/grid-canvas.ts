/**
 * GridCanvas Feature Types
 *
 * Feature flags for configuring GridCanvas behavior.
 * Apps use these flags to enable/disable specific features.
 *
 */

// =============================================================================
// FEATURE FLAGS
// =============================================================================

/**
 * Feature flags for GridCanvas component.
 *
 * Each flag controls whether a specific capability is enabled.
 * Apps can configure GridCanvas for different use cases:
 * - Spreadsheet: all features enabled
 * - Embedded table: editing + selection, no formulas
 * - Dashboard: read-only display
 *
 * @example
 * ```tsx
 * // Full spreadsheet
 * <GridCanvas features={{ editing: true, selection: true, formulas: true, fill: true }} />
 *
 * // Embedded table in Slides
 * <GridCanvas features={{ editing: true, selection: true }} />
 *
 * // Read-only dashboard
 * <GridCanvas features={{ editing: false, selection: false }} />
 * ```
 */
export interface GridCanvasFeatures {
  /**
   * Enable cell editing.
   * When false, cells cannot be edited.
   * @default true
   */
  editing?: boolean;

  /**
   * Enable cell selection UI.
   * When false, no selection boxes are shown.
   * @default true
   */
  selection?: boolean;

  /**
   * Enable formula bar integration.
   * When true, the grid coordinates with an external formula bar.
   * Spreadsheet app enables this; embedded grids typically don't.
   * @default false
   */
  formulas?: boolean;

  /**
   * Enable format editing via toolbar.
   * When true, selection changes update toolbar state.
   * Apps that own their toolbar enable this; embedded grids don't.
   * @default false
   */
  formatting?: boolean;

  /**
   * Enable row/column resize handles.
   * When false, users cannot resize rows/columns by dragging.
   * @default true
   */
  resize?: boolean;

  /**
   * Enable fill handle for drag-fill operations.
   * When false, fill handle is not shown and drag-fill is disabled.
   * @default false
   */
  fill?: boolean;

  /**
   * Enable right-click context menu.
   * When false, no context menu appears on right-click.
   * @default true
   */
  contextMenu?: boolean;

  /**
   * Enable keyboard shortcuts.
   * When false, keyboard input is not handled by the grid.
   * @default true
   */
  keyboard?: boolean;

  /**
   * Enable clipboard operations (copy/cut/paste).
   * When false, clipboard operations are disabled.
   * @default true
   */
  clipboard?: boolean;

  /**
   * Enable remote cursor display for collaboration.
   * When false, remote cursors are not shown.
   * @default false
   */
  collaboration?: boolean;

  /**
   * Enable cell comments.
   * When false, comment indicators and hover are disabled.
   * @default false
   */
  comments?: boolean;

  /**
   * Enable embedded charts.
   * When false, chart objects are not rendered.
   * @default false
   */
  charts?: boolean;

  /**
   * Enable floating objects (images, shapes, etc.).
   * When false, floating objects are not rendered or interactive.
   * @default false
   */
  floatingObjects?: boolean;

  /**
   * Enable find and replace functionality.
   * When false, find/replace is disabled.
   * @default false
   */
  findReplace?: boolean;
}

// =============================================================================
// PRESETS
// =============================================================================

/**
 * Preset names for common GridCanvas configurations.
 * Use presets for ergonomic defaults, override with `features` prop if needed.
 */
export type GridCanvasPreset = 'full' | 'embedded' | 'readonly';

/**
 * Preset configurations for common use cases.
 * These provide sensible defaults for typical scenarios.
 */
export const GRID_CANVAS_PRESETS: Record<GridCanvasPreset, Required<GridCanvasFeatures>> = {
  /**
   * Full spreadsheet experience.
   * All features enabled - used by the Spreadsheet app.
   */
  full: {
    editing: true,
    selection: true,
    formulas: true,
    formatting: true,
    resize: true,
    fill: true,
    contextMenu: true,
    keyboard: true,
    clipboard: true,
    collaboration: true,
    comments: true,
    charts: true,
    floatingObjects: true,
    findReplace: true,
  },

  /**
   * Embedded table experience.
   * Basic editing and selection - used for tables in Slides, Forms, etc.
   */
  embedded: {
    editing: true,
    selection: true,
    formulas: false,
    formatting: false,
    resize: true,
    fill: false,
    contextMenu: true,
    keyboard: true,
    clipboard: true,
    collaboration: false,
    comments: false,
    charts: false,
    floatingObjects: false,
    findReplace: false,
  },

  /**
   * Read-only display experience.
   * No interaction - used for dashboards, previews, etc.
   */
  readonly: {
    editing: false,
    selection: false,
    formulas: false,
    formatting: false,
    resize: false,
    fill: false,
    contextMenu: false,
    keyboard: false,
    clipboard: false,
    collaboration: false,
    comments: false,
    charts: false,
    floatingObjects: false,
    findReplace: false,
  },
} as const;

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Default features when no preset or explicit features are provided.
 * Uses 'embedded' preset as a sensible default for most apps.
 */
export const DEFAULT_GRID_CANVAS_FEATURES: Required<GridCanvasFeatures> =
  GRID_CANVAS_PRESETS.embedded;
