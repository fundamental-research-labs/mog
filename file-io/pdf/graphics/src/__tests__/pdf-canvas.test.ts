import type { Path } from '@mog/geometry';
import type { ContentOp } from '../content-ops';
import { MockIpcBridge } from '../ipc-bridge';
import { PdfCanvas } from '../pdf-canvas';
import { createScaffoldFont } from '../text/afm-metrics';

describe('PdfCanvas', () => {
  let bridge: MockIpcBridge;
  let canvas: PdfCanvas;

  beforeEach(() => {
    bridge = new MockIpcBridge();
    canvas = new PdfCanvas(bridge);
  });

  // ── Page Lifecycle ────────────────────────────────────────────────

  describe('page lifecycle', () => {
    it('beginPage emits Y-flip ConcatMatrix as first op', () => {
      canvas.beginPage(612, 792);
      const ops = canvas.ops;
      expect(ops.length).toBe(1);
      expect(ops[0]).toEqual({
        op: 'ConcatMatrix',
        a: 1,
        b: 0,
        c: 0,
        d: -1,
        tx: 0,
        ty: 792,
      });
    });

    it('endPage flushes ops to bridge', async () => {
      canvas.beginPage(612, 792);
      canvas.moveTo(0, 0);
      canvas.lineTo(100, 100);
      await canvas.endPage();

      const ops = bridge.getOps(0);
      expect(ops.length).toBeGreaterThan(0);
      // First op is the Y-flip matrix
      expect(ops[0]).toEqual(expect.objectContaining({ op: 'ConcatMatrix' }));
    });

    it('endPage clears the internal buffer', async () => {
      canvas.beginPage(612, 792);
      canvas.moveTo(0, 0);
      await canvas.endPage();

      expect(canvas.ops.length).toBe(0);
    });

    it('increments pageIndex on each beginPage', () => {
      canvas.beginPage(612, 792);
      expect(canvas.pageIndex).toBe(0);

      canvas.beginPage(612, 792);
      expect(canvas.pageIndex).toBe(1);
    });

    it('stores page dimensions', () => {
      canvas.beginPage(612, 792);
      expect(canvas.pageWidth).toBe(612);
      expect(canvas.pageHeight).toBe(792);
    });

    it('endPage is idempotent when no page is active', async () => {
      await canvas.endPage(); // Should not throw
      expect(bridge.getAllOps().length).toBe(0);
    });
  });

  // ── Graphics State ────────────────────────────────────────────────

  describe('save/restore', () => {
    it('emits SaveState and RestoreState ops', () => {
      canvas.beginPage(612, 792);
      canvas.save();
      canvas.restore();

      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SaveState' });
      expect(ops).toContainEqual({ op: 'RestoreState' });
    });

    it('save/restore preserves fill color', () => {
      canvas.beginPage(612, 792);
      canvas.setFillColor(1, 0, 0);
      canvas.save();
      canvas.setFillColor(0, 1, 0);
      canvas.restore();

      // After restore, state should be back to red
      // We verify by looking at the ops sequence
      const ops = canvas.ops;
      const fillOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFillColorRGB' }> => o.op === 'SetFillColorRGB',
      );
      expect(fillOps[0]).toEqual({ op: 'SetFillColorRGB', r: 1, g: 0, b: 0 });
      expect(fillOps[1]).toEqual({ op: 'SetFillColorRGB', r: 0, g: 1, b: 0 });
    });
  });

  // ── Transforms ────────────────────────────────────────────────────

  describe('transforms', () => {
    it('translate emits ConcatMatrix op', () => {
      canvas.beginPage(612, 792);
      canvas.translate(100, 200);

      const ops = canvas.ops;
      expect(ops).toContainEqual({
        op: 'ConcatMatrix',
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: 100,
        ty: 200,
      });
    });

    it('scale emits ConcatMatrix op', () => {
      canvas.beginPage(612, 792);
      canvas.scale(2, 3);

      const ops = canvas.ops;
      expect(ops).toContainEqual({
        op: 'ConcatMatrix',
        a: 2,
        b: 0,
        c: 0,
        d: 3,
        tx: 0,
        ty: 0,
      });
    });

    it('rotate emits ConcatMatrix op with cos/sin', () => {
      canvas.beginPage(612, 792);
      canvas.rotate(Math.PI / 2);

      const ops = canvas.ops;
      const rotOp = ops.find(
        (o) => o.op === 'ConcatMatrix' && o !== ops[0], // skip the Y-flip
      );
      expect(rotOp).toBeDefined();
      if (rotOp && rotOp.op === 'ConcatMatrix') {
        expect(rotOp.a).toBeCloseTo(0, 10);
        expect(rotOp.b).toBeCloseTo(1, 10);
        expect(rotOp.c).toBeCloseTo(-1, 10);
        expect(rotOp.d).toBeCloseTo(0, 10);
      }
    });

    it('transform emits arbitrary ConcatMatrix', () => {
      canvas.beginPage(612, 792);
      canvas.transform(1, 0.5, -0.5, 1, 10, 20);

      const ops = canvas.ops;
      expect(ops).toContainEqual({
        op: 'ConcatMatrix',
        a: 1,
        b: 0.5,
        c: -0.5,
        d: 1,
        tx: 10,
        ty: 20,
      });
    });

    it('setTransform emits ConcatMatrix', () => {
      canvas.beginPage(612, 792);
      canvas.setTransform({ a: 2, b: 0, c: 0, d: 2, tx: 50, ty: 50 });

      const ops = canvas.ops;
      expect(ops).toContainEqual({
        op: 'ConcatMatrix',
        a: 2,
        b: 0,
        c: 0,
        d: 2,
        tx: 50,
        ty: 50,
      });
    });
  });

  // ── Path Construction ─────────────────────────────────────────────

  describe('path construction', () => {
    it('moveTo emits MoveTo op', () => {
      canvas.beginPage(612, 792);
      canvas.moveTo(10, 20);

      expect(canvas.ops).toContainEqual({ op: 'MoveTo', x: 10, y: 20 });
    });

    it('lineTo emits LineTo op', () => {
      canvas.beginPage(612, 792);
      canvas.lineTo(100, 200);

      expect(canvas.ops).toContainEqual({ op: 'LineTo', x: 100, y: 200 });
    });

    it('curveTo emits CurveTo op', () => {
      canvas.beginPage(612, 792);
      canvas.curveTo(10, 20, 30, 40, 50, 60);

      expect(canvas.ops).toContainEqual({
        op: 'CurveTo',
        x1: 10,
        y1: 20,
        x2: 30,
        y2: 40,
        x: 50,
        y: 60,
      });
    });

    it('rect emits Rectangle op', () => {
      canvas.beginPage(612, 792);
      canvas.rect(10, 20, 100, 50);

      expect(canvas.ops).toContainEqual({
        op: 'Rectangle',
        x: 10,
        y: 20,
        w: 100,
        h: 50,
      });
    });

    it('closePath emits ClosePath op', () => {
      canvas.beginPage(612, 792);
      canvas.closePath();

      expect(canvas.ops).toContainEqual({ op: 'ClosePath' });
    });

    it('clip emits ClipNonZero op', () => {
      canvas.beginPage(612, 792);
      canvas.clip();

      expect(canvas.ops).toContainEqual({ op: 'ClipNonZero' });
    });
  });

  // ── Quadratic to Cubic Conversion ─────────────────────────────────

  describe('quadraticCurveTo', () => {
    it('converts quadratic to cubic bezier', () => {
      canvas.beginPage(612, 792);
      canvas.moveTo(0, 0); // Set pen position
      canvas.quadraticCurveTo(50, 100, 100, 0);

      // Expected conversion:
      // P0 = (0, 0), P1_quad = (50, 100), P2 = (100, 0)
      // CP1 = P0 + 2/3 * (P1 - P0) = (0 + 2/3*50, 0 + 2/3*100) = (33.33, 66.67)
      // CP2 = P2 + 2/3 * (P1 - P2) = (100 + 2/3*(-50), 0 + 2/3*(100)) = (66.67, 66.67)
      const curveOps = canvas.ops.filter((o) => o.op === 'CurveTo');
      expect(curveOps.length).toBe(1);

      const curve = curveOps[0];
      if (curve.op === 'CurveTo') {
        expect(curve.x1).toBeCloseTo(100 / 3, 5);
        expect(curve.y1).toBeCloseTo(200 / 3, 5);
        expect(curve.x2).toBeCloseTo(200 / 3, 5);
        expect(curve.y2).toBeCloseTo(200 / 3, 5);
        expect(curve.x).toBe(100);
        expect(curve.y).toBe(0);
      }
    });

    it('uses current pen position as P0', () => {
      canvas.beginPage(612, 792);
      canvas.moveTo(10, 20);
      canvas.quadraticCurveTo(60, 120, 110, 20);

      const curveOps = canvas.ops.filter((o) => o.op === 'CurveTo');
      expect(curveOps.length).toBe(1);

      const curve = curveOps[0];
      if (curve.op === 'CurveTo') {
        // CP1 = (10, 20) + 2/3 * ((60,120) - (10,20)) = (10 + 33.33, 20 + 66.67)
        expect(curve.x1).toBeCloseTo(10 + (2 / 3) * 50, 5);
        expect(curve.y1).toBeCloseTo(20 + (2 / 3) * 100, 5);
        // CP2 = (110, 20) + 2/3 * ((60,120) - (110,20)) = (110 - 33.33, 20 + 66.67)
        expect(curve.x2).toBeCloseTo(110 + (2 / 3) * -50, 5);
        expect(curve.y2).toBeCloseTo(20 + (2 / 3) * 100, 5);
      }
    });
  });

  // ── replayPath ────────────────────────────────────────────────────

  describe('replayPath', () => {
    it('replays all segment types from a Path', () => {
      canvas.beginPage(612, 792);

      const path: Path = {
        segments: [
          { type: 'M', x: 10, y: 20 },
          { type: 'L', x: 100, y: 20 },
          { type: 'C', x1: 120, y1: 20, x2: 120, y2: 80, x: 100, y: 80 },
          { type: 'Q', x1: 50, y1: 100, x: 10, y: 80 },
          { type: 'Z' },
        ],
        closed: true,
      };

      canvas.replayPath(path);

      const ops = canvas.ops.slice(1); // skip Y-flip
      expect(ops[0]).toEqual({ op: 'MoveTo', x: 10, y: 20 });
      expect(ops[1]).toEqual({ op: 'LineTo', x: 100, y: 20 });
      expect(ops[2]).toEqual(expect.objectContaining({ op: 'CurveTo', x: 100, y: 80 }));
      // Quadratic should be converted to cubic
      expect(ops[3]).toEqual(expect.objectContaining({ op: 'CurveTo' }));
      expect(ops[4]).toEqual({ op: 'ClosePath' });
    });

    it('handles empty path', () => {
      canvas.beginPage(612, 792);
      const path: Path = { segments: [], closed: false };
      canvas.replayPath(path);

      // Only the Y-flip op should be present
      expect(canvas.ops.length).toBe(1);
    });
  });

  // ── Fill & Stroke ─────────────────────────────────────────────────

  describe('fill & stroke', () => {
    it('setFillColor emits SetFillColorRGB', () => {
      canvas.beginPage(612, 792);
      canvas.setFillColor(1, 0.5, 0);
      expect(canvas.ops).toContainEqual({ op: 'SetFillColorRGB', r: 1, g: 0.5, b: 0 });
    });

    it('setStrokeColor emits SetStrokeColorRGB', () => {
      canvas.beginPage(612, 792);
      canvas.setStrokeColor(0, 0, 1);
      expect(canvas.ops).toContainEqual({ op: 'SetStrokeColorRGB', r: 0, g: 0, b: 1 });
    });

    it('setFillAlpha emits SetFillAlpha', () => {
      canvas.beginPage(612, 792);
      canvas.setFillAlpha(0.5);
      expect(canvas.ops).toContainEqual({ op: 'SetFillAlpha', alpha: 0.5 });
    });

    it('setStrokeAlpha emits SetStrokeAlpha', () => {
      canvas.beginPage(612, 792);
      canvas.setStrokeAlpha(0.75);
      expect(canvas.ops).toContainEqual({ op: 'SetStrokeAlpha', alpha: 0.75 });
    });

    it('setLineWidth emits SetLineWidth', () => {
      canvas.beginPage(612, 792);
      canvas.setLineWidth(2.5);
      expect(canvas.ops).toContainEqual({ op: 'SetLineWidth', width: 2.5 });
    });

    it('setLineDash emits SetLineDash', () => {
      canvas.beginPage(612, 792);
      canvas.setLineDash([4, 2], 1);
      expect(canvas.ops).toContainEqual({ op: 'SetLineDash', segments: [4, 2], phase: 1 });
    });

    it('setLineCap emits SetLineCap with integer', () => {
      canvas.beginPage(612, 792);
      canvas.setLineCap('round');
      expect(canvas.ops).toContainEqual({ op: 'SetLineCap', cap: 1 });
    });

    it('setLineJoin emits SetLineJoin with integer', () => {
      canvas.beginPage(612, 792);
      canvas.setLineJoin('bevel');
      expect(canvas.ops).toContainEqual({ op: 'SetLineJoin', join: 2 });
    });

    it('fill emits Fill', () => {
      canvas.beginPage(612, 792);
      canvas.fill();
      expect(canvas.ops).toContainEqual({ op: 'Fill' });
    });

    it('stroke emits Stroke', () => {
      canvas.beginPage(612, 792);
      canvas.stroke();
      expect(canvas.ops).toContainEqual({ op: 'Stroke' });
    });

    it('fillAndStroke emits FillAndStroke', () => {
      canvas.beginPage(612, 792);
      canvas.fillAndStroke();
      expect(canvas.ops).toContainEqual({ op: 'FillAndStroke' });
    });
  });

  // ── Complete Drawing Scenario ─────────────────────────────────────

  describe('complete drawing scenarios', () => {
    it('draws a filled red rectangle', () => {
      canvas.beginPage(612, 792);
      canvas.setFillColor(1, 0, 0);
      canvas.rect(50, 50, 200, 100);
      canvas.fill();

      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetFillColorRGB', r: 1, g: 0, b: 0 });
      expect(ops).toContainEqual({ op: 'Rectangle', x: 50, y: 50, w: 200, h: 100 });
      expect(ops).toContainEqual({ op: 'Fill' });
    });

    it('draws a stroked blue line with dashes', () => {
      canvas.beginPage(612, 792);
      canvas.setStrokeColor(0, 0, 1);
      canvas.setLineWidth(2);
      canvas.setLineDash([4, 4], 0);
      canvas.moveTo(10, 10);
      canvas.lineTo(200, 100);
      canvas.stroke();

      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetStrokeColorRGB', r: 0, g: 0, b: 1 });
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 2 });
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [4, 4], phase: 0 });
      expect(ops).toContainEqual({ op: 'MoveTo', x: 10, y: 10 });
      expect(ops).toContainEqual({ op: 'LineTo', x: 200, y: 100 });
      expect(ops).toContainEqual({ op: 'Stroke' });
    });

    it('draws with save/restore for isolated transforms', () => {
      canvas.beginPage(612, 792);
      canvas.setFillColor(0, 0, 0);

      // Draw first rect
      canvas.rect(0, 0, 50, 50);
      canvas.fill();

      // Save, translate, draw another
      canvas.save();
      canvas.translate(100, 100);
      canvas.setFillColor(1, 0, 0);
      canvas.rect(0, 0, 50, 50);
      canvas.fill();
      canvas.restore();

      // After restore, origin is back to (0,0)
      canvas.rect(200, 0, 50, 50);
      canvas.fill();

      const ops = canvas.ops;
      expect(ops.filter((o) => o.op === 'Rectangle').length).toBe(3);
      expect(ops.filter((o) => o.op === 'Fill').length).toBe(3);
      expect(ops.filter((o) => o.op === 'SaveState').length).toBe(1);
      expect(ops.filter((o) => o.op === 'RestoreState').length).toBe(1);
    });

    it('flushes multiple pages to bridge', async () => {
      // Page 0
      canvas.beginPage(612, 792);
      canvas.rect(0, 0, 100, 100);
      canvas.fill();
      await canvas.endPage();

      // Page 1
      canvas.beginPage(612, 792);
      canvas.rect(50, 50, 200, 200);
      canvas.stroke();
      await canvas.endPage();

      const page0Ops = bridge.getOps(0);
      const page1Ops = bridge.getOps(1);
      expect(page0Ops.length).toBeGreaterThan(0);
      expect(page1Ops.length).toBeGreaterThan(0);
      expect(page0Ops).toContainEqual(expect.objectContaining({ op: 'Fill' }));
      expect(page1Ops).toContainEqual(expect.objectContaining({ op: 'Stroke' }));
    });
  });

  // ── Text Drawing ──────────────────────────────────────────────────

  describe('text drawing', () => {
    it('drawText emits text content ops', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Hello', 100, 100, {});

      const ops = canvas.ops;
      expect(ops.some((o) => o.op === 'BeginText')).toBe(true);
      expect(ops.some((o) => o.op === 'SetFont')).toBe(true);
      expect(ops.some((o) => o.op === 'ShowText')).toBe(true);
      expect(ops.some((o) => o.op === 'EndText')).toBe(true);
    });

    it('drawText with color emits SetTextFillColor', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Red', 100, 100, { color: [1, 0, 0] });

      const ops = canvas.ops;
      expect(ops).toContainEqual({ op: 'SetTextFillColor', r: 1, g: 0, b: 0 });
    });

    it('drawText with center alignment adjusts x', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Hi', 200, 100, { halign: 'center' });

      const ops = canvas.ops;
      const tmOp = ops.find((o) => o.op === 'TextMatrix');
      expect(tmOp).toBeDefined();
      if (tmOp && tmOp.op === 'TextMatrix') {
        // Center alignment should reduce tx below 200
        expect(tmOp.tx).toBeLessThan(200);
      }
    });

    it('drawText with right alignment adjusts x', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Hi', 200, 100, { halign: 'right' });

      const ops = canvas.ops;
      const tmOp = ops.find((o) => o.op === 'TextMatrix');
      expect(tmOp).toBeDefined();
      if (tmOp && tmOp.op === 'TextMatrix') {
        expect(tmOp.tx).toBeLessThan(200);
      }
    });

    it('drawText emits Y-flip compensated TextMatrix', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Test', 100, 100, {});

      const ops = canvas.ops;
      const tmOp = ops.find((o) => o.op === 'TextMatrix');
      expect(tmOp).toBeDefined();
      if (tmOp && tmOp.op === 'TextMatrix') {
        // d should be -1 to compensate for page Y-flip
        expect(tmOp.d).toBe(-1);
        // ty should be pageHeight - baselineY
        expect(tmOp.ty).toBeGreaterThan(0);
        expect(tmOp.ty).toBeLessThan(792);
      }
    });

    it('drawText with underline emits decoration ops', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Underlined', 100, 100, { underline: true });

      const ops = canvas.ops;
      // Should have a SaveState/Stroke/RestoreState sequence for the underline
      const strokeOps = ops.filter((o) => o.op === 'Stroke');
      expect(strokeOps.length).toBeGreaterThanOrEqual(1);
    });

    it('drawText with strikethrough emits decoration ops', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Struck', 100, 100, { strikethrough: true });

      const ops = canvas.ops;
      const strokeOps = ops.filter((o) => o.op === 'Stroke');
      expect(strokeOps.length).toBeGreaterThanOrEqual(1);
    });

    it('drawText with rotation uses rotated TextMatrix', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      canvas.drawText('Rotated', 100, 100, { rotation: 45 });

      const ops = canvas.ops;
      const tmOp = ops.find((o) => o.op === 'TextMatrix');
      expect(tmOp).toBeDefined();
      if (tmOp && tmOp.op === 'TextMatrix') {
        // With 45deg rotation, a and d should be cos(45) ~= 0.707
        expect(tmOp.a).toBeCloseTo(Math.cos(Math.PI / 4), 5);
      }
    });

    it('drawText with empty string produces no ops', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      const opsBefore = canvas.ops.length;
      canvas.drawText('', 100, 100, {});
      const opsAfter = canvas.ops.length;
      expect(opsAfter).toBe(opsBefore);
    });
  });

  // ── Text Runs ─────────────────────────────────────────────────────

  describe('drawTextRuns', () => {
    it('emits ops for multiple runs', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);

      canvas.drawTextRuns([{ text: 'Hello ' }, { text: 'World', bold: true }], 100, 100, {
        maxWidth: 500,
        lineHeight: 14,
      });

      const ops = canvas.ops;
      const btCount = ops.filter((o) => o.op === 'BeginText').length;
      expect(btCount).toBeGreaterThanOrEqual(2); // One per run
    });

    it('emits different fonts for bold runs', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);

      canvas.drawTextRuns([{ text: 'Normal ' }, { text: 'Bold', bold: true }], 100, 100, {
        maxWidth: 500,
        lineHeight: 14,
      });

      const ops = canvas.ops;
      const fontOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFont' }> => o.op === 'SetFont',
      );
      expect(fontOps.length).toBeGreaterThanOrEqual(2);
      expect(fontOps[0].name).toBe('Helvetica');
      expect(fontOps[1].name).toBe('Helvetica-Bold');
    });

    it('handles per-run colors', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);

      canvas.drawTextRuns(
        [
          { text: 'Red', color: [1, 0, 0] },
          { text: ' Blue', color: [0, 0, 1] },
        ],
        100,
        100,
        { maxWidth: 500, lineHeight: 14 },
      );

      const ops = canvas.ops;
      const colorOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetTextFillColor' }> => o.op === 'SetTextFillColor',
      );
      expect(colorOps).toContainEqual({ op: 'SetTextFillColor', r: 1, g: 0, b: 0 });
      expect(colorOps).toContainEqual({ op: 'SetTextFillColor', r: 0, g: 0, b: 1 });
    });

    it('handles empty runs array', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);
      const opsBefore = canvas.ops.length;
      canvas.drawTextRuns([], 100, 100, { maxWidth: 500, lineHeight: 14 });
      expect(canvas.ops.length).toBe(opsBefore);
    });
  });

  // ── Text Measurement ──────────────────────────────────────────────

  describe('measureText', () => {
    it('returns positive width for non-empty text', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      const width = canvas.measureText('Hello', font, 12);
      expect(width).toBeGreaterThan(0);
    });

    it('returns 0 for empty string', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      const width = canvas.measureText('', font, 12);
      expect(width).toBe(0);
    });

    it('scales with font size', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      const w12 = canvas.measureText('Hello', font, 12);
      const w24 = canvas.measureText('Hello', font, 24);
      expect(w24).toBeCloseTo(w12 * 2, 5);
    });

    it('longer text is wider', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      const wShort = canvas.measureText('Hi', font, 12);
      const wLong = canvas.measureText('Hello World', font, 12);
      expect(wLong).toBeGreaterThan(wShort);
    });
  });

  describe('measureTextRuns', () => {
    it('returns measurement for simple runs', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont();
      canvas.setFont(font, 12);

      const result = canvas.measureTextRuns([{ text: 'Hello World' }], 500);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.lines.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Images ────────────────────────────────────────────────────────

  describe('drawImage', () => {
    it('emits DrawImage op', () => {
      canvas.beginPage(612, 792);
      const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      canvas.drawImage(data, 'jpeg', 10, 20, 100, 50);

      const ops = canvas.ops;
      const imgOp = ops.find((o) => o.op === 'DrawImage');
      expect(imgOp).toBeDefined();
      if (imgOp && imgOp.op === 'DrawImage') {
        expect(imgOp.format).toBe('jpeg');
        expect(imgOp.x).toBe(10);
        expect(imgOp.y).toBe(20);
        expect(imgOp.w).toBe(100);
        expect(imgOp.h).toBe(50);
        expect(imgOp.data).toEqual([0xff, 0xd8, 0xff, 0xe0]);
      }
    });
  });

  // ── Font ──────────────────────────────────────────────────────────

  describe('setFont', () => {
    it('updates the internal state', () => {
      canvas.beginPage(612, 792);
      const font = createScaffoldFont('courier', 'bold', 'italic');
      canvas.setFont(font, 16);

      // Font selection is reflected in text ops, not as a standalone op
      canvas.drawText('Test', 100, 100, {});
      const ops = canvas.ops;
      const fontOp = ops.find(
        (o): o is Extract<ContentOp, { op: 'SetFont' }> => o.op === 'SetFont',
      );
      expect(fontOp).toBeDefined();
      if (fontOp) {
        expect(fontOp.name).toBe('Courier-BoldOblique');
        expect(fontOp.size).toBe(16);
      }
    });
  });
});
