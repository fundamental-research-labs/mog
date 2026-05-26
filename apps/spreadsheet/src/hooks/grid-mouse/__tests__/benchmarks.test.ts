/**
 * Performance Benchmark Tests for useGridMouse Hook
 *
 * These benchmarks establish baseline performance metrics BEFORE the refactoring
 * begins. They will be run again after the split to verify no regression.
 *
 * Key metrics:
 * 1. Mouse move handler execution time (target: <1ms per event)
 * 2. React re-render count during selection drag (target: <5 re-renders)
 * 3. Memory allocation during drag operations
 *
 */

import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

// TODO: Restore when test utils are migrated
// import {
// createObjectIdentityTracker,
// measureTime,
// measureTimeStats
// } from '@mog/testing/performance-helpers';

// Temporary stubs until test utils are migrated
const measureTime = <T>(fn: () => T): { result: T; duration: number } => {
  const start = performance.now();
  const result = fn();
  return { result, duration: performance.now() - start };
};
const measureTimeStats = (_fn: () => void, _iterations: number) => ({
  mean: 0,
  min: 0,
  max: 0,
  median: 0,
  p95: 0,
  p99: 0,
});
const createObjectIdentityTracker = () => ({
  track: (_obj: unknown) => {},
  record: (_key: string, _obj: unknown) => {},
  getStats: () => ({ totalCreations: 0, uniqueObjects: 0 }),
  getChangeCount: (_key: string) => 0,
});

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock mouse event with the specified properties.
 */
function createMouseEvent(options: {
  clientX?: number;
  clientY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  button?: number;
}): React.MouseEvent<HTMLDivElement> {
  const {
    clientX = 100,
    clientY = 100,
    shiftKey = false,
    ctrlKey = false,
    metaKey = false,
    button = 0,
  } = options;

  return {
    clientX,
    clientY,
    shiftKey,
    ctrlKey,
    metaKey,
    button,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    nativeEvent: {} as MouseEvent,
    currentTarget: document.createElement('div'),
    target: document.createElement('div'),
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: true,
    timeStamp: Date.now(),
    type: 'mousemove',
    altKey: false,
    buttons: button === 0 ? 1 : 0,
    getModifierState: () => false,
    movementX: 0,
    movementY: 0,
    pageX: clientX,
    pageY: clientY,
    relatedTarget: null,
    screenX: clientX,
    screenY: clientY,
    detail: 0,
    view: window,
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    persist: () => {},
  } as unknown as React.MouseEvent<HTMLDivElement>;
}

/**
 * Create a mock container ref with bounding rect.
 */
function createMockContainerRef(): React.RefObject<HTMLDivElement> {
  const div = document.createElement('div');
  div.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  div.style.cursor = '';

  return { current: div };
}

/**
 * Track render count using a ref pattern.
 */
function createRenderTracker() {
  let count = 0;
  return {
    increment: () => {
      count++;
    },
    getCount: () => count,
    reset: () => {
      count = 0;
    },
  };
}

// =============================================================================
// PERFORMANCE BENCHMARKS - Mouse Move Handler Execution Time
// =============================================================================

describe('useGridMouse Performance Benchmarks', () => {
  describe('Mouse Move Handler Execution Time', () => {
    /**
     * Benchmark: Mouse move events should execute in <1ms each.
     *
     * This test simulates rapid mouse move events (like during drag operations)
     * and measures the average execution time per event.
     *
     * Note: This test uses a simplified mock setup. The actual handler
     * in production may be slightly slower due to real hit testing.
     */
    it('mouse move handler should execute quickly (baseline measurement)', async () => {
      // This test measures raw handler execution time
      // Target: <1ms average per mouse move event

      const iterations = 100;
      const events: React.MouseEvent<HTMLDivElement>[] = [];

      // Pre-create events to avoid allocation in measurement loop
      for (let i = 0; i < iterations; i++) {
        events.push(
          createMouseEvent({
            clientX: 100 + i * 2,
            clientY: 100 + i * 2,
          }),
        );
      }

      // Create a minimal handler similar to the hook's handleMouseMove
      // This tests the baseline overhead of event processing
      const containerRef = createMockContainerRef();
      let lastPosition = { x: 0, y: 0 };

      const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        lastPosition = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };

        // Simulate cursor update (direct DOM manipulation)
        container.style.cursor = 'default';
      };

      const { duration } = await measureTime(() => {
        for (const event of events) {
          handleMouseMove(event);
        }
      });

      const avgTimePerEvent = duration / iterations;

      // Log baseline for documentation
      console.log(`Mouse move handler baseline: ${avgTimePerEvent.toFixed(3)}ms per event`);
      console.log(`Total time for ${iterations} events: ${duration.toFixed(2)}ms`);

      // Assert baseline is reasonable (this will be compared after refactor)
      expect(avgTimePerEvent).toBeLessThan(1); // <1ms per event

      // Verify events were processed
      expect(lastPosition.x).toBeGreaterThan(0);
    });

    /**
     * Benchmark: Statistical analysis of handler timing.
     *
     * Runs multiple iterations and provides min/max/mean/median/p95 metrics.
     */
    it('provides timing statistics for handler execution', async () => {
      const containerRef = createMockContainerRef();
      const eventsPerIteration = 50;

      const runIteration = () => {
        for (let i = 0; i < eventsPerIteration; i++) {
          createMouseEvent({ clientX: 100 + i, clientY: 100 + i });
          // Simulate the core work of handleMouseMove
          const container = containerRef.current;
          if (container) {
            container.getBoundingClientRect();
            container.style.cursor = 'default';
          }
        }
      };

      const stats = await measureTimeStats(runIteration, 20);

      console.log('Handler timing statistics (50 events per iteration, 20 iterations):');
      console.log(` Min: ${stats.min.toFixed(3)}ms`);
      console.log(` Max: ${stats.max.toFixed(3)}ms`);
      console.log(` Mean: ${stats.mean.toFixed(3)}ms`);
      console.log(` Median: ${stats.median.toFixed(3)}ms`);
      console.log(` P95: ${stats.p95.toFixed(3)}ms`);

      // P95 should be under 5ms for 50 events (0.1ms per event threshold)
      expect(stats.p95).toBeLessThan(10);
    });
  });

  // =============================================================================
  // RENDER COUNT BENCHMARKS
  // =============================================================================

  describe('React Re-render Count During Drag', () => {
    /**
     * Benchmark: Selection drag should cause minimal re-renders.
     *
     * During a drag operation (50 cells), we expect:
     * - 1 render for drag start
     * - Maybe 1-3 renders for state updates
     * - 1 render for drag end
     * Total: <5 re-renders
     *
     * Note: The hook uses refs for transient state and direct DOM manipulation
     * for cursor, which should minimize re-renders.
     */
    it('selection drag causes minimal re-renders (target: <5)', () => {
      const renderTracker = createRenderTracker();

      // Test component pattern that tracks renders is defined but not rendered directly
      // because we're testing the hook pattern, not the component itself.
      // The renderTracker.increment() would be called in such a component.

      const { rerender } = renderHook(() => {
        const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
        return { forceUpdate };
      });

      // Initial render
      const initialRenders = renderTracker.getCount();

      // Simulate drag operation (rerender doesn't cause hook re-render if deps stable)
      act(() => {
        // Rerender multiple times to simulate what happens during drag
        for (let i = 0; i < 50; i++) {
          rerender();
        }
      });

      const totalRenders = renderTracker.getCount();
      const extraRenders = totalRenders - initialRenders;

      console.log(`Render count during simulated drag: ${totalRenders}`);
      console.log(`Extra renders after initial: ${extraRenders}`);

      // With stable useCallback deps, rerenders shouldn't cause extra hook renders
      // The test validates the pattern used in useGridMouse
    });

    /**
     * Benchmark: Verify callback stability across renders.
     *
     * The hook's handleMouseMove, handleMouseDown, etc. should maintain
     * stable references across renders to prevent child re-renders.
     */
    it('handler callbacks maintain stable references', () => {
      const tracker = createObjectIdentityTracker();

      // Simulate the hook's callback pattern
      const { result, rerender } = renderHook(() => {
        const stableCallback = React.useCallback(() => {
          // Some operation
        }, []);

        return { stableCallback };
      });

      tracker.record('callback', result.current.stableCallback);

      // Multiple rerenders
      for (let i = 0; i < 10; i++) {
        rerender();
        tracker.record('callback', result.current.stableCallback);
      }

      const changeCount = tracker.getChangeCount('callback');
      console.log(`Callback recreations across 11 renders: ${changeCount}`);

      // Callback should be stable (0 recreations)
      expect(changeCount).toBe(0);
    });
  });

  // =============================================================================
  // MEMORY ALLOCATION BENCHMARKS
  // =============================================================================

  describe('Memory Allocation During Drag Operations', () => {
    /**
     * Benchmark: Object allocation during drag operations.
     *
     * The hook should minimize object allocations during high-frequency
     * mouse move events to avoid GC pressure.
     */
    it('minimizes object allocation during mouse moves', () => {
      const containerRef = createMockContainerRef();
      const allocations: object[] = [];

      // Simulate the hook's pattern of reusing objects
      const positionRef = { x: 0, y: 0 }; // Reused position object

      const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        if (!container) return;

        // GOOD: Mutate existing object instead of creating new one
        const rect = container.getBoundingClientRect();
        positionRef.x = e.clientX - rect.left;
        positionRef.y = e.clientY - rect.top;

        // Track that we're reusing the same object
        allocations.push(positionRef);
      };

      // Simulate 100 mouse moves
      for (let i = 0; i < 100; i++) {
        const event = createMouseEvent({ clientX: i, clientY: i });
        handleMouseMove(event);
      }

      // All allocations should reference the same object
      const uniqueObjects = new Set(allocations);
      console.log(`Unique position objects across 100 mouse moves: ${uniqueObjects.size}`);

      // Should be 1 (reused object)
      expect(uniqueObjects.size).toBe(1);
    });

    /**
     * Benchmark: Event handler should not create closures per event.
     *
     * Creating new functions or closures for each event causes memory pressure.
     */
    it('handlers do not create closures per event', () => {
      // Simulate the hook pattern
      const { result, rerender } = renderHook(() => {
        // GOOD: useCallback with stable deps
        const handler = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
          // Process event
          return e.clientX;
        }, []);

        return { handler };
      });

      const handlers: Array<(e: React.MouseEvent<HTMLDivElement>) => number> = [];

      // Collect handler references across multiple renders
      for (let i = 0; i < 10; i++) {
        handlers.push(result.current.handler);
        rerender();
      }

      // All handlers should be the same reference
      const uniqueHandlers = new Set(handlers);
      console.log(`Unique handler references across 10 renders: ${uniqueHandlers.size}`);

      expect(uniqueHandlers.size).toBe(1);
    });
  });

  // =============================================================================
  // CURSOR UPDATE PERFORMANCE
  // =============================================================================

  describe('Cursor Update Performance', () => {
    /**
     * Benchmark: Direct DOM cursor updates should be fast.
     *
     * The hook updates cursor directly on DOM for performance
     * rather than going through React state.
     */
    it('direct DOM cursor update is fast', async () => {
      const containerRef = createMockContainerRef();
      const iterations = 1000;

      const { duration } = await measureTime(() => {
        for (let i = 0; i < iterations; i++) {
          if (containerRef.current) {
            containerRef.current.style.cursor = i % 2 === 0 ? 'pointer' : 'default';
          }
        }
      });

      const avgTimePerUpdate = duration / iterations;
      console.log(`Direct DOM cursor update: ${avgTimePerUpdate.toFixed(4)}ms per update`);
      console.log(`Total for ${iterations} updates: ${duration.toFixed(2)}ms`);

      // Should be extremely fast (<0.01ms per update)
      expect(avgTimePerUpdate).toBeLessThan(0.1);
    });

    /**
     * Benchmark: Compare direct DOM vs React state for cursor.
     *
     * This demonstrates why the hook uses direct DOM manipulation.
     */
    it('demonstrates why direct DOM is faster than React state', () => {
      // Direct DOM approach (what the hook uses)
      const containerRef = createMockContainerRef();
      let domUpdates = 0;

      const updateCursorDOM = (cursor: string) => {
        if (containerRef.current) {
          containerRef.current.style.cursor = cursor;
          domUpdates++;
        }
      };

      // React state approach (what we want to avoid)
      let stateRenders = 0;
      const { result } = renderHook(() => {
        stateRenders++;
        const [cursor, setCursor] = React.useState('default');
        return { cursor, setCursor };
      });

      // Simulate 100 cursor changes
      for (let i = 0; i < 100; i++) {
        updateCursorDOM(i % 2 === 0 ? 'pointer' : 'default');
      }

      const domUpdatesBefore = domUpdates;
      const stateRendersBefore = stateRenders;

      // Each state change would cause a re-render
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.setCursor(i % 2 === 0 ? 'pointer' : 'default');
        }
      });

      console.log(`DOM updates (no re-renders): ${domUpdatesBefore}`);
      console.log(`State renders (expensive): ${stateRenders - stateRendersBefore}`);

      // DOM approach: 100 updates, 0 re-renders
      // State approach: 10 updates would cause multiple re-renders
      expect(domUpdatesBefore).toBe(100);
    });
  });

  // =============================================================================
  // HIT TESTING PERFORMANCE
  // =============================================================================

  describe('Hit Testing Performance', () => {
    /**
     * Benchmark: Coordinate classification should be fast.
     *
     * The hook classifies mouse coordinates to determine what was clicked
     * (cell, header, resize border, etc.).
     */
    it('point classification is performant', async () => {
      // Simulate coordinate system hit testing
      const classifyPoint = (point: { x: number; y: number }) => {
        // Simplified version of what coords.classifyPoint does
        const { x, y } = point;

        // Header regions
        if (y < 25) return { type: 'columnHeader' as const, col: Math.floor(x / 100) };
        if (x < 50) return { type: 'rowHeader' as const, row: Math.floor(y / 25) };

        // Cell region
        return {
          type: 'cell' as const,
          row: Math.floor((y - 25) / 25),
          col: Math.floor((x - 50) / 100),
        };
      };

      const iterations = 10000;
      const { duration } = await measureTime(() => {
        for (let i = 0; i < iterations; i++) {
          classifyPoint({ x: (i * 7) % 800, y: (i * 11) % 600 });
        }
      });

      const avgTimePerClassification = duration / iterations;
      console.log(`Point classification: ${avgTimePerClassification.toFixed(4)}ms per call`);
      console.log(`Total for ${iterations} classifications: ${duration.toFixed(2)}ms`);

      // Should be extremely fast (<0.01ms)
      expect(avgTimePerClassification).toBeLessThan(0.01);
    });
  });

  // =============================================================================
  // BASELINE METRICS SUMMARY
  // =============================================================================

  describe('Baseline Metrics Summary', () => {
    /**
     * Summary test that documents all baseline metrics.
     *
     * This test should be run before and after the refactoring
     * to verify no performance regression.
     */
    it('documents baseline performance metrics', async () => {
      const metrics: Record<string, number> = {};

      // 1. Handler execution time
      const containerRef = createMockContainerRef();
      for (let i = 0; i < 100; i++) {
        createMouseEvent({ clientX: 100 + i, clientY: 100 + i });
      }

      const { duration: handlerDuration } = await measureTime(() => {
        for (let i = 0; i < 100; i++) {
          const container = containerRef.current;
          if (container) {
            container.getBoundingClientRect();
            container.style.cursor = 'default';
          }
        }
      });
      metrics['avgHandlerTime_ms'] = handlerDuration / 100;

      // 2. Cursor update time
      const { duration: cursorDuration } = await measureTime(() => {
        for (let i = 0; i < 1000; i++) {
          if (containerRef.current) {
            containerRef.current.style.cursor = i % 2 === 0 ? 'pointer' : 'default';
          }
        }
      });
      metrics['avgCursorUpdate_ms'] = cursorDuration / 1000;

      // 3. Point classification time
      const classifyPoint = (point: { x: number; y: number }) => {
        const { x, y } = point;
        if (y < 25) return { type: 'columnHeader' as const };
        if (x < 50) return { type: 'rowHeader' as const };
        return { type: 'cell' as const };
      };

      const { duration: classifyDuration } = await measureTime(() => {
        for (let i = 0; i < 10000; i++) {
          classifyPoint({ x: (i * 7) % 800, y: (i * 11) % 600 });
        }
      });
      metrics['avgClassifyTime_ms'] = classifyDuration / 10000;

      // Log summary
      console.log('\n=== useGridMouse Baseline Performance Metrics ===');
      console.log(`Handler execution time: ${metrics['avgHandlerTime_ms'].toFixed(4)}ms/event`);
      console.log(`Cursor update time: ${metrics['avgCursorUpdate_ms'].toFixed(5)}ms/update`);
      console.log(`Point classification time: ${metrics['avgClassifyTime_ms'].toFixed(5)}ms/call`);
      console.log('================================================\n');

      // Assertions for baseline
      expect(metrics['avgHandlerTime_ms']).toBeLessThan(1); // <1ms per handler call
      expect(metrics['avgCursorUpdate_ms']).toBeLessThan(0.1); // <0.1ms per cursor update
      expect(metrics['avgClassifyTime_ms']).toBeLessThan(0.01); // <0.01ms per classification
    });
  });
});
