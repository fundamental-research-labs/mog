/**
 * Formula Syntax Highlighter Component
 *
 * Provides visual feedback for formula structure with colored syntax highlighting.
 * Uses an overlay approach where highlighted tokens are rendered behind a transparent input.
 *
 * Features:
 * - Token-based coloring (functions, cell references, numbers, strings, operators)
 * - Parentheses matching with nesting level colors
 * - Highlights matching parenthesis pair when cursor is adjacent to a paren
 * - Error highlighting for unmatched parentheses
 *
 */

import { useCallback, useMemo } from 'react';

// =============================================================================
// Types
// =============================================================================

/** Token types for syntax highlighting */
export type TokenType =
  | 'function' // SUM, IF, VLOOKUP
  | 'cellRef' // A1, $B$2, AA123
  | 'number' // 100, 3.14, 50%
  | 'string' // "text"
  | 'operator' // +, -, *, /, ^, &, <, >, =
  | 'paren' // ( or )
  | 'comma' // ,
  | 'colon' // : (for ranges)
  | 'sheetRef' // Sheet1!
  | 'boolean' // TRUE, FALSE
  | 'error' // Syntax errors
  | 'text'; // Default/other

/** A single token from the formula */
export interface FormulaToken {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  /** For parentheses: nesting depth (0-based) */
  nestingLevel?: number;
  /** For parentheses: position of matching paren, -1 if unmatched */
  matchingParenPosition?: number;
}

/**
 * Range color mapping for cell references.
 * Maps character position ranges in the formula to colors.
 * Used to sync formula bar syntax highlighting with grid range box colors.
 */
export interface ReferenceColorRange {
  /** Start position in formula string (0-indexed) */
  startPos: number;
  /** End position in formula string (exclusive) */
  endPos: number;
  /** Color for this reference (from FORMULA_RANGE_COLORS) */
  color: string;
}

/** Props for the FormulaHighlighter component */
export interface FormulaHighlighterProps {
  /** The formula string to highlight */
  formula: string;
  /** Current cursor position (for parentheses matching) */
  cursorPosition?: number;
  /** Whether the formula bar is currently editing */
  isEditing?: boolean;
  /**
   * Optional color mappings for cell references.
   * When provided, cell references use these colors to match
   * the range box colors in the grid (Excel parity).
   * When not provided, uses static green for all cell references.
   */
  referenceColors?: ReferenceColorRange[];
}

// =============================================================================
// Token Colors (CSS custom properties for theming)
// =============================================================================

/** Colors for each token type - using CSS variables for theme support */
const TOKEN_COLORS: Record<TokenType, string> = {
  function: 'var(--formula-function, var(--color-ss-primary))', // Blue for functions
  cellRef: 'var(--formula-cellref, var(--color-ss-success))', // Green for cell references
  number: 'var(--formula-number, inherit)', // Default for numbers
  string: 'var(--formula-string, var(--color-ss-error))', // Red/maroon for strings
  operator: 'var(--formula-operator, inherit)', // Default for operators
  paren: 'var(--formula-paren, inherit)', // Default, overridden by nesting
  comma: 'var(--formula-comma, inherit)', // Default for commas
  colon: 'var(--formula-colon, var(--color-ss-success))', // Green like cell refs (part of ranges)
  sheetRef: 'var(--formula-sheetref, var(--color-ss-warning))', // Brown for sheet names
  boolean: 'var(--formula-boolean, var(--color-ss-primary))', // Blue for TRUE/FALSE
  error: 'var(--formula-error, var(--color-ss-error))', // Red for errors
  text: 'inherit', // Default color
};

/** Colors for nested parentheses by depth level */
const PAREN_NESTING_COLORS = [
  'var(--formula-paren-0, #000000)', // Level 0: black
  'var(--formula-paren-1, #0066cc)', // Level 1: blue
  'var(--formula-paren-2, #cc6600)', // Level 2: orange
  'var(--formula-paren-3, #006600)', // Level 3: green
  'var(--formula-paren-4, #660066)', // Level 4: purple
  'var(--formula-paren-5, #663300)', // Level 5+: brown
];

/** Background color for matching parentheses */
const MATCHING_PAREN_BG = 'var(--formula-paren-match-bg, rgba(255, 255, 0, 0.3))';

/** Background color for unmatched parentheses */
const UNMATCHED_PAREN_BG = 'var(--formula-paren-error-bg, rgba(255, 0, 0, 0.2))';

// =============================================================================
// Tokenizer
// =============================================================================

/**
 * Known Excel function names (subset for highlighting).
 * Using uppercase for comparison.
 */
const KNOWN_FUNCTIONS = new Set([
  // Math
  'SUM',
  'AVERAGE',
  'COUNT',
  'MAX',
  'MIN',
  'ABS',
  'ROUND',
  'ROUNDUP',
  'ROUNDDOWN',
  'CEILING',
  'FLOOR',
  'MOD',
  'ADD',
  'MINUS',
  'MULTIPLY',
  'DIVIDE',
  'POW',
  'UMINUS',
  'UPLUS',
  'UNARY_PERCENT',
  'POWER',
  'SQRT',
  'LOG',
  'LOG10',
  'LN',
  'EXP',
  'PI',
  'RAND',
  'RANDBETWEEN',
  'PRODUCT',
  'SUMPRODUCT',
  'SUMIF',
  'SUMIFS',
  'COUNTIF',
  'COUNTIFS',
  'AVERAGEIF',
  'AVERAGEIFS',
  // Lookup
  'VLOOKUP',
  'HLOOKUP',
  'LOOKUP',
  'INDEX',
  'MATCH',
  'XLOOKUP',
  'XMATCH',
  'OFFSET',
  'INDIRECT',
  'ROW',
  'COLUMN',
  'ROWS',
  'COLUMNS',
  'ADDRESS',
  'SINGLE',
  'ANCHORARRAY',
  // Text
  'CONCAT',
  'CONCATENATE',
  'LEFT',
  'RIGHT',
  'MID',
  'LEN',
  'FIND',
  'SEARCH',
  'REPLACE',
  'SUBSTITUTE',
  'TRIM',
  'UPPER',
  'LOWER',
  'PROPER',
  'TEXT',
  'VALUE',
  'TEXTJOIN',
  'CHAR',
  'CODE',
  // Logical
  'IF',
  'IFS',
  'AND',
  'OR',
  'NOT',
  'XOR',
  'TRUE',
  'FALSE',
  'IFERROR',
  'IFNA',
  'SWITCH',
  'EQ',
  'NE',
  'GT',
  'GTE',
  'LT',
  'LTE',
  // Date/Time
  'TODAY',
  'NOW',
  'DATE',
  'YEAR',
  'MONTH',
  'DAY',
  'HOUR',
  'MINUTE',
  'SECOND',
  'WEEKDAY',
  'WEEKNUM',
  'EDATE',
  'EOMONTH',
  'DATEDIF',
  'NETWORKDAYS',
  // Info
  'ISBLANK',
  'ISERROR',
  'ISNA',
  'ISNUMBER',
  'ISTEXT',
  'ISLOGICAL',
  'ISREF',
  'TYPE',
  'NA',
  // Array/Dynamic
  'FILTER',
  'SORT',
  'SORTBY',
  'UNIQUE',
  'SEQUENCE',
  'RANDARRAY',
  'LET',
  'LAMBDA',
  'CHOOSECOLS',
  'CHOOSEROWS',
  'VSTACK',
  'HSTACK',
  'WRAPROWS',
  'WRAPCOLS',
  'TOCOL',
  'TOROW',
  // Statistical
  'MEDIAN',
  'MODE',
  'STDEV',
  'STDEV.S',
  'STDEV.P',
  'VAR',
  'VAR.S',
  'VAR.P',
  'PERCENTILE',
  'PERCENTILE.INC',
  'PERCENTILE.EXC',
  'QUARTILE',
  'LARGE',
  'SMALL',
  'RANK',
  'RANK.EQ',
  'RANK.AVG',
]);

/**
 * Tokenize a formula string for syntax highlighting.
 * Lightweight tokenizer that doesn't need full parsing accuracy.
 *
 * @param formula The formula string to tokenize
 * @returns Array of tokens with position information
 */
export function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];

  if (!formula || formula.length === 0) {
    return tokens;
  }

  let i = 0;
  let parenDepth = 0;
  const parenStack: number[] = []; // Stack of opening paren positions

  while (i < formula.length) {
    const char = formula[i];

    // Skip whitespace (include in output as text for proper overlay alignment)
    if (/\s/.test(char)) {
      tokens.push({ type: 'text', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // String literals
    if (char === '"') {
      const start = i;
      i++; // Skip opening quote
      while (i < formula.length) {
        if (formula[i] === '"') {
          // Check for escaped quote (doubled: "")
          if (i + 1 < formula.length && formula[i + 1] === '"') {
            i += 2; // Skip both quotes and continue parsing string
          } else {
            // End of string
            i++; // Include closing quote
            break;
          }
        } else {
          i++;
        }
      }
      tokens.push({ type: 'string', value: formula.slice(start, i), start, end: i });
      continue;
    }

    // Numbers (including percentages)
    if (
      /[0-9]/.test(char) ||
      (char === '.' && i + 1 < formula.length && /[0-9]/.test(formula[i + 1]))
    ) {
      const start = i;
      // Match integer or decimal
      while (i < formula.length && /[0-9.]/.test(formula[i])) {
        i++;
      }
      // Match optional percentage sign
      if (i < formula.length && formula[i] === '%') {
        i++;
      }
      tokens.push({ type: 'number', value: formula.slice(start, i), start, end: i });
      continue;
    }

    // Cell references and function names (start with letter or $)
    if (/[A-Za-z_$]/.test(char)) {
      const start = i;
      // Match identifier (letters, digits, underscores, $, dots for functions like STDEV.S)
      while (i < formula.length && /[A-Za-z0-9_$.]/.test(formula[i])) {
        i++;
      }
      const value = formula.slice(start, i);
      const upperValue = value.toUpperCase();

      // Check if followed by ( - it's a function
      const isFollowedByParen = i < formula.length && formula[i] === '(';

      // Check if followed by ! - it's a sheet reference
      if (i < formula.length && formula[i] === '!') {
        // Include the ! in the sheet reference
        i++;
        tokens.push({ type: 'sheetRef', value: formula.slice(start, i), start, end: i });
        continue;
      }

      // Determine token type
      let type: TokenType;

      if (upperValue === 'TRUE' || upperValue === 'FALSE') {
        type = 'boolean';
      } else if (isFollowedByParen || KNOWN_FUNCTIONS.has(upperValue)) {
        type = 'function';
      } else if (isCellReference(value)) {
        type = 'cellRef';
      } else {
        // Could be a named range or other identifier
        type = 'text';
      }

      tokens.push({ type, value, start, end: i });
      continue;
    }

    // Operators
    if ('+-*/^&'.includes(char)) {
      tokens.push({ type: 'operator', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Comparison operators (may be 2 chars: <>, <=, >=)
    if ('<>='.includes(char)) {
      const start = i;
      i++;
      // Check for two-character operators
      if (i < formula.length && '>='.includes(formula[i])) {
        i++;
      }
      tokens.push({ type: 'operator', value: formula.slice(start, i), start, end: i });
      continue;
    }

    // Parentheses
    if (char === '(') {
      const matchIdx = tokens.length;
      parenStack.push(matchIdx);
      tokens.push({
        type: 'paren',
        value: char,
        start: i,
        end: i + 1,
        nestingLevel: parenDepth,
        matchingParenPosition: -1, // Will be updated when we find closing paren
      });
      parenDepth++;
      i++;
      continue;
    }

    if (char === ')') {
      parenDepth--;
      const matchingOpenIdx = parenStack.pop();
      const closingToken: FormulaToken = {
        type: 'paren',
        value: char,
        start: i,
        end: i + 1,
        nestingLevel: parenDepth >= 0 ? parenDepth : 0,
        matchingParenPosition: matchingOpenIdx !== undefined ? tokens[matchingOpenIdx].start : -1,
      };

      // Update the matching opening paren with this position
      if (matchingOpenIdx !== undefined) {
        tokens[matchingOpenIdx].matchingParenPosition = i;
      }

      tokens.push(closingToken);
      i++;
      continue;
    }

    // Comma
    if (char === ',') {
      tokens.push({ type: 'comma', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Colon (for ranges)
    if (char === ':') {
      tokens.push({ type: 'colon', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Exclamation (for sheet references - usually captured with identifier above)
    if (char === '!') {
      tokens.push({ type: 'text', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Square brackets (for structured references)
    if (char === '[' || char === ']' || char === '@' || char === '#') {
      tokens.push({ type: 'text', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Default: treat as text
    tokens.push({ type: 'text', value: char, start: i, end: i + 1 });
    i++;
  }

  // Mark any unmatched opening parens as errors
  for (const openIdx of parenStack) {
    tokens[openIdx].matchingParenPosition = -1;
  }

  return tokens;
}

/**
 * Check if a string looks like a cell reference.
 * Matches patterns like: A1, $A$1, AA123, $a$1 (case-insensitive)
 */
function isCellReference(value: string): boolean {
  // Remove leading $ signs and check pattern
  const normalized = value.replace(/\$/g, '');
  // Pattern: 1-3 letters followed by 1+ digits
  return /^[A-Za-z]{1,3}[0-9]+$/.test(normalized);
}

/**
 * Find positions of parentheses that should be highlighted as a matching pair.
 *
 * @param tokens The tokenized formula
 * @param cursorPosition Current cursor position
 * @returns Array of positions to highlight (0, 1, or 2 positions)
 */
export function findMatchingParenPositions(
  tokens: FormulaToken[],
  cursorPosition: number,
): number[] {
  // Find if cursor is adjacent to a parenthesis
  // "Adjacent" means cursor is right before or right after the paren

  for (const token of tokens) {
    if (token.type !== 'paren') continue;

    // Check if cursor is right after this paren (e.g., "SUM(|..." where | is cursor)
    // or right before this paren
    const isAdjacentAfter = cursorPosition === token.end;
    const isAdjacentBefore = cursorPosition === token.start;

    if (isAdjacentAfter || isAdjacentBefore) {
      const positions = [token.start];

      // Add matching paren if exists
      if (token.matchingParenPosition !== undefined && token.matchingParenPosition >= 0) {
        positions.push(token.matchingParenPosition);
      }

      return positions;
    }
  }

  return [];
}

// =============================================================================
// Component
// =============================================================================

/**
 * FormulaHighlighter renders a formula with syntax highlighting.
 * Designed to be used as an overlay behind an input field.
 *
 * @example
 * ```tsx
 * <div className="relative">
 * <FormulaHighlighter formula={value} cursorPosition={cursor} />
 * <input
 * value={value}
 * className="absolute inset-0 bg-transparent text-transparent caret-black"
 * />
 * </div>
 * ```
 */
export function FormulaHighlighter({
  formula,
  cursorPosition = 0,
  isEditing = false,
  referenceColors,
}: FormulaHighlighterProps) {
  // Tokenize the formula
  const tokens = useMemo(() => tokenizeFormula(formula), [formula]);

  // Find matching parentheses to highlight
  const matchingParenPositions = useMemo(
    () => (isEditing ? findMatchingParenPositions(tokens, cursorPosition) : []),
    [tokens, cursorPosition, isEditing],
  );

  const matchingSet = useMemo(() => new Set(matchingParenPositions), [matchingParenPositions]);

  /**
   * Get color for a cell reference token based on its position.
   * Returns the matching color from referenceColors if available,
   * otherwise falls back to the default green color.
   */
  const getReferenceColor = useCallback(
    (token: FormulaToken): string => {
      if (!referenceColors || referenceColors.length === 0) {
        return TOKEN_COLORS.cellRef;
      }
      // Find the reference color that contains this token's position
      const colorRange = referenceColors.find(
        (rc) => token.start >= rc.startPos && token.end <= rc.endPos,
      );
      return colorRange?.color ?? TOKEN_COLORS.cellRef;
    },
    [referenceColors],
  );

  // Render tokens with appropriate styling
  return (
    <span
      className="pointer-events-none whitespace-pre"
      style={{
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        letterSpacing: 'inherit',
      }}
      aria-hidden="true"
    >
      {tokens.map((token, index) => {
        // Determine color
        let color = TOKEN_COLORS[token.type];
        let backgroundColor = 'transparent';

        // Special handling for cell references - use formula range colors
        // This syncs the formula bar syntax highlighting with grid range box colors
        if (token.type === 'cellRef') {
          color = getReferenceColor(token);
        }

        // Special handling for parentheses
        if (token.type === 'paren') {
          // Use nesting-based color
          const nestLevel = token.nestingLevel ?? 0;
          const colorIndex = Math.min(nestLevel, PAREN_NESTING_COLORS.length - 1);
          color = PAREN_NESTING_COLORS[colorIndex];

          // Check if this paren should be highlighted (matching pair)
          if (matchingSet.has(token.start)) {
            if (token.matchingParenPosition === -1) {
              // Unmatched paren - error highlighting
              backgroundColor = UNMATCHED_PAREN_BG;
              color = 'var(--formula-error, var(--color-ss-error))';
            } else {
              // Matched paren - highlight both
              backgroundColor = MATCHING_PAREN_BG;
            }
          }
        }

        return (
          <span
            key={`${index}-${token.start}`}
            data-token-type={token.type}
            data-formula-token={token.value}
            style={{
              color,
              backgroundColor,
              borderRadius: backgroundColor !== 'transparent' ? '2px' : undefined,
            }}
          >
            {token.value}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Hook to get syntax highlighting props for use with FormulaBar.
 * Returns the tokens and any calculated highlighting data.
 */
export function useFormulaHighlighting(
  formula: string,
  cursorPosition: number,
  isEditing: boolean,
) {
  const tokens = useMemo(() => tokenizeFormula(formula), [formula]);

  const matchingParenPositions = useMemo(
    () => (isEditing ? findMatchingParenPositions(tokens, cursorPosition) : []),
    [tokens, cursorPosition, isEditing],
  );

  return {
    tokens,
    matchingParenPositions,
    hasUnmatchedParens: tokens.some((t) => t.type === 'paren' && t.matchingParenPosition === -1),
  };
}
