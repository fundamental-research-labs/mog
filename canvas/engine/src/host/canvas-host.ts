/**
 * CanvasHost — Multi-Canvas Stacking
 *
 * Creates N stacked <canvas> elements inside a container div.
 * Handles DPR detection, resize observation, and canvas context management.
 *
 * @module @mog/canvas-engine/host
 */

import type { CanvasHostConfig, Size } from '../core/types';

/**
 * Manages multiple stacked canvas elements for layered rendering.
 *
 * Canvas 0 (bottom) uses { alpha: false } for compositing performance.
 * Canvas 1+ (top) use { alpha: true } for transparency.
 *
 * DPR handling: canvas.width = cssWidth * dpr, ctx.setTransform(dpr, 0, 0, dpr, 0, 0).
 * All drawing is in CSS pixels; the transform handles scaling.
 */
export class CanvasHost {
  private canvases: HTMLCanvasElement[] = [];
  private contexts: (CanvasRenderingContext2D | null)[] = [];
  private container: HTMLElement;
  private canvasCount: number;
  private dprMode: 'auto' | number;
  private currentDpr: number;
  private currentSize: Size = { width: 0, height: 0 };
  private resizeObserver: ResizeObserver | null = null;
  private dprMediaQuery: MediaQueryList | null = null;
  private dprListener: (() => void) | null = null;
  private resizeDirty = false;
  private resizeRafId: number | null = null;
  private disposed = false;
  private onResize: (() => void) | null = null;
  private pendingResize: { width: number; height: number; dpr: number } | null = null;
  private backgroundColor: string;

  constructor(config: CanvasHostConfig) {
    this.container = config.container;
    this.canvasCount = config.canvasCount ?? 2;
    this.dprMode = config.dprMode ?? 'auto';
    this.currentDpr = this.computeDpr();
    this.backgroundColor = config.backgroundColor ?? '#ffffff';

    this.createCanvases();
    this.setupResizeObserver();
    this.setupDprDetection();
    this.applySize();
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  getCanvas(index: number): HTMLCanvasElement {
    if (index < 0 || index >= this.canvases.length) {
      throw new RangeError(`Canvas index ${index} out of range [0, ${this.canvases.length})`);
    }
    return this.canvases[index];
  }

  getContext(index: number): CanvasRenderingContext2D {
    if (index < 0 || index >= this.contexts.length) {
      throw new RangeError(`Canvas index ${index} out of range [0, ${this.contexts.length})`);
    }
    const ctx = this.contexts[index];
    if (!ctx) {
      throw new Error(`Failed to get 2D context for canvas ${index}`);
    }
    return ctx;
  }

  getSize(): Size {
    return this.currentSize;
  }

  getDPR(): number {
    return this.currentDpr;
  }

  getCanvasCount(): number {
    return this.canvasCount;
  }

  /** Set callback for when container resizes or DPR changes */
  setOnResize(callback: (() => void) | null): void {
    this.onResize = callback;
  }

  /** Force resize to current container dimensions */
  resize(): void {
    this.applySize();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Disconnect observers
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Remove DPR listener
    if (this.dprMediaQuery && this.dprListener) {
      this.dprMediaQuery.removeEventListener('change', this.dprListener);
      this.dprMediaQuery = null;
      this.dprListener = null;
    }

    // Cancel pending resize rAF
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = null;
    }

    // Remove canvases from DOM
    for (const canvas of this.canvases) {
      if (canvas.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
    }
    this.canvases = [];
    this.contexts = [];
    this.onResize = null;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private createCanvases(): void {
    // Ensure container has relative/absolute positioning for stacking
    const position = getComputedStyle(this.container).position;
    if (position === 'static') {
      this.container.style.position = 'relative';
    }

    for (let i = 0; i < this.canvasCount; i++) {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      // Canvas layers are visual only. Input is captured on the host
      // container, while React DOM overlays provide real controls over canvas
      // affordances; keep canvases out of pointer hit-testing so they cannot
      // cover those overlays.
      canvas.style.pointerEvents = 'none';

      // Bottom canvas: opaque for performance. Top canvases: transparent.
      const alpha = i > 0;

      // desynchronized: true bypasses the compositor for lower latency, but on
      // Windows (especially in WebView2 / Tauri) it can silently produce a
      // context that never flushes to screen — rendering appears completely black.
      // Only enable on platforms where it's known to work reliably.
      const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.platform);
      const useDesync = !isWindows;

      const ctx = useDesync ? canvas.getContext('2d', { alpha, desynchronized: true }) : null;

      // Fallback without desynchronized
      const context = ctx ?? canvas.getContext('2d', { alpha });

      // Pre-fill opaque bottom canvas with background color to prevent black flash
      // before the first render frame. The BackgroundLayer will paint over this.
      if (i === 0 && context) {
        context.fillStyle = this.backgroundColor;
        context.fillRect(0, 0, canvas.width || 1, canvas.height || 1);
      }

      this.canvases.push(canvas);
      this.contexts.push(context);
      this.container.appendChild(canvas);
    }
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      // rAF-driven resize: set dirty flag, apply on next animation frame.
      // This gives immediate updates without CPU waste during window drag.
      this.resizeDirty = true;
      if (this.resizeRafId === null && !this.disposed) {
        this.resizeRafId = requestAnimationFrame(() => {
          this.resizeRafId = null;
          if (this.resizeDirty && !this.disposed) {
            this.resizeDirty = false;
            this.applySize();
          }
        });
      }
    });
    this.resizeObserver.observe(this.container);
  }

  private setupDprDetection(): void {
    if (this.dprMode !== 'auto') return;

    // Remove any existing listener before re-registering (avoids orphaned
    // listeners when this method is called recursively after a DPR change).
    if (this.dprMediaQuery && this.dprListener) {
      this.dprMediaQuery.removeEventListener('change', this.dprListener);
    }

    // ResizeObserver does NOT fire on DPR-only changes (e.g., dragging
    // window between Retina and non-Retina monitors). Use matchMedia.
    const dpr = window.devicePixelRatio;
    this.dprMediaQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprListener = () => {
      if (this.disposed) return;
      const newDpr = this.computeDpr();
      if (newDpr !== this.currentDpr) {
        this.currentDpr = newDpr;
        this.applySize();
        // Re-register for next DPR change
        this.setupDprDetection();
      }
    };
    this.dprMediaQuery.addEventListener('change', this.dprListener);
  }

  private computeDpr(): number {
    if (typeof this.dprMode === 'number') return this.dprMode;
    return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  }

  private applySize(): void {
    const rect = this.container.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;

    if (cssWidth === 0 || cssHeight === 0) return;

    // Store new size immediately (getSize() returns this)
    this.currentSize = { width: cssWidth, height: cssHeight };
    const dpr = this.currentDpr;

    // Defer the actual canvas element resize to the render frame
    // so clearing and drawing happen atomically
    this.pendingResize = { width: cssWidth, height: cssHeight, dpr };

    this.onResize?.();
  }

  /** Apply any pending canvas dimension change. Call immediately before rendering. */
  flushResize(): boolean {
    if (!this.pendingResize) return false;
    const { width, height, dpr } = this.pendingResize;
    this.pendingResize = null;

    for (let i = 0; i < this.canvases.length; i++) {
      const canvas = this.canvases[i];
      const ctx = this.contexts[i];
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    return true;
  }
}
