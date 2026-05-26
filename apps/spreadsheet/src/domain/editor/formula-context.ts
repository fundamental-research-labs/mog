/**
 * Formula Context Analyzer
 *
 * Pure function to analyze cursor position within a formula for autocomplete.
 * No state, no side effects - deterministic output for given input.
 *
 * Used by editor machine to compute:
 * - Which function is being edited (innermost)
 * - Which argument is current
 * - What prefix is being typed (for function name completion)
 * - Whether to show suggestions or argument hints
 *
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Function call context in the parse stack.
 * Tracks nested function calls for proper argument tracking.
 */
export interface FunctionStackEntry {
  /** Function name (uppercase) */
  name: string;
  /** Current argument index (0-based) */
  argIndex: number;
  /** Position of opening parenthesis */
  parenStart: number;
}

/**
 * Formula editing context at a given cursor position.
 * Computed by analyzeFormulaContext() pure function.
 */
export interface FormulaContext {
  /** Current function being edited (innermost). Null if not inside a function call. */
  currentFunction: string | null;

  /** Index of current argument (0-based). 0 if at first argument or not in function. */
  currentArgIndex: number;

  /** Stack of nested functions for context (outermost first). */
  functionStack: FunctionStackEntry[];

  /** Text being typed for function name completion (e.g., "SU" when typing "=SU"). Null if not typing a function name. */
  functionPrefix: string | null;

  /** Whether cursor is in a position where function suggestions should show. */
  shouldShowSuggestions: boolean;

  /** Whether cursor is inside function parens (should show argument hint). */
  shouldShowArgumentHint: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Characters that can precede a function name.
 * Used to detect when we're starting to type a function name.
 */
const FUNCTION_START_CHARS = new Set([
  '',
  '=',
  '(',
  ',',
  '+',
  '-',
  '*',
  '/',
  '&',
  ' ',
  '^',
  '<',
  '>',
  '%',
]);

/**
 * Characters that are valid in function names.
 * Excel function names can contain letters, digits, periods, and underscores.
 */
const FUNCTION_NAME_CHAR_REGEX = /[A-Z0-9_.]/i;

/**
 * Characters that start a function name.
 * Must start with a letter.
 */
const FUNCTION_NAME_START_REGEX = /[A-Z]/i;

// =============================================================================
// ANALYZER
// =============================================================================

/**
 * Analyze formula to determine editing context.
 * Pure function - no side effects, deterministic output.
 *
 * @param formula The formula string (including leading =)
 * @param cursorPosition Cursor position within formula (0-based)
 * @returns FormulaContext describing what's being edited
 */
export function analyzeFormulaContext(formula: string, cursorPosition: number): FormulaContext {
  const context: FormulaContext = {
    currentFunction: null,
    currentArgIndex: 0,
    functionStack: [],
    functionPrefix: null,
    shouldShowSuggestions: false,
    shouldShowArgumentHint: false,
  };

  // Non-formula strings don't have formula context
  if (!formula.startsWith('=')) {
    return context;
  }

  // Track parsing state
  let i = 1; // Skip leading =
  let currentFuncName = '';
  let funcNameStart = -1;
  let inString = false;
  let stringChar = '';

  // Parse up to cursor position
  while (i < cursorPosition && i < formula.length) {
    const char = formula[i];
    const prevChar = i > 0 ? formula[i - 1] : '';

    // Handle string literals - don't parse function names inside strings
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      funcNameStart = -1;
      currentFuncName = '';
      i++;
      continue;
    }
    if (inString && char === stringChar) {
      // Check for escaped quote (two quotes in a row)
      const nextChar = i + 1 < formula.length ? formula[i + 1] : '';
      if (nextChar === stringChar) {
        i += 2; // Skip both quotes
        continue;
      }
      inString = false;
      i++;
      continue;
    }
    if (inString) {
      i++;
      continue;
    }

    // Function name detection
    if (FUNCTION_NAME_START_REGEX.test(char) && funcNameStart === -1) {
      // Check if this could be start of function name (preceded by operator/delimiter)
      if (FUNCTION_START_CHARS.has(prevChar)) {
        funcNameStart = i;
        currentFuncName = char;
      }
    } else if (funcNameStart !== -1 && FUNCTION_NAME_CHAR_REGEX.test(char)) {
      // Continue building function name
      currentFuncName += char;
    } else if (funcNameStart !== -1) {
      // Function name ended
      if (char === '(') {
        // This is a function call - push to stack
        context.functionStack.push({
          name: currentFuncName.toUpperCase(),
          argIndex: 0,
          parenStart: i,
        });
      }
      // Reset function name tracking
      funcNameStart = -1;
      currentFuncName = '';
    }

    // Track parentheses and argument positions
    if (char === '(' && funcNameStart === -1) {
      // Opening paren that's not part of a function call (e.g., grouping)
      // We don't push these to the function stack
    } else if (char === ')') {
      // Closing paren - pop the most recent function from stack
      if (context.functionStack.length > 0) {
        context.functionStack.pop();
      }
    } else if (char === ',' && context.functionStack.length > 0) {
      // Comma in function arguments - increment arg index of innermost function
      context.functionStack[context.functionStack.length - 1].argIndex++;
    }

    i++;
  }

  // Determine current state at cursor position
  // If we're inside a function call (stack is not empty)
  if (context.functionStack.length > 0) {
    const innermost = context.functionStack[context.functionStack.length - 1];
    context.currentFunction = innermost.name;
    context.currentArgIndex = innermost.argIndex;
    context.shouldShowArgumentHint = true;
  }

  // Check if we're typing a function name (prefix detection)
  if (funcNameStart !== -1 && cursorPosition > funcNameStart) {
    // We're in the middle of typing a function name
    const potentialPrefix = formula.slice(funcNameStart, cursorPosition).toUpperCase();

    // Check if this looks like a cell reference (e.g., A1, B2, AA10, XFD1048576)
    // Cell references: 1-3 letters followed by ONLY digits (no more letters)
    // Function names: like LOG10, CEILING.MATH - have letters after the first group or contain periods
    // Key insight:
    // - Cell refs: A1, B2, AA10, XFD1048576 - pattern is [A-Z]{1,3}[0-9]+
    // - Functions with numbers: LOG10, PERCENTILE.INC - either have 4+ leading letters or have periods
    // If prefix has 4+ leading letters before any digit, it's a function
    // If prefix contains a period, it's a function
    const letterMatch = potentialPrefix.match(/^[A-Z]+/i);
    const leadingLetterCount = letterMatch ? letterMatch[0].length : 0;
    const containsPeriod = potentialPrefix.includes('.');
    const endsWithDigit = /\d$/.test(potentialPrefix);

    // It's a cell ref if: 1-3 leading letters, ends with digit, no period
    const looksLikeCellRef =
      leadingLetterCount >= 1 && leadingLetterCount <= 3 && endsWithDigit && !containsPeriod;

    if (!looksLikeCellRef) {
      context.functionPrefix = potentialPrefix;
      // Show suggestions after 1+ characters
      context.shouldShowSuggestions = context.functionPrefix.length >= 1;
      // Don't show argument hint when typing function name
      if (context.shouldShowSuggestions) {
        context.shouldShowArgumentHint = false;
      }
    }
  }

  // Also check if cursor is right after '=' or an operator (ready to type function)
  if (!context.functionPrefix && cursorPosition > 0) {
    const charBefore = formula[cursorPosition - 1];
    if (
      charBefore === '=' ||
      charBefore === '(' ||
      charBefore === ',' ||
      charBefore === '+' ||
      charBefore === '-' ||
      charBefore === '*' ||
      charBefore === '/' ||
      charBefore === '&' ||
      charBefore === '^'
    ) {
      // Cursor is right after operator - if they type a letter, suggestions will show
      // But don't show empty suggestions list
    }
  }

  return context;
}

/**
 * Check if a character at position is inside a string literal.
 * Utility for external use.
 */
export function isInsideString(formula: string, position: number): boolean {
  if (!formula.startsWith('=')) return false;

  let inString = false;
  let stringChar = '';

  for (let i = 1; i < position && i < formula.length; i++) {
    const char = formula[i];

    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar) {
      // Check for escaped quote
      const nextChar = i + 1 < formula.length ? formula[i + 1] : '';
      if (nextChar === stringChar) {
        i++; // Skip escaped quote
      } else {
        inString = false;
      }
    }
  }

  return inString;
}
