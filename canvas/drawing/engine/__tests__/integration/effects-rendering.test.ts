/**
 * Integration Tests: Effect Rendering
 *
 * Verifies effect rendering (shadow, glow, bevel, inner shadow) works correctly
 * across SVG output. Tests the full pipeline from DrawingEffects through to
 * composited SVG filter output, including the renderDrawingObjectToSVG orchestrator.
 *
 * Covers:
 * - Individual effect rendering (shadow, glow, bevel, utilities)
 * - Inner shadow ordering relative to fill
 * - 9i: Multi-effect composition
 */
import type { DrawingEffects, DrawingObject } from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
} from '@mog-sdk/contracts/text-effects';
import {
  bevelToSVGFilter,
  colorWithOpacity,
  compositeEffectsToSVGFilter,
  emuToPx,
  glowToSVGFilter,
  innerShadowToSVGFilter,
  outerShadowToSVGFilter,
  renderDrawingObjectToSVG,
} from '../../src/index';

// ─── Constants ──────────────────────────────────────────────────────────────

const EMU_PER_PIXEL = 9525;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a simple rectangular path (100x80). */
function makeRectPath(): Path {
  return {
    segments: [
      { type: 'M' as const, x: 0, y: 0 },
      { type: 'L' as const, x: 100, y: 0 },
      { type: 'L' as const, x: 100, y: 80 },
      { type: 'L' as const, x: 0, y: 80 },
      { type: 'Z' as const },
    ],
    closed: true,
  };
}

/** Create a DrawingObject with a solid fill and optional effects. */
function createShapeWithEffects(effects: DrawingEffects): DrawingObject {
  return {
    geometry: makeRectPath(),
    fill: { type: 'solid', color: '#4472C4' },
    effects,
  };
}

// =============================================================================
// Effect Rendering Tests
// =============================================================================

describe('Effect Rendering', () => {
  // ─── Shadow rendering ───────────────────────────────────────────────────

  describe('Shadow rendering', () => {
    const shadow: OuterShadowEffect = {
      blurRadius: 47625, // 5 px
      distance: 28575, // 3 px
      direction: 45,
      color: '#000000',
      opacity: 0.5,
    };

    test('outerShadowToSVGFilter produces valid filter fragment', () => {
      const result = outerShadowToSVGFilter(shadow, 'shadow-1');

      // Should contain a feDropShadow element (the outer shadow uses this SVG primitive)
      expect(result).toContain('<feDropShadow');
      expect(result).toContain('result="shadow-1"');
    });

    test('shadow blur radius converts from EMU (47625 EMU = 5 px)', () => {
      const px = emuToPx(47625);
      expect(px).toBeCloseTo(5, 1);
    });

    test('shadow direction/distance converts to offsets for direction=0', () => {
      const rightShadow: OuterShadowEffect = {
        ...shadow,
        direction: 0,
        distance: 28575, // 3 px
      };
      const result = outerShadowToSVGFilter(rightShadow, 'shadow-dir0');
      const distPx = emuToPx(28575); // 3 px

      // direction=0 means positive x-axis, so dx should be ~3, dy ~0
      expect(result).toContain(`dx="${distPx}"`);
      expect(result).toContain(`dy="${0}"`);
    });

    test('colorWithOpacity produces rgba string from hex + opacity', () => {
      const result = colorWithOpacity('#FF0000', 0.5);
      expect(result).toBe('rgba(255,0,0,0.5)');
    });

    test('colorWithOpacity passes through color at full opacity', () => {
      expect(colorWithOpacity('#FF0000', 1)).toBe('#FF0000');
    });

    test('colorWithOpacity returns transparent for zero opacity', () => {
      expect(colorWithOpacity('#FF0000', 0)).toBe('rgba(0,0,0,0)');
    });
  });

  // ─── Glow rendering ────────────────────────────────────────────────────

  describe('Glow rendering', () => {
    test('glowToSVGFilter produces valid filter with feGaussianBlur', () => {
      const glow: GlowEffect = {
        radius: EMU_PER_PIXEL * 5, // 5 px
        color: '#FFD700',
        opacity: 0.6,
      };
      const result = glowToSVGFilter(glow, 'glow-1');

      expect(result).toContain('<feGaussianBlur');
      expect(result).toContain('in="SourceAlpha"');
      expect(result).toContain('flood-color="#FFD700"');
    });

    test('glow with zero radius produces valid SVG filter (no blur)', () => {
      const glow: GlowEffect = {
        radius: 0,
        color: '#00FF00',
        opacity: 0.8,
      };
      const result = glowToSVGFilter(glow, 'glow-zero');

      // Even with zero radius, should still produce valid filter primitives
      expect(result).toContain('<feGaussianBlur');
      expect(result).toContain('stdDeviation="0"');
      expect(result).toContain('flood-color="#00FF00"');
    });
  });

  // ─── Bevel rendering ───────────────────────────────────────────────────

  describe('Bevel rendering', () => {
    test('bevelToSVGFilter produces valid filter with specular lighting', () => {
      const bevel: BevelEffect = {
        topPreset: 'softRound',
        topWidth: 76200, // 8 px
        topHeight: 76200, // 8 px
      };
      const result = bevelToSVGFilter(bevel, 'bevel-1');

      expect(result).toContain('<feSpecularLighting');
      expect(result).toContain('result="bevel-1"');
    });

    test('bevel width/height in EMU convert correctly (76200 EMU = 8 px)', () => {
      expect(emuToPx(76200)).toBeCloseTo(8, 1);
    });
  });
});

// =============================================================================
// Inner Shadow Ordering
// =============================================================================

describe('Inner Shadow Ordering', () => {
  test('DrawingObject with inner shadow renders fill before filter application', () => {
    const effects: DrawingEffects = {
      innerShadow: [
        {
          blurRadius: 38100, // 4 px
          distance: 19050, // 2 px
          direction: 225,
          color: '#000000',
          opacity: 0.3,
        },
      ],
    };
    const obj = createShapeWithEffects(effects);
    const svg = renderDrawingObjectToSVG(obj);

    // The SVG should contain the fill content (path element)
    expect(svg).toContain('<path');

    // The inner shadow is rendered via a filter applied to the shape.
    // The <path> element should reference the filter via filter="url(#...)"
    expect(svg).toContain('filter="url(#');

    // Filter definition should appear in <defs> before the path content.
    // The path with fill comes after <defs>, and the filter is applied as an
    // attribute on the path — meaning fill is rendered first, then filter applied on top.
    const defsIdx = svg.indexOf('<defs>');
    const pathIdx = svg.indexOf('<path');
    expect(defsIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBeGreaterThan(defsIdx);
  });

  test('innerShadowToSVGFilter produces valid filter primitives', () => {
    const shadow: InnerShadowEffect = {
      blurRadius: 38100,
      distance: 19050,
      direction: 225,
      color: '#000000',
      opacity: 0.3,
    };
    const result = innerShadowToSVGFilter(shadow, 'ishadow-1');

    expect(result).toContain('<feOffset');
    expect(result).toContain('<feGaussianBlur');
    expect(result).toContain('<feFlood');
    expect(result).toContain('<feComposite');
    expect(result).toContain('operator="in"');
    expect(result).toContain('result="ishadow-1"');
  });

  test('inner shadow uses SourceAlpha as initial input', () => {
    const shadow: InnerShadowEffect = {
      blurRadius: 19050,
      distance: 9525,
      direction: 180,
      color: '#333333',
      opacity: 0.5,
    };
    const result = innerShadowToSVGFilter(shadow, 'is-test');
    expect(result).toContain('in="SourceAlpha"');
  });
});

// =============================================================================
// Multi-Effect Composition
// =============================================================================

describe('Multi-Effect Composition', () => {
  test('compositeEffectsToSVGFilter combines shadow + bevel into single filter', () => {
    const effects: DrawingEffects = {
      outerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 4,
          distance: EMU_PER_PIXEL * 3,
          direction: 45,
          color: '#000000',
          opacity: 0.5,
        },
      ],
      bevel: {
        topPreset: 'circle',
        topWidth: EMU_PER_PIXEL * 3,
        topHeight: EMU_PER_PIXEL * 3,
      },
    };
    const result = compositeEffectsToSVGFilter(effects, 'composite-1');

    // Should be a single <filter> element
    expect(result).toContain(
      '<filter id="composite-1" x="-50%" y="-50%" width="200%" height="200%">',
    );
    expect(result).toContain('</filter>');
    // Should contain both shadow and bevel filter primitives
    expect(result).toContain('<feDropShadow');
    expect(result).toContain('<feSpecularLighting');

    // Only one <filter> wrapper
    const filterCount = (result.match(/<filter /g) || []).length;
    expect(filterCount).toBe(1);
  });

  test('shadow + glow composition produces combined filter', () => {
    const effects: DrawingEffects = {
      outerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 3,
          distance: EMU_PER_PIXEL * 2,
          direction: 90,
          color: '#000000',
          opacity: 0.4,
        },
      ],
      glow: {
        radius: EMU_PER_PIXEL * 5,
        color: '#FFD700',
        opacity: 0.6,
      },
    };
    const result = compositeEffectsToSVGFilter(effects, 'shadow-glow');

    expect(result).toContain(
      '<filter id="shadow-glow" x="-50%" y="-50%" width="200%" height="200%">',
    );
    // Shadow uses feDropShadow
    expect(result).toContain('<feDropShadow');
    // Glow uses feGaussianBlur + feFlood + feComposite
    expect(result).toContain('<feGaussianBlur');
    expect(result).toContain('flood-color="#FFD700"');
    expect(result).toContain('</filter>');
  });

  test('DrawingObject with multiple effects renders to SVG with filter defs', () => {
    const effects: DrawingEffects = {
      outerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 4,
          distance: EMU_PER_PIXEL * 3,
          direction: 45,
          color: '#000000',
          opacity: 0.5,
        },
      ],
      glow: {
        radius: EMU_PER_PIXEL * 5,
        color: '#FFD700',
        opacity: 0.6,
      },
    };
    const obj = createShapeWithEffects(effects);
    const svg = renderDrawingObjectToSVG(obj);

    // The SVG should contain filter definitions
    expect(svg).toContain('<filter');
    expect(svg).toContain('<defs>');
    // Shape path should reference the filter
    expect(svg).toContain('filter="url(#');
    // SVG should be valid (has opening and closing tags)
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  test('empty effects produce no filter elements', () => {
    const effects: DrawingEffects = {};
    const obj = createShapeWithEffects(effects);
    const svg = renderDrawingObjectToSVG(obj);

    // No filter should be generated for empty effects
    expect(svg).not.toContain('<filter');
    // Path should have no filter attribute
    expect(svg).not.toContain('filter="url(#');
  });

  test('compositeEffectsToSVGFilter returns empty string for empty effects', () => {
    const effects: DrawingEffects = {};
    const result = compositeEffectsToSVGFilter(effects, 'empty');
    expect(result).toBe('');
  });

  test('all four effect types compose into single filter', () => {
    const effects: DrawingEffects = {
      outerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 3,
          distance: EMU_PER_PIXEL * 2,
          direction: 45,
          color: '#000000',
          opacity: 0.4,
        },
      ],
      innerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 2,
          distance: EMU_PER_PIXEL,
          direction: 225,
          color: '#333333',
          opacity: 0.3,
        },
      ],
      glow: {
        radius: EMU_PER_PIXEL * 4,
        color: '#FFD700',
        opacity: 0.5,
      },
      bevel: {
        topPreset: 'softRound',
        topWidth: EMU_PER_PIXEL * 2,
        topHeight: EMU_PER_PIXEL * 2,
      },
    };
    const result = compositeEffectsToSVGFilter(effects, 'all-four');

    expect(result).toContain('<filter id="all-four" x="-50%" y="-50%" width="200%" height="200%">');

    // Outer shadow (feDropShadow)
    expect(result).toContain('<feDropShadow');
    // Inner shadow (feOffset, feGaussianBlur, feFlood, feComposite)
    expect(result).toContain('<feOffset');
    expect(result).toContain('flood-color="#333333"');
    // Glow (feGaussianBlur + feFlood with glow color)
    expect(result).toContain('flood-color="#FFD700"');
    // Bevel (feSpecularLighting)
    expect(result).toContain('<feSpecularLighting');

    expect(result).toContain('</filter>');

    // Still only one <filter> wrapper
    const filterCount = (result.match(/<filter /g) || []).length;
    expect(filterCount).toBe(1);
  });

  test('DrawingObject with effects but no fill still generates filter', () => {
    const obj: DrawingObject = {
      geometry: makeRectPath(),
      effects: {
        outerShadow: [
          {
            blurRadius: EMU_PER_PIXEL * 3,
            distance: EMU_PER_PIXEL * 2,
            direction: 45,
            color: '#000000',
            opacity: 0.5,
          },
        ],
      },
    };
    const svg = renderDrawingObjectToSVG(obj);

    // Should still contain filter
    expect(svg).toContain('<filter');
    expect(svg).toContain('filter="url(#');
    // Fill should be "none" since no fill was specified
    expect(svg).toContain('fill="none"');
  });

  test('multiple outer shadows each get unique result IDs', () => {
    const effects: DrawingEffects = {
      outerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 2,
          distance: EMU_PER_PIXEL,
          direction: 0,
          color: '#ff0000',
          opacity: 0.3,
        },
        {
          blurRadius: EMU_PER_PIXEL * 4,
          distance: EMU_PER_PIXEL * 2,
          direction: 180,
          color: '#0000ff',
          opacity: 0.5,
        },
      ],
    };
    const result = compositeEffectsToSVGFilter(effects, 'multi-shadow');

    // Each shadow should get a unique result ID
    expect(result).toContain('result="os_0"');
    expect(result).toContain('result="os_1"');
    expect(result).toContain('flood-color="#ff0000"');
    expect(result).toContain('flood-color="#0000ff"');
  });
});
