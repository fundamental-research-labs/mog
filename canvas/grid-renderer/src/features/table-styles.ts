/**
 * Table Style Definitions
 *
 * Excel-compatible table style presets (60 styles: 21 light, 28 medium, 11 dark).
 * Each preset defines colors for headers, data rows, banding, and total rows.
 *
 * Table style rendering
 */

import type { TableStylePreset } from '@mog-sdk/contracts/tables';

// =============================================================================
// Style Definition Types
// =============================================================================

/**
 * Color scheme for a table style preset.
 */
export interface TableStyleColors {
  /** Header row background color */
  headerBackground: string;
  /** Header row text color */
  headerText: string;
  /** Header row border color */
  headerBorder: string;
  /** First data row background (or odd rows for banding) */
  rowBackground1: string;
  /** Second data row background (or even rows for banding) */
  rowBackground2: string;
  /** Data row text color */
  dataText: string;
  /** Total row background color */
  totalBackground: string;
  /** Total row text color */
  totalText: string;
  /** Table border color */
  borderColor: string;
  /** First/last column highlight background */
  columnHighlight?: string;
}

/**
 * Computed style for a specific cell within a table.
 */
export interface TableCellStyle {
  backgroundColor?: string;
  textColor?: string;
  bold?: boolean;
  borders?: {
    top?: { color: string; width: number };
    right?: { color: string; width: number };
    bottom?: { color: string; width: number };
    left?: { color: string; width: number };
  };
}

// =============================================================================
// Style Preset Definitions
// =============================================================================

/**
 * Light style color schemes (1-21).
 * Light backgrounds with colored headers.
 */
const LIGHT_STYLES: Record<string, TableStyleColors> = {
  light1: {
    headerBackground: '#000000',
    headerText: '#FFFFFF',
    headerBorder: '#000000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#F2F2F2',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#000000',
  },
  light2: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#4472C4',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D6DCE5',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#4472C4',
  },
  light3: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#ED7D31',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FCE4D6',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#ED7D31',
  },
  light4: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#A5A5A5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#EDEDED',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#A5A5A5',
  },
  light5: {
    headerBackground: '#FFC000',
    headerText: '#000000',
    headerBorder: '#FFC000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FFF2CC',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#FFC000',
  },
  light6: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#5B9BD5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#DDEBF7',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#5B9BD5',
  },
  light7: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#70AD47',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#E2EFDA',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#70AD47',
  },
  light8: {
    headerBackground: '#FFFFFF',
    headerText: '#4472C4',
    headerBorder: '#4472C4',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D6DCE5',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#4472C4',
    borderColor: '#4472C4',
  },
  light9: {
    headerBackground: '#FFFFFF',
    headerText: '#ED7D31',
    headerBorder: '#ED7D31',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FCE4D6',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#ED7D31',
    borderColor: '#ED7D31',
  },
  light10: {
    headerBackground: '#FFFFFF',
    headerText: '#A5A5A5',
    headerBorder: '#A5A5A5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#EDEDED',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#A5A5A5',
    borderColor: '#A5A5A5',
  },
  light11: {
    headerBackground: '#FFFFFF',
    headerText: '#FFC000',
    headerBorder: '#FFC000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FFF2CC',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#FFC000',
    borderColor: '#FFC000',
  },
  light12: {
    headerBackground: '#FFFFFF',
    headerText: '#5B9BD5',
    headerBorder: '#5B9BD5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#DDEBF7',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#5B9BD5',
    borderColor: '#5B9BD5',
  },
  light13: {
    headerBackground: '#FFFFFF',
    headerText: '#70AD47',
    headerBorder: '#70AD47',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#E2EFDA',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#70AD47',
    borderColor: '#70AD47',
  },
  light14: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#2F5496',
    rowBackground1: '#D6DCE5',
    rowBackground2: '#B4C6E7',
    dataText: '#000000',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#2F5496',
  },
  light15: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#C65911',
    rowBackground1: '#FCE4D6',
    rowBackground2: '#F8CBAD',
    dataText: '#000000',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#C65911',
  },
  light16: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#7F7F7F',
    rowBackground1: '#EDEDED',
    rowBackground2: '#DBDBDB',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#7F7F7F',
  },
  light17: {
    headerBackground: '#FFC000',
    headerText: '#000000',
    headerBorder: '#BF8F00',
    rowBackground1: '#FFF2CC',
    rowBackground2: '#FFE699',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#000000',
    borderColor: '#BF8F00',
  },
  light18: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#2E75B6',
    rowBackground1: '#DDEBF7',
    rowBackground2: '#BDD7EE',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#2E75B6',
  },
  light19: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#538135',
    rowBackground1: '#E2EFDA',
    rowBackground2: '#C6E0B4',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#538135',
  },
  light20: {
    headerBackground: '#9E480E',
    headerText: '#FFFFFF',
    headerBorder: '#9E480E',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#F4B183',
    dataText: '#000000',
    totalBackground: '#9E480E',
    totalText: '#FFFFFF',
    borderColor: '#9E480E',
  },
  light21: {
    headerBackground: '#7030A0',
    headerText: '#FFFFFF',
    headerBorder: '#7030A0',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#E2D1F2',
    dataText: '#000000',
    totalBackground: '#7030A0',
    totalText: '#FFFFFF',
    borderColor: '#7030A0',
  },
  light22: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#4472C4',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D6E4F0',
    dataText: '#000000',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#8FAADC',
  },
  light23: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#ED7D31',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#F8CBAD',
    dataText: '#000000',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#F4B183',
  },
  light24: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#A5A5A5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D9D9D9',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#C0C0C0',
  },
  light25: {
    headerBackground: '#FFC000',
    headerText: '#FFFFFF',
    headerBorder: '#FFC000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FFE699',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#FFFFFF',
    borderColor: '#FFD966',
  },
  light26: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#5B9BD5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#BDD7EE',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#9DC3E6',
  },
  light27: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#70AD47',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#C6EFCE',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#A9D18E',
  },
  light28: {
    headerBackground: '#264478',
    headerText: '#FFFFFF',
    headerBorder: '#264478',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#B4C6E7',
    dataText: '#000000',
    totalBackground: '#264478',
    totalText: '#FFFFFF',
    borderColor: '#8DB4E2',
  },
};

/**
 * Medium style color schemes (1-28).
 * More saturated colors with visible banding.
 */
const MEDIUM_STYLES: Record<string, TableStyleColors> = {
  medium1: {
    headerBackground: '#FFFFFF',
    headerText: '#000000',
    headerBorder: '#000000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#F2F2F2',
    dataText: '#000000',
    totalBackground: '#FFFFFF',
    totalText: '#000000',
    borderColor: '#9B9B9B',
  },
  medium2: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#4472C4',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D6DCE5',
    dataText: '#000000',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#8FAADC',
  },
  medium3: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#ED7D31',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FCE4D6',
    dataText: '#000000',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#F4B183',
  },
  medium4: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#A5A5A5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#EDEDED',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#C9C9C9',
  },
  medium5: {
    headerBackground: '#FFC000',
    headerText: '#000000',
    headerBorder: '#FFC000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FFF2CC',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#000000',
    borderColor: '#FFD966',
  },
  medium6: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#5B9BD5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#DDEBF7',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#9DC3E6',
  },
  medium7: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#70AD47',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#E2EFDA',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#A9D18E',
  },
  medium8: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#2F5496',
    rowBackground1: '#D6DCE5',
    rowBackground2: '#B4C6E7',
    dataText: '#000000',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#4472C4',
  },
  medium9: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#C65911',
    rowBackground1: '#FCE4D6',
    rowBackground2: '#F8CBAD',
    dataText: '#000000',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#ED7D31',
  },
  medium10: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#7F7F7F',
    rowBackground1: '#EDEDED',
    rowBackground2: '#DBDBDB',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#A5A5A5',
  },
  medium11: {
    headerBackground: '#FFC000',
    headerText: '#000000',
    headerBorder: '#BF8F00',
    rowBackground1: '#FFF2CC',
    rowBackground2: '#FFE699',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#000000',
    borderColor: '#FFC000',
  },
  medium12: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#2E75B6',
    rowBackground1: '#DDEBF7',
    rowBackground2: '#BDD7EE',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#5B9BD5',
  },
  medium13: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#538135',
    rowBackground1: '#E2EFDA',
    rowBackground2: '#C6E0B4',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#70AD47',
  },
  medium14: {
    headerBackground: '#FFFFFF',
    headerText: '#4472C4',
    headerBorder: '#4472C4',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D6DCE5',
    dataText: '#000000',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#4472C4',
  },
  medium15: {
    headerBackground: '#FFFFFF',
    headerText: '#ED7D31',
    headerBorder: '#ED7D31',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FCE4D6',
    dataText: '#000000',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#ED7D31',
  },
  medium16: {
    headerBackground: '#FFFFFF',
    headerText: '#A5A5A5',
    headerBorder: '#A5A5A5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#EDEDED',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#A5A5A5',
  },
  medium17: {
    headerBackground: '#FFFFFF',
    headerText: '#BF8F00',
    headerBorder: '#FFC000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FFF2CC',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#000000',
    borderColor: '#FFC000',
  },
  medium18: {
    headerBackground: '#FFFFFF',
    headerText: '#5B9BD5',
    headerBorder: '#5B9BD5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#DDEBF7',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#5B9BD5',
  },
  medium19: {
    headerBackground: '#FFFFFF',
    headerText: '#70AD47',
    headerBorder: '#70AD47',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#E2EFDA',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#70AD47',
  },
  medium20: {
    headerBackground: '#FFFFFF',
    headerText: '#000000',
    headerBorder: '#000000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#D9D9D9',
    dataText: '#000000',
    totalBackground: '#000000',
    totalText: '#FFFFFF',
    borderColor: '#000000',
  },
  medium21: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#4472C4',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#B4C6E7',
    dataText: '#000000',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#4472C4',
  },
  medium22: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#ED7D31',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#F8CBAD',
    dataText: '#000000',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#ED7D31',
  },
  medium23: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#A5A5A5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#DBDBDB',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#A5A5A5',
  },
  medium24: {
    headerBackground: '#FFC000',
    headerText: '#000000',
    headerBorder: '#FFC000',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#FFE699',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#000000',
    borderColor: '#FFC000',
  },
  medium25: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#5B9BD5',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#BDD7EE',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#5B9BD5',
  },
  medium26: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#70AD47',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#C6E0B4',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#70AD47',
  },
  medium27: {
    headerBackground: '#9E480E',
    headerText: '#FFFFFF',
    headerBorder: '#9E480E',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#F4B183',
    dataText: '#000000',
    totalBackground: '#9E480E',
    totalText: '#FFFFFF',
    borderColor: '#9E480E',
  },
  medium28: {
    headerBackground: '#7030A0',
    headerText: '#FFFFFF',
    headerBorder: '#7030A0',
    rowBackground1: '#FFFFFF',
    rowBackground2: '#CDA3DE',
    dataText: '#000000',
    totalBackground: '#7030A0',
    totalText: '#FFFFFF',
    borderColor: '#7030A0',
  },
};

/**
 * Dark style color schemes (1-11).
 * Dark backgrounds with high contrast.
 */
const DARK_STYLES: Record<string, TableStyleColors> = {
  dark1: {
    headerBackground: '#000000',
    headerText: '#FFFFFF',
    headerBorder: '#000000',
    rowBackground1: '#737373',
    rowBackground2: '#595959',
    dataText: '#FFFFFF',
    totalBackground: '#000000',
    totalText: '#FFFFFF',
    borderColor: '#000000',
  },
  dark2: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#4472C4',
    rowBackground1: '#8FAADC',
    rowBackground2: '#6F92D2',
    dataText: '#FFFFFF',
    totalBackground: '#4472C4',
    totalText: '#FFFFFF',
    borderColor: '#4472C4',
  },
  dark3: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#ED7D31',
    rowBackground1: '#F4B183',
    rowBackground2: '#E9956A',
    dataText: '#FFFFFF',
    totalBackground: '#ED7D31',
    totalText: '#FFFFFF',
    borderColor: '#ED7D31',
  },
  dark4: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#A5A5A5',
    rowBackground1: '#C9C9C9',
    rowBackground2: '#B7B7B7',
    dataText: '#000000',
    totalBackground: '#A5A5A5',
    totalText: '#FFFFFF',
    borderColor: '#A5A5A5',
  },
  dark5: {
    headerBackground: '#FFC000',
    headerText: '#000000',
    headerBorder: '#FFC000',
    rowBackground1: '#FFD966',
    rowBackground2: '#FFC93D',
    dataText: '#000000',
    totalBackground: '#FFC000',
    totalText: '#000000',
    borderColor: '#FFC000',
  },
  dark6: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#5B9BD5',
    rowBackground1: '#9DC3E6',
    rowBackground2: '#7DAFE0',
    dataText: '#000000',
    totalBackground: '#5B9BD5',
    totalText: '#FFFFFF',
    borderColor: '#5B9BD5',
  },
  dark7: {
    headerBackground: '#70AD47',
    headerText: '#FFFFFF',
    headerBorder: '#70AD47',
    rowBackground1: '#A9D18E',
    rowBackground2: '#8CC265',
    dataText: '#000000',
    totalBackground: '#70AD47',
    totalText: '#FFFFFF',
    borderColor: '#70AD47',
  },
  dark8: {
    headerBackground: '#4472C4',
    headerText: '#FFFFFF',
    headerBorder: '#2F5496',
    rowBackground1: '#4472C4',
    rowBackground2: '#2F5496',
    dataText: '#FFFFFF',
    totalBackground: '#2F5496',
    totalText: '#FFFFFF',
    borderColor: '#2F5496',
  },
  dark9: {
    headerBackground: '#ED7D31',
    headerText: '#FFFFFF',
    headerBorder: '#C65911',
    rowBackground1: '#ED7D31',
    rowBackground2: '#C65911',
    dataText: '#FFFFFF',
    totalBackground: '#C65911',
    totalText: '#FFFFFF',
    borderColor: '#C65911',
  },
  dark10: {
    headerBackground: '#A5A5A5',
    headerText: '#FFFFFF',
    headerBorder: '#7F7F7F',
    rowBackground1: '#A5A5A5',
    rowBackground2: '#7F7F7F',
    dataText: '#FFFFFF',
    totalBackground: '#7F7F7F',
    totalText: '#FFFFFF',
    borderColor: '#7F7F7F',
  },
  dark11: {
    headerBackground: '#5B9BD5',
    headerText: '#FFFFFF',
    headerBorder: '#2E75B6',
    rowBackground1: '#5B9BD5',
    rowBackground2: '#2E75B6',
    dataText: '#FFFFFF',
    totalBackground: '#2E75B6',
    totalText: '#FFFFFF',
    borderColor: '#2E75B6',
  },
};

// =============================================================================
// Style Lookup
// =============================================================================

/**
 * All table style presets.
 */
const ALL_STYLES: Record<string, TableStyleColors> = {
  ...LIGHT_STYLES,
  ...MEDIUM_STYLES,
  ...DARK_STYLES,
};

/**
 * Default style when no preset specified.
 */
const DEFAULT_STYLE: TableStyleColors = MEDIUM_STYLES.medium2;

/**
 * Get the color scheme for a table style preset.
 *
 * @param preset - Style preset name
 * @returns Color scheme for the preset
 */
export function getTableStyleColors(preset: TableStylePreset | undefined): TableStyleColors {
  if (!preset || preset === 'none') {
    return DEFAULT_STYLE;
  }
  return ALL_STYLES[preset] ?? DEFAULT_STYLE;
}

// =============================================================================
// Exports
// =============================================================================

export { ALL_STYLES, DARK_STYLES, DEFAULT_STYLE, LIGHT_STYLES, MEDIUM_STYLES };
