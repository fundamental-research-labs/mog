/**
 * Built-in Cell Styles
 *
 * Excel-compatible built-in styles that are always available.
 * These styles are defined in code (not Yjs) because:
 * 1. They never change and don't need collaboration
 * 2. They're immediately available without network sync
 * 3. They can be versioned with the code
 *
 * When a style is applied, its format values are COPIED to cells.
 * Style changes don't retroactively update already-styled cells.
 *
 * Extracted from @mog-sdk/contracts/styles (purity extraction).
 */

import type { CellStyle, StyleCategory } from '@mog-sdk/contracts/core';

// =============================================================================
// Excel-Compatible Built-in Styles
// =============================================================================

/**
 * All built-in styles, grouped by category.
 * Colors are based on Excel's default theme.
 */
export const BUILT_IN_STYLES: readonly CellStyle[] = [
  // =========================================================================
  // Normal Style (Default - Excel's base style)
  // =========================================================================
  {
    id: 'normal',
    name: 'Normal',
    category: 'titles-headings', // Listed with titles/headings in Excel
    builtIn: true,
    format: {
      fontFamily: 'Calibri',
      fontSize: 11,
      fontColor: '#000000',
      bold: false,
      italic: false,
      underlineType: 'none',
      strikethrough: false,
      horizontalAlign: 'general',
      verticalAlign: 'bottom',
      wrapText: false,
    },
  },

  // =========================================================================
  // Good / Bad / Neutral
  // =========================================================================
  {
    id: 'good',
    name: 'Good',
    category: 'good-bad-neutral',
    builtIn: true,
    format: {
      fontColor: '#006100',
      backgroundColor: '#c6efce',
    },
  },
  {
    id: 'bad',
    name: 'Bad',
    category: 'good-bad-neutral',
    builtIn: true,
    format: {
      fontColor: '#9c0006',
      backgroundColor: '#ffc7ce',
    },
  },
  {
    id: 'neutral',
    name: 'Neutral',
    category: 'good-bad-neutral',
    builtIn: true,
    format: {
      fontColor: '#9c5700',
      backgroundColor: '#ffeb9c',
    },
  },

  // =========================================================================
  // Data & Model
  // =========================================================================
  {
    id: 'calculation',
    name: 'Calculation',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#fa7d00',
      backgroundColor: '#f2f2f2',
      bold: true,
    },
  },
  {
    id: 'check-cell',
    name: 'Check Cell',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#000000',
      backgroundColor: '#a5a5a5',
      bold: true,
    },
  },
  {
    id: 'explanatory-text',
    name: 'Explanatory Text',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#7f7f7f',
      italic: true,
    },
  },
  {
    id: 'input',
    name: 'Input',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#3f3f76',
      backgroundColor: '#ffcc99',
    },
  },
  {
    id: 'linked-cell',
    name: 'Linked Cell',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#fa7d00',
    },
  },
  {
    id: 'note',
    name: 'Note',
    category: 'data-model',
    builtIn: true,
    format: {
      backgroundColor: '#ffffcc',
    },
  },
  {
    id: 'output',
    name: 'Output',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#3f3f3f',
      backgroundColor: '#f2f2f2',
      bold: true,
    },
  },
  {
    id: 'warning-text',
    name: 'Warning Text',
    category: 'data-model',
    builtIn: true,
    format: {
      fontColor: '#ff0000',
    },
  },

  // =========================================================================
  // Titles & Headings
  // Issue 4: Use theme:dark2 for heading colors to respect theme changes
  // =========================================================================
  {
    id: 'title',
    name: 'Title',
    category: 'titles-headings',
    builtIn: true,
    format: {
      fontSize: 18,
      bold: true,
      fontColor: 'theme:dark2',
    },
  },
  {
    id: 'heading-1',
    name: 'Heading 1',
    category: 'titles-headings',
    builtIn: true,
    format: {
      fontSize: 15,
      bold: true,
      fontColor: 'theme:dark2',
      borders: {
        bottom: { style: 'thin', color: '#44546a' },
      },
    },
  },
  {
    id: 'heading-2',
    name: 'Heading 2',
    category: 'titles-headings',
    builtIn: true,
    format: {
      fontSize: 13,
      bold: true,
      fontColor: 'theme:dark2',
    },
  },
  {
    id: 'heading-3',
    name: 'Heading 3',
    category: 'titles-headings',
    builtIn: true,
    format: {
      fontSize: 11,
      bold: true,
      fontColor: 'theme:dark2',
    },
  },
  {
    id: 'heading-4',
    name: 'Heading 4',
    category: 'titles-headings',
    builtIn: true,
    format: {
      bold: true,
      fontColor: 'theme:dark2',
    },
  },
  {
    id: 'total',
    name: 'Total',
    category: 'titles-headings',
    builtIn: true,
    format: {
      bold: true,
    },
  },

  // =========================================================================
  // Themed Accent Colors (Accent 1 - Blue)
  // Issue 4: These use theme references so they update when theme changes
  // =========================================================================
  {
    id: 'accent1',
    name: 'Accent1',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent1',
    },
  },
  {
    id: 'accent1-20',
    name: '20% - Accent1',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent1:0.8', // 80% tint toward white
    },
  },
  {
    id: 'accent1-40',
    name: '40% - Accent1',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent1:0.6', // 60% tint toward white
    },
  },
  {
    id: 'accent1-60',
    name: '60% - Accent1',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent1:0.4', // 40% tint toward white
    },
  },

  // =========================================================================
  // Themed Accent Colors (Accent 2 - Orange)
  // =========================================================================
  {
    id: 'accent2',
    name: 'Accent2',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent2',
    },
  },
  {
    id: 'accent2-20',
    name: '20% - Accent2',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent2:0.8',
    },
  },
  {
    id: 'accent2-40',
    name: '40% - Accent2',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent2:0.6',
    },
  },
  {
    id: 'accent2-60',
    name: '60% - Accent2',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent2:0.4',
    },
  },

  // =========================================================================
  // Themed Accent Colors (Accent 3 - Gray)
  // =========================================================================
  {
    id: 'accent3',
    name: 'Accent3',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent3',
    },
  },
  {
    id: 'accent3-20',
    name: '20% - Accent3',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent3:0.8',
    },
  },
  {
    id: 'accent3-40',
    name: '40% - Accent3',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent3:0.6',
    },
  },
  {
    id: 'accent3-60',
    name: '60% - Accent3',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent3:0.4',
    },
  },

  // =========================================================================
  // Themed Accent Colors (Accent 4 - Yellow)
  // =========================================================================
  {
    id: 'accent4',
    name: 'Accent4',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent4',
    },
  },
  {
    id: 'accent4-20',
    name: '20% - Accent4',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent4:0.8',
    },
  },
  {
    id: 'accent4-40',
    name: '40% - Accent4',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent4:0.6',
    },
  },
  {
    id: 'accent4-60',
    name: '60% - Accent4',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent4:0.4',
    },
  },

  // =========================================================================
  // Themed Accent Colors (Accent 5 - Blue-Gray)
  // =========================================================================
  {
    id: 'accent5',
    name: 'Accent5',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent5',
    },
  },
  {
    id: 'accent5-20',
    name: '20% - Accent5',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent5:0.8',
    },
  },
  {
    id: 'accent5-40',
    name: '40% - Accent5',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent5:0.6',
    },
  },
  {
    id: 'accent5-60',
    name: '60% - Accent5',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent5:0.4',
    },
  },

  // =========================================================================
  // Themed Accent Colors (Accent 6 - Green)
  // =========================================================================
  {
    id: 'accent6',
    name: 'Accent6',
    category: 'themed',
    builtIn: true,
    format: {
      fontColor: 'theme:light1',
      backgroundColor: 'theme:accent6',
    },
  },
  {
    id: 'accent6-20',
    name: '20% - Accent6',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent6:0.8',
    },
  },
  {
    id: 'accent6-40',
    name: '40% - Accent6',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent6:0.6',
    },
  },
  {
    id: 'accent6-60',
    name: '60% - Accent6',
    category: 'themed',
    builtIn: true,
    format: {
      backgroundColor: 'theme:accent6:0.4',
    },
  },

  // =========================================================================
  // Number Format Styles
  // =========================================================================
  {
    id: 'comma',
    name: 'Comma',
    category: 'number-format',
    builtIn: true,
    format: {
      numberFormat: '#,##0.00',
      numberFormatType: 'number',
    },
  },
  {
    id: 'comma-0',
    name: 'Comma [0]',
    category: 'number-format',
    builtIn: true,
    format: {
      numberFormat: '#,##0',
      numberFormatType: 'number',
    },
  },
  {
    id: 'currency',
    name: 'Currency',
    category: 'number-format',
    builtIn: true,
    format: {
      numberFormat: '$#,##0.00',
      numberFormatType: 'currency',
    },
  },
  {
    id: 'currency-0',
    name: 'Currency [0]',
    category: 'number-format',
    builtIn: true,
    format: {
      numberFormat: '$#,##0',
      numberFormatType: 'currency',
    },
  },
  {
    id: 'percent',
    name: 'Percent',
    category: 'number-format',
    builtIn: true,
    format: {
      numberFormat: '0%',
      numberFormatType: 'percentage',
    },
  },
] as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get all built-in styles.
 */
export function getBuiltInStyles(): readonly CellStyle[] {
  return BUILT_IN_STYLES;
}

/**
 * Get built-in styles filtered by category.
 */
export function getBuiltInStylesByCategory(category: StyleCategory): readonly CellStyle[] {
  return BUILT_IN_STYLES.filter((s) => s.category === category);
}

/**
 * Find a built-in style by ID.
 */
export function getBuiltInStyleById(id: string): CellStyle | undefined {
  return BUILT_IN_STYLES.find((s) => s.id === id);
}

/**
 * Check if a style ID is a built-in style.
 */
export function isBuiltInStyle(id: string): boolean {
  return BUILT_IN_STYLES.some((s) => s.id === id);
}

/**
 * Get all unique style categories (in display order).
 */
export const STYLE_CATEGORY_ORDER: readonly StyleCategory[] = [
  'good-bad-neutral',
  'data-model',
  'titles-headings',
  'themed',
  'number-format',
  'custom',
] as const;

/**
 * Human-readable category names for UI.
 */
export const STYLE_CATEGORY_LABELS: Record<StyleCategory, string> = {
  'good-bad-neutral': 'Good, Bad and Neutral',
  'data-model': 'Data and Model',
  'titles-headings': 'Titles and Headings',
  themed: 'Themed Cell Styles',
  'number-format': 'Number Format',
  custom: 'Custom',
};
