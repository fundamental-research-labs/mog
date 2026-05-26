/**
 * Tests for columnLetter utility and OOXML column reference overflow fix
 */

import { generateBarChartXML } from '../src/export/ooxml/bar-chart-xml';
import { columnLetter } from '../src/export/ooxml/column-util';
import type { ChartSpec, DataRow } from '../src/grammar/spec';

describe('columnLetter', () => {
  it('converts single-letter columns correctly', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(1)).toBe('B');
    expect(columnLetter(2)).toBe('C');
    expect(columnLetter(25)).toBe('Z');
  });

  it('converts double-letter columns correctly', () => {
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
    expect(columnLetter(701)).toBe('ZZ');
  });

  it('converts triple-letter columns correctly', () => {
    expect(columnLetter(702)).toBe('AAA');
  });

  it('handles the values used by OOXML series (B=1, C=2, etc.)', () => {
    // The OOXML generators use columnLetter(index + 1) where index is 0-based series index
    // Series 0 -> column B (index 1)
    expect(columnLetter(1)).toBe('B');
    // Series 24 -> column Z (index 25)
    expect(columnLetter(25)).toBe('Z');
    // Series 25 -> column AA (index 26) -- this was the bug boundary
    expect(columnLetter(26)).toBe('AA');
    // Series 26 -> column AB (index 27)
    expect(columnLetter(27)).toBe('AB');
  });
});

describe('OOXML column reference overflow with 30+ series', () => {
  it('generates valid column references for bar chart with 30 series', () => {
    // Create a spec with a color field to produce multiple series
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
        color: { field: 'series', type: 'nominal' },
      },
    };

    // Create data with 30 unique series
    const data: DataRow[] = [];
    for (let s = 0; s < 30; s++) {
      for (let c = 0; c < 3; c++) {
        data.push({
          category: `Cat${c}`,
          value: s * 10 + c,
          series: `Series${s}`,
        });
      }
    }

    const result = generateBarChartXML(spec, data, { sheetName: 'Sheet1' });

    // Verify the XML contains valid column references
    // Series 25 (index 25) should produce column AA (columnLetter(26))
    // Series 26 (index 26) should produce column AB (columnLetter(27))
    expect(result.chartXml).toContain('$AA$');
    expect(result.chartXml).toContain('$AB$');

    // Verify no invalid characters like [ or \\ appear in column references
    // Old bug: String.fromCharCode(66 + 25) = '[', which is invalid
    const columnRefPattern = /\$([A-Z]+)\$/g;
    const matches = result.chartXml.match(columnRefPattern);
    expect(matches).not.toBeNull();
    for (const match of matches!) {
      const col = match.replace(/\$/g, '');
      // Every column reference should only contain uppercase letters
      expect(col).toMatch(/^[A-Z]+$/);
    }
  });
});
