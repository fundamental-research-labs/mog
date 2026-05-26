import type { ContentOp } from '../content-ops';
import type { DrawingObject, ShapePathSegment } from '../drawing-renderer';
import { renderDrawingObject } from '../drawing-renderer';
import { MockIpcBridge } from '../ipc-bridge';
import { PdfCanvas } from '../pdf-canvas';
import { createScaffoldFont } from '../text/afm-metrics';

describe('Drawing Renderer', () => {
  let bridge: MockIpcBridge;
  let canvas: PdfCanvas;

  beforeEach(() => {
    bridge = new MockIpcBridge();
    canvas = new PdfCanvas(bridge);
    canvas.beginPage(612, 792);
    const font = createScaffoldFont();
    canvas.setFont(font, 12);
  });

  function getOpsAfterSetup(): ContentOp[] {
    // Get ops excluding the Y-flip ConcatMatrix at index 0
    return canvas.ops.slice(1) as ContentOp[];
  }

  // ── Basic Shape Rendering ───────────────────────────────────────

  describe('shape rendering', () => {
    it('renders a simple rectangle shape', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 10, y: 20, width: 100, height: 50 },
        fill: { type: 'solid', color: [1, 0, 0] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops.some((o) => o.op === 'SaveState')).toBe(true);
      expect(ops.some((o) => o.op === 'RestoreState')).toBe(true);
      expect(ops).toContainEqual({ op: 'Rectangle', x: 10, y: 20, w: 100, h: 50 });
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetFillColorRGB', r: 1, g: 0, b: 0 }),
      );
      expect(ops.some((o) => o.op === 'Fill')).toBe(true);
    });

    it('renders shape with stroke', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        stroke: { color: [0, 0, 1], width: 2 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetStrokeColorRGB', r: 0, g: 0, b: 1 }),
      );
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 2 });
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
    });

    it('renders shape with fill and stroke', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: 'solid', color: [1, 0, 0] },
        stroke: { color: [0, 0, 0], width: 1 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops.some((o) => o.op === 'Fill')).toBe(true);
      expect(ops.some((o) => o.op === 'Stroke')).toBe(true);
    });

    it('renders shape with fill alpha', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: 'solid', color: [1, 0, 0], alpha: 0.5 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual({ op: 'SetFillAlpha', alpha: 0.5 });
    });
  });

  // ── Transform ────────────────────────────────────────────────────

  describe('transform', () => {
    it('applies transform if present', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 50, ty: 50 },
        fill: { type: 'solid', color: [0, 0, 0] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual({
        op: 'ConcatMatrix',
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: 50,
        ty: 50,
      });
    });

    it('does not emit transform if not present', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 10, y: 20, width: 100, height: 100 },
        fill: { type: 'solid', color: [0, 0, 0] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      // Should not have any ConcatMatrix ops (the one at index 0 is the Y-flip)
      const concatOps = ops.filter((o) => o.op === 'ConcatMatrix');
      expect(concatOps.length).toBe(0);
    });

    it('applies rotation transform', () => {
      const angle = Math.PI / 4;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: { a: cos, b: sin, c: -sin, d: cos, tx: 50, ty: 50 },
        fill: { type: 'solid', color: [0, 0, 0] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();
      const transformOp = ops.find((o) => o.op === 'ConcatMatrix');
      expect(transformOp).toBeDefined();
      if (transformOp && transformOp.op === 'ConcatMatrix') {
        expect(transformOp.a).toBeCloseTo(cos, 5);
        expect(transformOp.b).toBeCloseTo(sin, 5);
      }
    });
  });

  // ── Fill Types ──────────────────────────────────────────────────

  describe('fill types', () => {
    it('renders solid fill', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: 'solid', color: [0.5, 0.5, 0.5] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetFillColorRGB', r: 0.5, g: 0.5, b: 0.5 }),
      );
      expect(ops.some((o) => o.op === 'Fill')).toBe(true);
    });

    it('renders linear gradient fill (with fallback color)', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: {
          type: 'linear-gradient',
          color: [1, 0, 0],
          gradient: {
            angle: 0,
            stops: [
              { position: 0, color: [1, 0, 0] },
              { position: 1, color: [0, 0, 1] },
            ],
          },
        },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      // Should use fallback color
      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetFillColorRGB', r: 1, g: 0, b: 0 }),
      );
      expect(ops.some((o) => o.op === 'Fill')).toBe(true);
    });

    it('renders pattern fill (with foreground color)', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: {
          type: 'pattern',
          pattern: {
            pattern: 'mediumGray',
            foreColor: [0.5, 0, 0],
            backColor: [1, 1, 1],
          },
        },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetFillColorRGB', r: 0.5, g: 0, b: 0 }),
      );
    });

    it('alpha fill sets and resets fill alpha', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: 'solid', color: [1, 0, 0], alpha: 0.3 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      const alphaOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFillAlpha' }> => o.op === 'SetFillAlpha',
      );
      expect(alphaOps.length).toBe(2);
      expect(alphaOps[0].alpha).toBe(0.3);
      expect(alphaOps[1].alpha).toBe(1.0);
    });

    it('no alpha reset when alpha is 1', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: 'solid', color: [1, 0, 0], alpha: 1.0 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      const alphaOps = ops.filter((o) => o.op === 'SetFillAlpha');
      expect(alphaOps.length).toBe(0);
    });
  });

  // ── Stroke ──────────────────────────────────────────────────────

  describe('stroke rendering', () => {
    it('sets stroke properties', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        stroke: {
          color: [0, 0.5, 1],
          width: 3,
          dashPattern: [5, 3],
          cap: 'round',
          join: 'bevel',
        },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'SetStrokeColorRGB', r: 0, g: 0.5, b: 1 }),
      );
      expect(ops).toContainEqual({ op: 'SetLineWidth', width: 3 });
      expect(ops).toContainEqual({ op: 'SetLineDash', segments: [5, 3], phase: 0 });
      expect(ops).toContainEqual({ op: 'SetLineCap', cap: 1 }); // round = 1
      expect(ops).toContainEqual({ op: 'SetLineJoin', join: 2 }); // bevel = 2
    });

    it('omits dash pattern if not specified', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        stroke: { color: [0, 0, 0], width: 1 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      const dashOps = ops.filter((o) => o.op === 'SetLineDash');
      expect(dashOps.length).toBe(0);
    });
  });

  // ── Custom Shape Paths ──────────────────────────────────────────

  describe('custom shape paths', () => {
    it('renders custom path segments', () => {
      const trianglePath: ShapePathSegment[] = [
        { type: 'M', x: 50, y: 0 },
        { type: 'L', x: 100, y: 100 },
        { type: 'L', x: 0, y: 100 },
        { type: 'Z' },
      ];

      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        shapePath: trianglePath,
        fill: { type: 'solid', color: [0, 1, 0] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual({ op: 'MoveTo', x: 50, y: 0 });
      expect(ops).toContainEqual({ op: 'LineTo', x: 100, y: 100 });
      expect(ops).toContainEqual({ op: 'LineTo', x: 0, y: 100 });
      expect(ops).toContainEqual({ op: 'ClosePath' });
      expect(ops.some((o) => o.op === 'Fill')).toBe(true);
    });

    it('renders custom path with curves', () => {
      const curvePath: ShapePathSegment[] = [
        { type: 'M', x: 0, y: 50 },
        { type: 'C', x1: 0, y1: 0, x2: 100, y2: 0, x: 100, y: 50 },
        { type: 'Z' },
      ];

      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        shapePath: curvePath,
        fill: { type: 'solid', color: [0, 0, 1] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops).toContainEqual(
        expect.objectContaining({ op: 'CurveTo', x1: 0, y1: 0, x2: 100, y2: 0, x: 100, y: 50 }),
      );
    });

    it('re-builds path for stroke after fill', () => {
      const path: ShapePathSegment[] = [
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 100, y: 100 },
        { type: 'Z' },
      ];

      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        shapePath: path,
        fill: { type: 'solid', color: [1, 0, 0] },
        stroke: { color: [0, 0, 0], width: 1 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      // Path should be built twice: once for fill, once for stroke
      const moveOps = ops.filter((o) => o.op === 'MoveTo');
      expect(moveOps.length).toBe(2);
    });
  });

  // ── Group Rendering ─────────────────────────────────────────────

  describe('group rendering', () => {
    it('renders children recursively', () => {
      const group: DrawingObject = {
        type: 'group',
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        children: [
          {
            type: 'shape',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            fill: { type: 'solid', color: [1, 0, 0] },
          },
          {
            type: 'shape',
            bounds: { x: 100, y: 0, width: 100, height: 100 },
            fill: { type: 'solid', color: [0, 0, 1] },
          },
        ],
      };

      renderDrawingObject(group, canvas);
      const ops = getOpsAfterSetup();

      // Should have two fills (one for each child)
      const fillOps = ops.filter((o) => o.op === 'Fill');
      expect(fillOps.length).toBe(2);

      // Should have two red/blue color sets
      const colorOps = ops.filter(
        (o): o is Extract<ContentOp, { op: 'SetFillColorRGB' }> => o.op === 'SetFillColorRGB',
      );
      expect(colorOps).toContainEqual(expect.objectContaining({ r: 1, g: 0, b: 0 }));
      expect(colorOps).toContainEqual(expect.objectContaining({ r: 0, g: 0, b: 1 }));
    });

    it('group with transform applies to all children', () => {
      const group: DrawingObject = {
        type: 'group',
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 50, ty: 50 },
        children: [
          {
            type: 'shape',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            fill: { type: 'solid', color: [1, 0, 0] },
          },
        ],
      };

      renderDrawingObject(group, canvas);
      const ops = getOpsAfterSetup();

      // The group's transform should be applied before children
      const concatIdx = ops.findIndex((o) => o.op === 'ConcatMatrix');
      const fillIdx = ops.findIndex((o) => o.op === 'Fill');
      expect(concatIdx).toBeLessThan(fillIdx);
    });

    it('empty group does not crash', () => {
      const group: DrawingObject = {
        type: 'group',
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        children: [],
      };

      renderDrawingObject(group, canvas);
      // Should not throw
      const ops = getOpsAfterSetup();
      expect(ops.some((o) => o.op === 'SaveState')).toBe(true);
      expect(ops.some((o) => o.op === 'RestoreState')).toBe(true);
    });

    it('group without children property does not crash', () => {
      const group: DrawingObject = {
        type: 'group',
        bounds: { x: 0, y: 0, width: 200, height: 200 },
      };

      expect(() => renderDrawingObject(group, canvas)).not.toThrow();
    });

    it('nested groups render correctly', () => {
      const nested: DrawingObject = {
        type: 'group',
        bounds: { x: 0, y: 0, width: 300, height: 300 },
        children: [
          {
            type: 'group',
            bounds: { x: 0, y: 0, width: 150, height: 150 },
            children: [
              {
                type: 'shape',
                bounds: { x: 0, y: 0, width: 50, height: 50 },
                fill: { type: 'solid', color: [1, 0, 0] },
              },
            ],
          },
        ],
      };

      renderDrawingObject(nested, canvas);
      const ops = getOpsAfterSetup();

      // 3 levels of save/restore
      const saveOps = ops.filter((o) => o.op === 'SaveState');
      const restoreOps = ops.filter((o) => o.op === 'RestoreState');
      expect(saveOps.length).toBe(3);
      expect(restoreOps.length).toBe(3);
    });
  });

  // ── Image Rendering ─────────────────────────────────────────────

  describe('image rendering', () => {
    it('renders image object with drawImage', () => {
      const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      const obj: DrawingObject = {
        type: 'image',
        bounds: { x: 10, y: 20, width: 200, height: 150 },
        imageSrc: imageData,
        imageFormat: 'jpeg',
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      const drawImageOp = ops.find((o) => o.op === 'DrawImage');
      expect(drawImageOp).toBeDefined();
      if (drawImageOp && drawImageOp.op === 'DrawImage') {
        expect(drawImageOp.format).toBe('jpeg');
        expect(drawImageOp.x).toBe(10);
        expect(drawImageOp.y).toBe(20);
        expect(drawImageOp.w).toBe(200);
        expect(drawImageOp.h).toBe(150);
      }
    });

    it('does not render image without imageSrc', () => {
      const obj: DrawingObject = {
        type: 'image',
        bounds: { x: 10, y: 20, width: 200, height: 150 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops.find((o) => o.op === 'DrawImage')).toBeUndefined();
    });
  });

  // ── Text Object Rendering ──────────────────────────────────────

  describe('text object rendering', () => {
    it('renders text object with drawTextRuns', () => {
      const obj: DrawingObject = {
        type: 'text',
        bounds: { x: 10, y: 20, width: 200, height: 100 },
        text: {
          runs: [{ text: 'Hello World' }],
          insets: { top: 5, right: 5, bottom: 5, left: 5 },
        },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops.some((o) => o.op === 'BeginText')).toBe(true);
      expect(ops.some((o) => o.op === 'ShowText')).toBe(true);
      expect(ops.some((o) => o.op === 'EndText')).toBe(true);
    });

    it('does not render empty text runs', () => {
      const obj: DrawingObject = {
        type: 'text',
        bounds: { x: 10, y: 20, width: 200, height: 100 },
        text: {
          runs: [],
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops.find((o) => o.op === 'BeginText')).toBeUndefined();
    });

    it('does not render text object without text property', () => {
      const obj: DrawingObject = {
        type: 'text',
        bounds: { x: 10, y: 20, width: 200, height: 100 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      expect(ops.find((o) => o.op === 'BeginText')).toBeUndefined();
    });
  });

  // ── Text in Shape ───────────────────────────────────────────────

  describe('text in shape', () => {
    it('renders text within a shape', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 10, y: 20, width: 200, height: 100 },
        fill: { type: 'solid', color: [0.9, 0.9, 0.9] },
        text: {
          runs: [{ text: 'Shape Text' }],
          insets: { top: 5, right: 10, bottom: 5, left: 10 },
        },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      // Should have both fill and text ops
      expect(ops.some((o) => o.op === 'Fill')).toBe(true);
      expect(ops.some((o) => o.op === 'BeginText')).toBe(true);
      expect(ops.some((o) => o.op === 'ShowText')).toBe(true);
    });
  });

  // ── Save/Restore State ──────────────────────────────────────────

  describe('state management', () => {
    it('always wraps in save/restore', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      const saves = ops.filter((o) => o.op === 'SaveState').length;
      const restores = ops.filter((o) => o.op === 'RestoreState').length;
      expect(saves).toBeGreaterThanOrEqual(1);
      expect(saves).toBe(restores);
    });

    it('save comes before restore', () => {
      const obj: DrawingObject = {
        type: 'shape',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        fill: { type: 'solid', color: [1, 0, 0] },
      };

      renderDrawingObject(obj, canvas);
      const ops = getOpsAfterSetup();

      const saveIdx = ops.findIndex((o) => o.op === 'SaveState');
      const restoreIdx = ops.findLastIndex((o) => o.op === 'RestoreState');
      expect(saveIdx).toBeLessThan(restoreIdx);
    });
  });
});
