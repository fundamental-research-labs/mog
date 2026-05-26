import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
  PresetShadowType,
  ReflectionEffect,
  SoftEdgeEffect,
  TextEffects,
  Transform3DEffect,
  WarpedTextPath,
} from '@mog-sdk/contracts/text-effects';
import {
  calculateEffectBounds,
  computeBevel,
  computeEffects,
  computeGlow,
  computeInnerShadow,
  computeOuterShadow,
  computePresetShadow,
  computeReflection,
  computeSoftEdge,
  computeTransform3D,
  emuToPixels,
  getPresetShadowTypes,
  matrixToCss3d,
  transform3DPoint,
} from '../src/effects/ooxml-effects';

const STUB_WARPED_PATH: WarpedTextPath = {
  topPath: 'M0,0 L200,0',
  bottomPath: 'M0,50 L200,50',
  glyphTransforms: [],
  bounds: { x: 0, y: 0, width: 200, height: 50 },
};

describe('emuToPixels', () => {
  test('1 point (12700 EMU) converts to ~1.333 pixels', () => {
    const px = emuToPixels(12700);
    expect(px).toBeCloseTo(1.333, 2);
  });

  test('1 inch (914400 EMU) converts to 96 pixels', () => {
    const px = emuToPixels(914400);
    expect(px).toBeCloseTo(96, 1);
  });

  test('0 EMU converts to 0 pixels', () => {
    expect(emuToPixels(0)).toBe(0);
  });
});

describe('computeOuterShadow', () => {
  test('converts EMU values to pixels with direction/distance', () => {
    const config: OuterShadowEffect = {
      blurRadius: 50800,
      distance: 38100,
      direction: 45,
      color: '#000000',
      opacity: 0.5,
    };

    const shadow = computeOuterShadow(config);

    expect(shadow.type).toBe('outer');
    expect(shadow.blur).toBeCloseTo(emuToPixels(50800), 5);
    expect(shadow.color).toBe('#000000');
    expect(shadow.opacity).toBe(0.5);

    // direction 45 degrees: offsetX and offsetY should be equal and positive
    const dist = emuToPixels(38100);
    expect(shadow.offsetX).toBeCloseTo(Math.cos((45 * Math.PI) / 180) * dist, 5);
    expect(shadow.offsetY).toBeCloseTo(Math.sin((45 * Math.PI) / 180) * dist, 5);
  });

  test('passes through scale and skew for perspective shadows', () => {
    const config: OuterShadowEffect = {
      blurRadius: 76200,
      distance: 114300,
      direction: 90,
      color: '#000000',
      opacity: 0.35,
      scaleX: 1,
      scaleY: 0.5,
      skewX: -45,
    };

    const shadow = computeOuterShadow(config);

    expect(shadow.scaleX).toBe(1);
    expect(shadow.scaleY).toBe(0.5);
    expect(shadow.skewX).toBe(-45);
  });
});

describe('computeInnerShadow', () => {
  test('produces inner type shadow', () => {
    const config: InnerShadowEffect = {
      blurRadius: 25400,
      distance: 12700,
      direction: 225,
      color: '#000000',
      opacity: 0.3,
    };

    const shadow = computeInnerShadow(config);

    expect(shadow.type).toBe('inner');
    expect(shadow.blur).toBeCloseTo(emuToPixels(25400), 5);
    expect(shadow.color).toBe('#000000');
    expect(shadow.opacity).toBe(0.3);
  });
});

describe('computePresetShadow', () => {
  test('all 20 presets produce valid ShadowLayers', () => {
    const presets = getPresetShadowTypes();
    expect(presets.length).toBe(20);

    for (const preset of presets) {
      const shadow = computePresetShadow(preset);
      expect(shadow.type).toBe('outer');
      expect(shadow.blur).toBeGreaterThanOrEqual(0);
      expect(isFinite(shadow.offsetX)).toBe(true);
      expect(isFinite(shadow.offsetY)).toBe(true);
      expect(shadow.opacity).toBeGreaterThan(0);
      expect(shadow.opacity).toBeLessThanOrEqual(1);
      expect(shadow.color).toBe('#000000');
    }
  });

  test('shdw1 has correct direction (45 deg)', () => {
    const shadow = computePresetShadow('shdw1');
    // At 45 degrees, offsetX and offsetY should be approximately equal
    expect(shadow.offsetX).toBeCloseTo(shadow.offsetY, 5);
  });
});

describe('getPresetShadowTypes', () => {
  test('returns 20 presets', () => {
    const types = getPresetShadowTypes();
    expect(types).toHaveLength(20);
    expect(types[0]).toBe('shdw1');
    expect(types[19]).toBe('shdw20');
  });
});

describe('computeGlow', () => {
  test('converts radius/color/opacity', () => {
    const config: GlowEffect = {
      radius: 63500,
      color: '#FFD700',
      opacity: 0.6,
    };

    const glow = computeGlow(config);

    expect(glow.radius).toBeCloseTo(emuToPixels(63500), 5);
    expect(glow.color).toBe('#FFD700');
    expect(glow.opacity).toBe(0.6);
  });
});

describe('computeSoftEdge', () => {
  test('converts radius from EMU to pixels', () => {
    const config: SoftEdgeEffect = { radius: 25400 };

    const mask = computeSoftEdge(config);

    expect(mask.radius).toBeCloseTo(emuToPixels(25400), 5);
  });
});

describe('computeReflection', () => {
  test('defaults scaleY to -0.5', () => {
    const config: ReflectionEffect = {
      blurRadius: 6350,
      startOpacity: 0.52,
      endOpacity: 0,
      distance: 0,
      direction: 90,
    };

    const reflection = computeReflection(config);

    expect(reflection.scaleY).toBe(-0.5);
    expect(reflection.scaleX).toBe(1);
    expect(reflection.startOpacity).toBe(0.52);
    expect(reflection.endOpacity).toBe(0);
    expect(reflection.distance).toBeCloseTo(emuToPixels(0), 5);
    expect(reflection.blur).toBeCloseTo(emuToPixels(6350), 5);
  });

  test('uses provided scaleY', () => {
    const config: ReflectionEffect = {
      blurRadius: 0,
      startOpacity: 1,
      endOpacity: 0,
      distance: 0,
      direction: 90,
      scaleY: -1,
    };

    const reflection = computeReflection(config);
    expect(reflection.scaleY).toBe(-1);
  });
});

describe('computeBevel', () => {
  test('returns highlight/shadow paths with correct material colors', () => {
    const config: BevelEffect = {
      topPreset: 'circle',
    };

    const bevel = computeBevel(config, STUB_WARPED_PATH, { width: 200, height: 50 });

    expect(bevel.highlightPath).toBe(STUB_WARPED_PATH.topPath);
    expect(bevel.shadowPath).toBe(STUB_WARPED_PATH.topPath);
    // circle preset uses 'matte' material
    expect(bevel.highlightColor).toBe('#FFFFFF');
    expect(bevel.shadowColor).toBe('#000000');
    expect(bevel.highlightOpacity).toBe(0.4);
    expect(bevel.shadowOpacity).toBe(0.3);
  });

  test('metallic preset uses higher opacities', () => {
    const config: BevelEffect = {
      topPreset: 'coolSlant', // metallic material
    };

    const bevel = computeBevel(config, STUB_WARPED_PATH, { width: 200, height: 50 });

    expect(bevel.highlightOpacity).toBe(0.8);
    expect(bevel.shadowOpacity).toBe(0.6);
  });

  test('plastic preset uses medium opacities', () => {
    const config: BevelEffect = {
      topPreset: 'slope', // plastic material
    };

    const bevel = computeBevel(config, STUB_WARPED_PATH, { width: 200, height: 50 });

    expect(bevel.highlightOpacity).toBe(0.6);
    expect(bevel.shadowOpacity).toBe(0.4);
  });

  test('defaults to circle when topPreset is undefined', () => {
    const config: BevelEffect = {};

    const bevel = computeBevel(config, STUB_WARPED_PATH, { width: 200, height: 50 });

    // circle is matte
    expect(bevel.highlightOpacity).toBe(0.4);
    expect(bevel.shadowOpacity).toBe(0.3);
  });
});

describe('computeTransform3D', () => {
  test('produces 16-element matrix', () => {
    const config: Transform3DEffect = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };

    const result = computeTransform3D(config);

    expect(result.matrix).toHaveLength(16);
    expect(result.perspective).toBe(1000);
  });

  test('identity rotation produces identity matrix', () => {
    const config: Transform3DEffect = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };

    const result = computeTransform3D(config);

    // Column-major identity
    expect(result.matrix[0]).toBeCloseTo(1, 5);
    expect(result.matrix[5]).toBeCloseTo(1, 5);
    expect(result.matrix[10]).toBeCloseTo(1, 5);
    expect(result.matrix[15]).toBeCloseTo(1, 5);
  });

  test('uses perspective from config when provided', () => {
    const config: Transform3DEffect = {
      rotationX: 10,
      rotationY: 0,
      rotationZ: 0,
      perspective: 5000000,
    };

    const result = computeTransform3D(config);

    expect(result.perspective).toBeCloseTo(emuToPixels(5000000), 1);
  });
});

describe('transform3DPoint', () => {
  test('identity transform returns original point', () => {
    const config: Transform3DEffect = {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };

    const transform = computeTransform3D(config);
    const result = transform3DPoint({ x: 100, y: 50 }, transform);

    expect(result.x).toBeCloseTo(100, 5);
    expect(result.y).toBeCloseTo(50, 5);
  });

  test('perspective divide produces finite results', () => {
    const config: Transform3DEffect = {
      rotationX: 30,
      rotationY: 20,
      rotationZ: 10,
    };

    const transform = computeTransform3D(config);
    const result = transform3DPoint({ x: 100, y: 50 }, transform);

    expect(isFinite(result.x)).toBe(true);
    expect(isFinite(result.y)).toBe(true);
  });
});

describe('matrixToCss3d', () => {
  test('produces correct CSS matrix3d string', () => {
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const css = matrixToCss3d(matrix);
    expect(css).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');
  });
});

describe('computeEffects', () => {
  test('returns empty result for undefined effects', () => {
    const result = computeEffects(undefined, STUB_WARPED_PATH, { width: 200, height: 50 });
    expect(result.shadowLayers).toHaveLength(0);
    expect(result.glowLayer).toBeUndefined();
    expect(result.reflectionLayer).toBeUndefined();
    expect(result.transform3D).toBeUndefined();
    expect(result.bevelPaths).toBeUndefined();
    expect(result.softEdgeMask).toBeUndefined();
  });

  test('processes all effects combined', () => {
    const effects: TextEffects = {
      outerShadow: {
        blurRadius: 50800,
        distance: 38100,
        direction: 45,
        color: '#000000',
        opacity: 0.5,
      },
      innerShadow: {
        blurRadius: 25400,
        distance: 12700,
        direction: 225,
        color: '#000000',
        opacity: 0.3,
      },
      glow: {
        radius: 63500,
        color: '#FFD700',
        opacity: 0.6,
      },
      softEdge: {
        radius: 25400,
      },
      reflection: {
        blurRadius: 6350,
        startOpacity: 0.52,
        endOpacity: 0,
        distance: 0,
        direction: 90,
      },
      transform3D: {
        rotationX: 15,
        rotationY: 10,
        rotationZ: 5,
      },
      bevel: {
        topPreset: 'circle',
      },
    };

    const result = computeEffects(effects, STUB_WARPED_PATH, { width: 200, height: 50 });

    expect(result.shadowLayers).toHaveLength(2); // outer + inner
    expect(result.shadowLayers[0].type).toBe('outer');
    expect(result.shadowLayers[1].type).toBe('inner');
    expect(result.glowLayer).toBeDefined();
    expect(result.glowLayer!.color).toBe('#FFD700');
    expect(result.softEdgeMask).toBeDefined();
    expect(result.reflectionLayer).toBeDefined();
    expect(result.transform3D).toBeDefined();
    expect(result.transform3D!.matrix).toHaveLength(16);
    expect(result.bevelPaths).toBeDefined();
    expect(result.bevelPaths!.highlightPath).toBe(STUB_WARPED_PATH.topPath);
  });

  test('processes preset shadow', () => {
    const effects: TextEffects = {
      presetShadow: 'shdw1',
    };

    const result = computeEffects(effects, STUB_WARPED_PATH, { width: 200, height: 50 });

    expect(result.shadowLayers).toHaveLength(1);
    expect(result.shadowLayers[0].type).toBe('outer');
  });
});

describe('calculateEffectBounds', () => {
  const baseBounds = { x: 0, y: 0, width: 200, height: 50 };

  test('returns base bounds for undefined effects', () => {
    const result = calculateEffectBounds(baseBounds, undefined);
    expect(result).toEqual(baseBounds);
  });

  test('expands bounds for outer shadow', () => {
    const effects: TextEffects = {
      outerShadow: {
        blurRadius: 50800,
        distance: 38100,
        direction: 45,
        color: '#000000',
        opacity: 0.5,
      },
    };

    const result = calculateEffectBounds(baseBounds, effects);

    expect(result.x).toBeLessThan(baseBounds.x);
    expect(result.y).toBeLessThan(baseBounds.y);
    expect(result.width).toBeGreaterThan(baseBounds.width);
    expect(result.height).toBeGreaterThan(baseBounds.height);
  });

  test('expands bounds for glow', () => {
    const effects: TextEffects = {
      glow: {
        radius: 63500,
        color: '#FFD700',
        opacity: 0.6,
      },
    };

    const result = calculateEffectBounds(baseBounds, effects);
    const glowRadius = emuToPixels(63500);

    expect(result.x).toBeCloseTo(baseBounds.x - glowRadius, 2);
    expect(result.y).toBeCloseTo(baseBounds.y - glowRadius, 2);
    expect(result.width).toBeCloseTo(baseBounds.width + glowRadius * 2, 2);
    expect(result.height).toBeCloseTo(baseBounds.height + glowRadius * 2, 2);
  });

  test('expands bounds for reflection', () => {
    const effects: TextEffects = {
      reflection: {
        blurRadius: 6350,
        startOpacity: 0.52,
        endOpacity: 0,
        distance: 12700,
        direction: 90,
      },
    };

    const result = calculateEffectBounds(baseBounds, effects);

    expect(result.height).toBeGreaterThan(baseBounds.height);
    // Width and x should not change for a vertical reflection
    expect(result.x).toBe(baseBounds.x);
    expect(result.width).toBe(baseBounds.width);
  });

  test('expands bounds for soft edge', () => {
    const effects: TextEffects = {
      softEdge: { radius: 25400 },
    };

    const result = calculateEffectBounds(baseBounds, effects);
    const edgeRadius = emuToPixels(25400);

    expect(result.x).toBeCloseTo(baseBounds.x - edgeRadius, 2);
    expect(result.y).toBeCloseTo(baseBounds.y - edgeRadius, 2);
  });

  test('expands bounds for preset shadow', () => {
    const effects: TextEffects = {
      presetShadow: 'shdw6' as PresetShadowType, // perspective shadow with scale
    };

    const result = calculateEffectBounds(baseBounds, effects);

    expect(result.x).toBeLessThan(baseBounds.x);
    expect(result.y).toBeLessThan(baseBounds.y);
    expect(result.width).toBeGreaterThan(baseBounds.width);
    expect(result.height).toBeGreaterThan(baseBounds.height);
  });
});
