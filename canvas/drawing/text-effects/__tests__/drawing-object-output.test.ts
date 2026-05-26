/**
 * Tests for warpToDrawingObjects
 */
import { jest } from '@jest/globals';

import type { AffineTransform, Path, Point2D } from '@mog-sdk/contracts/geometry';
import type { TextEffectStyle } from '../src/effects/style-presets';
import type { GlyphBox, WarpedGlyph } from '../src/warp/warp-engine';

const mockWarpText = jest.fn();
const mockGetWarpPreset = jest.fn();
const mockCompute3DTransform = jest.fn();

// Mock warp-engine
jest.unstable_mockModule('../src/warp/warp-engine', () => ({
  warpText: mockWarpText,
}));

// Mock preset registry
jest.unstable_mockModule('../src/presets/registry', () => ({
  getWarpPreset: mockGetWarpPreset,
}));

// Mock three-d
jest.unstable_mockModule('../src/effects/three-d', () => ({
  compute3DTransform: mockCompute3DTransform,
}));

// We need to mock PathOps.pathBoundingBox for the 3D test
jest.unstable_mockModule('@mog/geometry', () => ({
  PathOps: {
    pathBoundingBox: jest.fn(() => ({ x: 0, y: 0, width: 200, height: 100 })),
  },
}));

const { warpToDrawingObjects } = await import('../src/drawing-object-output');

// ─── Test Helpers ──────────────────────────────────────────────────────────

const IDENTITY_TRANSFORM: AffineTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function makeGlyphBox(char: string, x: number, width: number): GlyphBox {
  return { x, y: 10, width, height: 14, ascent: 10, descent: 4, char };
}

function makeWarpedGlyph(glyph: GlyphBox): WarpedGlyph {
  const x = glyph.x;
  const w = glyph.width;
  return {
    original: glyph,
    corners: [
      { x, y: 0 },
      { x: x + w, y: 0 },
      { x: x + w, y: 14 },
      { x, y: 14 },
    ] as [Point2D, Point2D, Point2D, Point2D],
    transform: IDENTITY_TRANSFORM,
    scale: 1,
  };
}

const MOCK_TOP_PATH: Path = {
  segments: [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 200, y: 0 },
  ],
  closed: false,
};

const MOCK_BOTTOM_PATH: Path = {
  segments: [
    { type: 'M', x: 0, y: 100 },
    { type: 'L', x: 200, y: 100 },
  ],
  closed: false,
};

const MOCK_PRESET = {
  name: 'textPlain',
  topGuide: jest.fn(() => MOCK_TOP_PATH),
  bottomGuide: jest.fn(() => MOCK_BOTTOM_PATH),
  defaultAdjustment: 0.5,
  minAdjustment: 0,
  maxAdjustment: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetWarpPreset.mockReturnValue(MOCK_PRESET);
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('warpToDrawingObjects', () => {
  it('returns empty array for empty glyphs', () => {
    const result = warpToDrawingObjects([], 'textPlain' as any, 200, 100);
    expect(result).toEqual([]);
    // Should not even call getWarpPreset if glyphs is empty
  });

  it('returns empty array when warpText returns empty', () => {
    mockWarpText.mockReturnValue([]);
    const glyph = makeGlyphBox('A', 0, 10);
    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100);
    expect(result).toEqual([]);
  });

  it('maps a single glyph with default solid black fill', () => {
    const glyph = makeGlyphBox('A', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100);

    expect(result).toHaveLength(1);
    expect(result[0].geometry.closed).toBe(true);
    expect(result[0].geometry.segments).toHaveLength(5); // M, L, L, L, Z
    expect(result[0].fill).toEqual({ type: 'solid', color: '#000000' });
    expect(result[0].transform).toEqual(IDENTITY_TRANSFORM);
  });

  it('maps a single glyph with solid fill from style', () => {
    const glyph = makeGlyphBox('B', 0, 12);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#FF0000' },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result).toHaveLength(1);
    expect(result[0].fill).toEqual({ type: 'solid', color: '#FF0000' });
  });

  it('maps a glyph with linear gradient fill', () => {
    const glyph = makeGlyphBox('C', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const style: TextEffectStyle = {
      fill: {
        type: 'gradient',
        gradient: {
          type: 'linear',
          angle: 90,
          stops: [
            { position: 0, color: '#0000FF' },
            { position: 100, color: '#00FF00' },
          ],
        },
      },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result).toHaveLength(1);
    expect(result[0].fill).toEqual({
      type: 'linear-gradient',
      angle: 90,
      stops: [
        { offset: 0, color: '#0000FF' },
        { offset: 100, color: '#00FF00' },
      ],
    });
  });

  it('maps a glyph with radial gradient fill', () => {
    const glyph = makeGlyphBox('D', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const style: TextEffectStyle = {
      fill: {
        type: 'gradient',
        gradient: {
          type: 'radial',
          stops: [
            { position: 0, color: '#FFFFFF' },
            { position: 100, color: '#000000' },
          ],
        },
      },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result).toHaveLength(1);
    expect(result[0].fill).toEqual({
      type: 'radial-gradient',
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.5,
      radiusY: 0.5,
      stops: [
        { offset: 0, color: '#FFFFFF' },
        { offset: 100, color: '#000000' },
      ],
    });
  });

  it('maps fill type "none" correctly', () => {
    const glyph = makeGlyphBox('E', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const style: TextEffectStyle = {
      fill: { type: 'none' },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result[0].fill).toEqual({ type: 'none' });
  });

  it('maps outline to stroke', () => {
    const glyph = makeGlyphBox('F', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#000000' },
      outline: { color: '#FF0000', width: 2 },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result[0].stroke).toEqual({ color: '#FF0000', width: 2 });
  });

  it('maps shadow to effects.outerShadow', () => {
    const glyph = makeGlyphBox('G', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#000000' },
      shadow: { color: '#000000', offsetX: 3, offsetY: 4, blur: 5, opacity: 0.5 },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result[0].effects).toBeDefined();
    expect(result[0].effects!.outerShadow).toHaveLength(1);

    const shadow = result[0].effects!.outerShadow![0];
    // distance = sqrt(3^2 + 4^2) = 5, in EMUs = 5 * 9525 = 47625
    expect(shadow.distance).toBeCloseTo(5 * 9525);
    // direction = atan2(4, 3) * 180/PI ~= 53.13
    expect(shadow.direction).toBeCloseTo(Math.atan2(4, 3) * (180 / Math.PI));
    // blur = 5 * 9525 = 47625
    expect(shadow.blurRadius).toBe(5 * 9525);
    expect(shadow.color).toBe('#000000');
    expect(shadow.opacity).toBe(0.5);
  });

  it('maps multiple glyphs to multiple DrawingObjects', () => {
    const glyph1 = makeGlyphBox('H', 0, 10);
    const glyph2 = makeGlyphBox('I', 10, 8);
    const glyph3 = makeGlyphBox('!', 18, 5);
    const warped = [makeWarpedGlyph(glyph1), makeWarpedGlyph(glyph2), makeWarpedGlyph(glyph3)];
    mockWarpText.mockReturnValue(warped);

    const result = warpToDrawingObjects([glyph1, glyph2, glyph3], 'textPlain' as any, 200, 100);

    expect(result).toHaveLength(3);
    // Each DrawingObject should have its own geometry path based on glyph corners
    expect(result[0].geometry.segments[0]).toEqual({ type: 'M', x: 0, y: 0 });
    expect(result[1].geometry.segments[0]).toEqual({ type: 'M', x: 10, y: 0 });
    expect(result[2].geometry.segments[0]).toEqual({ type: 'M', x: 18, y: 0 });
  });

  it('uses preset defaultAdjustment when no adjustment is provided', () => {
    const glyph = makeGlyphBox('J', 0, 10);
    mockWarpText.mockReturnValue([makeWarpedGlyph(glyph)]);

    warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100);

    expect(MOCK_PRESET.topGuide).toHaveBeenCalledWith(200, 100, 0.5);
    expect(MOCK_PRESET.bottomGuide).toHaveBeenCalledWith(200, 100, 0.5);
  });

  it('uses provided adjustment value', () => {
    const glyph = makeGlyphBox('K', 0, 10);
    mockWarpText.mockReturnValue([makeWarpedGlyph(glyph)]);

    warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, 0.75);

    expect(MOCK_PRESET.topGuide).toHaveBeenCalledWith(200, 100, 0.75);
    expect(MOCK_PRESET.bottomGuide).toHaveBeenCalledWith(200, 100, 0.75);
  });

  it('wraps glyphs in parent with 3D transform when threeDRotation is set', () => {
    const glyph = makeGlyphBox('L', 0, 10);
    const warped = makeWarpedGlyph(glyph);
    mockWarpText.mockReturnValue([warped]);

    const transform3D: AffineTransform = { a: 0.9, b: 0.1, c: -0.1, d: 0.9, tx: 5, ty: 3 };
    mockCompute3DTransform.mockReturnValue(transform3D);

    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#0000FF' },
      threeDRotation: { rotationX: 10, rotationY: 0, rotationZ: 0 },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    // Should return a single parent DrawingObject with children
    expect(result).toHaveLength(1);
    expect(result[0].transform).toEqual(transform3D);
    expect(result[0].children).toBeDefined();
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].fill).toEqual({ type: 'solid', color: '#0000FF' });
  });

  it('does not create outline/stroke when style has no outline', () => {
    const glyph = makeGlyphBox('M', 0, 10);
    mockWarpText.mockReturnValue([makeWarpedGlyph(glyph)]);

    const style: TextEffectStyle = {
      fill: { type: 'solid', color: '#000000' },
      // no outline
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result[0].stroke).toBeUndefined();
  });

  it('creates correct quad path from warped glyph corners', () => {
    const glyph = makeGlyphBox('N', 0, 10);
    const warped: WarpedGlyph = {
      original: glyph,
      corners: [
        { x: 5, y: 2 },
        { x: 15, y: 3 },
        { x: 16, y: 17 },
        { x: 4, y: 16 },
      ],
      transform: IDENTITY_TRANSFORM,
      scale: 1,
    };
    mockWarpText.mockReturnValue([warped]);

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100);

    const segs = result[0].geometry.segments;
    expect(segs[0]).toEqual({ type: 'M', x: 5, y: 2 });
    expect(segs[1]).toEqual({ type: 'L', x: 15, y: 3 });
    expect(segs[2]).toEqual({ type: 'L', x: 16, y: 17 });
    expect(segs[3]).toEqual({ type: 'L', x: 4, y: 16 });
    expect(segs[4]).toEqual({ type: 'Z' });
    expect(result[0].geometry.closed).toBe(true);
  });

  it('maps solid fill with missing color to default #000000', () => {
    const glyph = makeGlyphBox('O', 0, 10);
    mockWarpText.mockReturnValue([makeWarpedGlyph(glyph)]);

    const style: TextEffectStyle = {
      fill: { type: 'solid' }, // no color specified
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect(result[0].fill).toEqual({ type: 'solid', color: '#000000' });
  });

  it('maps gradient fill with missing angle to 0', () => {
    const glyph = makeGlyphBox('P', 0, 10);
    mockWarpText.mockReturnValue([makeWarpedGlyph(glyph)]);

    const style: TextEffectStyle = {
      fill: {
        type: 'gradient',
        gradient: {
          type: 'linear',
          // no angle
          stops: [
            { position: 0, color: '#000' },
            { position: 100, color: '#FFF' },
          ],
        },
      },
    };

    const result = warpToDrawingObjects([glyph], 'textPlain' as any, 200, 100, undefined, style);

    expect((result[0].fill as any).angle).toBe(0);
  });
});
