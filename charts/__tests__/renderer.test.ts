/**
 * Tests for Canvas Renderer - arc path command rendering
 *
 * @jest-environment jsdom
 */

import { CanvasRenderer } from '../src/primitives/renderer/canvas-renderer';
import type { PathMark } from '../src/primitives/types';

// Mock canvas getContext
const mockCtx = {
  clearRect: jest.fn(),
  setTransform: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  arc: jest.fn(),
  ellipse: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
  fillRect: jest.fn(),
  strokeRect: jest.fn(),
  fillText: jest.fn(),
  strokeText: jest.fn(),
  measureText: jest.fn(() => ({
    width: 50,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 2,
  })),
  getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: jest.fn(),
  translate: jest.fn(),
  rotate: jest.fn(),
  scale: jest.fn(),
  closePath: jest.fn(),
  quadraticCurveTo: jest.fn(),
  bezierCurveTo: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
  createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  drawImage: jest.fn(),
};

HTMLCanvasElement.prototype.getContext = jest.fn(() => mockCtx) as any;

describe('CanvasRenderer arc path commands', () => {
  let renderer: CanvasRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    const canvas = document.createElement('canvas');
    renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
    renderer.resize(800, 600);
  });

  afterEach(() => {
    renderer.destroy();
  });

  it('renders circular arc path commands using ctx.arc instead of lineTo', () => {
    // SVG path with a circular arc (rx === ry)
    // M 0 0 A 50 50 0 0 1 100 0
    const pathMark: PathMark = {
      type: 'path',
      x: 10,
      y: 20,
      path: 'M 0 0 A 50 50 0 0 1 100 0',
      style: { fill: '#ff0000' },
    };

    renderer.render([pathMark]);

    // arc() should have been called (not just lineTo for the endpoint)
    expect(mockCtx.arc).toHaveBeenCalled();
    // The arc call should include the offset
    const arcCall = mockCtx.arc.mock.calls.find(
      (call: number[]) => call.length >= 5 && typeof call[3] === 'number',
    );
    expect(arcCall).toBeDefined();
  });

  it('renders elliptical arc path commands using ctx.ellipse', () => {
    // SVG path with an elliptical arc (rx !== ry)
    // M 0 0 A 60 30 0 0 1 100 0
    const pathMark: PathMark = {
      type: 'path',
      x: 5,
      y: 10,
      path: 'M 0 0 A 60 30 0 0 1 100 0',
      style: { fill: '#00ff00' },
    };

    renderer.render([pathMark]);

    // ellipse() should have been called for non-uniform radii
    expect(mockCtx.ellipse).toHaveBeenCalled();
    const ellipseCall = mockCtx.ellipse.mock.calls[0];
    // Verify radii are passed correctly
    expect(ellipseCall[2]).toBe(60); // rx
    expect(ellipseCall[3]).toBe(30); // ry
  });

  it('falls back to lineTo for degenerate arcs (rx=0 or ry=0)', () => {
    // Degenerate arc with rx=0
    const pathMark: PathMark = {
      type: 'path',
      x: 0,
      y: 0,
      path: 'M 0 0 A 0 50 0 0 1 100 0',
      style: { fill: '#0000ff' },
    };

    renderer.render([pathMark]);

    // Should fall back to lineTo, not call arc/ellipse for the A command
    // (arc may be called by other path rendering, but ellipse should not)
    expect(mockCtx.ellipse).not.toHaveBeenCalled();
    // lineTo should be called for the degenerate arc endpoint
    expect(mockCtx.lineTo).toHaveBeenCalled();
  });

  it('renders large arc flag correctly', () => {
    // Large arc (largeArc=1)
    const pathMark: PathMark = {
      type: 'path',
      x: 0,
      y: 0,
      path: 'M 0 0 A 50 50 0 1 1 100 0',
      style: { fill: '#ff00ff' },
    };

    renderer.render([pathMark]);

    // arc should be called with the correct sweep direction
    expect(mockCtx.arc).toHaveBeenCalled();
  });
});
