/**
 * Pattern Math — shared constants and geometry for Excel pattern fill rendering.
 *
 * Both `pattern-fill.ts` (ContentOp generation) and `backend-fills.ts`
 * (RenderBackend rendering) import from here, eliminating duplicated
 * Bayer matrices, density values, and pattern dispatch logic.
 */

/**
 * All 18 Excel pattern types.
 */
export type ExcelPatternType =
  | 'none'
  | 'solid'
  | 'darkGray'
  | 'mediumGray'
  | 'lightGray'
  | 'gray125'
  | 'gray0625'
  | 'darkHorizontal'
  | 'lightHorizontal'
  | 'darkVertical'
  | 'lightVertical'
  | 'darkDown'
  | 'lightDown'
  | 'darkUp'
  | 'lightUp'
  | 'darkGrid'
  | 'lightGrid'
  | 'darkTrellis'
  | 'lightTrellis';

/** Size of each pattern tile in points. */
export const TILE_SIZE = 8;

/** All pattern types as an array for iteration. */
export const ALL_PATTERN_TYPES: ExcelPatternType[] = [
  'none',
  'solid',
  'darkGray',
  'mediumGray',
  'lightGray',
  'gray125',
  'gray0625',
  'darkHorizontal',
  'lightHorizontal',
  'darkVertical',
  'lightVertical',
  'darkDown',
  'lightDown',
  'darkUp',
  'lightUp',
  'darkGrid',
  'lightGrid',
  'darkTrellis',
  'lightTrellis',
];

// ============================================================================
// Bayer Dithering
// ============================================================================

/**
 * 8x8 Bayer dithering matrix (normalized 0-1).
 * Used by gray dot patterns for visually uniform pixel distribution.
 */
const bayer8x8: readonly (readonly number[])[] = [
  [0 / 64, 32 / 64, 8 / 64, 40 / 64, 2 / 64, 34 / 64, 10 / 64, 42 / 64],
  [48 / 64, 16 / 64, 56 / 64, 24 / 64, 50 / 64, 18 / 64, 58 / 64, 26 / 64],
  [12 / 64, 44 / 64, 4 / 64, 36 / 64, 14 / 64, 46 / 64, 6 / 64, 38 / 64],
  [60 / 64, 28 / 64, 52 / 64, 20 / 64, 62 / 64, 30 / 64, 54 / 64, 22 / 64],
  [3 / 64, 35 / 64, 11 / 64, 43 / 64, 1 / 64, 33 / 64, 9 / 64, 41 / 64],
  [51 / 64, 19 / 64, 59 / 64, 27 / 64, 49 / 64, 17 / 64, 57 / 64, 25 / 64],
  [15 / 64, 47 / 64, 7 / 64, 39 / 64, 13 / 64, 45 / 64, 5 / 64, 37 / 64],
  [63 / 64, 31 / 64, 55 / 64, 23 / 64, 61 / 64, 29 / 64, 53 / 64, 21 / 64],
];

/**
 * Determine if a pixel at (px, py) should be filled for a given density.
 * Uses the Bayer dithering matrix for visually uniform distribution.
 */
export function shouldFillPixel(px: number, py: number, density: number): boolean {
  return bayer8x8[py % 8][px % 8] < density;
}

// ============================================================================
// Pattern Tile Actions
// ============================================================================

/**
 * Declarative description of what a pattern tile needs to draw.
 * Each consumer (ContentOp generator, RenderBackend renderer) interprets
 * these actions in its own output format.
 */
export type PatternTileAction =
  | { type: 'grayDots'; density: number }
  | { type: 'horizontalLines'; lineWidth: number; spacing: number }
  | { type: 'verticalLines'; lineWidth: number; spacing: number }
  | { type: 'diagonalDown'; lineWidth: number }
  | { type: 'diagonalUp'; lineWidth: number };

/**
 * Get the tile actions for a pattern type.
 * Returns an empty array for 'none' and 'solid' (handled separately by callers).
 */
export function getPatternActions(pattern: ExcelPatternType): PatternTileAction[] {
  switch (pattern) {
    case 'none':
    case 'solid':
      return [];

    // Gray patterns (Bayer-dithered dots)
    case 'darkGray':
      return [{ type: 'grayDots', density: 0.75 }];
    case 'mediumGray':
      return [{ type: 'grayDots', density: 0.5 }];
    case 'lightGray':
      return [{ type: 'grayDots', density: 0.25 }];
    case 'gray125':
      return [{ type: 'grayDots', density: 0.125 }];
    case 'gray0625':
      return [{ type: 'grayDots', density: 0.0625 }];

    // Horizontal lines
    case 'darkHorizontal':
      return [{ type: 'horizontalLines', lineWidth: 2, spacing: 2 }];
    case 'lightHorizontal':
      return [{ type: 'horizontalLines', lineWidth: 1, spacing: 4 }];

    // Vertical lines
    case 'darkVertical':
      return [{ type: 'verticalLines', lineWidth: 2, spacing: 2 }];
    case 'lightVertical':
      return [{ type: 'verticalLines', lineWidth: 1, spacing: 4 }];

    // Diagonal down (top-left to bottom-right)
    case 'darkDown':
      return [{ type: 'diagonalDown', lineWidth: 2 }];
    case 'lightDown':
      return [{ type: 'diagonalDown', lineWidth: 1 }];

    // Diagonal up (bottom-left to top-right)
    case 'darkUp':
      return [{ type: 'diagonalUp', lineWidth: 2 }];
    case 'lightUp':
      return [{ type: 'diagonalUp', lineWidth: 1 }];

    // Cross-hatch patterns
    case 'darkGrid':
      return [
        { type: 'horizontalLines', lineWidth: 2, spacing: 2 },
        { type: 'verticalLines', lineWidth: 2, spacing: 2 },
      ];
    case 'lightGrid':
      return [
        { type: 'horizontalLines', lineWidth: 1, spacing: 4 },
        { type: 'verticalLines', lineWidth: 1, spacing: 4 },
      ];

    // Trellis patterns (diagonal cross-hatch)
    case 'darkTrellis':
      return [
        { type: 'diagonalDown', lineWidth: 2 },
        { type: 'diagonalUp', lineWidth: 2 },
      ];
    case 'lightTrellis':
      return [
        { type: 'diagonalDown', lineWidth: 1 },
        { type: 'diagonalUp', lineWidth: 1 },
      ];
  }
}
