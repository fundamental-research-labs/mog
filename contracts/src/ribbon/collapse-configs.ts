/**
 * Ribbon Collapse Configurations
 *
 * Pure data defining how each group collapses.
 * No imports from engine - just static config objects.
 *
 * ARCHITECTURE:
 * - These are pure data configurations, no runtime dependencies
 * - Groups import these configs and pass to ToolbarGroup
 * - ToolbarGroup uses config + current level to determine render mode
 *
 */

import type { GroupCollapseConfig } from './collapse-types';

// =============================================================================
// Home Tab Groups
// =============================================================================

/**
 * Clipboard group collapse configuration.
 * Priority 1 (highest) - core operations, collapse last.
 */
export const CLIPBOARD_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 1,
  levels: {
    0: 'full', // Paste large, Cut/Copy stacked
    1: 'compact', // Paste medium, all icon+label
    2: 'icons', // All icon-only
    3: 'icons', // Still visible (high priority)
    4: 'dropdown', // Finally collapses at mobile
  },
};

/**
 * Font group collapse configuration.
 * Priority 2 - essential formatting.
 */
export const FONT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Alignment group collapse configuration.
 * Priority 2 - essential formatting.
 */
export const ALIGNMENT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Number format group collapse configuration.
 * Priority 3 - important but not critical.
 */
export const NUMBER_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Styles group collapse configuration.
 * Priority 4 - can be accessed via dropdown.
 */
export const STYLES_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full', // Cell styles gallery
    1: 'full', // Keep large Styles buttons vertical so labels wrap correctly
    2: 'dropdown', // Collapse early (low priority)
    3: 'dropdown',
    4: 'hidden', // Hide at mobile
  },
};

/**
 * Cells group collapse configuration.
 * Priority 4 - can be accessed via dropdown.
 */
export const CELLS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Editing group collapse configuration.
 * Priority 3 - Find/Select used frequently.
 */
export const EDITING_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

// =============================================================================
// Insert Tab Groups
// =============================================================================

/**
 * Tables group (Insert tab) collapse configuration.
 * Priority 2 - frequently used insertion.
 */
export const TABLES_INSERT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Illustrations group (Insert tab) collapse configuration.
 * Priority 3 - charts, pictures, shapes.
 */
export const ILLUSTRATIONS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Charts group (Insert tab) collapse configuration.
 * Priority 3 - chart insertion.
 */
export const CHARTS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Sparklines group (Insert tab) collapse configuration.
 * Priority 4 - specialized feature.
 */
export const SPARKLINES_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'dropdown',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Links group (Insert tab) collapse configuration.
 * Priority 4 - hyperlinks, etc.
 */
export const LINKS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'dropdown',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Text group (Insert tab) collapse configuration.
 * Priority 4 - text box, header/footer.
 */
export const TEXT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'dropdown',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Filters group (Insert tab) collapse configuration.
 * Priority 4 - slicer and timeline filters.
 */
export const FILTERS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'dropdown',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Comments group (Insert tab) collapse configuration.
 * Priority 4 - single-button group for inserting comments.
 */
export const COMMENTS_INSERT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'dropdown',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Page Layout Tab Groups
// =============================================================================

/**
 * Themes group (Page Layout tab) collapse configuration.
 * Priority 3 - document themes.
 */
export const THEMES_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Page Setup group (Page Layout tab) collapse configuration.
 * Priority 2 - margins, orientation, etc.
 */
export const PAGE_SETUP_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Scale to Fit group (Page Layout tab) collapse configuration.
 * Priority 4 - print scaling.
 */
export const SCALE_TO_FIT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Sheet Options group (Page Layout tab) collapse configuration.
 * Priority 4 - gridlines, headings for print.
 */
export const SHEET_OPTIONS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Arrange group (Page Layout tab) collapse configuration.
 * Priority 4 - bring forward, send backward, align, group for floating objects.
 * Page Layout Arrange Group
 */
export const ARRANGE_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Formulas Tab Groups
// =============================================================================

/**
 * Function Library group (Formulas tab) collapse configuration.
 * Priority 2 - core formula functionality.
 */
export const FUNCTION_LIBRARY_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Defined Names group (Formulas tab) collapse configuration.
 * Priority 3 - name manager.
 */
export const DEFINED_NAMES_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Formula Auditing group (Formulas tab) collapse configuration.
 * Priority 3 - trace precedents/dependents.
 */
export const FORMULA_AUDITING_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Calculation group (Formulas tab) collapse configuration.
 * Priority 4 - calculation options.
 */
export const CALCULATION_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Data Tab Groups
// =============================================================================

/**
 * Get External Data group (Data tab) collapse configuration.
 * Priority 3 - data connections.
 */
export const GET_EXTERNAL_DATA_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Sort & Filter group (Data tab) collapse configuration.
 * Priority 2 - core data operations.
 */
export const SORT_FILTER_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Data Tools group (Data tab) collapse configuration.
 * Priority 3 - text to columns, remove duplicates.
 */
export const DATA_TOOLS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Outline group (Data tab) collapse configuration.
 * Priority 4 - grouping, subtotals.
 */
export const OUTLINE_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Queries & Connections group (Data tab) collapse configuration.
 * Priority 3 - external data queries.
 */
export const QUERIES_CONNECTIONS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Forecast group (Data tab) collapse configuration.
 * Priority 4 - disabled/stub group.
 */
export const FORECAST_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Review Tab Groups
// =============================================================================

/**
 * Proofing group (Review tab) collapse configuration.
 * Priority 4 - spell check.
 */
export const PROOFING_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Comments group (Review tab) collapse configuration.
 * Priority 3 - collaboration feature.
 */
export const COMMENTS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Protect group (Review tab) collapse configuration.
 * Priority 3 - sheet/workbook protection.
 */
export const PROTECT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Accessibility group (Review tab) collapse configuration.
 * Priority 4 - single-button group for accessibility checker.
 * Skips dropdown mode (keeps as icon).
 */
export const ACCESSIBILITY_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'icons', // Skip dropdown - keep as icon
    4: 'hidden',
  },
};

// =============================================================================
// View Tab Groups
// =============================================================================

/**
 * Workbook Views group (View tab) collapse configuration.
 * Priority 3 - normal, page break preview.
 */
export const WORKBOOK_VIEWS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Show group (View tab) collapse configuration.
 * Priority 4 - gridlines, headings, formula bar, status bar.
 * Keep the checkbox grid mounted through desktop dense/minimal levels so
 * View > Show controls remain directly reachable instead of hiding behind a
 * collapsed group menu.
 */
export const SHOW_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'compact',
    3: 'compact',
    4: 'hidden',
  },
};

/**
 * Zoom group (View tab) collapse configuration.
 * Priority 3 - zoom controls.
 */
export const ZOOM_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Window group (View tab) collapse configuration.
 * Priority 4 - freeze panes, split.
 */
export const WINDOW_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Macros group (View tab) collapse configuration.
 * Priority 4 - macro recording and viewing.
 */
export const MACROS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Settings group (View tab) collapse configuration.
 * Priority 4 - workbook settings and options.
 */
export const SETTINGS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Draw Tab Groups
// =============================================================================

/**
 * Tools group (Draw tab) collapse configuration.
 * Priority 4 - drawing tools (disabled/stub).
 */
export const DRAW_TOOLS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Pens group (Draw tab) collapse configuration.
 * Priority 5 - pen styles (disabled/stub).
 */
export const DRAW_PENS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 5,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

/**
 * Convert group (Draw tab) collapse configuration.
 * Priority 5 - ink to shape conversion (disabled/stub).
 */
export const DRAW_CONVERT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 5,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Table Design Tab Groups (Contextual)
// =============================================================================

/**
 * Properties group (Table Design tab) collapse configuration.
 * Priority 2 - table name and resize controls.
 */
export const TABLE_PROPERTIES_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 2,
  levels: {
    0: 'full',
    1: 'full',
    2: 'compact',
    3: 'icons',
    4: 'dropdown',
  },
};

/**
 * Style Options group (Table Design tab) collapse configuration.
 * Priority 3 - header row, total row, etc.
 */
export const TABLE_STYLE_OPTIONS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Table Styles group (Table Design tab) collapse configuration.
 * Priority 3 - table style gallery.
 */
export const TABLE_STYLES_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Tools group (Table Design tab) collapse configuration.
 * Priority 4 - convert to range, etc.
 */
export const TABLE_TOOLS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'dropdown',
    3: 'dropdown',
    4: 'hidden',
  },
};

// =============================================================================
// Format Object Tab Groups (Contextual)
// =============================================================================

/**
 * Arrange group (Format Object tab) collapse configuration.
 * Priority 3 - bring forward, send backward, align, group.
 */
export const FORMAT_OBJECT_ARRANGE_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};

/**
 * Actions group (Format Object tab) collapse configuration.
 * Priority 4 - single-button group for additional actions.
 * Skips dropdown mode (keeps as icon).
 */
export const FORMAT_OBJECT_ACTIONS_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 4,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'icons', // Skip dropdown - keep as icon
    4: 'hidden',
  },
};

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default collapse config for groups without explicit config.
 * Uses middle priority and standard progression.
 */
export const DEFAULT_COLLAPSE_CONFIG: GroupCollapseConfig = {
  priority: 3,
  levels: {
    0: 'full',
    1: 'compact',
    2: 'icons',
    3: 'dropdown',
    4: 'dropdown',
  },
};
