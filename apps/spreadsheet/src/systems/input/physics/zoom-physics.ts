/**
 * Zoom Physics Engine
 *
 * Passive physics class for smooth zoom animations.
 * No rAF loop - driven by RenderScheduler's update() calls.
 *
 * Features:
 * - Immediate zoom via applyZoom()
 * - Animated zoom via zoomTo() with ease-out cubic
 * - Min/max zoom level clamping
 * - Center point tracking for zoom-to-cursor
 *
 * @module state/coordinator/physics/zoom-physics
 */

import type { ZoomPhysicsConfig, ZoomState } from '@mog-sdk/contracts/rendering';

/**
 * Default configuration for zoom physics
 */
export const DEFAULT_ZOOM_CONFIG: ZoomPhysicsConfig = {
  minZoom: 0.1,
  maxZoom: 4.0,
  animationDuration: 200,
};

export class ZoomPhysics {
  private level: number = 1;
  private targetLevel: number = 1;
  private centerX: number = 0;
  private centerY: number = 0;
  private _isAnimating: boolean = false;
  private animationProgress: number = 0;
  private startLevel: number = 1;

  private readonly config: ZoomPhysicsConfig;

  constructor(config: Partial<ZoomPhysicsConfig> = {}) {
    this.config = { ...DEFAULT_ZOOM_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────
  // Physics Update (called by RenderScheduler)
  // ─────────────────────────────────────────────────────────────

  /**
   * Called by RenderScheduler each frame when animating.
   * Updates zoom level using ease-out cubic interpolation.
   *
   * @param deltaTimeMs - Time since last frame in milliseconds
   */
  update(deltaTimeMs: number): void {
    if (!this._isAnimating) return;

    this.animationProgress += deltaTimeMs / this.config.animationDuration;

    if (this.animationProgress >= 1) {
      // Animation complete
      this.level = this.targetLevel;
      this._isAnimating = false;
      this.animationProgress = 0;
    } else {
      // Ease-out cubic: 1 - (1 - t)^3
      // Starts fast, slows down at the end - feels natural
      const t = 1 - Math.pow(1 - this.animationProgress, 3);
      this.level = this.startLevel + (this.targetLevel - this.startLevel) * t;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Immediate Zoom
  // ─────────────────────────────────────────────────────────────

  /**
   * Apply immediate zoom delta (from wheel or pinch gesture).
   * Interrupts any running animation.
   *
   * @param delta - Zoom delta (positive = zoom in, negative = zoom out)
   * @param centerX - X coordinate of zoom center (e.g., cursor position)
   * @param centerY - Y coordinate of zoom center
   */
  applyZoom(delta: number, centerX: number, centerY: number): void {
    // Stop any running animation
    if (this._isAnimating) {
      this.stop();
    }

    // Apply multiplicative zoom: level * (1 + delta)
    // This feels more natural than additive zoom
    const newLevel = this.level * (1 + delta);

    // Clamp to bounds
    this.level = this.clampLevel(newLevel);
    this.centerX = centerX;
    this.centerY = centerY;
  }

  // ─────────────────────────────────────────────────────────────
  // Animated Zoom
  // ─────────────────────────────────────────────────────────────

  /**
   * Animate to target zoom level with ease-out cubic easing.
   * Useful for zoom buttons, double-tap zoom, or fit-to-content.
   *
   * @param level - Target zoom level
   * @param centerX - X coordinate of zoom center
   * @param centerY - Y coordinate of zoom center
   */
  zoomTo(level: number, centerX: number, centerY: number): void {
    this.targetLevel = this.clampLevel(level);
    this.centerX = centerX;
    this.centerY = centerY;
    this.startLevel = this.level;
    this.animationProgress = 0;
    this._isAnimating = true;
  }

  // ─────────────────────────────────────────────────────────────
  // Control Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Stop any running animation immediately.
   * Keeps current zoom level.
   */
  stop(): void {
    this._isAnimating = false;
    this.animationProgress = 0;
  }

  /**
   * Reset zoom to default (level 1).
   * Does not animate - use zoomTo(1, cx, cy) for animated reset.
   */
  reset(): void {
    this.stop();
    this.level = 1;
    this.targetLevel = 1;
    this.startLevel = 1;
  }

  /**
   * Set zoom level directly without animation.
   * Useful for restoring state from storage.
   *
   * @param level - Zoom level to set (will be clamped)
   */
  setLevel(level: number): void {
    this.stop();
    this.level = this.clampLevel(level);
    this.targetLevel = this.level;
    this.startLevel = this.level;
  }

  // ─────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────

  /**
   * Whether a zoom animation is currently running
   */
  get isAnimating(): boolean {
    return this._isAnimating;
  }

  /**
   * Current zoom level
   */
  get currentLevel(): number {
    return this.level;
  }

  /**
   * Target zoom level (same as current if not animating)
   */
  get targetZoomLevel(): number {
    return this.targetLevel;
  }

  /**
   * Current zoom center point
   */
  get center(): { x: number; y: number } {
    return { x: this.centerX, y: this.centerY };
  }

  /**
   * Configured minimum zoom level
   */
  get minZoom(): number {
    return this.config.minZoom;
  }

  /**
   * Configured maximum zoom level
   */
  get maxZoom(): number {
    return this.config.maxZoom;
  }

  /**
   * Animation progress (0-1), 0 if not animating
   */
  get progress(): number {
    return this._isAnimating ? this.animationProgress : 0;
  }

  /**
   * Get full zoom state for external consumers
   */
  getState(): ZoomState {
    return {
      level: this.level,
      centerX: this.centerX,
      centerY: this.centerY,
      isAnimating: this._isAnimating,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Clamp zoom level to configured bounds
   */
  private clampLevel(level: number): number {
    return Math.max(this.config.minZoom, Math.min(this.config.maxZoom, level));
  }
}
