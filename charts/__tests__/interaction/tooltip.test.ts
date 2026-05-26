/**
 * Tests for Tooltip Utilities
 */

import {
  extractTooltipFields,
  findAllTooltipData,
  findTooltipData,
  formatDate,
  formatNumber,
  formatTooltipHtml,
  formatTooltipText,
  formatValue,
  getMarkPosition,
  type ChartSpec,
  type DataRow,
  type EncodingSpec,
} from '../../src/interaction/tooltip';
import type { AnyMark, ArcMark, RectMark, SymbolMark } from '../../src/primitives/types';

describe('tooltip utilities', () => {
  // ==========================================================================
  // Formatting Tests
  // ==========================================================================

  describe('formatNumber', () => {
    it('formats number with locale by default', () => {
      const result = formatNumber(1234567);
      expect(result).toMatch(/1.*234.*567/); // Locale may vary
    });

    it('formats with fixed decimals (.Nf)', () => {
      expect(formatNumber(123.456, '.2f')).toBe('123.46');
      expect(formatNumber(123, '.2f')).toBe('123.00');
      expect(formatNumber(123.999, '.1f')).toBe('124.0');
    });

    it('formats as percentage (.N%)', () => {
      expect(formatNumber(0.1234, '.1%')).toBe('12.3%');
      expect(formatNumber(0.5, '.0%')).toBe('50%');
      expect(formatNumber(1.5, '.0%')).toBe('150%');
    });

    it('formats with thousands separator (,)', () => {
      expect(formatNumber(1234567, ',')).toBe('1,234,567');
      expect(formatNumber(1234567.89, ',.2f')).toBe('1,234,567.89');
    });

    it('formats with currency ($)', () => {
      expect(formatNumber(1234.56, '$,.2f')).toBe('$1,234.56');
      expect(formatNumber(99.99, '$.2f')).toBe('$99.99');
    });

    it('handles edge cases', () => {
      expect(formatNumber(0, '.2f')).toBe('0.00');
      expect(formatNumber(-1234.56, ',.2f')).toBe('-1,234.56');
    });
  });

  describe('formatDate', () => {
    it('formats date with locale by default', () => {
      const date = new Date(2024, 0, 15);
      const result = formatDate(date);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('formats with year/month/day specifiers', () => {
      const date = new Date(2024, 5, 15); // June 15, 2024
      expect(formatDate(date, '%Y-%m-%d')).toBe('2024-06-15');
    });

    it('formats with time specifiers', () => {
      const date = new Date(2024, 5, 15, 14, 30, 45);
      expect(formatDate(date, '%H:%M:%S')).toBe('14:30:45');
    });

    it('handles timestamp input', () => {
      const timestamp = new Date(2024, 5, 15).getTime();
      expect(formatDate(timestamp, '%Y-%m-%d')).toBe('2024-06-15');
    });

    it('handles string date input', () => {
      // Using full ISO format to avoid timezone issues
      const dateStr = '2024-06-15T12:00:00';
      expect(formatDate(dateStr, '%Y-%m-%d')).toBe('2024-06-15');
    });

    it('returns string for invalid date', () => {
      expect(formatDate('not a date')).toBe('not a date');
    });
  });

  describe('formatValue', () => {
    it('returns empty string for null/undefined', () => {
      expect(formatValue(null)).toBe('');
      expect(formatValue(undefined)).toBe('');
    });

    it('formats numbers', () => {
      expect(formatValue(123.456, '.2f')).toBe('123.46');
    });

    it('formats dates with temporal type', () => {
      // Using full ISO format to avoid timezone issues
      const result = formatValue('2024-06-15T12:00:00', '%Y-%m-%d', 'temporal');
      expect(result).toBe('2024-06-15');
    });

    it('converts other values to string', () => {
      expect(formatValue('hello')).toBe('hello');
      expect(formatValue(true)).toBe('true');
      expect(formatValue({ foo: 'bar' })).toBe('[object Object]');
    });
  });

  // ==========================================================================
  // Field Extraction Tests
  // ==========================================================================

  describe('extractTooltipFields', () => {
    const datum: DataRow = {
      category: 'A',
      value: 123.456,
      date: '2024-06-15',
      extra: 'data',
    };

    it('extracts all fields when no encoding provided', () => {
      const fields = extractTooltipFields(datum);
      expect(fields.length).toBe(4);
      expect(fields.find((f) => f.name === 'category')?.value).toBe('A');
      expect(fields.find((f) => f.name === 'value')?.value).toBe(123.456);
    });

    it('extracts fields from encoding channels', () => {
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative', format: '.2f' },
      };

      const fields = extractTooltipFields(datum, encoding);
      expect(fields.length).toBe(2);
      expect(fields.find((f) => f.name === 'category')).toBeDefined();
      expect(fields.find((f) => f.name === 'value')?.formatted).toBe('123.46');
    });

    it('uses title from encoding spec', () => {
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal', title: 'Product' },
        y: { field: 'value', type: 'quantitative', title: 'Sales' },
      };

      const fields = extractTooltipFields(datum, encoding);
      expect(fields.find((f) => f.name === 'Product')).toBeDefined();
      expect(fields.find((f) => f.name === 'Sales')).toBeDefined();
    });

    it('adds tooltip-specific fields', () => {
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal' },
        tooltip: [
          { field: 'extra', title: 'Extra Info' },
          { field: 'date', type: 'temporal' },
        ],
      };

      const fields = extractTooltipFields(datum, encoding);
      expect(fields.find((f) => f.name === 'Extra Info')).toBeDefined();
      expect(fields.find((f) => f.name === 'date')).toBeDefined();
    });

    it('handles single tooltip spec (not array)', () => {
      const encoding: EncodingSpec = {
        tooltip: { field: 'extra' },
      };

      const fields = extractTooltipFields(datum, encoding);
      expect(fields.find((f) => f.name === 'extra')).toBeDefined();
    });

    it('avoids duplicate fields', () => {
      const encoding: EncodingSpec = {
        x: { field: 'category', type: 'nominal' },
        tooltip: { field: 'category' },
      };

      const fields = extractTooltipFields(datum, encoding);
      const categoryFields = fields.filter((f) => f.value === 'A');
      expect(categoryFields.length).toBe(1);
    });
  });

  // ==========================================================================
  // Mark Position Tests
  // ==========================================================================

  describe('getMarkPosition', () => {
    it('returns center for rect marks', () => {
      const rect: RectMark = {
        type: 'rect',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        style: {},
      };
      const pos = getMarkPosition(rect);
      expect(pos.x).toBe(60); // 10 + 100/2
      expect(pos.y).toBe(45); // 20 + 50/2
    });

    it('returns position for symbol marks', () => {
      const symbol: SymbolMark = {
        type: 'symbol',
        x: 50,
        y: 100,
        size: 100,
        shape: 'circle',
        style: {},
      };
      const pos = getMarkPosition(symbol);
      expect(pos.x).toBe(50);
      expect(pos.y).toBe(100);
    });

    it('returns wedge center for arc marks', () => {
      const arc: ArcMark = {
        type: 'arc',
        x: 100,
        y: 100,
        innerRadius: 0,
        outerRadius: 50,
        startAngle: 0,
        endAngle: Math.PI,
        style: {},
      };
      const pos = getMarkPosition(arc);
      // Mid angle is PI/2, mid radius is 25
      // Arc convention: 0 at top (12 o'clock), clockwise
      // mathAngle = PI/2 - PI/2 = 0
      // x = 100 + cos(0) * 25 = 100 + 25 = 125
      // y = 100 + sin(0) * 25 = 100 + 0 = 100
      expect(pos.x).toBeCloseTo(125, 5);
      expect(pos.y).toBeCloseTo(100, 5);
    });
  });

  // ==========================================================================
  // Tooltip Data Functions Tests
  // ==========================================================================

  describe('findTooltipData', () => {
    const marks: AnyMark[] = [
      {
        type: 'rect',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        style: {},
        datum: { category: 'A', value: 10 },
      },
      {
        type: 'rect',
        x: 100,
        y: 0,
        width: 50,
        height: 50,
        style: {},
        datum: { category: 'B', value: 20 },
      },
      {
        type: 'symbol',
        x: 200,
        y: 25,
        size: 100,
        shape: 'circle',
        style: {},
        datum: { category: 'C', value: 30 },
      },
    ];

    const spec: ChartSpec = {
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    it('returns tooltip data for exact hit', () => {
      const result = findTooltipData(marks, 25, 25, spec);
      expect(result).not.toBeNull();
      expect(result!.datum.category).toBe('A');
      expect(result!.fields.length).toBe(2);
    });

    it('returns tooltip data for closest mark within radius', () => {
      const result = findTooltipData(marks, 195, 25, spec, { radius: 20 });
      expect(result).not.toBeNull();
      expect(result!.datum.category).toBe('C');
    });

    it('returns null when no mark found', () => {
      const result = findTooltipData(marks, 500, 500, spec);
      expect(result).toBeNull();
    });

    it('returns null for mark without datum', () => {
      const marksWithoutDatum: AnyMark[] = [
        { type: 'rect', x: 0, y: 0, width: 50, height: 50, style: {} },
      ];
      const result = findTooltipData(marksWithoutDatum, 25, 25, spec);
      expect(result).toBeNull();
    });

    it('respects useClosest option', () => {
      // Position (180, 25) is 20 pixels from the symbol at (200, 25)
      // With useClosest=false, only exact hits are returned (not nearby marks)
      const result = findTooltipData(marks, 180, 25, spec, { radius: 20, useClosest: false });
      expect(result).toBeNull();
    });
  });

  describe('findAllTooltipData', () => {
    const marks: AnyMark[] = [
      { type: 'symbol', x: 0, y: 50, size: 100, shape: 'circle', style: {}, datum: { id: 1 } },
      { type: 'symbol', x: 50, y: 50, size: 100, shape: 'circle', style: {}, datum: { id: 2 } },
      { type: 'symbol', x: 100, y: 50, size: 100, shape: 'circle', style: {}, datum: { id: 3 } },
    ];

    const spec: ChartSpec = {
      encoding: {
        x: { field: 'id', type: 'quantitative' },
      },
    };

    it('returns all marks within radius', () => {
      // Position (25, 50) is 25 from symbol 1 at (0, 50) and 25 from symbol 2 at (50, 50)
      const results = findAllTooltipData(marks, 25, 50, spec, 30);
      expect(results.length).toBe(2);
    });

    it('sorts by distance', () => {
      const results = findAllTooltipData(marks, 25, 50, spec, 30);
      // Symbol 1 at x=0 is 25 away, symbol 2 at x=50 is 25 away - both equal distance
      // But the first one should be included
      expect([1, 2]).toContain(results[0].datum.id);
    });

    it('returns empty array when no marks found', () => {
      const results = findAllTooltipData(marks, 200, 200, spec, 10);
      expect(results.length).toBe(0);
    });
  });

  // ==========================================================================
  // Formatting Output Tests
  // ==========================================================================

  describe('formatTooltipHtml', () => {
    it('generates HTML table', () => {
      const tooltipData = {
        datum: { category: 'A', value: 123 },
        mark: { type: 'rect' as const, x: 0, y: 0, width: 50, height: 50, style: {} },
        position: { x: 25, y: 25 },
        fields: [
          { name: 'Category', value: 'A', formatted: 'A' },
          { name: 'Value', value: 123, formatted: '123' },
        ],
      };

      const html = formatTooltipHtml(tooltipData);
      expect(html).toContain('<table');
      expect(html).toContain('Category');
      expect(html).toContain('Value');
      expect(html).toContain('123');
    });

    it('escapes HTML in values', () => {
      const tooltipData = {
        datum: { text: '<script>alert("xss")</script>' },
        mark: { type: 'rect' as const, x: 0, y: 0, width: 50, height: 50, style: {} },
        position: { x: 25, y: 25 },
        fields: [
          {
            name: 'Text',
            value: '<script>alert("xss")</script>',
            formatted: '<script>alert("xss")</script>',
          },
        ],
      };

      const html = formatTooltipHtml(tooltipData);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('formatTooltipText', () => {
    it('generates plain text', () => {
      const tooltipData = {
        datum: { category: 'A', value: 123 },
        mark: { type: 'rect' as const, x: 0, y: 0, width: 50, height: 50, style: {} },
        position: { x: 25, y: 25 },
        fields: [
          { name: 'Category', value: 'A', formatted: 'A' },
          { name: 'Value', value: 123, formatted: '123' },
        ],
      };

      const text = formatTooltipText(tooltipData);
      expect(text).toBe('Category: A\nValue: 123');
    });
  });
});
