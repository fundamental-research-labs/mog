/**
 * Unit Tests for Scale Functions
 *
 * Tests domain/range mapping, invert, ticks, nice, etc.
 */

import {
  formatDate,
  generateTicks,
  // Color utilities
  hexToRgb,
  interpolateColor,
  interpolateColors,
  interpolateViridis,
  niceLinear,
  rgbToHex,
  // Ordinal scales
  scaleBand,
  scaleDiverging,
  // Linear scale
  scaleLinear,
  // Log scale
  scaleLog,
  scaleOrdinal,
  scalePoint,
  // Color scales
  scaleSequential,
  // Time scale
  scaleTime,
  // Color schemes
  schemeCategory10,
  schemeViridis,
  tickStep,
} from '../../src/primitives/scales';

// ============================================================================
// Linear Scale Tests
// ============================================================================

describe('scaleLinear', () => {
  describe('basic mapping', () => {
    it('should map domain to range linearly', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]);
      expect(scale(0)).toBe(0);
      expect(scale(50)).toBe(400);
      expect(scale(100)).toBe(800);
    });

    it('should handle values outside domain', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]);
      expect(scale(-50)).toBe(-400);
      expect(scale(150)).toBe(1200);
    });

    it('should handle inverted domain', () => {
      const scale = scaleLinear().domain([100, 0]).range([0, 800]);
      expect(scale(100)).toBe(0);
      expect(scale(0)).toBe(800);
      expect(scale(50)).toBe(400);
    });

    it('should handle inverted range', () => {
      const scale = scaleLinear().domain([0, 100]).range([800, 0]);
      expect(scale(0)).toBe(800);
      expect(scale(100)).toBe(0);
      expect(scale(50)).toBe(400);
    });

    it('should handle degenerate domain (single point)', () => {
      const scale = scaleLinear().domain([50, 50]).range([0, 100]);
      expect(scale(50)).toBe(50); // Midpoint of range
    });
  });

  describe('invert', () => {
    it('should invert range back to domain', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]);
      expect(scale.invert(0)).toBe(0);
      expect(scale.invert(400)).toBe(50);
      expect(scale.invert(800)).toBe(100);
    });

    it('should invert values outside range', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]);
      expect(scale.invert(-400)).toBe(-50);
      expect(scale.invert(1200)).toBe(150);
    });
  });

  describe('clamp', () => {
    it('should not clamp by default', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]);
      expect(scale.clamp()).toBe(false);
      expect(scale(150)).toBe(1200);
    });

    it('should clamp when enabled', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]).clamp(true);
      expect(scale.clamp()).toBe(true);
      expect(scale(-50)).toBe(0);
      expect(scale(150)).toBe(800);
    });

    it('should clamp invert when enabled', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]).clamp(true);
      expect(scale.invert(-400)).toBe(0);
      expect(scale.invert(1200)).toBe(100);
    });
  });

  describe('ticks', () => {
    it('should generate tick values', () => {
      const scale = scaleLinear().domain([0, 100]);
      const ticks = scale.ticks(5);
      expect(ticks).toContain(0);
      expect(ticks).toContain(100);
      // Ticks should be nice round numbers
      expect(ticks.every((t) => t % 20 === 0 || t % 25 === 0 || t % 10 === 0)).toBe(true);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThanOrEqual(12);
    });

    it('should handle small ranges', () => {
      const scale = scaleLinear().domain([0, 1]);
      const ticks = scale.ticks(5);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks[0]).toBeGreaterThanOrEqual(0);
      expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(1);
    });

    it('should handle negative ranges', () => {
      const scale = scaleLinear().domain([-100, 100]);
      const ticks = scale.ticks(5);
      expect(ticks.some((t) => t < 0)).toBe(true);
      expect(ticks.some((t) => t > 0)).toBe(true);
    });
  });

  describe('nice', () => {
    it('should extend domain to nice values', () => {
      const scale = scaleLinear().domain([0.123, 9.876]).nice();
      const [d0, d1] = scale.domain();
      expect(d0).toBeLessThanOrEqual(0.123);
      expect(d1).toBeGreaterThanOrEqual(9.876);
      // Should be round numbers
      expect(d0 % 1).toBe(0);
    });
  });

  describe('tickFormat', () => {
    it('should format ticks as strings', () => {
      const scale = scaleLinear().domain([0, 100]);
      const format = scale.tickFormat();
      expect(format(50)).toBe('50');
    });

    it('should respect specifier for precision', () => {
      const scale = scaleLinear().domain([0, 1]);
      const format = scale.tickFormat(10, '.2');
      expect(format(0.5)).toBe('0.50');
    });

    it('should handle percentage format', () => {
      const scale = scaleLinear().domain([0, 1]);
      const format = scale.tickFormat(10, '%');
      // The format should include percent sign and multiply by 100
      const result = format(0.5);
      expect(result).toContain('%');
      expect(result).toContain('50');
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 800]).clamp(true);
      const copy = scale.copy();

      expect(copy.domain()).toEqual([0, 100]);
      expect(copy.range()).toEqual([0, 800]);
      expect(copy.clamp()).toBe(true);

      // Modify original
      scale.domain([0, 200]);
      expect(copy.domain()).toEqual([0, 100]); // Copy unchanged
    });
  });
});

describe('tickStep', () => {
  it('should calculate nice step sizes', () => {
    expect(tickStep(0, 100, 10)).toBeCloseTo(10);
    expect(tickStep(0, 10, 5)).toBeCloseTo(2);
    expect(tickStep(0, 1, 10)).toBeCloseTo(0.1);
  });

  it('should handle descending ranges', () => {
    expect(tickStep(100, 0, 10)).toBeCloseTo(-10);
  });
});

describe('generateTicks', () => {
  it('should generate ticks within range', () => {
    const ticks = generateTicks(0, 100, 5);
    expect(ticks.every((t) => t >= 0 && t <= 100)).toBe(true);
  });

  it('should return empty for zero count', () => {
    expect(generateTicks(0, 100, 0)).toEqual([]);
  });
});

describe('niceLinear', () => {
  it('should return nice bounds', () => {
    const [lo, hi] = niceLinear(0.123, 9.876);
    expect(lo).toBeLessThanOrEqual(0.123);
    expect(hi).toBeGreaterThanOrEqual(9.876);
  });
});

// ============================================================================
// Log Scale Tests
// ============================================================================

describe('scaleLog', () => {
  describe('basic mapping', () => {
    it('should map domain to range logarithmically', () => {
      const scale = scaleLog().domain([1, 1000]).range([0, 300]);
      expect(scale(1)).toBeCloseTo(0);
      expect(scale(10)).toBeCloseTo(100);
      expect(scale(100)).toBeCloseTo(200);
      expect(scale(1000)).toBeCloseTo(300);
    });

    it('should handle different bases', () => {
      const scale = scaleLog().base(2).domain([1, 8]).range([0, 300]);
      expect(scale(1)).toBeCloseTo(0);
      expect(scale(2)).toBeCloseTo(100);
      expect(scale(4)).toBeCloseTo(200);
      expect(scale(8)).toBeCloseTo(300);
    });
  });

  describe('invert', () => {
    it('should invert logarithmically', () => {
      const scale = scaleLog().domain([1, 1000]).range([0, 300]);
      expect(scale.invert(0)).toBeCloseTo(1);
      expect(scale.invert(100)).toBeCloseTo(10);
      expect(scale.invert(200)).toBeCloseTo(100);
      expect(scale.invert(300)).toBeCloseTo(1000);
    });
  });

  describe('ticks', () => {
    it('should generate ticks at powers of base', () => {
      const scale = scaleLog().domain([1, 1000]);
      const ticks = scale.ticks();
      expect(ticks).toContain(1);
      expect(ticks).toContain(10);
      expect(ticks).toContain(100);
      expect(ticks).toContain(1000);
    });
  });

  describe('nice', () => {
    it('should extend to power boundaries', () => {
      const scale = scaleLog().domain([5, 500]).nice();
      const [d0, d1] = scale.domain();
      expect(d0).toBeLessThanOrEqual(5);
      expect(d1).toBeGreaterThanOrEqual(500);
      // Should be powers of 10
      expect(Math.log10(d0) % 1).toBeCloseTo(0);
      expect(Math.log10(d1) % 1).toBeCloseTo(0);
    });
  });

  describe('base', () => {
    it('should get and set base', () => {
      const scale = scaleLog();
      expect(scale.base()).toBe(10);
      scale.base(2);
      expect(scale.base()).toBe(2);
    });

    it('should reject invalid bases', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const scale = scaleLog();

      scale.base(1); // Invalid - should default to 10
      expect(scale.base()).toBe(10);
      scale.base(-2); // Invalid
      expect(scale.base()).toBe(10);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        'Log base must be positive and not equal to 1. Using 10.',
      );
      warnSpy.mockRestore();
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const scale = scaleLog().domain([1, 100]).range([0, 200]).base(2);
      const copy = scale.copy();

      expect(copy.domain()).toEqual([1, 100]);
      expect(copy.base()).toBe(2);

      scale.base(10);
      expect(copy.base()).toBe(2);
    });
  });
});

// ============================================================================
// Time Scale Tests
// ============================================================================

describe('scaleTime', () => {
  describe('basic mapping', () => {
    it('should map dates to positions', () => {
      const start = new Date(2020, 0, 1);
      const end = new Date(2020, 11, 31);
      const scale = scaleTime().domain([start, end]).range([0, 800]);

      expect(scale(start)).toBeCloseTo(0);
      expect(scale(end)).toBeCloseTo(800);

      // Midpoint
      const mid = new Date(2020, 6, 1);
      const result = scale(mid);
      expect(result).toBeGreaterThan(300);
      expect(result).toBeLessThan(500);
    });
  });

  describe('invert', () => {
    it('should invert positions to dates', () => {
      const start = new Date(2020, 0, 1);
      const end = new Date(2020, 11, 31);
      const scale = scaleTime().domain([start, end]).range([0, 800]);

      expect(scale.invert(0).getTime()).toBeCloseTo(start.getTime(), -3);
      expect(scale.invert(800).getTime()).toBeCloseTo(end.getTime(), -3);
    });
  });

  describe('ticks', () => {
    it('should generate date ticks', () => {
      const start = new Date(2020, 0, 1);
      const end = new Date(2020, 11, 31);
      const scale = scaleTime().domain([start, end]);

      const ticks = scale.ticks(12);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every((t) => t instanceof Date)).toBe(true);
    });
  });

  describe('tickFormat', () => {
    it('should format dates', () => {
      const start = new Date(2020, 0, 1);
      const end = new Date(2020, 11, 31);
      const scale = scaleTime().domain([start, end]);

      const format = scale.tickFormat();
      const formatted = format(new Date(2020, 6, 15));
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const start = new Date(2020, 0, 1);
      const end = new Date(2020, 11, 31);
      const scale = scaleTime().domain([start, end]).range([0, 800]);
      const copy = scale.copy();

      expect(copy.domain()[0].getTime()).toBe(start.getTime());
      expect(copy.range()).toEqual([0, 800]);
    });
  });
});

describe('formatDate', () => {
  it('should format year', () => {
    expect(formatDate(new Date(2020, 5, 15), 'yyyy')).toBe('2020');
  });

  it('should format month', () => {
    expect(formatDate(new Date(2020, 5, 15), 'MMM')).toBe('Jun');
    expect(formatDate(new Date(2020, 5, 15), 'MM')).toBe('06');
  });

  it('should format day', () => {
    expect(formatDate(new Date(2020, 5, 5), 'd')).toBe('5');
    expect(formatDate(new Date(2020, 5, 5), 'dd')).toBe('05');
  });

  it('should format time', () => {
    expect(formatDate(new Date(2020, 5, 15, 9, 5, 3), 'HH:mm:ss')).toBe('09:05:03');
  });

  it('should format combined', () => {
    expect(formatDate(new Date(2020, 5, 15), 'MMM d, yyyy')).toBe('Jun 15, 2020');
  });
});

// ============================================================================
// Band Scale Tests
// ============================================================================

describe('scaleBand', () => {
  describe('basic mapping', () => {
    it('should map categories to positions', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]);

      expect(scale('A')).toBe(0);
      expect(scale('B')).toBe(100);
      expect(scale('C')).toBe(200);
    });

    it('should return NaN for unknown categories', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]);
      expect(Number.isNaN(scale('D'))).toBe(true);
    });
  });

  describe('bandwidth', () => {
    it('should calculate bandwidth', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]);
      expect(scale.bandwidth()).toBe(100);
    });

    it('should reduce bandwidth with padding', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).padding(0.2);
      expect(scale.bandwidth()).toBeLessThan(100);
    });
  });

  describe('step', () => {
    it('should calculate step size', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]);
      expect(scale.step()).toBe(100);
    });
  });

  describe('padding', () => {
    it('should apply inner padding', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).paddingInner(0.5);
      const bandwidth = scale.bandwidth();
      const step = scale.step();
      expect(bandwidth).toBeLessThan(step);
    });

    it('should apply outer padding', () => {
      const scale1 = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).paddingOuter(0);
      const scale2 = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).paddingOuter(0.5);
      expect(scale2('A')).toBeGreaterThan(scale1('A'));
    });

    it('should apply combined padding', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).padding(0.2);
      expect(scale.paddingInner()).toBe(0.2);
      expect(scale.paddingOuter()).toBe(0.2);
    });
  });

  describe('round', () => {
    it('should round positions when enabled', () => {
      const scale = scaleBand().domain(['A', 'B', 'C', 'D', 'E']).range([0, 333]).round(true);
      expect(Number.isInteger(scale('B'))).toBe(true);
      expect(Number.isInteger(scale.bandwidth())).toBe(true);
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const scale = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).padding(0.2);
      const copy = scale.copy();

      expect(copy.domain()).toEqual(['A', 'B', 'C']);
      expect(copy.padding()).toBe(0.2);

      scale.domain(['X', 'Y']);
      expect(copy.domain()).toEqual(['A', 'B', 'C']);
    });
  });
});

// ============================================================================
// Point Scale Tests
// ============================================================================

describe('scalePoint', () => {
  describe('basic mapping', () => {
    it('should map categories to point positions', () => {
      const scale = scalePoint().domain(['A', 'B', 'C']).range([0, 200]);

      expect(scale('A')).toBe(0);
      expect(scale('B')).toBe(100);
      expect(scale('C')).toBe(200);
    });
  });

  describe('step', () => {
    it('should calculate step between points', () => {
      const scale = scalePoint().domain(['A', 'B', 'C']).range([0, 200]);
      expect(scale.step()).toBe(100);
    });
  });

  describe('padding', () => {
    it('should apply outer padding', () => {
      const scale1 = scalePoint().domain(['A', 'B', 'C']).range([0, 200]).padding(0);
      const scale2 = scalePoint().domain(['A', 'B', 'C']).range([0, 200]).padding(0.5);

      expect(scale2('A')).toBeGreaterThan(scale1('A'));
      expect(scale2('C')).toBeLessThan(scale1('C'));
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const scale = scalePoint().domain(['A', 'B', 'C']).range([0, 200]).padding(0.5);
      const copy = scale.copy();

      expect(copy.domain()).toEqual(['A', 'B', 'C']);
      expect(copy.padding()).toBe(0.5);
    });
  });
});

// ============================================================================
// Color Scale Tests
// ============================================================================

describe('scaleOrdinal', () => {
  describe('basic mapping', () => {
    it('should map categories to colors', () => {
      const scale = scaleOrdinal(['cat', 'dog', 'bird'], schemeCategory10);

      expect(scale('cat')).toBe(schemeCategory10[0]);
      expect(scale('dog')).toBe(schemeCategory10[1]);
      expect(scale('bird')).toBe(schemeCategory10[2]);
    });

    it('should cycle colors when domain exceeds range', () => {
      const colors = ['#f00', '#0f0', '#00f'];
      const scale = scaleOrdinal(['A', 'B', 'C', 'D', 'E'], colors);

      expect(scale('A')).toBe('#f00');
      expect(scale('D')).toBe('#f00'); // Wraps around
      expect(scale('E')).toBe('#0f0');
    });

    it('should use scheme name', () => {
      const scale = scaleOrdinal(['A', 'B'], 'category10');
      expect(scale('A')).toBe(schemeCategory10[0]);
    });
  });

  describe('implicit domain extension', () => {
    it('should add unknown values to domain', () => {
      const scale = scaleOrdinal(['cat', 'dog'], schemeCategory10);
      expect(scale('bird')).toBe(schemeCategory10[2]);
      expect(scale.domain()).toContain('bird');
    });
  });

  describe('unknown', () => {
    it('should return unknown color for unknown values when set', () => {
      const scale = scaleOrdinal(['cat', 'dog'], schemeCategory10);
      scale.unknown('#888');

      expect(scale('unknown-value')).toBe('#888');
      expect(scale.domain()).not.toContain('unknown-value');
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const scale = scaleOrdinal(['A', 'B'], schemeCategory10);
      scale.unknown('#888');
      const copy = scale.copy();

      expect(copy.domain()).toEqual(['A', 'B']);
      expect(copy.unknown()).toBe('#888');
    });
  });
});

describe('scaleSequential', () => {
  describe('basic mapping', () => {
    it('should map numeric values to colors', () => {
      const scale = scaleSequential([0, 100], interpolateViridis);

      expect(typeof scale(0)).toBe('string');
      expect(typeof scale(50)).toBe('string');
      expect(typeof scale(100)).toBe('string');

      // Different values should produce different colors
      expect(scale(0)).not.toBe(scale(100));
    });

    it('should use scheme name', () => {
      const scale = scaleSequential([0, 100], 'viridis');
      expect(typeof scale(50)).toBe('string');
    });

    it('should clamp out-of-domain values', () => {
      const scale = scaleSequential([0, 100], interpolateViridis);
      expect(scale(-50)).toBe(scale(0)); // Clamped to 0
      expect(scale(150)).toBe(scale(100)); // Clamped to 100
    });
  });

  describe('domain', () => {
    it('should get and set domain', () => {
      const scale = scaleSequential([0, 100], interpolateViridis);
      expect(scale.domain()).toEqual([0, 100]);

      scale.domain([0, 1000]);
      expect(scale.domain()).toEqual([0, 1000]);
    });
  });

  describe('copy', () => {
    it('should create an independent copy', () => {
      const scale = scaleSequential([0, 100], interpolateViridis);
      const copy = scale.copy();

      expect(copy.domain()).toEqual([0, 100]);

      scale.domain([0, 200]);
      expect(copy.domain()).toEqual([0, 100]);
    });
  });
});

describe('scaleDiverging', () => {
  describe('basic mapping', () => {
    it('should map values with midpoint', () => {
      const scale = scaleDiverging([-1, 0, 1], 'rdylbu');

      // Should produce different colors for negative, zero, and positive
      const negColor = scale(-1);
      const midColor = scale(0);
      const posColor = scale(1);

      expect(negColor).not.toBe(midColor);
      expect(midColor).not.toBe(posColor);
    });
  });

  describe('domain', () => {
    it('should support asymmetric domains', () => {
      const scale = scaleDiverging([-10, 0, 100], 'rdylgn');
      expect(scale.domain()).toEqual([-10, 0, 100]);
    });
  });
});

// ============================================================================
// Color Utility Tests
// ============================================================================

describe('hexToRgb', () => {
  it('should parse hex colors', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('should handle without hash', () => {
    expect(hexToRgb('ff0000')).toEqual([255, 0, 0]);
  });
});

describe('rgbToHex', () => {
  it('should convert RGB to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });

  it('should clamp values', () => {
    expect(rgbToHex(300, -50, 128)).toBe('#ff0080');
  });
});

describe('interpolateColor', () => {
  it('should interpolate between colors', () => {
    expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    // OKLab perceptually uniform interpolation: midpoint is #636363, not #808080
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#636363');
  });

  it('should interpolate red channel', () => {
    // OKLab perceptually uniform interpolation: midpoint is #630000, not #800000
    expect(interpolateColor('#ff0000', '#000000', 0.5)).toBe('#630000');
  });
});

describe('interpolateColors', () => {
  it('should create interpolator from array', () => {
    const interp = interpolateColors(['#000000', '#ffffff']);
    expect(interp(0)).toBe('#000000');
    expect(interp(1)).toBe('#ffffff');
    // OKLab perceptually uniform interpolation: midpoint is #636363, not #808080
    expect(interp(0.5)).toBe('#636363');
  });

  it('should handle multi-stop gradients', () => {
    const interp = interpolateColors(['#ff0000', '#00ff00', '#0000ff']);
    expect(interp(0)).toBe('#ff0000');
    expect(interp(0.5)).toBe('#00ff00');
    expect(interp(1)).toBe('#0000ff');
  });

  it('should handle single color', () => {
    const interp = interpolateColors(['#ff0000']);
    expect(interp(0)).toBe('#ff0000');
    expect(interp(0.5)).toBe('#ff0000');
    expect(interp(1)).toBe('#ff0000');
  });

  it('should handle empty array', () => {
    const interp = interpolateColors([]);
    expect(interp(0.5)).toBe('#000000');
  });
});

// ============================================================================
// Color Scheme Tests
// ============================================================================

describe('color schemes', () => {
  it('schemeCategory10 should have 10 colors', () => {
    expect(schemeCategory10.length).toBe(10);
    expect(schemeCategory10.every((c) => c.startsWith('#'))).toBe(true);
  });

  it('schemeViridis should have colors', () => {
    expect(schemeViridis.length).toBeGreaterThan(0);
    expect(schemeViridis.every((c) => c.startsWith('#'))).toBe(true);
  });
});
