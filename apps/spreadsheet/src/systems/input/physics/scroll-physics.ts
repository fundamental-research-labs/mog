/**
 * Scroll Physics Engine
 *
 * Passive physics class for scroll momentum and deceleration.
 * Driven by RenderScheduler - no internal rAF loop.
 *
 * Features:
 * - iOS-like exponential decay momentum (τ = 325ms default)
 * - Bounds clamping
 * - Immediate delta application
 * - Zero allocations during animation
 *
 * @module state/coordinator/physics/scroll-physics
 */

import type {
  ScrollPhysicsConfig,
  ScrollState,
  ViewportPositionIndexLike,
} from '@mog-sdk/contracts/rendering';

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: ScrollPhysicsConfig = {
  decelerationRate: 325, // iOS-like time constant
  minVelocity: 0.5, // px/s threshold to stop
  maxVelocity: 8000, // px/s maximum
};

// =============================================================================
// Rubber-Band Configuration (iOS-style elastic overscroll)
// =============================================================================

const RUBBER_BAND_CONFIG = {
  /** Whether rubber-banding is enabled */
  enabled: true,
  /** Maximum overscroll distance in pixels */
  maxOverscroll: 100,
  /** Stiffness factor (0-1, lower = more elastic) */
  stiffness: 0.5,
  /** Duration in ms for snap-back animation */
  snapBackDuration: 200,
};

// =============================================================================
// ScrollPhysics Class
// =============================================================================

/**
 * ScrollPhysics - Momentum scrolling with exponential decay.
 *
 * Usage:
 * 1. Create instance with optional config
 * 2. Call `applyDelta()` for immediate scrolling (wheel, pan drag)
 * 3. Call `startMomentum()` to begin momentum animation
 * 4. Call `update(deltaTimeMs)` each frame (RenderScheduler calls this)
 * 5. Read `position` and `isAnimating` to update UI
 */
export class ScrollPhysics {
  private readonly config: ScrollPhysicsConfig;

  // Position state
  private x: number = 0;
  private y: number = 0;

  // Velocity state (px/s)
  private velocityX: number = 0;
  private velocityY: number = 0;

  // Animation state
  private _isAnimating: boolean = false;

  // Smooth animation state (for animateTo)
  private targetX: number | null = null;
  private targetY: number | null = null;
  private animationStartTime: number = 0;
  private animationDuration: number = 0;
  private animationStartX: number = 0;
  private animationStartY: number = 0;

  // Bounds
  private minX: number = 0;
  private maxX: number = Infinity;
  private minY: number = 0;
  private maxY: number = Infinity;

  // Rubber-band state (iOS-style elastic overscroll)
  private rubberBandEnabled: boolean = RUBBER_BAND_CONFIG.enabled;
  private _isUserDragging: boolean = false;

  constructor(config: Partial<ScrollPhysicsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────
  // Core Update (called by RenderScheduler each frame)
  // ─────────────────────────────────────────────────────────────

  /**
   * Update physics simulation for one frame.
   * Called by RenderScheduler each animation frame.
   *
   * Uses exponential decay: v(t) = v0 * e^(-t/τ)
   * Position integral: x(t) = x0 + v0 * τ * (1 - e^(-t/τ))
   *
   * @param deltaTimeMs - Time since last frame in milliseconds
   */
  update(deltaTimeMs: number): void {
    if (!this._isAnimating) return;

    // Handle smooth animation (animateTo)
    if (this.targetX !== null || this.targetY !== null) {
      const now = performance.now();
      const elapsed = now - this.animationStartTime;
      const progress = Math.min(1, elapsed / this.animationDuration);

      // Ease-out cubic interpolation for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      // Interpolate to target
      if (this.targetX !== null) {
        this.x = this.animationStartX + (this.targetX - this.animationStartX) * eased;
      }
      if (this.targetY !== null) {
        this.y = this.animationStartY + (this.targetY - this.animationStartY) * eased;
      }

      // Stop when animation complete
      if (progress >= 1) {
        if (this.targetX !== null) this.x = this.targetX;
        if (this.targetY !== null) this.y = this.targetY;
        this.targetX = null;
        this.targetY = null;
        this._isAnimating = false;
      }
      return;
    }

    // Handle momentum animation (startMomentum)
    const tau = this.config.decelerationRate;

    // Exponential decay factor
    const decay = Math.exp(-deltaTimeMs / tau);

    // Update position using integral of velocity
    // Δx = v * τ * (1 - e^(-Δt/τ))
    const positionFactor = tau * (1 - decay);
    this.x += (this.velocityX / 1000) * positionFactor;
    this.y += (this.velocityY / 1000) * positionFactor;

    // Decay velocity
    this.velocityX *= decay;
    this.velocityY *= decay;

    // Handle boundary behavior (rubber-band vs hard stop)
    const isOverscrolledX = this.x < this.minX || this.x > this.maxX;
    const isOverscrolledY = this.y < this.minY || this.y > this.maxY;

    if (this.rubberBandEnabled && !this._isUserDragging) {
      // Rubber-band snap-back: animate back to bounds when overscrolled
      if (isOverscrolledX || isOverscrolledY) {
        const targetX = this.clamp(this.x, this.minX, this.maxX);
        const targetY = this.clamp(this.y, this.minY, this.maxY);

        // Stop momentum and snap back
        this.velocityX = 0;
        this.velocityY = 0;
        this.animateTo(targetX, targetY, RUBBER_BAND_CONFIG.snapBackDuration);
        return;
      }
    } else {
      // Hard stop at bounds (non-rubber-band mode)
      this.x = this.clamp(this.x, this.minX, this.maxX);
      this.y = this.clamp(this.y, this.minY, this.maxY);
    }

    // Check for boundary collision - stop velocity in that direction
    if (this.x <= this.minX || this.x >= this.maxX) {
      this.velocityX = 0;
    }
    if (this.y <= this.minY || this.y >= this.maxY) {
      this.velocityY = 0;
    }

    // Stop when velocity below threshold
    const speed = Math.sqrt(this.velocityX * this.velocityX + this.velocityY * this.velocityY);
    if (speed < this.config.minVelocity) {
      this.velocityX = 0;
      this.velocityY = 0;
      this._isAnimating = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Immediate Scroll (wheel, pan drag)
  // ─────────────────────────────────────────────────────────────

  /**
   * Apply immediate scroll delta.
   * Used for wheel events and pan drag movements.
   * Supports rubber-band overscroll when dragging past boundaries.
   *
   * @param deltaX - Horizontal scroll delta in pixels
   * @param deltaY - Vertical scroll delta in pixels
   */
  applyDelta(deltaX: number, deltaY: number): void {
    this.x += deltaX;
    this.y += deltaY;

    // Handle boundary with optional rubber-banding
    if (this.rubberBandEnabled && this._isUserDragging) {
      // Allow overscroll with increasing resistance (rubber-band effect)
      const { maxOverscroll, stiffness } = RUBBER_BAND_CONFIG;

      if (this.x < this.minX) {
        // Over-scrolled left: apply rubber-band resistance
        const overscroll = this.minX - this.x;
        this.x = this.minX - Math.min(maxOverscroll, overscroll * stiffness);
      } else if (this.x > this.maxX) {
        // Over-scrolled right: apply rubber-band resistance
        const overscroll = this.x - this.maxX;
        this.x = this.maxX + Math.min(maxOverscroll, overscroll * stiffness);
      }

      if (this.y < this.minY) {
        // Over-scrolled top: apply rubber-band resistance
        const overscroll = this.minY - this.y;
        this.y = this.minY - Math.min(maxOverscroll, overscroll * stiffness);
      } else if (this.y > this.maxY) {
        // Over-scrolled bottom: apply rubber-band resistance
        const overscroll = this.y - this.maxY;
        this.y = this.maxY + Math.min(maxOverscroll, overscroll * stiffness);
      }
    } else {
      // Hard clamp to bounds (no rubber-banding)
      this.x = this.clamp(this.x, this.minX, this.maxX);
      this.y = this.clamp(this.y, this.minY, this.maxY);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Momentum Control
  // ─────────────────────────────────────────────────────────────

  /**
   * Start momentum animation with given velocity.
   *
   * @param velocityX - Initial horizontal velocity in px/s
   * @param velocityY - Initial vertical velocity in px/s
   */
  startMomentum(velocityX: number, velocityY: number): void {
    // Clamp velocity to maximum
    this.velocityX = this.clampVelocity(velocityX);
    this.velocityY = this.clampVelocity(velocityY);

    // Only animate if velocity is significant
    const speed = Math.sqrt(this.velocityX * this.velocityX + this.velocityY * this.velocityY);
    this._isAnimating = speed >= this.config.minVelocity;
  }

  /**
   * Stop any running momentum animation.
   */
  stop(): void {
    this.velocityX = 0;
    this.velocityY = 0;
    this.targetX = null;
    this.targetY = null;
    this._isAnimating = false;
  }

  /**
   * Animate smoothly to a target position.
   * Stops any existing momentum and starts a smooth ease-out animation.
   *
   * @param x - Target X position
   * @param y - Target Y position
   * @param duration - Animation duration in milliseconds (default 300ms)
   */
  animateTo(x: number, y: number, duration: number = 300): void {
    // Stop any existing momentum
    this.velocityX = 0;
    this.velocityY = 0;

    // Clamp target to bounds
    const clampedX = this.clamp(x, this.minX, this.maxX);
    const clampedY = this.clamp(y, this.minY, this.maxY);

    // Set animation state
    this.animationStartX = this.x;
    this.animationStartY = this.y;
    this.targetX = clampedX;
    this.targetY = clampedY;
    this.animationDuration = duration;
    this.animationStartTime = performance.now();
    this._isAnimating = true;
  }

  /**
   * Snap the scroll position to the nearest cell boundary.
   * Uses ViewportPositionIndex to find cell boundaries and animates to them.
   *
   * Scroll Animation - Cell Snapping
   * After momentum scroll completes, this snaps to the nearest cell top-left corner.
   *
   * @param positionIndex - Viewport position index for O(1) lookups
   * @param duration - Animation duration in milliseconds (default 100ms for snappy feel)
   */
  snapToCell(positionIndex: ViewportPositionIndexLike, duration: number = 100): void {
    const pi = positionIndex;

    if (!pi.hasData) return;

    let targetY: number;
    let targetX: number;

    // Use position index for fast row/col lookup
    const currentRow = pi.findRowAtY(this.y);
    const currentCol = pi.findColAtX(this.x);

    if (currentRow !== null) {
      const rowTop = pi.getRowTop(currentRow);
      const rowHeight = pi.getRowHeight(currentRow);
      const rowBottom = rowTop + rowHeight;
      // Snap to closest edge
      const distToTop = this.y - rowTop;
      const distToBottom = rowBottom - this.y;
      const snapRow =
        distToTop <= distToBottom ? currentRow : Math.min(currentRow + 1, pi.totalRows - 1);
      targetY = pi.getRowTop(snapRow);
    } else {
      // Position index couldn't find row — skip snapping
      return;
    }

    if (currentCol !== null) {
      const colLeft = pi.getColLeft(currentCol);
      const colWidth = pi.getColWidth(currentCol);
      const colRight = colLeft + colWidth;
      const distToLeft = this.x - colLeft;
      const distToRight = colRight - this.x;
      const snapCol =
        distToLeft <= distToRight ? currentCol : Math.min(currentCol + 1, pi.totalCols - 1);
      targetX = pi.getColLeft(snapCol);
    } else {
      // Position index couldn't find col — skip snapping
      return;
    }

    // Only animate if we need to move
    const deltaX = Math.abs(targetX - this.x);
    const deltaY = Math.abs(targetY - this.y);

    // If already at a cell boundary (within 1px), don't animate
    if (deltaX < 1 && deltaY < 1) {
      return;
    }

    // Animate to snapped position
    this.animateTo(targetX, targetY, duration);
  }

  // ─────────────────────────────────────────────────────────────
  // Bounds Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Set scroll bounds.
   *
   * @param minX - Minimum X position (usually 0)
   * @param maxX - Maximum X position (total width - viewport width)
   * @param minY - Minimum Y position (usually 0)
   * @param maxY - Maximum Y position (total height - viewport height)
   */
  setBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;

    // Clamp current position to new bounds
    this.x = this.clamp(this.x, this.minX, this.maxX);
    this.y = this.clamp(this.y, this.minY, this.maxY);
  }

  /**
   * Get current bounds.
   */
  getBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
      minX: this.minX,
      maxX: this.maxX,
      minY: this.minY,
      maxY: this.maxY,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Position Control
  // ─────────────────────────────────────────────────────────────

  /**
   * Set position directly.
   * Stops any running animation.
   *
   * @param x - New X position
   * @param y - New Y position
   */
  setPosition(x: number, y: number): void {
    this.stop();
    this.x = this.clamp(x, this.minX, this.maxX);
    this.y = this.clamp(y, this.minY, this.maxY);
  }

  // ─────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────

  /**
   * Whether momentum animation is currently running.
   */
  get isAnimating(): boolean {
    return this._isAnimating;
  }

  /**
   * Current scroll position.
   */
  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /**
   * Current velocity (px/s).
   */
  get velocity(): { x: number; y: number } {
    return { x: this.velocityX, y: this.velocityY };
  }

  /**
   * Get complete scroll state for subscribers.
   */
  getState(): ScrollState {
    return {
      x: this.x,
      y: this.y,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      isAnimating: this._isAnimating,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Rubber-Band Control (iOS-style elastic overscroll)
  // ─────────────────────────────────────────────────────────────

  /**
   * Set whether rubber-banding is enabled.
   * When enabled, scrolling past boundaries will show elastic overscroll effect.
   *
   * @param enabled - Whether to enable rubber-banding
   */
  setRubberBandEnabled(enabled: boolean): void {
    this.rubberBandEnabled = enabled;
  }

  /**
   * Get whether rubber-banding is enabled.
   */
  isRubberBandEnabled(): boolean {
    return this.rubberBandEnabled;
  }

  /**
   * Set the user dragging state.
   * While dragging, rubber-band overscroll is allowed.
   * When released (dragging = false), snap-back animation occurs.
   *
   * @param isDragging - Whether the user is currently dragging
   */
  setUserDragging(isDragging: boolean): void {
    const wasDragging = this._isUserDragging;
    this._isUserDragging = isDragging;

    // When user releases drag, trigger snap-back if overscrolled
    if (wasDragging && !isDragging && this.rubberBandEnabled) {
      const isOverscrolledX = this.x < this.minX || this.x > this.maxX;
      const isOverscrolledY = this.y < this.minY || this.y > this.maxY;

      if (isOverscrolledX || isOverscrolledY) {
        const targetX = this.clamp(this.x, this.minX, this.maxX);
        const targetY = this.clamp(this.y, this.minY, this.maxY);
        this.animateTo(targetX, targetY, RUBBER_BAND_CONFIG.snapBackDuration);
      }
    }
  }

  /**
   * Get whether the user is currently dragging.
   */
  get isUserDragging(): boolean {
    return this._isUserDragging;
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private clampVelocity(velocity: number): number {
    const sign = Math.sign(velocity);
    const magnitude = Math.min(Math.abs(velocity), this.config.maxVelocity);
    return sign * magnitude;
  }
}
