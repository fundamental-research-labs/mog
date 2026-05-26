import type { ContentOp } from '../content-ops';
import { lineCapToInt, lineJoinToInt } from '../content-ops';

describe('content-ops', () => {
  describe('lineCapToInt', () => {
    it('maps butt to 0', () => {
      expect(lineCapToInt('butt')).toBe(0);
    });

    it('maps round to 1', () => {
      expect(lineCapToInt('round')).toBe(1);
    });

    it('maps square to 2', () => {
      expect(lineCapToInt('square')).toBe(2);
    });
  });

  describe('lineJoinToInt', () => {
    it('maps miter to 0', () => {
      expect(lineJoinToInt('miter')).toBe(0);
    });

    it('maps round to 1', () => {
      expect(lineJoinToInt('round')).toBe(1);
    });

    it('maps bevel to 2', () => {
      expect(lineJoinToInt('bevel')).toBe(2);
    });
  });

  describe('ContentOp discriminated union', () => {
    it('can create and check SaveState op', () => {
      const op: ContentOp = { op: 'SaveState' };
      expect(op.op).toBe('SaveState');
    });

    it('can create and check ConcatMatrix op', () => {
      const op: ContentOp = { op: 'ConcatMatrix', a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 };
      expect(op.op).toBe('ConcatMatrix');
      if (op.op === 'ConcatMatrix') {
        expect(op.tx).toBe(10);
        expect(op.ty).toBe(20);
      }
    });

    it('can create and check SetFillColorRGB op', () => {
      const op: ContentOp = { op: 'SetFillColorRGB', r: 1, g: 0.5, b: 0 };
      if (op.op === 'SetFillColorRGB') {
        expect(op.r).toBe(1);
        expect(op.g).toBe(0.5);
        expect(op.b).toBe(0);
      }
    });

    it('can create and check SetLineDash op', () => {
      const op: ContentOp = { op: 'SetLineDash', segments: [4, 2, 1, 2], phase: 0 };
      if (op.op === 'SetLineDash') {
        expect(op.segments).toEqual([4, 2, 1, 2]);
        expect(op.phase).toBe(0);
      }
    });

    it('can create and check ShowText op', () => {
      const op: ContentOp = { op: 'ShowText', bytes: [72, 101, 108, 108, 111] };
      if (op.op === 'ShowText') {
        expect(op.bytes).toEqual([72, 101, 108, 108, 111]);
      }
    });

    it('can create and check DrawImage op', () => {
      const op: ContentOp = {
        op: 'DrawImage',
        data: [0xff, 0xd8],
        format: 'jpeg',
        x: 10,
        y: 20,
        w: 100,
        h: 50,
      };
      if (op.op === 'DrawImage') {
        expect(op.format).toBe('jpeg');
        expect(op.w).toBe(100);
      }
    });
  });
});
