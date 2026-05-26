/**
 * Tests for renderer/effects/canvas.ts
 *
 * Validates Canvas2D effect rendering: outer shadow, inner shadow, glow,
 * soft edge, bevel, and helper utilities (colorWithOpacity, emuToPx).
 */
import { jest } from '@jest/globals';

import type { Path } from '@mog-sdk/contracts/geometry';
import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
  SoftEdgeEffect,
} from '@mog-sdk/contracts/text-effects';
import {
  colorWithOpacity,
  emuToPx,
  renderBevelToCanvas,
  renderGlowToCanvas,
  renderInnerShadowToCanvas,
  renderOuterShadowToCanvas,
  renderSoftEdgeToCanvas,
} from '../../src/renderer/effects/canvas';

// ─── Mock Canvas Context ────────────────────────────────────────────────────

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    bezierCurveTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    setLineDash: jest.fn(),
  } as unknown as CanvasRenderingContext2D;
}

// ─── Test Geometry ──────────────────────────────────────────────────────────

const testPath: Path = {
  segments: [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 100, y: 0 },
    { type: 'L', x: 100, y: 100 },
    { type: 'L', x: 0, y: 100 },
    { type: 'Z' },
  ],
  closed: true,
};

const mockReplayPath = jest.fn();

// =============================================================================
// emuToPx
// =============================================================================

describe('emuToPx', () => {
  it('converts EMUs to pixels (9525 EMU = 1 px)', () => {
    expect(emuToPx(9525)).toBe(1);
  });

  it('converts fractional values correctly', () => {
    // 12700 EMU = 1 point. At 96 DPI, 1 point = 12700/9525 px ~= 1.333px
    expect(emuToPx(12700)).toBeCloseTo(1.3333, 3);
  });

  it('returns 0 for 0 EMUs', () => {
    expect(emuToPx(0)).toBe(0);
  });

  it('handles large values', () => {
    // 914400 EMU = 1 inch = 96 pixels
    expect(emuToPx(914400)).toBeCloseTo(96, 0);
  });
});

// =============================================================================
// colorWithOpacity
// =============================================================================

describe('colorWithOpacity', () => {
  it('passes through color when opacity >= 1', () => {
    expect(colorWithOpacity('#ff0000', 1)).toBe('#ff0000');
    expect(colorWithOpacity('#ff0000', 1.5)).toBe('#ff0000');
  });

  it('returns transparent black when opacity <= 0', () => {
    expect(colorWithOpacity('#ff0000', 0)).toBe('rgba(0,0,0,0)');
    expect(colorWithOpacity('#ff0000', -0.5)).toBe('rgba(0,0,0,0)');
  });

  it('converts hex color to rgba with opacity', () => {
    expect(colorWithOpacity('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(colorWithOpacity('#00ff00', 0.3)).toBe('rgba(0,255,0,0.3)');
    expect(colorWithOpacity('#0000ff', 0.8)).toBe('rgba(0,0,255,0.8)');
  });

  it('converts hex black to rgba', () => {
    expect(colorWithOpacity('#000000', 0.4)).toBe('rgba(0,0,0,0.4)');
  });

  it('handles 3-character hex colors correctly', () => {
    expect(colorWithOpacity('#f00', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(colorWithOpacity('#0f0', 0.5)).toBe('rgba(0,255,0,0.5)');
    expect(colorWithOpacity('#00f', 0.5)).toBe('rgba(0,0,255,0.5)');
    expect(colorWithOpacity('#abc', 0.5)).toBe('rgba(170,187,204,0.5)');
  });

  it('handles 3-character hex colors at full opacity (passes through)', () => {
    expect(colorWithOpacity('#f00', 1)).toBe('#f00');
  });

  it('replaces alpha in existing rgba color', () => {
    expect(colorWithOpacity('rgba(255,0,0,1)', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(colorWithOpacity('rgba(0,128,255,0.9)', 0.3)).toBe('rgba(0,128,255,0.3)');
  });

  it('converts rgb to rgba', () => {
    expect(colorWithOpacity('rgb(255,0,0)', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('returns unmodified color for unknown formats', () => {
    expect(colorWithOpacity('red', 0.5)).toBe('red');
    expect(colorWithOpacity('hsl(0,100%,50%)', 0.5)).toBe('hsl(0,100%,50%)');
  });
});

// =============================================================================
// renderOuterShadowToCanvas
// =============================================================================

describe('renderOuterShadowToCanvas', () => {
  const shadow: OuterShadowEffect = {
    blurRadius: 9525 * 4, // 4px blur
    distance: 9525 * 3, // 3px distance
    direction: 45, // 45 degrees
    color: '#000000',
    opacity: 0.5,
  };

  beforeEach(() => {
    mockReplayPath.mockClear();
  });

  it('sets shadowColor with opacity', () => {
    const ctx = createMockContext();
    renderOuterShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.shadowColor).toBe('rgba(0,0,0,0.5)');
  });

  it('sets shadowBlur from blurRadius', () => {
    const ctx = createMockContext();
    renderOuterShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.shadowBlur).toBeCloseTo(4, 1);
  });

  it('sets shadowOffsetX/Y from direction and distance', () => {
    const ctx = createMockContext();
    renderOuterShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    const dist = 3;
    const dirRad = (45 * Math.PI) / 180;
    expect(ctx.shadowOffsetX).toBeCloseTo(Math.cos(dirRad) * dist, 3);
    expect(ctx.shadowOffsetY).toBeCloseTo(Math.sin(dirRad) * dist, 3);
  });

  it('calls save/restore to isolate state', () => {
    const ctx = createMockContext();
    renderOuterShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('calls beginPath, replayPath, and fill', () => {
    const ctx = createMockContext();
    renderOuterShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(mockReplayPath).toHaveBeenCalledWith(testPath, ctx);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('handles 0 degree direction (shadow to the right)', () => {
    const rightShadow: OuterShadowEffect = {
      ...shadow,
      direction: 0,
    };
    const ctx = createMockContext();
    renderOuterShadowToCanvas(rightShadow, testPath, ctx, mockReplayPath);
    expect(ctx.shadowOffsetX).toBeCloseTo(3, 1);
    expect(ctx.shadowOffsetY).toBeCloseTo(0, 1);
  });

  it('handles 90 degree direction (shadow downward)', () => {
    const downShadow: OuterShadowEffect = {
      ...shadow,
      direction: 90,
    };
    const ctx = createMockContext();
    renderOuterShadowToCanvas(downShadow, testPath, ctx, mockReplayPath);
    expect(ctx.shadowOffsetX).toBeCloseTo(0, 1);
    expect(ctx.shadowOffsetY).toBeCloseTo(3, 1);
  });
});

// =============================================================================
// renderInnerShadowToCanvas
// =============================================================================

describe('renderInnerShadowToCanvas', () => {
  const shadow: InnerShadowEffect = {
    blurRadius: 9525 * 2, // 2px blur
    distance: 9525, // 1px distance
    direction: 225, // top-left light
    color: '#000000',
    opacity: 0.3,
  };

  beforeEach(() => {
    mockReplayPath.mockClear();
  });

  it('clips to geometry', () => {
    const ctx = createMockContext();
    renderInnerShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.clip).toHaveBeenCalled();
  });

  it('sets shadow properties', () => {
    const ctx = createMockContext();
    renderInnerShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.shadowColor).toBe('rgba(0,0,0,0.3)');
    expect(ctx.shadowBlur).toBeCloseTo(2, 1);
  });

  it('calls fill with evenodd for cutout technique', () => {
    const ctx = createMockContext();
    renderInnerShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.fill).toHaveBeenCalledWith('evenodd');
  });

  it('draws a large rect for the inverted shadow technique', () => {
    const ctx = createMockContext();
    renderInnerShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.rect).toHaveBeenCalled();
  });

  it('calls save/restore to isolate state', () => {
    const ctx = createMockContext();
    renderInnerShadowToCanvas(shadow, testPath, ctx, mockReplayPath);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// renderGlowToCanvas
// =============================================================================

describe('renderGlowToCanvas', () => {
  const glow: GlowEffect = {
    radius: 9525 * 6, // 6px radius
    color: '#FFD700',
    opacity: 0.6,
  };

  beforeEach(() => {
    mockReplayPath.mockClear();
  });

  it('performs multiple stroke passes', () => {
    const ctx = createMockContext();
    renderGlowToCanvas(glow, testPath, ctx, mockReplayPath);
    const strokeCalls = (ctx.stroke as jest.Mock).mock.calls.length;
    expect(strokeCalls).toBeGreaterThanOrEqual(3);
  });

  it('sets lineCap and lineJoin to round', () => {
    const ctx = createMockContext();
    renderGlowToCanvas(glow, testPath, ctx, mockReplayPath);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.lineJoin).toBe('round');
  });

  it('calls replayPath for each pass', () => {
    const ctx = createMockContext();
    renderGlowToCanvas(glow, testPath, ctx, mockReplayPath);
    expect(mockReplayPath.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('calls save/restore to isolate state', () => {
    const ctx = createMockContext();
    renderGlowToCanvas(glow, testPath, ctx, mockReplayPath);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('uses decreasing line widths for outer passes', () => {
    const ctx = createMockContext();
    const widths: number[] = [];
    Object.defineProperty(ctx, 'lineWidth', {
      get() {
        return this._lineWidth || 1;
      },
      set(val: number) {
        widths.push(val);
        this._lineWidth = val;
      },
    });
    renderGlowToCanvas(glow, testPath, ctx, mockReplayPath);
    // Widths should be in decreasing order (outer pass first)
    for (let i = 0; i < widths.length - 1; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i + 1]);
    }
  });
});

// =============================================================================
// renderSoftEdgeToCanvas
// =============================================================================

describe('renderSoftEdgeToCanvas', () => {
  const softEdge: SoftEdgeEffect = {
    radius: 9525 * 2, // 2px radius
  };

  beforeEach(() => {
    mockReplayPath.mockClear();
  });

  it('sets shadowBlur from radius', () => {
    const ctx = createMockContext();
    renderSoftEdgeToCanvas(softEdge, testPath, ctx, mockReplayPath);
    expect(ctx.shadowBlur).toBeCloseTo(2, 1);
  });

  it('calls save/restore to isolate state', () => {
    const ctx = createMockContext();
    renderSoftEdgeToCanvas(softEdge, testPath, ctx, mockReplayPath);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('sets globalCompositeOperation to destination-in', () => {
    const ctx = createMockContext();
    renderSoftEdgeToCanvas(softEdge, testPath, ctx, mockReplayPath);
    expect(ctx.globalCompositeOperation).toBe('destination-in');
  });

  it('calls beginPath, replayPath, and fill to actually render', () => {
    const ctx = createMockContext();
    renderSoftEdgeToCanvas(softEdge, testPath, ctx, mockReplayPath);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(mockReplayPath).toHaveBeenCalledWith(testPath, ctx);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('sets shadowColor for the blur mask', () => {
    const ctx = createMockContext();
    renderSoftEdgeToCanvas(softEdge, testPath, ctx, mockReplayPath);
    expect(ctx.shadowColor).toBe('rgba(0,0,0,1)');
  });
});

// =============================================================================
// renderBevelToCanvas
// =============================================================================

describe('renderBevelToCanvas', () => {
  beforeEach(() => {
    mockReplayPath.mockClear();
  });

  it('returns early when no preset is set', () => {
    const bevel: BevelEffect = {};
    const ctx = createMockContext();
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('renders light and dark strokes for top bevel', () => {
    const bevel: BevelEffect = {
      topPreset: 'circle',
      topWidth: 9525 * 2, // 2px
    };
    const ctx = createMockContext();
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // Should call stroke twice (light + dark edge)
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it('uses default width when topWidth is not specified', () => {
    const bevel: BevelEffect = {
      topPreset: 'circle',
    };
    const ctx = createMockContext();
    const widths: number[] = [];
    Object.defineProperty(ctx, 'lineWidth', {
      get() {
        return this._lineWidth || 1;
      },
      set(val: number) {
        widths.push(val);
        this._lineWidth = val;
      },
    });
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // Default is 25400 EMU = ~2.67px for the light edge
    expect(widths[0]).toBeCloseTo(emuToPx(25400), 1);
  });

  it('uses light color for first stroke and dark for second', () => {
    const bevel: BevelEffect = {
      topPreset: 'circle',
    };
    const ctx = createMockContext();
    const styles: string[] = [];
    Object.defineProperty(ctx, 'strokeStyle', {
      get() {
        return this._strokeStyle || '';
      },
      set(val: string) {
        styles.push(val);
        this._strokeStyle = val;
      },
    });
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    expect(styles[0]).toContain('255,255,255'); // light edge
    expect(styles[1]).toContain('0,0,0'); // dark edge
  });

  it('calls save/restore to isolate state', () => {
    const bevel: BevelEffect = {
      topPreset: 'circle',
    };
    const ctx = createMockContext();
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('renders strokes for bottom bevel only', () => {
    const bevel: BevelEffect = {
      bottomPreset: 'angle',
      bottomWidth: 9525 * 2, // 2px
    };
    const ctx = createMockContext();
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // Should call stroke twice (dark + light edge for bottom bevel)
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('uses inverted colors for bottom bevel (dark first, light second)', () => {
    const bevel: BevelEffect = {
      bottomPreset: 'circle',
    };
    const ctx = createMockContext();
    const styles: string[] = [];
    Object.defineProperty(ctx, 'strokeStyle', {
      get() {
        return this._strokeStyle || '';
      },
      set(val: string) {
        styles.push(val);
        this._strokeStyle = val;
      },
    });
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // Bottom bevel inverts light/dark: dark edge first, light edge second
    expect(styles[0]).toContain('0,0,0'); // dark edge
    expect(styles[1]).toContain('255,255,255'); // light edge
  });

  it('renders both top and bottom bevels when both presets are set', () => {
    const bevel: BevelEffect = {
      topPreset: 'circle',
      topWidth: 9525 * 2,
      bottomPreset: 'angle',
      bottomWidth: 9525 * 3,
    };
    const ctx = createMockContext();
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // 2 strokes for top + 2 strokes for bottom = 4 total
    expect(ctx.stroke).toHaveBeenCalledTimes(4);
  });

  it('uses correct colors when both top and bottom bevels are rendered', () => {
    const bevel: BevelEffect = {
      topPreset: 'circle',
      bottomPreset: 'angle',
    };
    const ctx = createMockContext();
    const styles: string[] = [];
    Object.defineProperty(ctx, 'strokeStyle', {
      get() {
        return this._strokeStyle || '';
      },
      set(val: string) {
        styles.push(val);
        this._strokeStyle = val;
      },
    });
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // Top bevel: light then dark
    expect(styles[0]).toContain('255,255,255'); // top light edge
    expect(styles[1]).toContain('0,0,0'); // top dark edge
    // Bottom bevel: dark then light (inverted)
    expect(styles[2]).toContain('0,0,0'); // bottom dark edge
    expect(styles[3]).toContain('255,255,255'); // bottom light edge
  });

  it('uses default width when bottomWidth is not specified', () => {
    const bevel: BevelEffect = {
      bottomPreset: 'circle',
    };
    const ctx = createMockContext();
    const widths: number[] = [];
    Object.defineProperty(ctx, 'lineWidth', {
      get() {
        return this._lineWidth || 1;
      },
      set(val: number) {
        widths.push(val);
        this._lineWidth = val;
      },
    });
    renderBevelToCanvas(bevel, testPath, ctx, mockReplayPath);
    // Default is 25400 EMU = ~2.67px for the primary edge
    expect(widths[0]).toBeCloseTo(emuToPx(25400), 1);
    // Secondary edge is half the width
    expect(widths[1]).toBeCloseTo(emuToPx(25400) * 0.5, 1);
  });
});
