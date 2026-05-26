/**
 * Tests for analyzeFormulaContext — the pure function that drives autocomplete.
 *
 * Covers:
 * - Basic function prefix detection (=SU → shouldShowSuggestions)
 * - Nested function contexts (=SUM(AV → suggests AVERAGE)
 * - Operators and commas as function-start triggers
 * - Cell reference vs function name disambiguation
 * - String literal handling (no suggestions inside strings)
 * - Argument tracking (currentFunction, currentArgIndex)
 */

import { analyzeFormulaContext } from '../formula-context';

describe('analyzeFormulaContext', () => {
  // =========================================================================
  // Basic prefix detection
  // =========================================================================

  it('returns no suggestions for non-formula strings', () => {
    const ctx = analyzeFormulaContext('hello', 5);
    expect(ctx.shouldShowSuggestions).toBe(false);
    expect(ctx.functionPrefix).toBeNull();
  });

  it('returns no suggestions for just "="', () => {
    const ctx = analyzeFormulaContext('=', 1);
    expect(ctx.shouldShowSuggestions).toBe(false);
    expect(ctx.functionPrefix).toBeNull();
  });

  it('detects function prefix after "=" (=S)', () => {
    const ctx = analyzeFormulaContext('=S', 2);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('S');
  });

  it('detects function prefix after "=" (=SU)', () => {
    const ctx = analyzeFormulaContext('=SU', 3);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('SU');
  });

  it('detects function prefix after "=" (=SUM)', () => {
    const ctx = analyzeFormulaContext('=SUM', 4);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('SUM');
  });

  it('no suggestions when cursor is inside completed function call', () => {
    // =SUM( with cursor after (
    const ctx = analyzeFormulaContext('=SUM(', 5);
    expect(ctx.shouldShowSuggestions).toBe(false);
    expect(ctx.currentFunction).toBe('SUM');
    expect(ctx.shouldShowArgumentHint).toBe(true);
  });

  // =========================================================================
  // Nested functions
  // =========================================================================

  it('detects prefix inside nested function (=SUM(AV)', () => {
    const ctx = analyzeFormulaContext('=SUM(AV', 7);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('AV');
    // Still inside SUM's argument
    expect(ctx.functionStack.length).toBe(1);
    expect(ctx.functionStack[0].name).toBe('SUM');
  });

  it('detects prefix after comma (=IF(A1,SU)', () => {
    const ctx = analyzeFormulaContext('=IF(A1,SU', 10);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('SU');
    expect(ctx.functionStack[0].name).toBe('IF');
    expect(ctx.functionStack[0].argIndex).toBe(1);
  });

  // =========================================================================
  // Operators as function-start triggers
  // =========================================================================

  it('detects prefix after + operator (=A1+SU)', () => {
    const ctx = analyzeFormulaContext('=A1+SU', 7);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('SU');
  });

  it('detects prefix after * operator (=2*COS)', () => {
    const ctx = analyzeFormulaContext('=2*COS', 6);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('COS');
  });

  it('detects prefix after - operator (=-SU)', () => {
    const ctx = analyzeFormulaContext('=-SU', 4);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('SU');
  });

  // =========================================================================
  // Cell reference disambiguation
  // =========================================================================

  it('does NOT suggest for cell reference A1', () => {
    const ctx = analyzeFormulaContext('=A1', 3);
    // A1 looks like a cell ref (1 letter + digit), not a function
    expect(ctx.shouldShowSuggestions).toBe(false);
  });

  it('does NOT suggest for cell reference AA10', () => {
    const ctx = analyzeFormulaContext('=AA10', 5);
    expect(ctx.shouldShowSuggestions).toBe(false);
  });

  it('DOES suggest for partial function names that look like they could be cell refs', () => {
    // "SU" has 2 letters, no digits → function prefix, not cell ref
    const ctx = analyzeFormulaContext('=SU', 3);
    expect(ctx.shouldShowSuggestions).toBe(true);
  });

  it('DOES suggest for function name with 4+ leading letters (LOG10-like)', () => {
    // "LOGI" has 4 letters → always a function, even if digits follow
    const ctx = analyzeFormulaContext('=LOGI', 5);
    expect(ctx.shouldShowSuggestions).toBe(true);
  });

  it('DOES suggest for function names containing periods', () => {
    const ctx = analyzeFormulaContext('=CEILING.M', 11);
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('CEILING.M');
  });

  // =========================================================================
  // String literal handling
  // =========================================================================

  it('does NOT suggest inside a string literal', () => {
    // =CONCAT("SU with cursor inside the string
    const ctx = analyzeFormulaContext('=CONCAT("SU', 12);
    expect(ctx.shouldShowSuggestions).toBe(false);
  });

  // =========================================================================
  // Argument tracking
  // =========================================================================

  it('tracks current function and arg index', () => {
    // =IF(A1>0, cursor after comma
    const ctx = analyzeFormulaContext('=IF(A1>0,', 10);
    expect(ctx.currentFunction).toBe('IF');
    expect(ctx.currentArgIndex).toBe(1);
    expect(ctx.shouldShowArgumentHint).toBe(true);
  });

  it('tracks nested function stack', () => {
    // =IF(SUM(A1:A2)>0,
    const ctx = analyzeFormulaContext('=IF(SUM(A1:A2)>0,', 18);
    // SUM's closing paren pops it off the stack, so only IF remains
    expect(ctx.functionStack.length).toBe(1);
    expect(ctx.currentFunction).toBe('IF');
    expect(ctx.currentArgIndex).toBe(1);
  });

  it('handles deeply nested functions', () => {
    // =IF(SUM(AV — cursor is typing AV inside SUM inside IF
    const ctx = analyzeFormulaContext('=IF(SUM(AV', 11);
    expect(ctx.functionStack.length).toBe(2);
    expect(ctx.functionStack[0].name).toBe('IF');
    expect(ctx.functionStack[1].name).toBe('SUM');
    expect(ctx.shouldShowSuggestions).toBe(true);
    expect(ctx.functionPrefix).toBe('AV');
  });
});
