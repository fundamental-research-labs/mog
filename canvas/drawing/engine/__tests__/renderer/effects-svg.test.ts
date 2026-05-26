/**
 * Tests for renderer/effects/svg.ts
 *
 * Validates SVG filter generation for drawing effects: outer shadow, inner
 * shadow, glow, bevel, and composite effect chaining.
 */
import type { DrawingEffects } from '@mog-sdk/contracts/drawing';
import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
} from '@mog-sdk/contracts/text-effects';
import {
  bevelToSVGFilter,
  compositeEffectsToSVGFilter,
  glowToSVGFilter,
  innerShadowToSVGFilter,
  outerShadowToSVGFilter,
} from '../../src/renderer/effects/svg';

// ─── Constants ──────────────────────────────────────────────────────────────

const EMU_PER_PIXEL = 9525;

// =============================================================================
// outerShadowToSVGFilter
// =============================================================================

describe('outerShadowToSVGFilter', () => {
  const shadow: OuterShadowEffect = {
    blurRadius: EMU_PER_PIXEL * 4, // 4px
    distance: EMU_PER_PIXEL * 3, // 3px
    direction: 45,
    color: '#000000',
    opacity: 0.5,
  };

  it('generates a feDropShadow element', () => {
    const result = outerShadowToSVGFilter(shadow, 'shadow1');
    expect(result).toContain('<feDropShadow');
  });

  it('includes the result id', () => {
    const result = outerShadowToSVGFilter(shadow, 'shadow1');
    expect(result).toContain('result="shadow1"');
  });

  it('computes dx/dy from direction and distance', () => {
    const result = outerShadowToSVGFilter(shadow, 'shadow1');
    const dist = 3;
    const dirRad = (45 * Math.PI) / 180;
    const dx = Math.cos(dirRad) * dist;
    const dy = Math.sin(dirRad) * dist;
    expect(result).toContain(`dx="${dx}"`);
    expect(result).toContain(`dy="${dy}"`);
  });

  it('sets stdDeviation from blur radius', () => {
    const result = outerShadowToSVGFilter(shadow, 'shadow1');
    expect(result).toContain(`stdDeviation="${4}"`);
  });

  it('includes flood-color and flood-opacity', () => {
    const result = outerShadowToSVGFilter(shadow, 'shadow1');
    expect(result).toContain('flood-color="#000000"');
    expect(result).toContain('flood-opacity="0.5"');
  });

  it('handles 0 degree direction (shadow to the right)', () => {
    const rightShadow: OuterShadowEffect = { ...shadow, direction: 0 };
    const result = outerShadowToSVGFilter(rightShadow, 'shadow1');
    expect(result).toContain(`dx="${3}"`);
    expect(result).toContain(`dy="${0}"`);
  });

  it('handles 90 degree direction (shadow downward)', () => {
    const downShadow: OuterShadowEffect = { ...shadow, direction: 90 };
    const result = outerShadowToSVGFilter(downShadow, 'shadow1');
    const dx = Math.cos((90 * Math.PI) / 180) * 3;
    const dy = Math.sin((90 * Math.PI) / 180) * 3;
    expect(result).toContain(`dx="${dx}"`);
    expect(result).toContain(`dy="${dy}"`);
  });
});

// =============================================================================
// innerShadowToSVGFilter
// =============================================================================

describe('innerShadowToSVGFilter', () => {
  const shadow: InnerShadowEffect = {
    blurRadius: EMU_PER_PIXEL * 2,
    distance: EMU_PER_PIXEL,
    direction: 225,
    color: '#333333',
    opacity: 0.4,
  };

  it('includes feOffset element with SourceAlpha input', () => {
    const result = innerShadowToSVGFilter(shadow, 'is1');
    expect(result).toContain('<feOffset');
    expect(result).toContain('in="SourceAlpha"');
  });

  it('includes feGaussianBlur element', () => {
    const result = innerShadowToSVGFilter(shadow, 'is1');
    expect(result).toContain('<feGaussianBlur');
    expect(result).toContain(`stdDeviation="${2}"`);
  });

  it('includes feFlood with color and opacity', () => {
    const result = innerShadowToSVGFilter(shadow, 'is1');
    expect(result).toContain('flood-color="#333333"');
    expect(result).toContain('flood-opacity="0.4"');
  });

  it('includes feComposite with operator in', () => {
    const result = innerShadowToSVGFilter(shadow, 'is1');
    expect(result).toContain('<feComposite');
    expect(result).toContain('operator="in"');
  });

  it('computes dx/dy from direction and distance', () => {
    const result = innerShadowToSVGFilter(shadow, 'is1');
    const dist = 1;
    const dirRad = (225 * Math.PI) / 180;
    const dx = Math.cos(dirRad) * dist;
    const dy = Math.sin(dirRad) * dist;
    expect(result).toContain(`dx="${dx}"`);
    expect(result).toContain(`dy="${dy}"`);
  });

  it('uses result id for intermediate results', () => {
    const result = innerShadowToSVGFilter(shadow, 'is1');
    expect(result).toContain('result="is1_off"');
    expect(result).toContain('result="is1_blur"');
    expect(result).toContain('result="is1_color"');
    expect(result).toContain('result="is1"');
  });
});

// =============================================================================
// glowToSVGFilter
// =============================================================================

describe('glowToSVGFilter', () => {
  const glow: GlowEffect = {
    radius: EMU_PER_PIXEL * 5,
    color: '#FFD700',
    opacity: 0.6,
  };

  it('includes feGaussianBlur on SourceAlpha', () => {
    const result = glowToSVGFilter(glow, 'glow1');
    expect(result).toContain('<feGaussianBlur');
    expect(result).toContain('in="SourceAlpha"');
    expect(result).toContain(`stdDeviation="${5}"`);
  });

  it('includes feFlood with glow color and opacity', () => {
    const result = glowToSVGFilter(glow, 'glow1');
    expect(result).toContain('flood-color="#FFD700"');
    expect(result).toContain('flood-opacity="0.6"');
  });

  it('includes feComposite to clip glow to blur shape', () => {
    const result = glowToSVGFilter(glow, 'glow1');
    expect(result).toContain('<feComposite');
    expect(result).toContain('operator="in"');
  });

  it('uses result id for intermediate and final results', () => {
    const result = glowToSVGFilter(glow, 'glow1');
    expect(result).toContain('result="glow1_blur"');
    expect(result).toContain('result="glow1_color"');
    expect(result).toContain('result="glow1"');
  });
});

// =============================================================================
// bevelToSVGFilter
// =============================================================================

describe('bevelToSVGFilter', () => {
  const bevel: BevelEffect = {
    topPreset: 'circle',
    topWidth: EMU_PER_PIXEL * 3,
    topHeight: EMU_PER_PIXEL * 3,
  };

  it('includes feSpecularLighting element', () => {
    const result = bevelToSVGFilter(bevel, 'bevel1');
    expect(result).toContain('<feSpecularLighting');
  });

  it('includes fePointLight', () => {
    const result = bevelToSVGFilter(bevel, 'bevel1');
    expect(result).toContain('<fePointLight');
  });

  it('uses SourceAlpha as input', () => {
    const result = bevelToSVGFilter(bevel, 'bevel1');
    expect(result).toContain('in="SourceAlpha"');
  });

  it('includes result id', () => {
    const result = bevelToSVGFilter(bevel, 'bevel1');
    expect(result).toContain('result="bevel1"');
  });

  it('uses bevel topWidth and topHeight for surfaceScale', () => {
    const smallBevel: BevelEffect = {
      topPreset: 'circle',
      topWidth: EMU_PER_PIXEL * 2,
      topHeight: EMU_PER_PIXEL * 4,
    };
    const result = bevelToSVGFilter(smallBevel, 'bevel1');
    // surfaceScale = max(1, round(2 + 4) / 2) = 3
    expect(result).toContain('surfaceScale="3"');
  });

  it('uses different specular values for different presets', () => {
    const slopeBevel: BevelEffect = {
      topPreset: 'slope',
      topWidth: EMU_PER_PIXEL * 3,
      topHeight: EMU_PER_PIXEL * 3,
    };
    const result = bevelToSVGFilter(slopeBevel, 'bevel1');
    expect(result).toContain('specularConstant="0.8"');
    expect(result).toContain('specularExponent="30"');
  });

  it('uses hardEdge preset values', () => {
    const hardBevel: BevelEffect = {
      topPreset: 'hardEdge',
      topWidth: EMU_PER_PIXEL * 2,
      topHeight: EMU_PER_PIXEL * 2,
    };
    const result = bevelToSVGFilter(hardBevel, 'bevel1');
    expect(result).toContain('specularConstant="1"');
    expect(result).toContain('specularExponent="40"');
  });

  it('uses default dimensions when topWidth/topHeight are not specified', () => {
    const minimalBevel: BevelEffect = {
      topPreset: 'circle',
    };
    const result = bevelToSVGFilter(minimalBevel, 'bevel1');
    // Default 25400 EMU = ~2.67px each, surfaceScale = max(1, round(2.67 + 2.67) / 2) = 3
    expect(result).toContain('surfaceScale=');
    expect(result).toContain('specularConstant="0.6"');
    expect(result).toContain('specularExponent="20"');
  });
});

// =============================================================================
// compositeEffectsToSVGFilter
// =============================================================================

describe('compositeEffectsToSVGFilter', () => {
  it('returns empty string when no effects are present', () => {
    const effects: DrawingEffects = {};
    expect(compositeEffectsToSVGFilter(effects, 'fx1')).toBe('');
  });

  it('generates filter for single outer shadow', () => {
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
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('<filter id="fx1" x="-50%" y="-50%" width="200%" height="200%">');
    expect(result).toContain('<feDropShadow');
    expect(result).toContain('result="os_0"');
    expect(result).toContain('</filter>');
  });

  it('generates filter for multiple outer shadows', () => {
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
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('result="os_0"');
    expect(result).toContain('result="os_1"');
    expect(result).toContain('flood-color="#ff0000"');
    expect(result).toContain('flood-color="#0000ff"');
  });

  it('generates filter for glow effect', () => {
    const effects: DrawingEffects = {
      glow: {
        radius: EMU_PER_PIXEL * 5,
        color: '#FFD700',
        opacity: 0.6,
      },
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('<feGaussianBlur');
    expect(result).toContain('flood-color="#FFD700"');
  });

  it('generates filter for bevel effect', () => {
    const effects: DrawingEffects = {
      bevel: {
        topPreset: 'circle',
        topWidth: EMU_PER_PIXEL * 3,
        topHeight: EMU_PER_PIXEL * 3,
      },
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('<feSpecularLighting');
    expect(result).toContain('result="bevel_');
  });

  it('generates filter for inner shadow', () => {
    const effects: DrawingEffects = {
      innerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 2,
          distance: EMU_PER_PIXEL,
          direction: 225,
          color: '#333333',
          opacity: 0.4,
        },
      ],
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('<filter id="fx1" x="-50%" y="-50%" width="200%" height="200%">');
    expect(result).toContain('<feOffset');
    expect(result).toContain('flood-color="#333333"');
    expect(result).toContain('</filter>');
  });

  it('chains multiple effect types together', () => {
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
      bevel: {
        topPreset: 'circle',
        topWidth: EMU_PER_PIXEL * 3,
        topHeight: EMU_PER_PIXEL * 3,
      },
    };
    const result = compositeEffectsToSVGFilter(effects, 'composite');
    expect(result).toContain(
      '<filter id="composite" x="-50%" y="-50%" width="200%" height="200%">',
    );
    expect(result).toContain('result="os_0"');
    expect(result).toContain('flood-color="#FFD700"');
    expect(result).toContain('<feSpecularLighting');
    expect(result).toContain('</filter>');
  });

  it('includes feMerge with SourceGraphic for single effect', () => {
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
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('<feMerge>');
    expect(result).toContain('<feMergeNode in="os_0"/>');
    expect(result).toContain('<feMergeNode in="SourceGraphic"/>');
    expect(result).toContain('</feMerge>');
  });

  it('includes feMerge with all result IDs for multi-effect composite', () => {
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
    const result = compositeEffectsToSVGFilter(effects, 'fx2');
    expect(result).toContain('<feMerge>');
    expect(result).toContain('<feMergeNode in="os_0"/>');
    expect(result).toContain('<feMergeNode in="glow_1"/>');
    expect(result).toContain('<feMergeNode in="SourceGraphic"/>');
    expect(result).toContain('</feMerge>');
  });

  it('places feMerge at the end of the filter before closing tag', () => {
    const effects: DrawingEffects = {
      outerShadow: [
        {
          blurRadius: EMU_PER_PIXEL * 2,
          distance: EMU_PER_PIXEL,
          direction: 0,
          color: '#ff0000',
          opacity: 0.3,
        },
      ],
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    // feMerge should come after the filter primitives and before </filter>
    expect(result).toMatch(/feMerge>.*<\/feMerge><\/filter>$/);
  });

  it('does not include feMerge when no effects (returns empty string)', () => {
    const effects: DrawingEffects = {};
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toBe('');
  });

  it('includes generous region bounds to prevent effect clipping', () => {
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
    };
    const result = compositeEffectsToSVGFilter(effects, 'fx1');
    expect(result).toContain('x="-50%"');
    expect(result).toContain('y="-50%"');
    expect(result).toContain('width="200%"');
    expect(result).toContain('height="200%"');
  });
});
