import { createScaffoldFont, measureTextWidth } from '../text/afm-metrics';
import {
  computeAlignmentX,
  computeAlignmentY,
  getAscender,
  getDescender,
  getXHeight,
  measureSingleText,
  measureTextRuns,
  wrapText,
} from '../text/text-layout';
import type { FontHandle, TextRun } from '../types';

describe('text-layout', () => {
  const font: FontHandle = createScaffoldFont();
  const boldFont: FontHandle = createScaffoldFont('helvetica', 'bold');
  const size = 12;

  describe('wrapText', () => {
    it('returns single line when text fits', () => {
      const lines = wrapText('Hello', font, size, 200);
      expect(lines).toEqual(['Hello']);
    });

    it('wraps text at word boundaries', () => {
      const lines = wrapText('Hello World Foo Bar', font, size, 50);
      expect(lines.length).toBeGreaterThan(1);
      // Each line should be a valid substring
      for (const line of lines) {
        expect(line.length).toBeGreaterThan(0);
      }
    });

    it('handles single long word that exceeds maxWidth', () => {
      const lines = wrapText('Supercalifragilisticexpialidocious', font, size, 10);
      // Even if the word exceeds max width, it should still appear (no infinite loop)
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0]).toContain('Supercalifragilisticexpialidocious');
    });

    it('handles empty string', () => {
      const lines = wrapText('', font, size, 200);
      expect(lines).toEqual(['']);
    });

    it('handles zero maxWidth', () => {
      const lines = wrapText('Hello World', font, size, 0);
      expect(lines).toEqual(['Hello World']);
    });

    it('handles negative maxWidth', () => {
      const lines = wrapText('Hello World', font, size, -10);
      expect(lines).toEqual(['Hello World']);
    });

    it('preserves words correctly across line breaks', () => {
      // Measure "Hello " to know what fits
      const helloWidth = measureTextWidth('Hello ', font, size);
      const worldWidth = measureTextWidth('World', font, size);
      const totalWidth = helloWidth + worldWidth;

      // Set maxWidth to just enough for "Hello " but not "Hello World"
      const lines = wrapText('Hello World', font, size, helloWidth + 1);
      // Should fit on one line since helloWidth + 1 < totalWidth only if worldWidth > 1
      if (helloWidth + 1 < totalWidth) {
        expect(lines.length).toBe(2);
      }
    });
  });

  describe('measureSingleText', () => {
    it('measures single line text', () => {
      const result = measureSingleText('Hello', font, size, 200, 14);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBe(14); // 1 line * 14pt line height
      expect(result.lines).toEqual(['Hello']);
    });

    it('measures multi-line text', () => {
      const result = measureSingleText('Hello World Foo Bar Baz', font, size, 40, 14);
      expect(result.lines.length).toBeGreaterThan(1);
      expect(result.height).toBe(result.lines.length * 14);
    });
  });

  describe('measureTextRuns', () => {
    it('measures a single run', () => {
      const runs: TextRun[] = [{ text: 'Hello World' }];
      const result = measureTextRuns(runs, 200, font, size);
      expect(result.width).toBeGreaterThan(0);
      expect(result.lines.length).toBeGreaterThanOrEqual(1);
    });

    it('measures multiple runs on a single line', () => {
      const runs: TextRun[] = [{ text: 'Hello ', bold: true }, { text: 'World' }];
      const result = measureTextRuns(runs, 500, font, size);
      expect(result.lines.length).toBe(1);
      expect(result.lines[0].runs.length).toBe(2);
    });

    it('wraps runs across lines', () => {
      const runs: TextRun[] = [
        { text: 'Hello World this is a long piece of text that should wrap' },
      ];
      const result = measureTextRuns(runs, 80, font, size);
      expect(result.lines.length).toBeGreaterThan(1);
    });

    it('handles empty runs', () => {
      const runs: TextRun[] = [];
      const result = measureTextRuns(runs, 200, font, size);
      expect(result.lines.length).toBe(1);
      expect(result.width).toBe(0);
    });

    it('handles superscript/subscript runs with smaller size', () => {
      const runs: TextRun[] = [{ text: 'H' }, { text: '2', subscript: true }, { text: 'O' }];
      const result = measureTextRuns(runs, 200, font, size);
      expect(result.lines.length).toBe(1);
      expect(result.width).toBeGreaterThan(0);
    });

    it('reports correct total dimensions', () => {
      const runs: TextRun[] = [{ text: 'Test' }];
      const result = measureTextRuns(runs, 200, font, size);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });
  });

  describe('computeAlignmentX', () => {
    it('returns 0 for left alignment', () => {
      expect(computeAlignmentX(50, 200, 'left')).toBe(0);
    });

    it('centers correctly', () => {
      expect(computeAlignmentX(50, 200, 'center')).toBe(75);
    });

    it('right-aligns correctly', () => {
      expect(computeAlignmentX(50, 200, 'right')).toBe(150);
    });

    it('returns 0 for justify', () => {
      expect(computeAlignmentX(50, 200, 'justify')).toBe(0);
    });

    it('returns 0 for distributed', () => {
      expect(computeAlignmentX(50, 200, 'distributed')).toBe(0);
    });
  });

  describe('computeAlignmentY', () => {
    it('returns 0 for top alignment', () => {
      expect(computeAlignmentY(50, 200, 'top')).toBe(0);
    });

    it('centers vertically', () => {
      expect(computeAlignmentY(50, 200, 'middle')).toBe(75);
    });

    it('bottom-aligns correctly', () => {
      expect(computeAlignmentY(50, 200, 'bottom')).toBe(150);
    });
  });

  describe('font metrics helpers', () => {
    it('getAscender returns positive value', () => {
      expect(getAscender(12)).toBeGreaterThan(0);
    });

    it('getDescender returns negative value', () => {
      expect(getDescender(12)).toBeLessThan(0);
    });

    it('getXHeight returns positive value less than ascender', () => {
      const xh = getXHeight(12);
      const asc = getAscender(12);
      expect(xh).toBeGreaterThan(0);
      expect(xh).toBeLessThan(asc);
    });

    it('scales linearly with font size', () => {
      const asc12 = getAscender(12);
      const asc24 = getAscender(24);
      expect(asc24).toBeCloseTo(asc12 * 2, 5);
    });
  });
});
