/**
 * Tests for PriorityScheduler — Passive Invalidation Scheduler
 *
 * The scheduler is PASSIVE: it does NOT own a rAF loop.
 * The RenderLoop calls scheduler.processFrame(budgetMs) each frame.
 */

import { jest } from '@jest/globals';

import { RenderPriority } from '../core/types';
import { PriorityScheduler, SchedulerTaskConfig } from '../scheduler/priority-scheduler';

// =============================================================================
// Helpers
// =============================================================================

/** Create a task config with defaults */
function makeTask(
  overrides: Partial<SchedulerTaskConfig> & { execute?: () => void } = {},
): SchedulerTaskConfig {
  return {
    priority: RenderPriority.NORMAL,
    layerId: 'layer-1',
    execute: jest.fn(),
    ...overrides,
  };
}

/**
 * Mock performance.now() to return controlled values.
 * Each call increments by `stepMs`.
 */
function mockPerformanceNow(stepMs: number): jest.SpyInstance {
  let now = 1000;
  return jest.spyOn(performance, 'now').mockImplementation(() => {
    const current = now;
    now += stepMs;
    return current;
  });
}

/**
 * Mock performance.now() with a sequence of specific return values.
 * When the sequence is exhausted, returns the last value.
 */
function mockPerformanceSequence(values: number[]): jest.SpyInstance {
  let index = 0;
  return jest.spyOn(performance, 'now').mockImplementation(() => {
    if (index < values.length) {
      return values[index++];
    }
    return values[values.length - 1];
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe('PriorityScheduler', () => {
  let scheduler: PriorityScheduler;

  beforeEach(() => {
    scheduler = new PriorityScheduler();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    scheduler.dispose();
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // 1. Task scheduling and execution via processFrame()
  // ===========================================================================

  describe('task scheduling and execution', () => {
    it('should return a unique task ID when scheduling', () => {
      const id1 = scheduler.schedule(makeTask());
      const id2 = scheduler.schedule(makeTask({ layerId: 'layer-2' }));
      expect(id1).toMatch(/^sched_\d+$/);
      expect(id2).toMatch(/^sched_\d+$/);
      expect(id1).not.toBe(id2);
    });

    it('should execute scheduled tasks when processFrame is called', () => {
      const spy = mockPerformanceNow(0);
      const execute = jest.fn();
      scheduler.schedule(makeTask({ execute }));

      scheduler.processFrame(16);

      expect(execute).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should not execute tasks before processFrame is called', () => {
      const execute = jest.fn();
      scheduler.schedule(makeTask({ execute }));
      expect(execute).not.toHaveBeenCalled();
    });

    it('should clear tasks from queue after execution', () => {
      const spy = mockPerformanceNow(0);
      scheduler.schedule(makeTask());

      expect(scheduler.hasWork()).toBe(true);
      scheduler.processFrame(16);
      expect(scheduler.hasWork()).toBe(false);
      spy.mockRestore();
    });

    it('should handle task execution errors gracefully', () => {
      const spy = mockPerformanceNow(0);
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('task boom');

      const goodTask = jest.fn();
      scheduler.schedule(
        makeTask({
          layerId: 'layer-1',
          execute: () => {
            throw error;
          },
        }),
      );
      scheduler.schedule(
        makeTask({
          layerId: 'layer-2',
          execute: goodTask,
        }),
      );

      scheduler.processFrame(16);

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('[PriorityScheduler]'),
        error,
      );
      // The second task should still execute
      expect(goodTask).toHaveBeenCalledTimes(1);

      consoleError.mockRestore();
      spy.mockRestore();
    });

    it('should not execute cancelled tasks during processFrame', () => {
      const spy = mockPerformanceNow(0);
      const execute = jest.fn();
      scheduler.schedule(
        makeTask({
          layerId: 'layer-1',
          execute,
          priority: RenderPriority.NORMAL,
        }),
      );
      // Cancel it by scheduling a replacement and then cancelling
      // Actually, let's cancel by ID
      const id = scheduler.schedule(
        makeTask({
          layerId: 'layer-2',
          execute,
          priority: RenderPriority.NORMAL,
        }),
      );
      scheduler.cancel(id);

      scheduler.processFrame(16);

      // Only the first task should have executed
      expect(execute).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 2. Priority ordering
  // ===========================================================================

  describe('priority ordering', () => {
    it('should execute CRITICAL tasks before USER_BLOCKING tasks', () => {
      const spy = mockPerformanceNow(0);
      const order: string[] = [];

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub',
          execute: () => order.push('USER_BLOCKING'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit',
          execute: () => order.push('CRITICAL'),
        }),
      );

      scheduler.processFrame(100);

      expect(order[0]).toBe('CRITICAL');
      expect(order[1]).toBe('USER_BLOCKING');
      spy.mockRestore();
    });

    it('should execute tasks in full priority order: CRITICAL > USER_BLOCKING > NORMAL > LOW > IDLE', () => {
      const spy = mockPerformanceNow(0);
      const order: string[] = [];

      // Schedule in reverse order to prove sorting
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'idle',
          execute: () => order.push('IDLE'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.LOW,
          layerId: 'low',
          execute: () => order.push('LOW'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'normal',
          execute: () => order.push('NORMAL'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub',
          execute: () => order.push('USER_BLOCKING'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit',
          execute: () => order.push('CRITICAL'),
        }),
      );

      scheduler.processFrame(100);

      expect(order).toEqual(['CRITICAL', 'USER_BLOCKING', 'NORMAL', 'LOW', 'IDLE']);
      spy.mockRestore();
    });

    it('should execute multiple tasks at the same priority in FIFO order', () => {
      const spy = mockPerformanceNow(0);
      const order: string[] = [];

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'a',
          execute: () => order.push('a'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'b',
          execute: () => order.push('b'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'c',
          execute: () => order.push('c'),
        }),
      );

      scheduler.processFrame(100);

      expect(order).toEqual(['a', 'b', 'c']);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 3. CRITICAL tasks bypass frame budget
  // ===========================================================================

  describe('CRITICAL tasks bypass frame budget', () => {
    it('should execute all CRITICAL tasks even when frame budget is exceeded', () => {
      // Each performance.now() call: frameStart=0, taskStart=0, afterTask=20, ...
      // With a 1ms total budget, CRITICAL tasks should still all run.
      const executions: string[] = [];

      // Each task "takes" 5ms: taskStart -> afterTask increments by 5
      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // task1: taskStart=0, afterTask=5
        0, 5,
        // task2: taskStart=5, afterTask=10
        5, 10,
        // task3: taskStart=10, afterTask=15
        10, 15,
        // frameEnd (for frame time stat)
        15,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit-1',
          execute: () => executions.push('crit-1'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit-2',
          execute: () => executions.push('crit-2'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit-3',
          execute: () => executions.push('crit-3'),
        }),
      );

      // Budget is tiny (1ms) but CRITICAL should still all run
      scheduler.processFrame(1);

      expect(executions).toEqual(['crit-1', 'crit-2', 'crit-3']);
      spy.mockRestore();
    });

    it('should skip non-CRITICAL tasks when budget is exhausted by CRITICAL work', () => {
      const executions: string[] = [];

      // CRITICAL tasks consume all budget, then NORMAL should be skipped
      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // critical task: taskStart=0, afterTask=15
        0, 15,
        // check totalTimeSpent(15) >= budgetMs(12) -> break
        // frameEnd
        15,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit',
          execute: () => executions.push('crit'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'normal',
          execute: () => executions.push('normal'),
        }),
      );

      scheduler.processFrame(12);

      expect(executions).toEqual(['crit']);
      // NORMAL task should still be in queue
      expect(scheduler.hasWork()).toBe(true);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 4. Time-slicing — per-priority budget caps
  // ===========================================================================

  describe('time-slicing', () => {
    it('should stop USER_BLOCKING tasks after 8ms per-priority budget', () => {
      const executions: string[] = [];

      // USER_BLOCKING budget = 8ms
      // Two tasks at 5ms each: first runs (5ms < 8ms), second runs (10ms > 8ms -> break before 3rd)
      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // task1: taskStart=0, afterTask=5
        0, 5,
        // task2: taskStart=5, afterTask=10 (priorityTimeSpent=10 >= 8 -> break before 3rd)
        5, 10,
        // frameEnd
        10,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub-1',
          execute: () => executions.push('ub-1'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub-2',
          execute: () => executions.push('ub-2'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub-3',
          execute: () => executions.push('ub-3'),
        }),
      );

      scheduler.processFrame(100); // generous total budget

      expect(executions).toEqual(['ub-1', 'ub-2']);
      // Third task remains
      expect(scheduler.hasWork()).toBe(true);
      spy.mockRestore();
    });

    it('should stop NORMAL tasks after 4ms per-priority budget', () => {
      const executions: string[] = [];

      // NORMAL budget = 4ms
      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // task1: taskStart=0, afterTask=3
        0, 3,
        // task2: taskStart=3, afterTask=6 (priorityTimeSpent=6 >= 4 -> break)
        3, 6,
        // frameEnd
        6,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n-1',
          execute: () => executions.push('n-1'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n-2',
          execute: () => executions.push('n-2'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n-3',
          execute: () => executions.push('n-3'),
        }),
      );

      scheduler.processFrame(100);

      expect(executions).toEqual(['n-1', 'n-2']);
      spy.mockRestore();
    });

    it('should enforce total frame budget across priorities', () => {
      const executions: string[] = [];

      // Total budget = 12ms
      // USER_BLOCKING runs 2 tasks at 5ms = 10ms, then NORMAL should be budget-capped
      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // UB task1: start=0, end=5
        0, 5,
        // UB task2: start=5, end=10
        5, 10,
        // Now totalTimeSpent=10, budget check for NORMAL: 10 < 12 -> allow
        // NORMAL task1: start=10, end=13 (totalTimeSpent=13 >= 12 -> break after)
        10, 13,
        // totalTimeSpent=13 >= budgetMs=12 -> break out of outer loop
        // frameEnd
        13,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub-1',
          execute: () => executions.push('ub-1'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'ub-2',
          execute: () => executions.push('ub-2'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n-1',
          execute: () => executions.push('n-1'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n-2',
          execute: () => executions.push('n-2'),
        }),
      );

      scheduler.processFrame(12);

      // UB tasks (10ms) + 1 normal task puts us over budget
      expect(executions).toEqual(['ub-1', 'ub-2', 'n-1']);
      spy.mockRestore();
    });

    it('should skip IDLE tasks entirely when total budget is already exhausted', () => {
      const executions: string[] = [];

      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // NORMAL task: start=0, end=14
        0, 14,
        // totalTimeSpent=14 >= budgetMs=12 -> break
        // IDLE is skipped because totalTimeSpent(14) >= budgetMs(12)
        // frameEnd
        14,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'normal',
          execute: () => executions.push('normal'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'idle',
          execute: () => executions.push('idle'),
        }),
      );

      scheduler.processFrame(12);

      expect(executions).toEqual(['normal']);
      expect(scheduler.hasAnyWork()).toBe(true);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 5. Deduplication
  // ===========================================================================

  describe('deduplication', () => {
    it('should deduplicate tasks with same layerId and hintKey', () => {
      const spy = mockPerformanceNow(0);
      const firstExecute = jest.fn();
      const secondExecute = jest.fn();

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'region-A',
          execute: firstExecute,
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'region-A',
          execute: secondExecute,
        }),
      );

      scheduler.processFrame(100);

      // First task replaced by second; only second should execute
      expect(firstExecute).not.toHaveBeenCalled();
      expect(secondExecute).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should NOT deduplicate tasks with same layerId but different hintKey', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'region-A',
          execute: exec1,
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'region-B',
          execute: exec2,
        }),
      );

      scheduler.processFrame(100);

      expect(exec1).toHaveBeenCalledTimes(1);
      expect(exec2).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should NOT deduplicate tasks with same hintKey but different layerId', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-A',
          hintKey: 'same-key',
          execute: exec1,
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-B',
          hintKey: 'same-key',
          execute: exec2,
        }),
      );

      scheduler.processFrame(100);

      expect(exec1).toHaveBeenCalledTimes(1);
      expect(exec2).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should use "all" as default hintKey when none provided', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      // Two tasks with same layerId and no hintKey should deduplicate
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          execute: exec1,
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          execute: exec2,
        }),
      );

      scheduler.processFrame(100);

      expect(exec1).not.toHaveBeenCalled();
      expect(exec2).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should track deduplication count in stats', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'key',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'key',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'layer-1',
          hintKey: 'key',
        }),
      );

      const stats = scheduler.getStats();
      // Second and third schedule both replace existing -> 2 deduplications
      expect(stats.deduplicatedCount).toBe(2);
    });
  });

  // ===========================================================================
  // 6. Cancel by task ID
  // ===========================================================================

  describe('cancel', () => {
    it('should cancel a task by ID so it does not execute', () => {
      const spy = mockPerformanceNow(0);
      const execute = jest.fn();

      const id = scheduler.schedule(
        makeTask({
          layerId: 'layer-1',
          execute,
        }),
      );
      scheduler.cancel(id);
      scheduler.processFrame(100);

      expect(execute).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should remove the cancelled task from the queue', () => {
      const id = scheduler.schedule(makeTask({ layerId: 'layer-1' }));

      expect(scheduler.hasWork()).toBe(true);
      scheduler.cancel(id);
      expect(scheduler.hasWork()).toBe(false);
    });

    it('should be a no-op when cancelling a non-existent task ID', () => {
      scheduler.schedule(makeTask({ layerId: 'layer-1' }));
      // Should not throw
      scheduler.cancel('sched_nonexistent');
      // Original task should still be in queue
      expect(scheduler.hasWork()).toBe(true);
    });

    it('should only cancel the specified task, not others', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      const id1 = scheduler.schedule(
        makeTask({
          layerId: 'layer-1',
          execute: exec1,
        }),
      );
      scheduler.schedule(
        makeTask({
          layerId: 'layer-2',
          execute: exec2,
        }),
      );

      scheduler.cancel(id1);
      scheduler.processFrame(100);

      expect(exec1).not.toHaveBeenCalled();
      expect(exec2).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 7. CancelAll
  // ===========================================================================

  describe('cancelAll', () => {
    it('should cancel all scheduled tasks', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();
      const exec3 = jest.fn();

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'l1',
          execute: exec1,
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l2',
          execute: exec2,
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'l3',
          execute: exec3,
        }),
      );

      scheduler.cancelAll();
      scheduler.processFrame(100);

      expect(exec1).not.toHaveBeenCalled();
      expect(exec2).not.toHaveBeenCalled();
      expect(exec3).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should empty all queues', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'l1',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l2',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'l3',
        }),
      );

      scheduler.cancelAll();

      expect(scheduler.hasWork()).toBe(false);
      expect(scheduler.hasAnyWork()).toBe(false);
    });

    it('should mark all tasks as cancelled', () => {
      const spy = mockPerformanceNow(0);

      // Schedule then cancelAll, then re-add. Only re-added should run.
      const original = jest.fn();
      const fresh = jest.fn();

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l1',
          execute: original,
        }),
      );
      scheduler.cancelAll();
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l2',
          execute: fresh,
        }),
      );

      scheduler.processFrame(100);

      expect(original).not.toHaveBeenCalled();
      expect(fresh).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 8. Flush
  // ===========================================================================

  describe('flush', () => {
    it('should execute all tasks synchronously', () => {
      const order: string[] = [];

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'idle',
          execute: () => order.push('idle'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'crit',
          execute: () => order.push('crit'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'normal',
          execute: () => order.push('normal'),
        }),
      );

      scheduler.flush();

      // Flush respects priority order
      expect(order).toEqual(['crit', 'normal', 'idle']);
    });

    it('should ignore budgets during flush', () => {
      // Even with many tasks, flush executes them all
      const executions: string[] = [];
      for (let i = 0; i < 100; i++) {
        scheduler.schedule(
          makeTask({
            priority: RenderPriority.NORMAL,
            layerId: `layer-${i}`,
            execute: () => executions.push(`task-${i}`),
          }),
        );
      }

      scheduler.flush();

      expect(executions).toHaveLength(100);
    });

    it('should clear all queues after flush', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'l1',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l2',
        }),
      );

      scheduler.flush();

      expect(scheduler.hasWork()).toBe(false);
      expect(scheduler.hasAnyWork()).toBe(false);
    });

    it('should not execute cancelled tasks during flush', () => {
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      const id = scheduler.schedule(
        makeTask({
          layerId: 'l1',
          execute: exec1,
        }),
      );
      scheduler.schedule(
        makeTask({
          layerId: 'l2',
          execute: exec2,
        }),
      );

      scheduler.cancel(id);
      scheduler.flush();

      // Cancelled task's execute is skipped (it's still in the queue entries
      // snapshot if cancel removed it from the map, but flush iterates the map)
      // Actually, cancel() removes from the map, so flush won't see it
      expect(exec1).not.toHaveBeenCalled();
      expect(exec2).toHaveBeenCalledTimes(1);
    });

    it('should increment totalProcessed for flushed tasks', () => {
      const spy = mockPerformanceNow(0);

      scheduler.schedule(makeTask({ layerId: 'l1' }));
      scheduler.schedule(makeTask({ layerId: 'l2' }));
      scheduler.schedule(makeTask({ layerId: 'l3' }));

      scheduler.flush();

      expect(scheduler.getStats().totalProcessed).toBe(3);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 9. Pause / Resume
  // ===========================================================================

  describe('pause and resume', () => {
    it('should skip processFrame when paused', () => {
      const spy = mockPerformanceNow(0);
      const execute = jest.fn();

      scheduler.schedule(makeTask({ execute }));
      scheduler.pause();

      const timeSpent = scheduler.processFrame(100);

      expect(execute).not.toHaveBeenCalled();
      expect(timeSpent).toBe(0);
      spy.mockRestore();
    });

    it('should report isPaused correctly', () => {
      expect(scheduler.isPaused()).toBe(false);

      scheduler.pause();
      expect(scheduler.isPaused()).toBe(true);

      scheduler.resume();
      expect(scheduler.isPaused()).toBe(false);
    });

    it('should execute tasks after resume', () => {
      const spy = mockPerformanceNow(0);
      const execute = jest.fn();

      scheduler.schedule(makeTask({ execute }));
      scheduler.pause();
      scheduler.processFrame(100);
      expect(execute).not.toHaveBeenCalled();

      scheduler.resume();
      scheduler.processFrame(100);
      expect(execute).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should retain tasks in queue while paused', () => {
      scheduler.schedule(makeTask({ layerId: 'l1' }));
      scheduler.pause();

      expect(scheduler.hasWork()).toBe(true);

      scheduler.processFrame(100);
      // Tasks should still be there after paused processFrame
      expect(scheduler.hasWork()).toBe(true);
    });

    it('should allow scheduling new tasks while paused', () => {
      scheduler.pause();
      scheduler.schedule(makeTask({ layerId: 'l1' }));
      expect(scheduler.hasWork()).toBe(true);
    });
  });

  // ===========================================================================
  // 10. Stats
  // ===========================================================================

  describe('stats', () => {
    it('should report queue depths per priority', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'c1',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'c2',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n1',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'i1',
        }),
      );

      const stats = scheduler.getStats();
      expect(stats.queueDepths[RenderPriority.CRITICAL]).toBe(2);
      expect(stats.queueDepths[RenderPriority.USER_BLOCKING]).toBe(0);
      expect(stats.queueDepths[RenderPriority.NORMAL]).toBe(1);
      expect(stats.queueDepths[RenderPriority.LOW]).toBe(0);
      expect(stats.queueDepths[RenderPriority.IDLE]).toBe(1);
    });

    it('should track totalProcessed across multiple frames', () => {
      const spy = mockPerformanceNow(0);

      scheduler.schedule(makeTask({ layerId: 'l1' }));
      scheduler.schedule(makeTask({ layerId: 'l2' }));
      scheduler.processFrame(100);

      scheduler.schedule(makeTask({ layerId: 'l3' }));
      scheduler.processFrame(100);

      expect(scheduler.getStats().totalProcessed).toBe(3);
      spy.mockRestore();
    });

    it('should report deduplication count', () => {
      // Schedule same layerId+hintKey 5 times: 4 deduplications
      for (let i = 0; i < 5; i++) {
        scheduler.schedule(
          makeTask({
            priority: RenderPriority.NORMAL,
            layerId: 'layer',
            hintKey: 'key',
          }),
        );
      }

      expect(scheduler.getStats().deduplicatedCount).toBe(4);
    });

    it('should track frame times and compute averageFrameTime', () => {
      // Simulate 3 frames with known durations
      const spy = mockPerformanceSequence([
        // Frame 1: start=0, end=5
        0, 5,
        // Frame 2: start=10, end=18
        10, 18,
        // Frame 3: start=20, end=23
        20, 23,
      ]);

      // Frame 1 (no tasks, just stats)
      scheduler.processFrame(100);
      // Frame 2
      scheduler.processFrame(100);
      // Frame 3
      scheduler.processFrame(100);

      const stats = scheduler.getStats();
      // Frame times: 5, 8, 3 => avg = (5+8+3)/3 ≈ 5.33
      expect(stats.averageFrameTime).toBeCloseTo(5.33, 1);
      spy.mockRestore();
    });

    it('should track maxFrameTime', () => {
      const spy = mockPerformanceSequence([
        // Frame 1: 3ms
        0, 3,
        // Frame 2: 10ms
        10, 20,
        // Frame 3: 2ms
        30, 32,
      ]);

      scheduler.processFrame(100);
      scheduler.processFrame(100);
      scheduler.processFrame(100);

      expect(scheduler.getStats().maxFrameTime).toBe(10);
      spy.mockRestore();
    });

    it('should report fps based on average frame time', () => {
      // With all zero-time frames, avg=0, fps should be 60 (default)
      const spy = mockPerformanceNow(0);

      for (let i = 0; i < 10; i++) {
        scheduler.processFrame(100);
      }

      expect(scheduler.getStats().fps).toBe(60);
      spy.mockRestore();
    });

    it('should report initial stats when no frames processed', () => {
      const stats = scheduler.getStats();

      expect(stats.totalProcessed).toBe(0);
      expect(stats.averageFrameTime).toBe(0);
      expect(stats.maxFrameTime).toBe(0);
      expect(stats.fps).toBe(60);
      expect(stats.deduplicatedCount).toBe(0);
    });
  });

  // ===========================================================================
  // 11. Dynamic shedding
  // ===========================================================================

  describe('dynamic shedding', () => {
    it('should start with shedding inactive', () => {
      expect(scheduler.isSheddingActive()).toBe(false);
    });

    it('should activate shedding when rolling average exceeds 12ms', () => {
      // Need 10 frames (ROLLING_WINDOW) with avg > 12ms (SHEDDING_TRIGGER_MS)
      // Each frame takes 15ms
      const times: number[] = [];
      let t = 0;
      for (let i = 0; i < 10; i++) {
        times.push(t); // frameStart
        t += 15;
        times.push(t); // frameEnd
      }
      const spy = mockPerformanceSequence(times);

      for (let i = 0; i < 10; i++) {
        scheduler.processFrame(100);
      }

      expect(scheduler.isSheddingActive()).toBe(true);
      spy.mockRestore();
    });

    it('should skip LOW tasks when shedding is active', () => {
      const executions: string[] = [];

      // First: activate shedding with 10 heavy frames
      const heavyTimes: number[] = [];
      let t = 0;
      for (let i = 0; i < 10; i++) {
        heavyTimes.push(t);
        t += 15;
        heavyTimes.push(t);
      }
      // Then one more frame where we check LOW is skipped
      // Frame 11: start, NORMAL task (start, end), LOW task should be skipped, frameEnd
      heavyTimes.push(t); // frameStart
      heavyTimes.push(t); // task NORMAL start
      heavyTimes.push(t); // task NORMAL end (0ms)
      heavyTimes.push(t); // frameEnd

      const spy = mockPerformanceSequence(heavyTimes);

      // Run 10 frames to trigger shedding
      for (let i = 0; i < 10; i++) {
        scheduler.processFrame(100);
      }
      expect(scheduler.isSheddingActive()).toBe(true);

      // Now schedule LOW and NORMAL tasks
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'normal',
          execute: () => executions.push('normal'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.LOW,
          layerId: 'low',
          execute: () => executions.push('low'),
        }),
      );

      scheduler.processFrame(100);

      // NORMAL should execute, LOW should be skipped
      expect(executions).toContain('normal');
      expect(executions).not.toContain('low');
      // LOW task remains in queue
      expect(scheduler.hasAnyWork()).toBe(true);
      spy.mockRestore();
    });

    it('should recover from shedding after 30 consecutive good frames', () => {
      // Activate shedding first
      const times: number[] = [];
      let t = 0;

      // 10 heavy frames to activate shedding
      for (let i = 0; i < 10; i++) {
        times.push(t);
        t += 15;
        times.push(t);
      }

      // 30 good frames (each < 10ms = SHEDDING_RECOVERY_MS) to recover
      for (let i = 0; i < 30; i++) {
        times.push(t);
        t += 5; // 5ms < 10ms recovery threshold
        times.push(t);
      }

      const spy = mockPerformanceSequence(times);

      // Trigger shedding
      for (let i = 0; i < 10; i++) {
        scheduler.processFrame(100);
      }
      expect(scheduler.isSheddingActive()).toBe(true);

      // Recover
      for (let i = 0; i < 30; i++) {
        scheduler.processFrame(100);
      }
      expect(scheduler.isSheddingActive()).toBe(false);
      spy.mockRestore();
    });

    it('should reset recovery counter on a bad frame during recovery', () => {
      const times: number[] = [];
      let t = 0;

      // 10 heavy frames to activate shedding
      for (let i = 0; i < 10; i++) {
        times.push(t);
        t += 15;
        times.push(t);
      }

      // 29 good frames (not enough to recover)
      for (let i = 0; i < 29; i++) {
        times.push(t);
        t += 5;
        times.push(t);
      }

      // 1 bad frame (resets counter)
      times.push(t);
      t += 15;
      times.push(t);

      // 29 more good frames (still not enough because counter reset)
      for (let i = 0; i < 29; i++) {
        times.push(t);
        t += 5;
        times.push(t);
      }

      const spy = mockPerformanceSequence(times);

      // Trigger shedding
      for (let i = 0; i < 10; i++) {
        scheduler.processFrame(100);
      }
      expect(scheduler.isSheddingActive()).toBe(true);

      // 29 good frames
      for (let i = 0; i < 29; i++) {
        scheduler.processFrame(100);
      }
      expect(scheduler.isSheddingActive()).toBe(true);

      // 1 bad frame resets counter
      scheduler.processFrame(100);
      expect(scheduler.isSheddingActive()).toBe(true);

      // 29 more good frames (total 29 since reset, need 30)
      for (let i = 0; i < 29; i++) {
        scheduler.processFrame(100);
      }
      expect(scheduler.isSheddingActive()).toBe(true);

      spy.mockRestore();
    });

    it('should not activate shedding before rolling window is full', () => {
      // Only 9 frames (ROLLING_WINDOW = 10), even with high times
      const times: number[] = [];
      let t = 0;
      for (let i = 0; i < 9; i++) {
        times.push(t);
        t += 20;
        times.push(t);
      }
      const spy = mockPerformanceSequence(times);

      for (let i = 0; i < 9; i++) {
        scheduler.processFrame(100);
      }

      expect(scheduler.isSheddingActive()).toBe(false);
      spy.mockRestore();
    });
  });

  // ===========================================================================
  // 12. hasWork / hasAnyWork
  // ===========================================================================

  describe('hasWork and hasAnyWork', () => {
    it('should return false when no tasks are scheduled', () => {
      expect(scheduler.hasWork()).toBe(false);
      expect(scheduler.hasAnyWork()).toBe(false);
    });

    it('hasWork should return true for non-IDLE tasks', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.CRITICAL,
          layerId: 'l1',
        }),
      );
      expect(scheduler.hasWork()).toBe(true);
      expect(scheduler.hasAnyWork()).toBe(true);
    });

    it('hasWork should return false when only IDLE tasks exist', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'l1',
        }),
      );

      expect(scheduler.hasWork()).toBe(false);
      expect(scheduler.hasAnyWork()).toBe(true);
    });

    it('hasWork should return true for USER_BLOCKING tasks', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.USER_BLOCKING,
          layerId: 'l1',
        }),
      );
      expect(scheduler.hasWork()).toBe(true);
    });

    it('hasWork should return true for NORMAL tasks', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l1',
        }),
      );
      expect(scheduler.hasWork()).toBe(true);
    });

    it('hasWork should return true for LOW tasks', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.LOW,
          layerId: 'l1',
        }),
      );
      expect(scheduler.hasWork()).toBe(true);
    });

    it('should update after processFrame clears tasks', () => {
      const spy = mockPerformanceNow(0);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l1',
        }),
      );
      expect(scheduler.hasWork()).toBe(true);

      scheduler.processFrame(100);
      expect(scheduler.hasWork()).toBe(false);
      spy.mockRestore();
    });

    it('should update after cancel removes a task', () => {
      const id = scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'l1',
        }),
      );
      expect(scheduler.hasWork()).toBe(true);

      scheduler.cancel(id);
      expect(scheduler.hasWork()).toBe(false);
    });

    it('should distinguish IDLE-only from mixed queues', () => {
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'idle-1',
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'idle-2',
        }),
      );

      expect(scheduler.hasWork()).toBe(false);
      expect(scheduler.hasAnyWork()).toBe(true);

      // Add a NORMAL task
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'normal',
        }),
      );

      expect(scheduler.hasWork()).toBe(true);
      expect(scheduler.hasAnyWork()).toBe(true);
    });
  });

  // ===========================================================================
  // Additional edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should return 0 time spent when no tasks are queued', () => {
      const spy = mockPerformanceNow(0);
      const result = scheduler.processFrame(100);
      expect(result).toBe(0);
      spy.mockRestore();
    });

    it('dispose should cancel all tasks', () => {
      const spy = mockPerformanceNow(0);
      const execute = jest.fn();

      scheduler.schedule(makeTask({ layerId: 'l1', execute }));
      scheduler.schedule(makeTask({ layerId: 'l2', execute }));

      scheduler.dispose();

      expect(scheduler.hasWork()).toBe(false);
      expect(scheduler.hasAnyWork()).toBe(false);
      spy.mockRestore();
    });

    it('processFrame with default budget should use 12ms', () => {
      // Schedule a task that "takes" 14ms. With default budget (12ms),
      // the first NORMAL task runs (budget check happens BEFORE execution
      // for non-CRITICAL tasks: totalTimeSpent(0) < budgetMs(12) -> allow),
      // then second NORMAL task is skipped (totalTimeSpent(14) >= 12).
      const executions: string[] = [];
      const spy = mockPerformanceSequence([
        // frameStart
        0,
        // task1: start=0, end=14
        0, 14,
        // totalTimeSpent=14 >= 12 -> break
        // frameEnd
        14,
      ]);

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n1',
          execute: () => executions.push('n1'),
        }),
      );
      scheduler.schedule(
        makeTask({
          priority: RenderPriority.NORMAL,
          layerId: 'n2',
          execute: () => executions.push('n2'),
        }),
      );

      scheduler.processFrame(); // default budget

      expect(executions).toEqual(['n1']);
      spy.mockRestore();
    });

    it('should handle rapid schedule-cancel-schedule cycles', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      const id1 = scheduler.schedule(
        makeTask({
          layerId: 'l1',
          hintKey: 'key',
          execute: exec1,
        }),
      );
      scheduler.cancel(id1);

      scheduler.schedule(
        makeTask({
          layerId: 'l1',
          hintKey: 'key',
          execute: exec2,
        }),
      );

      scheduler.processFrame(100);

      expect(exec1).not.toHaveBeenCalled();
      expect(exec2).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should allow new tasks to be scheduled after processFrame', () => {
      const spy = mockPerformanceNow(0);
      const exec1 = jest.fn();
      const exec2 = jest.fn();

      scheduler.schedule(makeTask({ layerId: 'l1', execute: exec1 }));
      scheduler.processFrame(100);

      scheduler.schedule(makeTask({ layerId: 'l2', execute: exec2 }));
      scheduler.processFrame(100);

      expect(exec1).toHaveBeenCalledTimes(1);
      expect(exec2).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should process IDLE tasks only when budget remains', () => {
      const spy = mockPerformanceNow(0);
      const idleExec = jest.fn();

      scheduler.schedule(
        makeTask({
          priority: RenderPriority.IDLE,
          layerId: 'idle',
          execute: idleExec,
        }),
      );

      // With generous budget and zero-time tasks, IDLE should run
      scheduler.processFrame(100);

      expect(idleExec).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should handle scheduling across all priority levels simultaneously', () => {
      const spy = mockPerformanceNow(0);
      const executions: RenderPriority[] = [];

      const priorities = [
        RenderPriority.CRITICAL,
        RenderPriority.USER_BLOCKING,
        RenderPriority.NORMAL,
        RenderPriority.LOW,
        RenderPriority.IDLE,
      ];

      for (const p of priorities) {
        scheduler.schedule(
          makeTask({
            priority: p,
            layerId: `layer-${p}`,
            execute: () => executions.push(p),
          }),
        );
      }

      scheduler.processFrame(100);

      expect(executions).toEqual([
        RenderPriority.CRITICAL,
        RenderPriority.USER_BLOCKING,
        RenderPriority.NORMAL,
        RenderPriority.LOW,
        RenderPriority.IDLE,
      ]);
      spy.mockRestore();
    });
  });
});
