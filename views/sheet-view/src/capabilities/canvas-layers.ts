import type {
  ISheetViewCanvasLayers,
  SheetCanvasLayerOptions,
  SheetCanvasLayerHandle,
} from '../capability-interfaces';
import type { RangeAddress } from '../public-types';

export interface SheetViewCanvasLayersDeps {
  getContainer: () => HTMLElement;
  getDpr: () => number;
  getVisibleRange: () => RangeAddress;
}

interface CanvasLayerEntry {
  options: SheetCanvasLayerOptions;
  dirty: boolean;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  raf: number | null;
}

export class SheetViewCanvasLayers implements ISheetViewCanvasLayers {
  private readonly _layers = new Map<string, CanvasLayerEntry>();
  private _nextId = 0;

  constructor(private readonly _deps?: SheetViewCanvasLayersDeps) {}

  createLayer(options: SheetCanvasLayerOptions): SheetCanvasLayerHandle {
    const id = options.id ?? `layer_${this._nextId++}`;
    if (this._layers.has(id)) {
      throw new Error(`SheetViewCanvasLayers.createLayer: duplicate layer id "${id}"`);
    }

    const entry: CanvasLayerEntry = {
      options: { ...options, id },
      dirty: true,
      canvas: null,
      ctx: null,
      raf: null,
    };

    if (this._deps) {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-mog-sheet-canvas-layer', id);
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = `${zIndexFor(options.zOrder)}`;
      this._deps.getContainer().appendChild(canvas);
      entry.canvas = canvas;
      entry.ctx = canvas.getContext('2d');
    }

    this._layers.set(id, entry);
    this._scheduleRender(id);

    return {
      invalidate: () => {
        const entry = this._layers.get(id);
        if (!entry) return;
        entry.dirty = true;
        this._scheduleRender(id);
      },
      dispose: () => {
        this._removeLayer(id);
      },
    };
  }

  /** @internal — expose for renderer integration. */
  getLayers(): ReadonlyMap<string, { options: SheetCanvasLayerOptions; dirty: boolean }> {
    return this._layers;
  }

  /** @internal */
  invalidateAll(): void {
    for (const [id, entry] of this._layers) {
      entry.dirty = true;
      this._scheduleRender(id);
    }
  }

  /** @internal */
  resize(): void {
    for (const [id, entry] of this._layers) {
      this._resizeCanvas(entry);
      entry.dirty = true;
      this._scheduleRender(id);
    }
  }

  /** @internal */
  disposeAll(): void {
    for (const id of [...this._layers.keys()]) this._removeLayer(id);
    this._layers.clear();
  }

  private _removeLayer(id: string): void {
    const entry = this._layers.get(id);
    if (!entry) return;
    if (entry.raf !== null) cancelFrame(entry.raf);
    entry.canvas?.remove();
    this._layers.delete(id);
  }

  private _scheduleRender(id: string): void {
    const entry = this._layers.get(id);
    if (!entry || !this._deps || entry.raf !== null) return;

    entry.raf = requestFrame(() => {
      entry.raf = null;
      this._render(id);
    });
  }

  private _render(id: string): void {
    const entry = this._layers.get(id);
    if (!entry || !this._deps || !entry.ctx || !entry.canvas) return;
    if (!entry.dirty) return;

    this._resizeCanvas(entry);
    const ctx = entry.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    ctx.restore();

    entry.dirty = false;
    entry.options.render({
      ctx,
      dpr: this._deps.getDpr(),
      visibleRange: this._deps.getVisibleRange(),
      invalidate: () => {
        entry.dirty = true;
        this._scheduleRender(id);
      },
      now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    });
  }

  private _resizeCanvas(entry: CanvasLayerEntry): void {
    if (!this._deps || !entry.canvas) return;

    const container = this._deps.getContainer();
    const rect = container.getBoundingClientRect();
    const width = rect.width || container.clientWidth || 0;
    const height = rect.height || container.clientHeight || 0;
    const dpr = this._deps.getDpr();
    const pixelWidth = Math.max(0, Math.round(width * dpr));
    const pixelHeight = Math.max(0, Math.round(height * dpr));

    if (entry.canvas.width !== pixelWidth) entry.canvas.width = pixelWidth;
    if (entry.canvas.height !== pixelHeight) entry.canvas.height = pixelHeight;
    entry.canvas.style.width = `${width}px`;
    entry.canvas.style.height = `${height}px`;

    entry.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function zIndexFor(zOrder: SheetCanvasLayerOptions['zOrder']): number {
  switch (zOrder) {
    case 'below-cells':
      return 100;
    case 'below-content':
      return 300;
    case 'above-content':
      return 700;
    case 'above-selection':
      return 850;
    case 'overlay':
      return 950;
  }
}

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
}
