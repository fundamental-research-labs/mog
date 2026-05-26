import type { ExcelBorderStyle } from '../border-renderer';
import {
  ALL_BORDER_STYLES,
  generateBorderOps,
  getBorderDashPattern,
  getBorderLineWidth,
  renderBorderSide,
  renderDiagonalBorder,
  renderDoubleBorder,
} from '../border-renderer';
import type { ContentOp } from '../content-ops';
import { MockIpcBridge } from '../ipc-bridge';
import { PdfCanvas } from '../pdf-canvas';

describe('Border Renderer', () => {
  let bridge: MockIpcBridge;
  let canvas: PdfCanvas;

  beforeEach(() => {
    bridge = new MockIpcBridge();
    canvas = new PdfCanvas(bridge);
    canvas.beginPage(612, 792);
  });

  // ── getBorderLineWidth ──────────────────────────────────────────

  describe('getBorderLineWidth', () => {
    it('returns correct widths for all styles', () => {
      expect(getBorderLineWidth('hair')).toBe(0.25);
      expect(getBorderLineWidth('thin')).toBe(0.5);
      expect(getBorderLineWidth('medium')).toBe(1);
      expect(getBorderLineWidth('thick')).toBe(1.5);
      expect(getBorderLineWidth('dashed')).toBe(0.5);
      expect(getBorderLineWidth('dotted')).toBe(0.5);
      expect(getBorderLineWidth('double')).toBe(0.5);
      expect(getBorderLineWidth('dashDot')).toBe(0.5);
      expect(getBorderLineWidth('dashDotDot')).toBe(0.5);
      expect(getBorderLineWidth('slantDashDot')).toBe(0.5);
      expect(getBorderLineWidth('mediumDashed')).toBe(1);
      expect(getBorderLineWidth('mediumDashDot')).toBe(1);
      expect(getBorderLineWidth('mediumDashDotDot')).toBe(1);
    });
  });

  // ── getBorderDashPattern ────────────────────────────────────────

  describe('getBorderDashPattern', () => {
    it('returns null for solid styles', () => {
      expect(getBorderDashPattern('thin')).toBeNull();
      expect(getBorderDashPattern('medium')).toBeNull();
      expect(getBorderDashPattern('thick')).toBeNull();
      expect(getBorderDashPattern('hair')).toBeNull();
      expect(getBorderDashPattern('double')).toBeNull();
    });

    it('returns correct dash patterns', () => {
      expect(getBorderDashPattern('dashed')).toEqual({ segments: [4, 4], phase: 0 });
      expect(getBorderDashPattern('dotted')).toEqual({ segments: [1, 2], phase: 0 });
      expect(getBorderDashPattern('dashDot')).toEqual({ segments: [4, 2, 1, 2], phase: 0 });
      expect(getBorderDashPattern('dashDotDot')).toEqual({
        segments: [4, 2, 1, 2, 1, 2],
        phase: 0,
      });
      expect(getBorderDashPattern('mediumDashed')).toEqual({ segments: [6, 3], phase: 0 });
      expect(getBorderDashPattern('mediumDashDot')).toEqual({ segments: [6, 3, 1, 3], phase: 0 });
      expect(getBorderDashPattern('mediumDashDotDot')).toEqual({
        segments: [6, 3, 1, 3, 1, 3],
        phase: 0,
      });
      expect(getBorderDashPattern('slantDashDot')).toEqual({ segments: [4, 2, 1, 2], phase: 0 });
    });
  });

  // ── renderBorderSide via RenderBackend ──────────────────────────

  describe('renderBorderSide', () => {
    it.each(ALL_BORDER_STYLES)('renders %s border style', (style) => {
      renderBorderSide(canvas, style, [0, 0, 0], 0, 100, 200, 100);
      const ops = canvas.ops;
      expect(ops.some((o) => o.op === 'SaveState')).toBe(true);
      expect(ops.some((o) => o.op === 'RestoreState')).toBe(true);
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
    });

    it('sets the correct stroke color', () => {
      renderBorderSide(canvas, 'thin', [1, 0, 0], 0, 0, 100, 0);
      const ops = canvas.ops;
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetStrokeColorRGB', r: 1, g: 0, b: 0 }),
      );
    });

    it('thin border uses 0.5pt line width', () => {
      renderBorderSide(canvas, 'thin', [0, 0, 0], 0, 0, 100, 0);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 0.5 });
    });

    it('thick border uses 1.5pt line width', () => {
      renderBorderSide(canvas, 'thick', [0, 0, 0], 0, 0, 100, 0);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 1.5 });
    });

    it('dashed border sets dash pattern', () => {
      renderBorderSide(canvas, 'dashed', [0, 0, 0], 0, 0, 100, 0);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [4, 4], phase: 0 });
    });

    it('dotted border sets dot pattern', () => {
      renderBorderSide(canvas, 'dotted', [0, 0, 0], 0, 0, 100, 0);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [1, 2], phase: 0 });
    });

    it('solid styles set empty dash pattern', () => {
      renderBorderSide(canvas, 'thin', [0, 0, 0], 0, 0, 100, 0);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [], phase: 0 });
    });

    it('renders from (x1,y1) to (x2,y2)', () => {
      renderBorderSide(canvas, 'thin', [0, 0, 0], 10, 20, 200, 20);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'MoveTo', x: 10, y: 20 });
      expect(ops).toContainEqual({ op: 'LineTo', x: 200, y: 20 });
    });
  });

  // ── Double Border ───────────────────────────────────────────────

  describe('renderDoubleBorder (via renderBorderSide)', () => {
    it('renders double border as two strokes', () => {
      renderBorderSide(canvas, 'double', [0, 0, 0], 0, 50, 200, 50);
      const ops = canvas.ops;
      const strokeOps = ops.filter((o) => o.op === 'Stroke');
      expect(strokeOps.length).toBe(2);
    });

    it('double border uses 0.5pt line width', () => {
      renderBorderSide(canvas, 'double', [0, 0, 0], 0, 50, 200, 50);
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 0.5 });
    });

    it('horizontal double border offsets vertically', () => {
      renderBorderSide(canvas, 'double', [0, 0, 0], 0, 50, 200, 50);
      const ops = canvas.ops;
      const moveOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'MoveTo' }> => o.op === 'MoveTo',
      );
      // Two move ops with different y values
      expect(moveOps.length).toBe(2);
      expect(moveOps[0].y).not.toBe(moveOps[1].y);
      // Offset by 0.75
      expect(Math.abs(moveOps[0].y - moveOps[1].y)).toBeCloseTo(1.5, 5);
    });

    it('vertical double border offsets horizontally', () => {
      renderBorderSide(canvas, 'double', [0, 0, 0], 50, 0, 50, 200);
      const ops = canvas.ops;
      const moveOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'MoveTo' }> => o.op === 'MoveTo',
      );
      expect(moveOps.length).toBe(2);
      expect(moveOps[0].x).not.toBe(moveOps[1].x);
      expect(Math.abs(moveOps[0].x - moveOps[1].x)).toBeCloseTo(1.5, 5);
    });
  });

  // ── renderDoubleBorder directly ──────────────────────────────────

  describe('renderDoubleBorder direct', () => {
    it('renders horizontal double border', () => {
      renderDoubleBorder(canvas, [1, 0, 0], 0, 50, 200, 50, true);
      const ops = canvas.ops;
      expect(ops.filter((o) => o.op === 'Stroke').length).toBe(2);
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetStrokeColorRGB', r: 1, g: 0, b: 0 }),
      );
    });

    it('renders vertical double border', () => {
      renderDoubleBorder(canvas, [0, 0, 1], 50, 0, 50, 200, false);
      const ops = canvas.ops;
      expect(ops.filter((o) => o.op === 'Stroke').length).toBe(2);
    });
  });

  // ── renderDiagonalBorder ────────────────────────────────────────

  describe('renderDiagonalBorder', () => {
    it('renders diagonal down border', () => {
      renderDiagonalBorder(
        canvas,
        { style: 'thin', color: [0, 0, 0] },
        { x: 10, y: 10, width: 100, height: 50 },
        'down',
      );
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'MoveTo', x: 10, y: 10 });
      expect(ops).toContainEqual({ op: 'LineTo', x: 110, y: 60 });
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
    });

    it('renders diagonal up border', () => {
      renderDiagonalBorder(
        canvas,
        { style: 'thin', color: [0, 0, 0] },
        { x: 10, y: 10, width: 100, height: 50 },
        'up',
      );
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'MoveTo', x: 10, y: 60 });
      expect(ops).toContainEqual({ op: 'LineTo', x: 110, y: 10 });
    });

    it('diagonal border with dashed style', () => {
      renderDiagonalBorder(
        canvas,
        { style: 'dashed', color: [1, 0, 0] },
        { x: 0, y: 0, width: 100, height: 100 },
        'down',
      );
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [4, 4], phase: 0 });
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetStrokeColorRGB', r: 1, g: 0, b: 0 }),
      );
    });

    it('diagonal border with thick style', () => {
      renderDiagonalBorder(
        canvas,
        { style: 'thick', color: [0, 0, 0] },
        { x: 0, y: 0, width: 100, height: 100 },
        'up',
      );
      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 1.5 });
    });
  });

  // ── generateBorderOps (ContentOps directly) ─────────────────────

  describe('generateBorderOps', () => {
    it('generates ops for thin border', () => {
      const ops = generateBorderOps('thin', [0, 0, 0], 0, 0, 100, 0);
      expect(ops[0]).toEqual({ op: 'SaveState' });
      expect(ops[ops.length - 1]).toEqual({ op: 'RestoreState' });
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 0.5 });
      expect(ops).toContainEqual({ op: 'Stroke' });
    });

    it('generates ops for dashed border with dash pattern', () => {
      const ops = generateBorderOps('dashed', [0, 0, 0], 0, 0, 100, 0);
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [4, 4], phase: 0 });
    });

    it('generates ops for double border with two strokes', () => {
      const ops = generateBorderOps('double', [0, 0, 0], 0, 50, 200, 50);
      const strokeOps = ops.filter((o) => o.op === 'Stroke');
      expect(strokeOps.length).toBe(2);
    });

    it('generates ops for all 13 styles', () => {
      for (const style of ALL_BORDER_STYLES) {
        const ops = generateBorderOps(style, [0, 0, 0], 0, 0, 100, 0);
        expect(ops.length).toBeGreaterThan(0);
        expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
      }
    });
  });

  // ── ALL_BORDER_STYLES ───────────────────────────────────────────

  describe('ALL_BORDER_STYLES', () => {
    it('contains exactly 13 styles', () => {
      expect(ALL_BORDER_STYLES.length).toBe(13);
    });

    it('contains all expected styles', () => {
      const expected: ExcelBorderStyle[] = [
        'thin',
        'medium',
        'thick',
        'hair',
        'dashed',
        'dotted',
        'double',
        'dashDot',
        'dashDotDot',
        'mediumDashed',
        'mediumDashDot',
        'mediumDashDotDot',
        'slantDashDot',
      ];
      for (const s of expected) {
        expect(ALL_BORDER_STYLES).toContain(s);
      }
    });
  });

  // ── Independent border colors ───────────────────────────────────

  describe('independent border colors', () => {
    it('each side can have a different color', () => {
      const colors: [number, number, number][] = [
        [1, 0, 0], // top
        [0, 1, 0], // right
        [0, 0, 1], // bottom
        [1, 1, 0], // left
      ];

      // Top
      renderBorderSide(canvas, 'thin', colors[0], 0, 0, 100, 0);
      // Right
      renderBorderSide(canvas, 'thin', colors[1], 100, 0, 100, 50);
      // Bottom
      renderBorderSide(canvas, 'thin', colors[2], 0, 50, 100, 50);
      // Left
      renderBorderSide(canvas, 'thin', colors[3], 0, 0, 0, 50);

      const ops = canvas.ops;
      const strokeColors = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetStrokeColorRGB' }> => o.op === 'SetStrokeColorRGB',
      );
      expect(strokeColors).toContainEqual(expect.objectContaining({ r: 1, g: 0, b: 0 }));
      expect(strokeColors).toContainEqual(expect.objectContaining({ r: 0, g: 1, b: 0 }));
      expect(strokeColors).toContainEqual(expect.objectContaining({ r: 0, g: 0, b: 1 }));
      expect(strokeColors).toContainEqual(expect.objectContaining({ r: 1, g: 1, b: 0 }));
    });
  });
});
