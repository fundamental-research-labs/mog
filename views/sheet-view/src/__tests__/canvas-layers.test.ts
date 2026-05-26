/**
 * @jest-environment jsdom
 */
import type { SheetCanvasLayerOptions } from '../capability-interfaces';
import { SheetViewCanvasLayers } from '../capabilities/canvas-layers';

function makeLayerOptions(overrides?: Partial<SheetCanvasLayerOptions>): SheetCanvasLayerOptions {
  return {
    zOrder: 'above-content',
    render: jest.fn(),
    ...overrides,
  };
}

describe('SheetViewCanvasLayers', () => {
  let layers: SheetViewCanvasLayers;

  beforeEach(() => {
    layers = new SheetViewCanvasLayers();
  });

  it('createLayer adds a layer to the registry', () => {
    layers.createLayer(makeLayerOptions());

    expect(layers.getLayers().size).toBe(1);
  });

  it('createLayer auto-generates an id when none provided', () => {
    const handle = layers.createLayer(makeLayerOptions());

    const keys = [...layers.getLayers().keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^layer_\d+$/);
    void handle;
  });

  it('createLayer uses custom id when provided', () => {
    layers.createLayer(makeLayerOptions({ id: 'my-layer' }));

    expect(layers.getLayers().has('my-layer')).toBe(true);
  });

  it('new layers start dirty', () => {
    layers.createLayer(makeLayerOptions({ id: 'test' }));

    const entry = layers.getLayers().get('test');
    expect(entry?.dirty).toBe(true);
  });

  it('handle.invalidate marks the layer dirty', () => {
    const handle = layers.createLayer(makeLayerOptions({ id: 'test' }));

    // Manually reset dirty flag to verify invalidate sets it
    const entry = layers.getLayers().get('test');
    (entry as { dirty: boolean }).dirty = false;

    handle.invalidate();

    expect(layers.getLayers().get('test')?.dirty).toBe(true);
  });

  it('handle.invalidate is a no-op after dispose', () => {
    const handle = layers.createLayer(makeLayerOptions({ id: 'test' }));
    handle.dispose();

    // Should not throw
    expect(() => handle.invalidate()).not.toThrow();
    expect(layers.getLayers().size).toBe(0);
  });

  it('handle.dispose removes the layer', () => {
    const handle = layers.createLayer(makeLayerOptions());
    expect(layers.getLayers().size).toBe(1);

    handle.dispose();
    expect(layers.getLayers().size).toBe(0);
  });

  it('disposeAll removes all layers', () => {
    layers.createLayer(makeLayerOptions());
    layers.createLayer(makeLayerOptions());
    layers.createLayer(makeLayerOptions());

    expect(layers.getLayers().size).toBe(3);

    layers.disposeAll();
    expect(layers.getLayers().size).toBe(0);
  });

  it('multiple layers are independent', () => {
    const h1 = layers.createLayer(makeLayerOptions({ id: 'a' }));
    const h2 = layers.createLayer(makeLayerOptions({ id: 'b' }));

    h1.dispose();

    expect(layers.getLayers().has('a')).toBe(false);
    expect(layers.getLayers().has('b')).toBe(true);
    void h2;
  });

  it('preserves the render callback in the options', () => {
    const renderFn = jest.fn();
    layers.createLayer(makeLayerOptions({ id: 'test', render: renderFn }));

    const entry = layers.getLayers().get('test');
    expect(entry?.options.render).toBe(renderFn);
  });

  it('creates a canvas and invokes the render callback with frame context', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(container, 'clientWidth', { value: 200 });
    Object.defineProperty(container, 'clientHeight', { value: 100 });

    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      setTransform: jest.fn(),
      clearRect: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx);

    const render = jest.fn();
    const domLayers = new SheetViewCanvasLayers({
      getContainer: () => container,
      getDpr: () => 2,
      getVisibleRange: () => ({ startRow: 1, startCol: 2, endRow: 3, endCol: 4 }),
    });

    domLayers.createLayer({ id: 'dom', zOrder: 'overlay', render });
    await new Promise((resolve) => setTimeout(resolve, 25));

    const canvas = container.querySelector(
      '[data-mog-sheet-canvas-layer="dom"]',
    ) as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx,
        dpr: 2,
        visibleRange: { startRow: 1, startCol: 2, endRow: 3, endCol: 4 },
      }),
    );

    getContextSpy.mockRestore();
    domLayers.disposeAll();
    container.remove();
  });
});
