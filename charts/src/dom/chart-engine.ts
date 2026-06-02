/**
 * Chart Engine - DOM bridge for managing chart instances and lifecycle
 *
 * This module contains the DOM-dependent parts of chart rendering:
 * - ChartInstanceImpl: Canvas-based chart rendering with ResizeObserver
 * - ChartEngine: Singleton manager for chart instances
 * - createChartEngine / createChart: Factory functions
 *
 * For pure computation (spec compilation, mark collection),
 * use configToSpec() and collectMarks() from '../core/chart-engine'.
 */
import { collectMarks, configToSpec } from '../core/chart-engine';
import { compile, type CompileResult } from '../grammar/compiler';
import { renderMark } from '../primitives/marks';
import { CanvasRenderer } from '../primitives/renderer/canvas-renderer';
import type {
  ChartCreateOptions,
  ChartData,
  ChartInstance,
  ImageExportOptions,
  StoredChartConfig,
} from '../types';

/**
 * Chart instance implementation using primitives-based rendering.
 * This is a DOM bridge wrapper - requires a browser environment.
 */
export class ChartInstanceImpl implements ChartInstance {
  readonly id: string;
  config: StoredChartConfig;
  data: ChartData;
  element?: HTMLElement;
  private renderer: CanvasRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;

  /** Cached compilation result. Reused on resize to avoid recompiling. */
  private _cachedCompile: CompileResult | null = null;

  /** Dirty flag: set when data/config changes, cleared after compile. */
  private _dirty = true;

  constructor(options: ChartCreateOptions) {
    this.id = options.config.id;
    this.config = options.config;
    this.data = options.data || { categories: [], series: [] };
    this.element = options.container;
    this.init(options);
  }

  private init(options: ChartCreateOptions): void {
    if (!options.container) {
      throw new Error('Chart container element is required');
    }

    // Create canvas element
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    options.container.appendChild(canvas);

    // Initialize renderer
    this.renderer = new CanvasRenderer(canvas);

    // Initial render (dirty is true from constructor)
    this.render();

    // Setup resize observer for responsive charts
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(options.container);
  }

  update(config: Partial<StoredChartConfig>): void {
    if (this.disposed) return;

    this.config = { ...this.config, ...config };
    this._dirty = true;
    this.render();
  }

  setData(data: ChartData): void {
    if (this.disposed) return;

    this.data = data;
    this._dirty = true;
    this.render();
  }

  resize(): void {
    if (this.disposed || !this.renderer || !this.element) return;

    const width = this.element.clientWidth;
    const height = this.element.clientHeight;

    if (width > 0 && height > 0) {
      this.renderer.resize(width, height);
      this.renderCachedMarks();
    }
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.renderer) {
      // Grab canvas reference before destroy
      const canvas = this.renderer.getCanvas();
      this.renderer.destroy();
      // Remove canvas from DOM
      if (canvas) {
        canvas.parentElement?.removeChild(canvas);
      }
      this.renderer = null;
    }

    this.element = undefined;
    this._cachedCompile = null;
  }

  /**
   * Full render: recompile if dirty, then draw marks.
   */
  private render(): void {
    if (!this.renderer || !this.element) return;

    const width = this.element.clientWidth || 600;
    const height = this.element.clientHeight || 400;

    // Ensure canvas is sized
    if (this.renderer.getWidth() !== width || this.renderer.getHeight() !== height) {
      this.renderer.resize(width, height);
    }

    // Only recompile when data or config has changed
    if (this._dirty || !this._cachedCompile) {
      const spec = configToSpec(this.config, this.data);
      this._cachedCompile = compile(spec, undefined, {
        width,
        height,
        textMeasurementContext: this.renderer.getContext(),
      });
      this._dirty = false;
    }

    // Render cached marks
    this.renderer.render(collectMarks(this._cachedCompile));
  }

  /**
   * Render using cached marks only (no recompile). Used on resize.
   * If no cached compile exists, falls back to a full render.
   */
  private renderCachedMarks(): void {
    if (!this.renderer) return;

    if (this._cachedCompile) {
      this.renderer.render(collectMarks(this._cachedCompile));
    } else {
      this.render();
    }
  }

  /**
   * Export chart as image data URL.
   *
   * When backgroundColor is specified, the background is drawn first via
   * fillRect, then marks are re-rendered on top. This ensures the background
   * appears behind all chart content (the old getImageData/putImageData
   * approach was buggy because putImageData overwrites the background).
   */
  exportImage(options?: ImageExportOptions): string | null {
    if (this.disposed || !this.renderer) return null;

    const format = options?.format ?? 'png';
    const canvas = this.renderer.getCanvas();

    if (options?.backgroundColor && this._cachedCompile) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = this.renderer.getDevicePixelRatio();
        // 1. Clear canvas at physical pixel level
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 2. Draw background fill at physical pixel level
        ctx.fillStyle = options.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // 3. Restore DPR scaling and render marks on top
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const mark of collectMarks(this._cachedCompile)) {
          renderMark(ctx, mark);
        }
      }
    }

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return canvas.toDataURL(mimeType);
  }
}

/**
 * Chart Engine - DOM bridge for managing all chart instances.
 *
 * This class provides DOM-based chart lifecycle management. It requires a
 * browser environment. For pure computation (spec compilation, mark collection),
 * use the exported configToSpec() and collectMarks() functions instead.
 *
 * Supports both singleton access via getInstance() and factory creation via
 * createChartEngine() for cases where multiple independent engines are needed.
 */
export class ChartEngine {
  private static instance: ChartEngine | null = null;
  private charts: Map<string, ChartInstanceImpl> = new Map();
  private _disposed = false;

  constructor() {}

  static getInstance(): ChartEngine {
    if (!ChartEngine.instance) {
      ChartEngine.instance = new ChartEngine();
    }
    return ChartEngine.instance;
  }

  /**
   * Create a new chart instance
   */
  create(options: ChartCreateOptions): ChartInstance {
    if (this._disposed) throw new Error('ChartEngine has been disposed');

    const existing = this.charts.get(options.config.id);
    if (existing) {
      existing.dispose();
    }

    const chart = new ChartInstanceImpl(options);
    this.charts.set(options.config.id, chart);
    return chart;
  }

  /**
   * Get an existing chart instance by ID
   */
  get(id: string): ChartInstance | undefined {
    if (this._disposed) return undefined;
    return this.charts.get(id);
  }

  /**
   * Update an existing chart's configuration
   */
  update(id: string, config: Partial<StoredChartConfig>): void {
    if (this._disposed) return;
    const chart = this.charts.get(id);
    if (chart) {
      chart.update(config);
    }
  }

  /**
   * Update an existing chart's data
   */
  setData(id: string, data: ChartData): void {
    if (this._disposed) return;
    const chart = this.charts.get(id);
    if (chart) {
      chart.setData(data);
    }
  }

  /**
   * Dispose a chart instance
   */
  dispose(id: string): void {
    if (this._disposed) return;
    const chart = this.charts.get(id);
    if (chart) {
      chart.dispose();
      this.charts.delete(id);
    }
  }

  /**
   * Dispose all chart instances and clean up the engine.
   * After calling this, the singleton is reset so getInstance()
   * creates a fresh engine.
   */
  disposeAll(): void {
    for (const chart of this.charts.values()) {
      chart.dispose();
    }
    this.charts.clear();
    this._disposed = false;
    ChartEngine.instance = null;
  }

  /**
   * Get all chart IDs
   */
  getChartIds(): string[] {
    if (this._disposed) return [];
    return Array.from(this.charts.keys());
  }

  /**
   * Get chart count
   */
  get count(): number {
    return this.charts.size;
  }

  /**
   * Export a chart as image data URL
   */
  exportImage(id: string, options?: ImageExportOptions): string | null {
    if (this._disposed) return null;
    const chart = this.charts.get(id);
    if (chart) {
      return chart.exportImage(options);
    }
    return null;
  }
}

/**
 * Create a new ChartEngine instance.
 * Prefer this over getInstance() when you need an independent engine
 * (e.g., for isolated test environments or multiple rendering contexts).
 */
export function createChartEngine(): ChartEngine {
  return new ChartEngine();
}

/**
 * Create a standalone chart (for simple usage without the engine)
 */
export function createChart(options: ChartCreateOptions): ChartInstance {
  return new ChartInstanceImpl(options);
}
