import { GraphicsStateStack, cloneState, createDefaultState } from '../graphics-state';

describe('GraphicsState', () => {
  describe('createDefaultState', () => {
    it('creates state with identity transform', () => {
      const state = createDefaultState();
      expect(state.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    });

    it('creates state with black fill and stroke', () => {
      const state = createDefaultState();
      expect(state.fillColor).toEqual([0, 0, 0]);
      expect(state.strokeColor).toEqual([0, 0, 0]);
    });

    it('creates state with full opacity', () => {
      const state = createDefaultState();
      expect(state.fillAlpha).toBe(1.0);
      expect(state.strokeAlpha).toBe(1.0);
    });

    it('creates state with default line style', () => {
      const state = createDefaultState();
      expect(state.lineWidth).toBe(1.0);
      expect(state.lineDash).toEqual([]);
      expect(state.lineDashPhase).toBe(0);
      expect(state.lineCap).toBe('butt');
      expect(state.lineJoin).toBe('miter');
    });

    it('creates state with no font', () => {
      const state = createDefaultState();
      expect(state.font).toBeNull();
      expect(state.fontSize).toBe(12);
    });
  });

  describe('cloneState', () => {
    it('creates a deep copy of the state', () => {
      const original = createDefaultState();
      original.fillColor = [1, 0, 0];
      original.transform = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 };

      const clone = cloneState(original);

      // Values should match
      expect(clone.fillColor).toEqual([1, 0, 0]);
      expect(clone.transform).toEqual({ a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 });

      // But mutations shouldn't affect original
      clone.fillColor[0] = 0;
      clone.transform.tx = 99;
      expect(original.fillColor).toEqual([1, 0, 0]);
      expect(original.transform.tx).toBe(10);
    });

    it('clones font handle', () => {
      const original = createDefaultState();
      original.font = { id: 'test', family: 'helvetica', weight: 'bold', style: 'normal' };

      const clone = cloneState(original);
      expect(clone.font).toEqual({
        id: 'test',
        family: 'helvetica',
        weight: 'bold',
        style: 'normal',
      });

      // Mutation isolation
      if (clone.font) {
        clone.font.id = 'modified';
      }
      expect(original.font!.id).toBe('test');
    });

    it('clones null font as null', () => {
      const original = createDefaultState();
      const clone = cloneState(original);
      expect(clone.font).toBeNull();
    });
  });

  describe('GraphicsStateStack', () => {
    let stack: GraphicsStateStack;

    beforeEach(() => {
      stack = new GraphicsStateStack();
    });

    it('starts with depth 0', () => {
      expect(stack.depth).toBe(0);
    });

    it('provides mutable current state', () => {
      stack.current.fillColor = [1, 0, 0];
      expect(stack.current.fillColor).toEqual([1, 0, 0]);
    });

    it('save increases depth', () => {
      stack.save();
      expect(stack.depth).toBe(1);
      stack.save();
      expect(stack.depth).toBe(2);
    });

    it('restore decreases depth', () => {
      stack.save();
      stack.save();
      stack.restore();
      expect(stack.depth).toBe(1);
    });

    it('save/restore preserves and restores state', () => {
      // Set initial state
      stack.current.fillColor = [1, 0, 0];
      stack.current.lineWidth = 3.0;

      // Save
      stack.save();

      // Modify
      stack.current.fillColor = [0, 1, 0];
      stack.current.lineWidth = 5.0;
      expect(stack.current.fillColor).toEqual([0, 1, 0]);
      expect(stack.current.lineWidth).toBe(5.0);

      // Restore
      stack.restore();
      expect(stack.current.fillColor).toEqual([1, 0, 0]);
      expect(stack.current.lineWidth).toBe(3.0);
    });

    it('nested save/restore works correctly', () => {
      stack.current.fillAlpha = 1.0;

      stack.save(); // depth 1
      stack.current.fillAlpha = 0.5;

      stack.save(); // depth 2
      stack.current.fillAlpha = 0.25;
      expect(stack.current.fillAlpha).toBe(0.25);

      stack.restore(); // back to depth 1
      expect(stack.current.fillAlpha).toBe(0.5);

      stack.restore(); // back to depth 0
      expect(stack.current.fillAlpha).toBe(1.0);
    });

    it('restore on empty stack throws', () => {
      expect(() => stack.restore()).toThrow('restore() called with empty stack');
    });

    it('reset clears everything', () => {
      stack.current.fillColor = [1, 0, 0];
      stack.save();
      stack.current.fillColor = [0, 1, 0];
      stack.save();

      stack.reset();
      expect(stack.depth).toBe(0);
      expect(stack.current.fillColor).toEqual([0, 0, 0]); // default
    });
  });
});
