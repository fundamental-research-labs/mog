/**
 * Scroll Physics Tests
 *
 * Comprehensive tests for momentum scrolling, deceleration, and bounds.
 *
 * @module input/physics/__tests__/scroll-physics.test
 */

import { ScrollPhysics } from '../scroll-physics';

// =============================================================================
// Test Constants
// =============================================================================

const FRAME_TIME = 16.67; // ~60fps
const TAU_DEFAULT = 325; // Default time constant

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Simulate multiple frames of physics updates.
 */
function simulateFrames(
  physics: ScrollPhysics,
  frameCount: number,
  frameTime: number = FRAME_TIME,
): void {
  for (let i = 0; i < frameCount; i++) {
    physics.update(frameTime);
  }
}

/**
 * Simulate physics until animation stops or max time reached.
 */
function simulateUntilStopped(
  physics: ScrollPhysics,
  maxTimeMs: number = 5000,
  frameTime: number = FRAME_TIME,
): number {
  let elapsed = 0;
  while (physics.isAnimating && elapsed < maxTimeMs) {
    physics.update(frameTime);
    elapsed += frameTime;
  }
  return elapsed;
}

// =============================================================================
// Basic Instantiation Tests
// =============================================================================

describe('ScrollPhysics', () => {
  describe('Instantiation', () => {
    it('creates with default configuration', () => {
      const physics = new ScrollPhysics();
      expect(physics).toBeDefined();
      expect(physics.isAnimating).toBe(false);
      expect(physics.position).toEqual({ x: 0, y: 0 });
      expect(physics.velocity).toEqual({ x: 0, y: 0 });
    });

    it('creates with custom configuration', () => {
      const physics = new ScrollPhysics({
        decelerationRate: 500,
        minVelocity: 1,
        maxVelocity: 5000,
      });
      expect(physics).toBeDefined();
    });

    it('starts at origin with zero velocity', () => {
      const physics = new ScrollPhysics();
      const state = physics.getState();

      expect(state.x).toBe(0);
      expect(state.y).toBe(0);
      expect(state.velocityX).toBe(0);
      expect(state.velocityY).toBe(0);
      expect(state.isAnimating).toBe(false);
    });
  });

  // ===========================================================================
  // Immediate Delta Application
  // ===========================================================================

  describe('applyDelta', () => {
    it('applies delta to position immediately', () => {
      const physics = new ScrollPhysics();

      physics.applyDelta(100, 50);

      expect(physics.position.x).toBe(100);
      expect(physics.position.y).toBe(50);
    });

    it('accumulates multiple deltas', () => {
      const physics = new ScrollPhysics();

      physics.applyDelta(100, 50);
      physics.applyDelta(50, 25);
      physics.applyDelta(-30, -10);

      expect(physics.position.x).toBe(120);
      expect(physics.position.y).toBe(65);
    });

    it('does not start animation', () => {
      const physics = new ScrollPhysics();

      physics.applyDelta(100, 50);

      expect(physics.isAnimating).toBe(false);
    });

    it('clamps to bounds', () => {
      const physics = new ScrollPhysics();
      physics.setBounds(0, 500, 0, 300);

      physics.applyDelta(1000, 500);

      expect(physics.position.x).toBe(500);
      expect(physics.position.y).toBe(300);
    });

    it('clamps to minimum bounds', () => {
      const physics = new ScrollPhysics();
      physics.setBounds(0, 500, 0, 300);

      physics.applyDelta(-100, -50);

      expect(physics.position.x).toBe(0);
      expect(physics.position.y).toBe(0);
    });
  });

  // ===========================================================================
  // Momentum Animation
  // ===========================================================================

  describe('startMomentum', () => {
    it('starts animation with velocity', () => {
      const physics = new ScrollPhysics();

      physics.startMomentum(1000, 500);

      expect(physics.isAnimating).toBe(true);
      expect(physics.velocity.x).toBe(1000);
      expect(physics.velocity.y).toBe(500);
    });

    it('clamps velocity to maximum', () => {
      const physics = new ScrollPhysics({ maxVelocity: 5000 });

      physics.startMomentum(10000, -8000);

      expect(physics.velocity.x).toBe(5000);
      expect(physics.velocity.y).toBe(-5000);
    });

    it('does not start animation for tiny velocity', () => {
      const physics = new ScrollPhysics({ minVelocity: 1 });

      physics.startMomentum(0.5, 0.3);

      expect(physics.isAnimating).toBe(false);
    });

    it('preserves velocity direction', () => {
      const physics = new ScrollPhysics();

      physics.startMomentum(-500, -300);

      expect(physics.velocity.x).toBe(-500);
      expect(physics.velocity.y).toBe(-300);
    });
  });

  // ===========================================================================
  // Physics Update
  // ===========================================================================

  describe('update', () => {
    it('does nothing when not animating', () => {
      const physics = new ScrollPhysics();
      const initialPosition = { ...physics.position };

      physics.update(FRAME_TIME);

      expect(physics.position).toEqual(initialPosition);
    });

    it('moves position in velocity direction', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 0);
      const initialX = physics.position.x;

      physics.update(FRAME_TIME);

      expect(physics.position.x).toBeGreaterThan(initialX);
    });

    it('decays velocity exponentially', () => {
      const physics = new ScrollPhysics({ decelerationRate: TAU_DEFAULT });
      physics.startMomentum(1000, 0);

      physics.update(TAU_DEFAULT);

      // After one time constant, velocity should be ~37% of original (1/e)
      const expectedVelocity = 1000 * Math.exp(-1);
      expect(physics.velocity.x).toBeCloseTo(expectedVelocity, 0);
    });

    it('stops when velocity falls below threshold', () => {
      const physics = new ScrollPhysics({
        decelerationRate: 100,
        minVelocity: 10,
      });
      physics.startMomentum(100, 0);

      simulateUntilStopped(physics);

      expect(physics.isAnimating).toBe(false);
      expect(physics.velocity.x).toBe(0);
      expect(physics.velocity.y).toBe(0);
    });

    it('eventually stops for any initial velocity', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(8000, 8000);

      const elapsed = simulateUntilStopped(physics, 10000);

      expect(physics.isAnimating).toBe(false);
      expect(elapsed).toBeLessThan(10000);
    });
  });

  // ===========================================================================
  // Bounds Handling
  // ===========================================================================

  describe('bounds', () => {
    it('sets bounds correctly', () => {
      const physics = new ScrollPhysics();

      physics.setBounds(10, 500, 20, 300);

      const bounds = physics.getBounds();
      expect(bounds).toEqual({ minX: 10, maxX: 500, minY: 20, maxY: 300 });
    });

    it('clamps current position when bounds change', () => {
      const physics = new ScrollPhysics();
      physics.applyDelta(1000, 800);

      physics.setBounds(0, 500, 0, 300);

      expect(physics.position.x).toBe(500);
      expect(physics.position.y).toBe(300);
    });

    it('stops velocity at bounds during momentum', () => {
      const physics = new ScrollPhysics();
      physics.setRubberBandEnabled(false); // Disable rubber-banding for deterministic bounds test
      physics.setBounds(0, 100, 0, 100);
      physics.startMomentum(5000, 5000);

      simulateFrames(physics, 60);

      expect(physics.position.x).toBe(100);
      expect(physics.position.y).toBe(100);
    });

    it('respects minimum bounds during momentum', () => {
      const physics = new ScrollPhysics();
      physics.setRubberBandEnabled(false); // Disable rubber-banding for deterministic bounds test
      physics.setBounds(0, 500, 0, 300);
      physics.setPosition(50, 50);
      physics.startMomentum(-5000, -5000);

      simulateFrames(physics, 60);

      expect(physics.position.x).toBe(0);
      expect(physics.position.y).toBe(0);
    });

    it('defaults to infinite bounds', () => {
      const physics = new ScrollPhysics();
      const bounds = physics.getBounds();

      expect(bounds.minX).toBe(0);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxX).toBe(Infinity);
      expect(bounds.maxY).toBe(Infinity);
    });
  });

  // ===========================================================================
  // Position Control
  // ===========================================================================

  describe('setPosition', () => {
    it('sets position directly', () => {
      const physics = new ScrollPhysics();

      physics.setPosition(250, 150);

      expect(physics.position.x).toBe(250);
      expect(physics.position.y).toBe(150);
    });

    it('stops any running animation', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 1000);

      physics.setPosition(100, 100);

      expect(physics.isAnimating).toBe(false);
      expect(physics.velocity).toEqual({ x: 0, y: 0 });
    });

    it('clamps to bounds', () => {
      const physics = new ScrollPhysics();
      physics.setBounds(0, 200, 0, 100);

      physics.setPosition(500, 300);

      expect(physics.position.x).toBe(200);
      expect(physics.position.y).toBe(100);
    });

    it('clamps to minimum bounds', () => {
      const physics = new ScrollPhysics();
      physics.setBounds(50, 200, 25, 100);

      physics.setPosition(-100, -50);

      expect(physics.position.x).toBe(50);
      expect(physics.position.y).toBe(25);
    });
  });

  // ===========================================================================
  // Stop Control
  // ===========================================================================

  describe('stop', () => {
    it('stops animation', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 1000);

      physics.stop();

      expect(physics.isAnimating).toBe(false);
    });

    it('zeros velocity', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 1000);

      physics.stop();

      expect(physics.velocity).toEqual({ x: 0, y: 0 });
    });

    it('preserves position', () => {
      const physics = new ScrollPhysics();
      physics.applyDelta(100, 50);
      physics.startMomentum(1000, 1000);
      simulateFrames(physics, 10);
      const positionBeforeStop = { ...physics.position };

      physics.stop();

      expect(physics.position).toEqual(positionBeforeStop);
    });

    it('is idempotent', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 1000);

      physics.stop();
      physics.stop();
      physics.stop();

      expect(physics.isAnimating).toBe(false);
      expect(physics.velocity).toEqual({ x: 0, y: 0 });
    });
  });

  // ===========================================================================
  // State Retrieval
  // ===========================================================================

  describe('getState', () => {
    it('returns complete state object', () => {
      const physics = new ScrollPhysics();
      physics.applyDelta(100, 50);
      physics.startMomentum(500, 250);

      const state = physics.getState();

      expect(state).toEqual({
        x: 100,
        y: 50,
        velocityX: 500,
        velocityY: 250,
        isAnimating: true,
      });
    });

    it('returns immutable snapshot', () => {
      const physics = new ScrollPhysics();
      const state1 = physics.getState();

      physics.applyDelta(100, 50);
      const state2 = physics.getState();

      expect(state1.x).toBe(0);
      expect(state2.x).toBe(100);
    });
  });

  // ===========================================================================
  // Physics Accuracy
  // ===========================================================================

  describe('Physics Accuracy', () => {
    it('position converges to correct final value', () => {
      const physics = new ScrollPhysics({
        decelerationRate: 325,
        minVelocity: 0.1,
      });
      physics.startMomentum(1000, 0);

      // Theoretical final position: x = v0 * τ / 1000 (converting τ to seconds)
      // For v0=1000px/s and τ=325ms: x = 1000 * 0.325 = 325px
      simulateUntilStopped(physics);

      // Allow 5% tolerance for numerical integration
      expect(physics.position.x).toBeGreaterThan(300);
      expect(physics.position.x).toBeLessThan(350);
    });

    it('diagonal momentum works correctly', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 1000);

      simulateFrames(physics, 30);

      // Both axes should progress equally
      expect(physics.position.x).toBeCloseTo(physics.position.y, 1);
    });

    it('handles high frame rates', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 0);

      // 120fps simulation
      simulateFrames(physics, 120, 8.33);

      expect(physics.position.x).toBeGreaterThan(0);
    });

    it('handles low frame rates', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 0);

      // 30fps simulation
      simulateFrames(physics, 30, 33.33);

      expect(physics.position.x).toBeGreaterThan(0);
    });

    it('is frame-rate independent', () => {
      // Same velocity, same duration, different frame rates
      const physics60 = new ScrollPhysics({ decelerationRate: 325 });
      const physics30 = new ScrollPhysics({ decelerationRate: 325 });

      physics60.startMomentum(1000, 0);
      physics30.startMomentum(1000, 0);

      // Simulate 1 second at different frame rates
      simulateFrames(physics60, 60, 16.67);
      simulateFrames(physics30, 30, 33.33);

      // Positions should be close (within 5%)
      const diff = Math.abs(physics60.position.x - physics30.position.x);
      const avg = (physics60.position.x + physics30.position.x) / 2;
      expect(diff / avg).toBeLessThan(0.05);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles zero delta', () => {
      const physics = new ScrollPhysics();

      physics.applyDelta(0, 0);

      expect(physics.position).toEqual({ x: 0, y: 0 });
    });

    it('handles zero velocity momentum', () => {
      const physics = new ScrollPhysics();

      physics.startMomentum(0, 0);

      expect(physics.isAnimating).toBe(false);
    });

    it('handles very small frame times', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 0);

      physics.update(0.1);

      expect(physics.isAnimating).toBe(true);
      expect(physics.position.x).toBeGreaterThan(0);
    });

    it('handles very large frame times', () => {
      const physics = new ScrollPhysics();
      physics.startMomentum(1000, 0);

      physics.update(1000);

      // Should have mostly decayed
      expect(physics.velocity.x).toBeLessThan(100);
    });

    it('handles negative bounds', () => {
      const physics = new ScrollPhysics();

      physics.setBounds(-100, 100, -50, 50);

      expect(physics.getBounds()).toEqual({
        minX: -100,
        maxX: 100,
        minY: -50,
        maxY: 50,
      });
    });

    it('handles bounds where min equals max', () => {
      const physics = new ScrollPhysics();
      physics.setBounds(50, 50, 25, 25);

      physics.applyDelta(100, 100);

      expect(physics.position.x).toBe(50);
      expect(physics.position.y).toBe(25);
    });

    it('handles rapid start/stop cycles', () => {
      const physics = new ScrollPhysics();

      for (let i = 0; i < 100; i++) {
        physics.startMomentum(1000, 500);
        physics.update(FRAME_TIME);
        physics.stop();
      }

      expect(physics.isAnimating).toBe(false);
      expect(physics.velocity).toEqual({ x: 0, y: 0 });
    });
  });

  // ===========================================================================
  // Performance (Allocation Tests)
  // ===========================================================================

  describe('Performance', () => {
    it('getState returns new object each call', () => {
      const physics = new ScrollPhysics();

      const state1 = physics.getState();
      const state2 = physics.getState();

      expect(state1).not.toBe(state2);
    });

    it('position getter returns new object each call', () => {
      const physics = new ScrollPhysics();

      const pos1 = physics.position;
      const pos2 = physics.position;

      expect(pos1).not.toBe(pos2);
    });

    it('velocity getter returns new object each call', () => {
      const physics = new ScrollPhysics();

      const vel1 = physics.velocity;
      const vel2 = physics.velocity;

      expect(vel1).not.toBe(vel2);
    });
  });
});
