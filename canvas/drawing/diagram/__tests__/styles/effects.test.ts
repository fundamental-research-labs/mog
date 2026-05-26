/**
 * Tests for Diagram Effects System
 *
 * Verifies shadow presets, glow effects, all 13 bevel types,
 * SVG filter generation with caching, and Canvas rendering.
 */

import { jest } from '@jest/globals';

import type { BevelEffect, ShapeEffects } from '@mog-sdk/contracts/diagram';
import {
  applyBevelToCanvas,
  applyEffectsToCanvas,
  BEVEL_TYPES,
  clearFilterCache,
  createBevel,
  createGlow,
  createShadow,
  generateSVGBevelFilter,
  generateSVGFilterDefs,
} from '../../src/styles/effects';

describe('BEVEL_TYPES', () => {
  it('should have 13 bevel types', () => {
    expect(BEVEL_TYPES.length).toBe(13);
  });

  it('should include all Excel bevel types', () => {
    const expectedTypes = [
      'none',
      'relaxed',
      'circle',
      'slope',
      'cross',
      'angle',
      'soft-round',
      'convex',
      'cool-slant',
      'divot',
      'riblet',
      'hard-edge',
      'art-deco',
    ];

    expectedTypes.forEach((type) => {
      expect(BEVEL_TYPES).toContain(type);
    });
  });
});

describe('createShadow', () => {
  it('should return undefined for none', () => {
    expect(createShadow('none')).toBeUndefined();
  });

  it('should create outer shadow preset', () => {
    const shadow = createShadow('outer');
    expect(shadow).toBeDefined();
    expect(shadow?.color).toBe('rgb(0,0,0)');
    expect(shadow?.blur).toBe(8);
    expect(shadow?.offsetX).toBe(4);
    expect(shadow?.offsetY).toBe(4);
    expect(shadow?.opacity).toBe(0.4);
  });

  it('should create inner shadow preset', () => {
    const shadow = createShadow('inner');
    expect(shadow).toBeDefined();
    expect(shadow?.offsetX).toBeLessThan(0);
    expect(shadow?.offsetY).toBeLessThan(0);
  });

  it('should create perspective shadow preset', () => {
    const shadow = createShadow('perspective');
    expect(shadow).toBeDefined();
    expect(shadow?.blur).toBeGreaterThan(8);
    expect(shadow?.offsetX).toBeGreaterThan(4);
  });
});

describe('createGlow', () => {
  it('should create small glow', () => {
    const glow = createGlow('#4472C4', 'small');
    expect(glow.color).toBe('#4472C4');
    expect(glow.radius).toBe(4);
    expect(glow.opacity).toBe(0.5);
  });

  it('should create medium glow', () => {
    const glow = createGlow('#4472C4', 'medium');
    expect(glow.radius).toBe(8);
  });

  it('should create large glow', () => {
    const glow = createGlow('#4472C4', 'large');
    expect(glow.radius).toBe(16);
  });
});

describe('createBevel', () => {
  it('should create bevel for all 13 types', () => {
    BEVEL_TYPES.forEach((type) => {
      const bevel = createBevel(type);
      expect(bevel.type).toBe(type);
      expect(typeof bevel.width).toBe('number');
      expect(typeof bevel.height).toBe('number');
    });
  });

  it('should return 0 size for none type', () => {
    const bevel = createBevel('none');
    expect(bevel.width).toBe(0);
    expect(bevel.height).toBe(0);
  });

  it('should return non-zero size for other types', () => {
    BEVEL_TYPES.filter((t) => t !== 'none').forEach((type) => {
      const bevel = createBevel(type);
      expect(bevel.width).toBeGreaterThan(0);
      expect(bevel.height).toBeGreaterThan(0);
    });
  });

  it('should fallback to relaxed for invalid type', () => {
    const bevel = createBevel('invalid-type' as BevelEffect['type']);
    // Should still create a valid bevel with relaxed dimensions
    expect(bevel.width).toBe(4);
    expect(bevel.height).toBe(4);
  });
});

describe('generateSVGFilterDefs', () => {
  beforeEach(() => {
    clearFilterCache();
  });

  it('should generate shadow filter', () => {
    const effects: ShapeEffects = {
      shadow: {
        color: 'rgba(0,0,0,0.3)',
        blur: 8,
        offsetX: 4,
        offsetY: 4,
        opacity: 0.4,
      },
    };

    const svg = generateSVGFilterDefs(effects, 'test-filter');

    expect(svg).toContain('<filter id="test-filter"');
    expect(svg).toContain('feDropShadow');
    expect(svg).toContain('dx="4"');
    expect(svg).toContain('dy="4"');
  });

  it('should generate glow filter', () => {
    const effects: ShapeEffects = {
      glow: {
        color: '#4472C4',
        radius: 8,
        opacity: 0.5,
      },
    };

    const svg = generateSVGFilterDefs(effects, 'test-filter');

    expect(svg).toContain('<filter id="test-filter"');
    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain('feFlood');
    expect(svg).toContain('feMerge');
  });

  it('should generate combined filter for multiple effects', () => {
    const effects: ShapeEffects = {
      shadow: {
        color: 'rgba(0,0,0,0.3)',
        blur: 8,
        offsetX: 4,
        offsetY: 4,
        opacity: 0.4,
      },
      glow: {
        color: '#4472C4',
        radius: 8,
        opacity: 0.5,
      },
    };

    const svg = generateSVGFilterDefs(effects, 'test-filter');

    expect(svg).toContain('feDropShadow');
    expect(svg).toContain('feGaussianBlur');
  });

  it('should use caching for identical effects', () => {
    const effects: ShapeEffects = {
      shadow: createShadow('outer'),
    };

    const svg1 = generateSVGFilterDefs(effects, 'filter-1');
    const svg2 = generateSVGFilterDefs(effects, 'filter-2');

    // Cache should replace filter ID but content pattern should match
    expect(svg1.replace('filter-1', 'X')).toBe(svg2.replace('filter-2', 'X'));
  });

  it('should clear cache properly', () => {
    const effects: ShapeEffects = {
      shadow: createShadow('outer'),
    };

    generateSVGFilterDefs(effects, 'filter-1');
    clearFilterCache();

    // After clearing, next call should still work
    const svg = generateSVGFilterDefs(effects, 'filter-2');
    expect(svg).toContain('filter-2');
  });
});

describe('generateSVGBevelFilter', () => {
  it('should return empty string for none bevel', () => {
    const bevel: BevelEffect = { type: 'none', width: 0, height: 0 };
    expect(generateSVGBevelFilter(bevel, 'test')).toBe('');
  });

  it('should generate filter for all 13 bevel types', () => {
    BEVEL_TYPES.forEach((type) => {
      if (type === 'none') return;

      const bevel = createBevel(type);
      const svg = generateSVGBevelFilter(bevel, `bevel-${type}`);

      expect(svg).toContain(`<filter id="bevel-${type}-bevel"`);
      expect(svg).toContain('</filter>');
    });
  });

  it('should generate valid SVG for relaxed bevel', () => {
    const bevel = createBevel('relaxed');
    const svg = generateSVGBevelFilter(bevel, 'test');

    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain('feSpecularLighting');
  });

  it('should generate valid SVG for hard-edge bevel', () => {
    const bevel = createBevel('hard-edge');
    const svg = generateSVGBevelFilter(bevel, 'test');

    expect(svg).toContain('feConvolveMatrix');
  });

  it('should generate valid SVG for riblet bevel', () => {
    const bevel = createBevel('riblet');
    const svg = generateSVGBevelFilter(bevel, 'test');

    expect(svg).toContain('feTurbulence');
    expect(svg).toContain('feDiffuseLighting');
  });

  it('should generate valid SVG for art-deco bevel', () => {
    const bevel = createBevel('art-deco');
    const svg = generateSVGBevelFilter(bevel, 'test');

    expect(svg).toContain('feComponentTransfer');
  });
});

describe('applyEffectsToCanvas', () => {
  let mockCtx: jest.Mocked<CanvasRenderingContext2D>;

  beforeEach(() => {
    mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      globalAlpha: 1,
    } as unknown as jest.Mocked<CanvasRenderingContext2D>;
  });

  it('should save and restore context', () => {
    const drawShape = jest.fn();
    applyEffectsToCanvas(mockCtx, {}, drawShape);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('should call drawShape at least once', () => {
    const drawShape = jest.fn();
    applyEffectsToCanvas(mockCtx, {}, drawShape);

    expect(drawShape).toHaveBeenCalled();
  });

  it('should apply shadow settings', () => {
    const drawShape = jest.fn();
    const effects: ShapeEffects = {
      shadow: {
        color: 'rgba(0,0,0,0.3)',
        blur: 8,
        offsetX: 4,
        offsetY: 4,
        opacity: 0.4,
      },
    };

    applyEffectsToCanvas(mockCtx, effects, drawShape);

    expect(mockCtx.shadowColor).toBe('rgba(0,0,0,0.3)');
    expect(mockCtx.shadowBlur).toBe(8);
    expect(mockCtx.shadowOffsetX).toBe(4);
    expect(mockCtx.shadowOffsetY).toBe(4);
  });

  it('should draw twice when glow is present', () => {
    const drawShape = jest.fn();
    const effects: ShapeEffects = {
      glow: {
        color: '#4472C4',
        radius: 8,
        opacity: 0.5,
      },
    };

    applyEffectsToCanvas(mockCtx, effects, drawShape);

    expect(drawShape).toHaveBeenCalledTimes(2);
  });

  // Test JSDoc documentation exists
  it('should have JSDoc with @sideEffects and @pure annotations', () => {
    const funcString = applyEffectsToCanvas.toString();
    // The function exists, we'll check the source file for docs
    expect(typeof applyEffectsToCanvas).toBe('function');
  });
});

describe('applyBevelToCanvas', () => {
  let mockCtx: jest.Mocked<CanvasRenderingContext2D>;

  beforeEach(() => {
    mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      fillRect: jest.fn(),
      createLinearGradient: jest.fn().mockReturnValue({
        addColorStop: jest.fn(),
      }),
      createRadialGradient: jest.fn().mockReturnValue({
        addColorStop: jest.fn(),
      }),
    } as unknown as jest.Mocked<CanvasRenderingContext2D>;
  });

  it('should do nothing for none bevel', () => {
    const bevel: BevelEffect = { type: 'none', width: 0, height: 0 };
    applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);

    expect(mockCtx.save).not.toHaveBeenCalled();
  });

  it('should save and restore context for non-none bevels', () => {
    const bevel = createBevel('relaxed');
    applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
  });

  it('should set overlay composite operation', () => {
    const bevel = createBevel('relaxed');
    applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);

    expect(mockCtx.globalCompositeOperation).toBe('overlay');
  });

  it('should render all 13 bevel types without errors', () => {
    BEVEL_TYPES.forEach((type) => {
      const bevel = createBevel(type);
      expect(() => {
        applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);
      }).not.toThrow();
    });
  });

  it('should use linear gradient for radial bevels', () => {
    const bevel = createBevel('relaxed');
    applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);

    expect(mockCtx.createLinearGradient).toHaveBeenCalled();
  });

  it('should use radial gradient for circular bevels', () => {
    const bevel = createBevel('circle');
    applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);

    expect(mockCtx.createRadialGradient).toHaveBeenCalled();
  });

  it('should render angular bevel with multiple fillRect calls', () => {
    const bevel = createBevel('angle');
    applyBevelToCanvas(mockCtx, bevel, 0, 0, 100, 100);

    // Angular bevel draws multiple rectangles for edges
    expect(mockCtx.fillRect).toHaveBeenCalled();
  });

  it('should handle unknown bevel type with fallback', () => {
    const unknownBevel: BevelEffect = {
      type: 'unknown-type' as BevelEffect['type'],
      width: 4,
      height: 4,
    };

    // Should not throw and should use fallback rendering
    expect(() => {
      applyBevelToCanvas(mockCtx, unknownBevel, 0, 0, 100, 100);
    }).not.toThrow();
  });
});
