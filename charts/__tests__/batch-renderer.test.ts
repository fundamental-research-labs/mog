/**
 * CanvasRenderer batch rendering tests
 */
import { CanvasRenderer, createCanvasRenderer } from '../src/primitives/renderer/canvas-renderer';
import type { ArcMark, PathMark, RectMark, SymbolMark, TextMark } from '../src/primitives/types';

function createMockContext(): CanvasRenderingContext2D {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === '_calls') return calls;
      const fns = [
        'setTransform',
        'clearRect',
        'save',
        'restore',
        'fillRect',
        'strokeRect',
        'fillText',
        'strokeText',
        'beginPath',
        'closePath',
        'moveTo',
        'lineTo',
        'arc',
        'ellipse',
        'quadraticCurveTo',
        'bezierCurveTo',
        'rect',
        'fill',
        'stroke',
        'translate',
        'rotate',
      ];
      if (fns.includes(prop))
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      return undefined;
    },
    set(_target, prop: string, value: unknown) {
      calls.push({ method: 'set:' + prop, args: [value] });
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

function createMockCanvas() {
  const ctx = createMockContext() as any;
  const canvas: any = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    _ctx: ctx,
    getContext: () => ctx,
  };
  return canvas as HTMLCanvasElement & {
    _ctx: CanvasRenderingContext2D & { _calls: Array<{ method: string; args: unknown[] }> };
  };
}

function makeRect(overrides: Partial<RectMark> = {}): RectMark {
  return {
    type: 'rect',
    x: 10,
    y: 20,
    width: 50,
    height: 30,
    style: { fill: '#ff0000', opacity: 1 },
    ...overrides,
  };
}
function makeText(overrides: Partial<TextMark> = {}): TextMark {
  return {
    type: 'text',
    x: 100,
    y: 100,
    text: 'Hello',
    fontSize: 14,
    fontFamily: 'sans-serif',
    textAlign: 'center',
    textBaseline: 'middle',
    style: { fill: '#000', opacity: 1 },
    ...overrides,
  };
}
function makePath(overrides: Partial<PathMark> = {}): PathMark {
  return {
    type: 'path',
    x: 0,
    y: 0,
    path: 'M0,0 L50,50',
    style: { stroke: '#000', strokeWidth: 1, opacity: 1 },
    ...overrides,
  };
}
function makeArc(overrides: Partial<ArcMark> = {}): ArcMark {
  return {
    type: 'arc',
    x: 100,
    y: 100,
    innerRadius: 0,
    outerRadius: 50,
    startAngle: 0,
    endAngle: Math.PI,
    style: { fill: '#00f', opacity: 1 },
    ...overrides,
  };
}
function makeSymbol(overrides: Partial<SymbolMark> = {}): SymbolMark {
  return {
    type: 'symbol',
    x: 50,
    y: 50,
    shape: 'circle',
    size: 64,
    style: { fill: '#0f0', opacity: 1 },
    ...overrides,
  };
}

describe('CanvasRenderer: lifecycle', () => {
  it('constructs', () => {
    expect(() => new CanvasRenderer(createMockCanvas(), { devicePixelRatio: 1 })).not.toThrow();
  });
  it('getCanvas()', () => {
    const c = createMockCanvas();
    expect(new CanvasRenderer(c, { devicePixelRatio: 1 }).getCanvas()).toBe(c);
  });
  it('resize updates dimensions', () => {
    const r = new CanvasRenderer(createMockCanvas(), { devicePixelRatio: 1 });
    r.resize(800, 600);
    expect(r.getWidth()).toBe(800);
    expect(r.getHeight()).toBe(600);
  });
  it('resize accounts for dpr', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 2 });
    r.resize(400, 300);
    expect(c.width).toBe(800);
    expect(c.height).toBe(600);
  });
  it('destroy prevents render', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(100, 100);
    r.destroy();
    c._ctx._calls.length = 0;
    r.render([makeRect()]);
    expect(c._ctx._calls.filter((x: any) => x.method === 'save')).toHaveLength(0);
  });
  it('destroy is idempotent', () => {
    const r = new CanvasRenderer(createMockCanvas(), { devicePixelRatio: 1 });
    r.destroy();
    expect(() => r.destroy()).not.toThrow();
  });
  it('getDevicePixelRatio()', () => {
    expect(
      new CanvasRenderer(createMockCanvas(), { devicePixelRatio: 2.5 }).getDevicePixelRatio(),
    ).toBe(2.5);
  });
  it('setDevicePixelRatio()', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(200, 100);
    r.setDevicePixelRatio(2);
    expect(r.getDevicePixelRatio()).toBe(2);
    expect(c.width).toBe(400);
  });
});

describe('CanvasRenderer: batching', () => {
  it('empty marks', () => {
    const r = new CanvasRenderer(createMockCanvas(), { devicePixelRatio: 1 });
    r.resize(100, 100);
    expect(() => r.render([])).not.toThrow();
  });
  it('same style = one batch', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(200, 200);
    c._ctx._calls.length = 0;
    r.render([
      makeRect({ x: 10, style: { fill: '#f00', opacity: 1 } }),
      makeRect({ x: 30, style: { fill: '#f00', opacity: 1 } }),
      makeRect({ x: 50, style: { fill: '#f00', opacity: 1 } }),
    ]);
    expect(c._ctx._calls.filter((x: any) => x.method === 'save').length).toBe(1);
  });
  it('different styles = separate batches', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(200, 200);
    c._ctx._calls.length = 0;
    r.render([
      makeRect({ style: { fill: '#f00', opacity: 1 } }),
      makeRect({ style: { fill: '#0f0', opacity: 1 } }),
    ]);
    expect(c._ctx._calls.filter((x: any) => x.method === 'save').length).toBe(2);
  });
  it('mixed mark types', () => {
    const r = new CanvasRenderer(createMockCanvas(), { devicePixelRatio: 1 });
    r.resize(200, 200);
    expect(() =>
      r.render([makeRect(), makeText(), makePath(), makeArc(), makeSymbol()]),
    ).not.toThrow();
  });
  it('text font = separate batches (consecutive only)', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(200, 200);
    c._ctx._calls.length = 0;
    // Non-adjacent marks with the same style are NOT merged to preserve z-order.
    // [fontSize:12, fontSize:14, fontSize:12] => 3 consecutive batches.
    r.render([makeText({ fontSize: 12 }), makeText({ fontSize: 14 }), makeText({ fontSize: 12 })]);
    expect(c._ctx._calls.filter((x: any) => x.method === 'save').length).toBe(3);
  });
  it('adjacent marks with same style are batched', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(200, 200);
    c._ctx._calls.length = 0;
    // Adjacent marks with the same style ARE merged.
    r.render([makeText({ fontSize: 12 }), makeText({ fontSize: 12 }), makeText({ fontSize: 14 })]);
    expect(c._ctx._calls.filter((x: any) => x.method === 'save').length).toBe(2);
  });
});

describe('createCanvasRenderer', () => {
  it('returns CanvasRenderer', () => {
    expect(createCanvasRenderer(createMockCanvas(), { devicePixelRatio: 1 })).toBeInstanceOf(
      CanvasRenderer,
    );
  });
});

describe('CanvasRenderer: clear', () => {
  it('calls clearRect', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.resize(100, 50);
    c._ctx._calls.length = 0;
    r.clear();
    expect(c._ctx._calls.filter((x: any) => x.method === 'clearRect').length).toBe(1);
  });
  it('no-op after destroy', () => {
    const c = createMockCanvas();
    const r = new CanvasRenderer(c, { devicePixelRatio: 1 });
    r.destroy();
    c._ctx._calls.length = 0;
    r.clear();
    expect(c._ctx._calls.filter((x: any) => x.method === 'clearRect')).toHaveLength(0);
  });
});
