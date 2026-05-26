import {
  analyzeFormulas,
  buildStyleHintsFromFormat,
  generateFormulaDocumentation,
  normalizeFormula,
} from '../internal/format-utils';

// =============================================================================
// buildStyleHintsFromFormat
// =============================================================================

describe('buildStyleHintsFromFormat', () => {
  it('returns empty array for default/empty format', () => {
    expect(buildStyleHintsFromFormat({})).toEqual([]);
  });

  it('detects bold', () => {
    expect(buildStyleHintsFromFormat({ bold: true })).toEqual(['bold']);
  });

  it('detects italic', () => {
    expect(buildStyleHintsFromFormat({ italic: true })).toEqual(['italic']);
  });

  it('detects underline (non-none)', () => {
    expect(buildStyleHintsFromFormat({ underlineType: 'single' })).toEqual(['underline']);
    expect(buildStyleHintsFromFormat({ underlineType: 'none' })).toEqual([]);
  });

  it('detects strikethrough', () => {
    expect(buildStyleHintsFromFormat({ strikethrough: true })).toEqual(['strikethrough']);
  });

  it('detects non-default background color', () => {
    expect(buildStyleHintsFromFormat({ backgroundColor: '#FFFF00' })).toEqual(['bg:#FFFF00']);
  });

  it('skips default background colors', () => {
    expect(buildStyleHintsFromFormat({ backgroundColor: '#ffffff' })).toEqual([]);
    expect(buildStyleHintsFromFormat({ backgroundColor: 'white' })).toEqual([]);
    expect(buildStyleHintsFromFormat({ backgroundColor: 'transparent' })).toEqual([]);
  });

  it('detects non-default font color', () => {
    expect(buildStyleHintsFromFormat({ fontColor: '#FF0000' })).toEqual(['color:#FF0000']);
  });

  it('skips default font colors', () => {
    expect(buildStyleHintsFromFormat({ fontColor: '#000000' })).toEqual([]);
    expect(buildStyleHintsFromFormat({ fontColor: 'black' })).toEqual([]);
  });

  it('detects number format (non-General)', () => {
    expect(buildStyleHintsFromFormat({ numberFormat: '#,##0.00' })).toEqual(['fmt:#,##0.00']);
    expect(buildStyleHintsFromFormat({ numberFormat: 'General' })).toEqual([]);
  });

  it('combines multiple hints', () => {
    const hints = buildStyleHintsFromFormat({
      bold: true,
      italic: true,
      backgroundColor: '#FFFF00',
    });
    expect(hints).toEqual(['bold', 'italic', 'bg:#FFFF00']);
  });
});

// =============================================================================
// normalizeFormula
// =============================================================================

describe('normalizeFormula', () => {
  it('converts relative references to [C][R] notation', () => {
    // B5 contains =A5+A4 → same col offset, same/prev row
    expect(normalizeFormula('A5+A4', 4, 1)).toBe('[C-1][R]+[C-1][R-1]');
  });

  it('handles same-cell reference as [C][R]', () => {
    expect(normalizeFormula('B2', 1, 1)).toBe('[C][R]');
  });

  it('handles positive offsets', () => {
    // A1 references C3 → col+2, row+2
    expect(normalizeFormula('C3', 0, 0)).toBe('[C+2][R+2]');
  });

  it('handles SUM with range', () => {
    expect(normalizeFormula('SUM(A1:A10)', 2, 2)).toBe('SUM([C-2][R-2]:[C-2][R+7])');
  });

  it('preserves fully absolute reference as-is', () => {
    expect(normalizeFormula('$A$1+B2', 1, 1)).toBe('$A$1+[C][R]');
  });

  it('preserves absolute column reference as-is', () => {
    expect(normalizeFormula('$A1', 0, 1)).toBe('$A1');
  });

  it('preserves absolute row reference as-is', () => {
    expect(normalizeFormula('A$1', 0, 1)).toBe('A$1');
  });

  it('preserves sheet references', () => {
    const result = normalizeFormula('Sheet1!A1+B2', 1, 1);
    expect(result).toBe('Sheet1![C-1][R-1]+[C][R]');
  });

  it('preserves quoted sheet references', () => {
    const result = normalizeFormula("'My Sheet'!A1", 0, 0);
    expect(result).toBe("'My Sheet'![C][R]");
  });
});

// =============================================================================
// analyzeFormulas
// =============================================================================

describe('analyzeFormulas', () => {
  it('returns empty maps for no formulas', () => {
    const result = analyzeFormulas([]);
    expect(result.patterns.size).toBe(0);
    expect(result.formulaToId.size).toBe(0);
  });

  it('groups cells by normalized pattern', () => {
    // Two cells with the same structural formula: =A{row} (column to the left, same row)
    const cells = [
      { row: 0, col: 1, formula: 'A1', value: 10 },
      { row: 1, col: 1, formula: 'A2', value: 20 },
    ];
    const result = analyzeFormulas(cells, 2);
    expect(result.patterns.size).toBe(1);
    const pattern = result.patterns.values().next().value!;
    expect(pattern.cells).toHaveLength(2);
    expect(pattern.id).toBe('F1');
  });

  it('assigns different IDs to different patterns', () => {
    const cells = [
      { row: 0, col: 2, formula: 'A1+B1', value: 10 },
      { row: 0, col: 3, formula: 'SUM(A1:C1)', value: 30 },
    ];
    const result = analyzeFormulas(cells, 1);
    expect(result.patterns.size).toBe(2);
  });

  it('only abbreviates patterns meeting the threshold', () => {
    const cells = [
      { row: 0, col: 1, formula: 'A1', value: 10 },
      { row: 1, col: 1, formula: 'A2', value: 20 },
    ];
    // threshold=3 → 2 cells not enough
    const result = analyzeFormulas(cells, 3);
    expect(result.formulaToId.size).toBe(0);

    // threshold=2 → qualifies
    const result2 = analyzeFormulas(cells, 2);
    expect(result2.formulaToId.size).toBe(2);
    expect(result2.formulaToId.get('0,1')).toBe('F1');
    expect(result2.formulaToId.get('1,1')).toBe('F1');
  });

  it('defaults to threshold of 10', () => {
    const cells = Array.from({ length: 9 }, (_, i) => ({
      row: i,
      col: 1,
      formula: `A${i + 1}`,
      value: i,
    }));
    const result = analyzeFormulas(cells);
    expect(result.minCellsForAbbreviation).toBe(10);
    expect(result.formulaToId.size).toBe(0); // 9 < 10

    cells.push({ row: 9, col: 1, formula: 'A10', value: 9 });
    const result2 = analyzeFormulas(cells);
    expect(result2.formulaToId.size).toBe(10); // 10 >= 10
  });

  it('skips cells without formulas', () => {
    const cells = [
      { row: 0, col: 0, formula: '', value: 10 },
      { row: 1, col: 0, formula: 'A1', value: 20 },
    ];
    const result = analyzeFormulas(cells, 1);
    expect(result.patterns.size).toBe(1);
  });
});

// =============================================================================
// generateFormulaDocumentation
// =============================================================================

describe('generateFormulaDocumentation', () => {
  it('returns empty array when no patterns qualify', () => {
    const analysis = analyzeFormulas([], 1);
    expect(generateFormulaDocumentation(analysis)).toEqual([]);
  });

  it('returns empty array when patterns are below threshold', () => {
    const cells = [{ row: 0, col: 1, formula: 'A1', value: 10 }];
    const analysis = analyzeFormulas(cells, 5);
    expect(generateFormulaDocumentation(analysis)).toEqual([]);
  });

  it('generates =F{N} -> pattern (e.g. ...) format', () => {
    const cells = [
      { row: 0, col: 1, formula: 'A1', value: 10 },
      { row: 1, col: 1, formula: 'A2', value: 20 },
      { row: 2, col: 1, formula: 'A3', value: 30 },
    ];
    const analysis = analyzeFormulas(cells, 2);
    const lines = generateFormulaDocumentation(analysis);

    expect(lines.length).toBe(2); // blank line + 1 definition
    expect(lines[0]).toBe('');
    expect(lines[1]).toMatch(/^=F1 -> /);
    expect(lines[1]).toContain('(e.g. ');
    expect(lines[1]).toContain('B1: =A1');
    expect(lines[1]).toContain('B2: =A2');
  });

  it('limits examples to 2 per pattern', () => {
    const cells = Array.from({ length: 5 }, (_, i) => ({
      row: i,
      col: 1,
      formula: `A${i + 1}`,
      value: i * 10,
    }));
    const analysis = analyzeFormulas(cells, 3);
    const lines = generateFormulaDocumentation(analysis);

    const defLine = lines.find((l) => l.startsWith('=F1'));
    expect(defLine).toBeDefined();
    // Should have exactly 2 examples (B1 and B2), not B3/B4/B5
    const exampleMatches = defLine!.match(/=A\d/g);
    expect(exampleMatches).toHaveLength(2);
  });

  it('produces multiple definitions sorted by ID', () => {
    // Two different patterns
    const cells = [
      { row: 0, col: 2, formula: 'A1+B1', value: 10 },
      { row: 1, col: 2, formula: 'A2+B2', value: 20 },
      { row: 0, col: 3, formula: 'SUM(A1:C1)', value: 30 },
      { row: 1, col: 3, formula: 'SUM(A2:C2)', value: 60 },
    ];
    const analysis = analyzeFormulas(cells, 2);
    const lines = generateFormulaDocumentation(analysis);

    const defs = lines.filter((l) => l.startsWith('=F'));
    expect(defs).toHaveLength(2);
    expect(defs[0]).toMatch(/^=F1/);
    expect(defs[1]).toMatch(/^=F2/);
  });
});
