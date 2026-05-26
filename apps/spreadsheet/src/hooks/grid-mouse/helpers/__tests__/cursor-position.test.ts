/**
 * Cursor Position Tests
 *
 * Tests for cursor position calculation helpers.
 * Uses the injectable measurer variant for testing without DOM canvas.
 */

import { calculateCursorPositionWithMeasurer, type TextMeasurer } from '../cursor-position';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock text measurer with fixed-width characters.
 * Each character is `charWidth` pixels wide.
 */
function createFixedWidthMeasurer(charWidth: number): TextMeasurer {
  return {
    font: '14px monospace',
    measureText: (text: string) => ({
      width: text.length * charWidth,
    }),
  };
}

/**
 * Create a mock text measurer with variable-width characters.
 * Uses a simple lookup table for testing.
 */
function createVariableWidthMeasurer(charWidths: Record<string, number>): TextMeasurer {
  return {
    font: '14px Arial',
    measureText: (text: string) => {
      let width = 0;
      for (const char of text) {
        width += charWidths[char] ?? 10; // Default 10px for unknown chars
      }
      return { width };
    },
  };
}

// =============================================================================
// calculateCursorPositionWithMeasurer Tests
// =============================================================================

describe('calculateCursorPositionWithMeasurer', () => {
  describe('edge cases', () => {
    it('returns 0 for empty text', () => {
      const measurer = createFixedWidthMeasurer(10);
      expect(calculateCursorPositionWithMeasurer(50, '', measurer)).toBe(0);
    });

    it('returns 0 for null-ish text', () => {
      const measurer = createFixedWidthMeasurer(10);
      // @ts-expect-error Testing null handling
      expect(calculateCursorPositionWithMeasurer(50, null, measurer)).toBe(0);
      // @ts-expect-error Testing undefined handling
      expect(calculateCursorPositionWithMeasurer(50, undefined, measurer)).toBe(0);
    });

    it('returns 0 for click at or before position 0', () => {
      const measurer = createFixedWidthMeasurer(10);
      expect(calculateCursorPositionWithMeasurer(0, 'Hello', measurer)).toBe(0);
      expect(calculateCursorPositionWithMeasurer(-10, 'Hello', measurer)).toBe(0);
    });

    it('returns text.length for click past end of text', () => {
      const measurer = createFixedWidthMeasurer(10);
      const text = 'Hello';
      // Text is 50px wide (5 chars * 10px), click at 100
      expect(calculateCursorPositionWithMeasurer(100, text, measurer)).toBe(5);
      expect(calculateCursorPositionWithMeasurer(1000, text, measurer)).toBe(5);
    });
  });

  describe('fixed-width font', () => {
    const measurer = createFixedWidthMeasurer(10);
    const text = 'Hello World';

    it('positions cursor before first character for click in first half of first char', () => {
      // Click at 4px, char is 10px wide, midpoint is 5px
      // 4 < 5 is true, so position is 0 (i - 1 = 1 - 1)
      expect(calculateCursorPositionWithMeasurer(4, text, measurer)).toBe(0);
    });

    it('positions cursor after first character for click in second half of first char', () => {
      // Click at 6px, char is 10px wide, midpoint is 5px
      // 6 < 5 is false, so position is 1 (i)
      expect(calculateCursorPositionWithMeasurer(6, text, measurer)).toBe(1);
    });

    it('positions cursor exactly at midpoint - chooses right side (not strictly less than)', () => {
      // Click exactly at midpoint (5px) - clickXInCell < midpoint is false
      // So position is i (1), not i-1 (0)
      expect(calculateCursorPositionWithMeasurer(5, text, measurer)).toBe(1);
    });

    it('positions cursor correctly in middle of text', () => {
      // Click at 55px - 'Hello' is 50px (5 chars), so we're at the space (index 5)
      // Space spans 50-60px, prevWidth=50, width=60, midpoint=55
      // 55 < 55 is false, so position is 6 (after space)
      expect(calculateCursorPositionWithMeasurer(55, text, measurer)).toBe(6);
    });

    it('positions cursor correctly at word boundary', () => {
      // "Hello World" - space is at index 5, spans 50-60px
      // Click at 54px - prevWidth=50, width=60, midpoint=55
      // 54 < 55 is true, so position is 5 (before space)
      expect(calculateCursorPositionWithMeasurer(54, text, measurer)).toBe(5);
      // Click at 56px - 56 < 55 is false, so position is 6 (after space)
      expect(calculateCursorPositionWithMeasurer(56, text, measurer)).toBe(6);
    });

    it('positions cursor at end for click on last character', () => {
      // "Hello World" is 11 chars, 110px total
      // Last char 'd' spans 100-110px, prevWidth=100, width=110, midpoint=105
      // 104 < 105 is true, so position is 10 (before 'd')
      expect(calculateCursorPositionWithMeasurer(104, text, measurer)).toBe(10);
      // 106 < 105 is false, so position is 11 (after 'd')
      expect(calculateCursorPositionWithMeasurer(106, text, measurer)).toBe(11);
    });
  });

  describe('variable-width font', () => {
    // Simulate proportional font where 'W' is wide, 'i' is narrow
    const charWidths: Record<string, number> = {
      W: 15,
      i: 5,
      n: 8,
      d: 8,
      o: 8,
      w: 10,
      ' ': 4,
    };
    const measurer = createVariableWidthMeasurer(charWidths);

    it('handles variable-width characters correctly', () => {
      const text = 'Window';
      // W(15) + i(5) + n(8) + d(8) + o(8) + w(10) = 54px total

      // Click at 7px - should be after 'W' (0-15px), midpoint at 7.5px
      expect(calculateCursorPositionWithMeasurer(7, text, measurer)).toBe(0);

      // Click at 8px - should be after 'W'
      expect(calculateCursorPositionWithMeasurer(8, text, measurer)).toBe(1);

      // Click at 17px - after 'Wi' (15+5=20px), 'i' spans 15-20px, midpoint 17.5px
      expect(calculateCursorPositionWithMeasurer(17, text, measurer)).toBe(1);

      // Click at 18px - should be after 'Wi'
      expect(calculateCursorPositionWithMeasurer(18, text, measurer)).toBe(2);
    });

    it('positions cursor correctly with narrow characters', () => {
      const text = 'iii'; // 3 narrow chars, 5px each = 15px total

      expect(calculateCursorPositionWithMeasurer(2, text, measurer)).toBe(0);
      expect(calculateCursorPositionWithMeasurer(3, text, measurer)).toBe(1);
      expect(calculateCursorPositionWithMeasurer(7, text, measurer)).toBe(1);
      expect(calculateCursorPositionWithMeasurer(8, text, measurer)).toBe(2);
    });

    it('positions cursor correctly with wide characters', () => {
      const text = 'WWW'; // 3 wide chars, 15px each = 45px total

      expect(calculateCursorPositionWithMeasurer(7, text, measurer)).toBe(0);
      expect(calculateCursorPositionWithMeasurer(8, text, measurer)).toBe(1);
      expect(calculateCursorPositionWithMeasurer(22, text, measurer)).toBe(1);
      expect(calculateCursorPositionWithMeasurer(23, text, measurer)).toBe(2);
    });
  });

  describe('real-world scenarios', () => {
    const measurer = createFixedWidthMeasurer(8);

    it('handles single character text', () => {
      // Single char 'A' spans 0-8px, midpoint at 4px
      expect(calculateCursorPositionWithMeasurer(0, 'A', measurer)).toBe(0);
      // 3 < 4 is true, so position is 0
      expect(calculateCursorPositionWithMeasurer(3, 'A', measurer)).toBe(0);
      // 4 < 4 is false, so position is 1 (at midpoint, goes right)
      expect(calculateCursorPositionWithMeasurer(4, 'A', measurer)).toBe(1);
      // 5 < 4 is false, so position is 1
      expect(calculateCursorPositionWithMeasurer(5, 'A', measurer)).toBe(1);
      expect(calculateCursorPositionWithMeasurer(8, 'A', measurer)).toBe(1);
    });

    it('handles text with numbers', () => {
      const text = '12345'; // 5 chars * 8px = 40px
      expect(calculateCursorPositionWithMeasurer(0, text, measurer)).toBe(0);
      // Click at 20px: char 3 ('3') spans 16-24px, prevWidth=16, width=24, midpoint=20
      // 20 < 20 is false, so position is 3 (after '3')
      expect(calculateCursorPositionWithMeasurer(20, text, measurer)).toBe(3);
      expect(calculateCursorPositionWithMeasurer(40, text, measurer)).toBe(5);
    });

    it('handles text with special characters', () => {
      const text = 'A=B+C'; // 5 chars * 8px = 40px
      // Click at 12px: char 2 ('=') spans 8-16px, prevWidth=8, width=16, midpoint=12
      // 12 < 12 is false, so position is 2 (after '=')
      expect(calculateCursorPositionWithMeasurer(12, text, measurer)).toBe(2);
      // Click at 20px: char 3 ('B') spans 16-24px, prevWidth=16, width=24, midpoint=20
      // 20 < 20 is false, so position is 3 (after 'B')
      expect(calculateCursorPositionWithMeasurer(20, text, measurer)).toBe(3);
    });

    it('handles long text', () => {
      const text = 'This is a very long text string for testing';
      // 43 chars * 8px = 344px
      // Click at 175px: char 22 spans 168-176px, prevWidth=168, width=176, midpoint=172
      // 175 < 172 is false, so position is 22 (after char index 21)
      expect(calculateCursorPositionWithMeasurer(175, text, measurer)).toBe(22);
      // Click at 344px: fullWidth is 344, clickXInCell >= fullWidth returns text.length
      expect(calculateCursorPositionWithMeasurer(344, text, measurer)).toBe(43);
    });
  });
});
