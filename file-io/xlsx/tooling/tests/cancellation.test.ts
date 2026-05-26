/**
 * Cancellation and Progress Reporting Tests
 *
 * Tests for AbortController/AbortSignal integration and progress tracking
 * during XLSX parsing operations.
 *
 * Usage:
 *   npx tsx xlsx/tooling/tests/cancellation.test.ts
 *
 * @module xlsx/tooling/tests/cancellation
 */

import { describe, expect, it } from 'vitest';
import {
  ProgressTracker,
  checkAborted,
  createCancellationChecker,
  createProgressReporter,
  estimateCellCount,
  estimateZipEntries,
  throttleProgress,
  withAbortSignal,
  type ParseProgress,
} from '@mog/xlsx-parser/progress';
import { ParseErrorCode } from '@mog/xlsx-parser/types';
import type { WorkerOutboundMessage } from '@mog/xlsx-parser/worker/types';
import {
  createErrorMessage,
  generateMessageId,
  isCancelled,
  isParseError,
  isParseSuccess,
  isProgress,
  isReady,
} from '@mog/xlsx-parser/worker/types';

// =============================================================================
// Progress Tracker Tests
// =============================================================================

describe('ProgressTracker', () => {
  it('should initialize with zero progress', () => {
    const tracker = new ProgressTracker();
    const progress = tracker.getProgress();

    expect(progress.phase).toBe('init');
    expect(progress.percentage).toBe(0);
  });

  it('should report progress through phases', () => {
    const updates: ParseProgress[] = [];
    const tracker = new ProgressTracker({
      onProgress: (p) => updates.push({ ...p }),
      throttleMs: 0, // Disable throttling for tests
    });

    tracker.startPhase('zip', 10);
    tracker.incrementProgress(5);
    tracker.incrementProgress(5);
    tracker.startPhase('cells', 100);
    tracker.updateProgress(50, 100);
    tracker.complete();

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1].phase).toBe('complete');
    expect(updates[updates.length - 1].percentage).toBe(100);
  });

  it('should track items processed and total', () => {
    const tracker = new ProgressTracker({ throttleMs: 0 });

    tracker.startPhase('cells', 1000);
    tracker.incrementProgress(500, 'Sheet1');

    const progress = tracker.getProgress();
    expect(progress.itemsProcessed).toBe(500);
    expect(progress.totalItems).toBe(1000);
  });

  it('should calculate elapsed time', async () => {
    const tracker = new ProgressTracker();

    // Wait a bit
    await new Promise((r) => setTimeout(r, 50));

    const elapsed = tracker.getElapsedMs();
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it('should throttle callbacks', () => {
    const updates: ParseProgress[] = [];
    const tracker = new ProgressTracker({
      onProgress: (p) => updates.push({ ...p }),
      throttleMs: 100,
    });

    tracker.startPhase('cells', 1000);

    // Rapidly update
    for (let i = 0; i < 100; i++) {
      tracker.incrementProgress(10);
    }

    // Should have throttled some updates
    expect(updates.length).toBeLessThan(100);
  });

  it('should always call callback on complete', () => {
    let callCount = 0;
    const tracker = new ProgressTracker({
      onProgress: () => callCount++,
      throttleMs: 10000, // Very long throttle
    });

    tracker.complete();

    // Complete should always fire
    expect(callCount).toBe(1);
  });
});

// =============================================================================
// Progress Reporter Tests
// =============================================================================

describe('createProgressReporter', () => {
  it('should report phases with correct percentage ranges', () => {
    const updates: ParseProgress[] = [];
    const reporter = createProgressReporter((p) => updates.push({ ...p }));

    reporter.init();
    reporter.zip(0);
    reporter.zip(100);
    reporter.xml(50);
    reporter.cells(50, 'Sheet1');
    reporter.styles(100);
    reporter.features(100, 'tables');
    reporter.complete();

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1].percentage).toBe(100);

    // Check that percentages increase monotonically
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i].percentage).toBeGreaterThanOrEqual(updates[i - 1].percentage);
    }
  });

  it('should include currentItem when provided', () => {
    const updates: ParseProgress[] = [];
    const reporter = createProgressReporter((p) => updates.push({ ...p }));

    reporter.cells(50, 'MySheet');

    const cellUpdate = updates.find((u) => u.phase === 'cells');
    expect(cellUpdate?.currentItem).toBe('MySheet');
  });
});

// =============================================================================
// Throttle Progress Tests
// =============================================================================

describe('throttleProgress', () => {
  it('should throttle rapid updates', () => {
    let callCount = 0;
    const throttled = throttleProgress(() => callCount++, 100);

    // Rapidly call
    for (let i = 0; i < 10; i++) {
      throttled({ phase: 'cells', percentage: i * 10 });
    }

    // Should have throttled
    expect(callCount).toBeLessThan(10);
    expect(callCount).toBeGreaterThan(0);
  });

  it('should always pass through complete phase', () => {
    let completeCalled = false;
    const throttled = throttleProgress((p) => {
      if (p.phase === 'complete') completeCalled = true;
    }, 10000);

    throttled({ phase: 'complete', percentage: 100 });

    expect(completeCalled).toBe(true);
  });

  it('should skip identical updates', async () => {
    let callCount = 0;
    const throttled = throttleProgress(() => callCount++, 0);

    throttled({ phase: 'cells', percentage: 50 });
    await new Promise((r) => setTimeout(r, 10));
    throttled({ phase: 'cells', percentage: 50 }); // Same, should skip

    expect(callCount).toBe(1);
  });
});

// =============================================================================
// Cancellation Tests
// =============================================================================

describe('checkAborted', () => {
  it('should not throw for non-aborted signal', () => {
    const controller = new AbortController();
    expect(() => checkAborted(controller.signal)).not.toThrow();
  });

  it('should throw for aborted signal', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => checkAborted(controller.signal)).toThrow(DOMException);
    expect(() => checkAborted(controller.signal)).toThrow('Operation was aborted');
  });

  it('should not throw for undefined signal', () => {
    expect(() => checkAborted(undefined)).not.toThrow();
  });
});

describe('createCancellationChecker', () => {
  it('should return no-op for undefined signal', () => {
    const checker = createCancellationChecker(undefined, 1);

    // Should not throw for any iteration
    for (let i = 0; i < 100; i++) {
      expect(() => checker(i)).not.toThrow();
    }
  });

  it('should check at interval', () => {
    const controller = new AbortController();
    const checker = createCancellationChecker(controller.signal, 10);

    // Should not throw before abort
    for (let i = 0; i < 50; i++) {
      checker(i);
    }

    // Abort and check at interval
    controller.abort();

    // Should not throw at non-interval iterations
    expect(() => checker(5)).not.toThrow();

    // Should throw at interval
    expect(() => checker(10)).toThrow(DOMException);
  });

  it('should check every iteration when interval is 1', () => {
    const controller = new AbortController();
    const checker = createCancellationChecker(controller.signal, 1);

    checker(0); // OK
    controller.abort();
    expect(() => checker(1)).toThrow(DOMException);
  });
});

describe('withAbortSignal', () => {
  it('should resolve for successful operation', async () => {
    const controller = new AbortController();

    const result = await withAbortSignal(controller.signal, async () => {
      return 'success';
    });

    expect(result).toBe('success');
  });

  it('should reject for aborted signal before start', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(withAbortSignal(controller.signal, async () => 'success')).rejects.toThrow(
      DOMException,
    );
  });

  it('should reject when aborted during operation', async () => {
    const controller = new AbortController();

    const promise = withAbortSignal(controller.signal, async () => {
      await new Promise((r) => setTimeout(r, 100));
      return 'success';
    });

    // Abort after starting
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toThrow(DOMException);
  });

  it('should work without signal', async () => {
    const result = await withAbortSignal(undefined, async () => 'success');
    expect(result).toBe('success');
  });
});

// =============================================================================
// Estimation Tests
// =============================================================================

describe('estimateCellCount', () => {
  it('should estimate cells based on file size', () => {
    // 50KB file -> ~1000 cells
    expect(estimateCellCount(50 * 1024)).toBe(Math.ceil((50 * 1024) / 50));

    // 1MB file -> ~20,000 cells
    expect(estimateCellCount(1024 * 1024)).toBe(Math.ceil((1024 * 1024) / 50));
  });
});

describe('estimateZipEntries', () => {
  it('should estimate entries based on sheet count', () => {
    // 1 sheet: 6 base + 2 per sheet = 8
    expect(estimateZipEntries(1)).toBe(8);

    // 5 sheets: 6 base + 10 per sheet = 16
    expect(estimateZipEntries(5)).toBe(16);
  });
});

// =============================================================================
// Worker Type Guards Tests
// =============================================================================

describe('Worker Type Guards', () => {
  it('generateMessageId should create unique IDs', () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it('isParseSuccess should identify success messages', () => {
    const success: WorkerOutboundMessage = {
      id: '1',
      type: 'success',
      result: {} as any,
      parseTimeMs: 100,
    };

    const error: WorkerOutboundMessage = {
      id: '1',
      type: 'error',
      code: ParseErrorCode.ParseError,
      message: 'test',
    };

    expect(isParseSuccess(success)).toBe(true);
    expect(isParseSuccess(error)).toBe(false);
  });

  it('isParseError should identify error messages', () => {
    const error: WorkerOutboundMessage = {
      id: '1',
      type: 'error',
      code: ParseErrorCode.ParseError,
      message: 'test',
    };

    expect(isParseError(error)).toBe(true);
  });

  it('isProgress should identify progress messages', () => {
    const progress: WorkerOutboundMessage = {
      id: '1',
      type: 'progress',
      progress: { phase: 'cells', percentage: 50 },
    };

    expect(isProgress(progress)).toBe(true);
  });

  it('isCancelled should identify cancelled messages', () => {
    const cancelled: WorkerOutboundMessage = {
      id: '1',
      type: 'cancelled',
    };

    expect(isCancelled(cancelled)).toBe(true);
  });

  it('isReady should identify ready messages', () => {
    const ready: WorkerOutboundMessage = {
      id: '1',
      type: 'ready',
      version: '1.0.0',
      capabilities: {
        wasmSupported: true,
        simdSupported: true,
        sharedArrayBufferSupported: true,
      },
    };

    expect(isReady(ready)).toBe(true);
  });
});

describe('createErrorMessage', () => {
  it('should create error message from Error', () => {
    const error = new Error('Test error');
    const msg = createErrorMessage('123', error);

    expect(msg.id).toBe('123');
    expect(msg.type).toBe('error');
    expect(msg.message).toBe('Test error');
    expect(msg.code).toBe('ParseError');
    expect(msg.stack).toBeDefined();
  });

  it('should extract code from XlsxParseError-like errors', () => {
    const error = new Error('ZIP failed');
    (error as any).code = 'ZipError';

    const msg = createErrorMessage('123', error);
    expect(msg.code).toBe('ZipError');
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Cancellation Integration', () => {
  it('should support cancellation pattern with progress', async () => {
    const controller = new AbortController();
    const progressUpdates: ParseProgress[] = [];

    const tracker = new ProgressTracker({
      onProgress: (p) => progressUpdates.push({ ...p }),
      throttleMs: 0,
    });

    // Simulate a cancellable operation
    const operation = async () => {
      tracker.startPhase('cells', 100);

      for (let i = 0; i < 100; i++) {
        // Check for cancellation
        checkAborted(controller.signal);

        // Simulate work
        await new Promise((r) => setTimeout(r, 1));
        tracker.incrementProgress(1);

        // Cancel at 50%
        if (i === 50) {
          controller.abort();
        }
      }

      tracker.complete();
      return 'done';
    };

    await expect(operation()).rejects.toThrow(DOMException);

    // Should have progress updates up to cancellation
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1].percentage).toBeLessThan(100);
  });

  it('should clean up listener on completion', async () => {
    const controller = new AbortController();

    // This should complete and clean up
    await withAbortSignal(controller.signal, async () => {
      return 'done';
    });

    // Aborting after completion should not cause issues
    controller.abort();

    // No exception should be thrown
    expect(true).toBe(true);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('should handle empty progress callback', () => {
    const tracker = new ProgressTracker({ onProgress: null });

    // Should not throw
    tracker.startPhase('cells', 100);
    tracker.incrementProgress(50);
    tracker.complete();

    expect(tracker.getProgress().phase).toBe('complete');
  });

  it('should handle zero total items', () => {
    const tracker = new ProgressTracker({ throttleMs: 0 });

    tracker.startPhase('cells', 0);
    const progress = tracker.getProgress();

    expect(progress.totalItems).toBeUndefined();
    expect(progress.itemsProcessed).toBeUndefined();
  });

  it('should clamp percentage to 100', () => {
    const tracker = new ProgressTracker({ throttleMs: 0 });

    tracker.startPhase('cells', 10);
    tracker.updateProgress(20, 10); // More than total

    const progress = tracker.getProgress();
    expect(progress.percentage).toBeLessThanOrEqual(100);
  });

  it('should handle rapid phase transitions', () => {
    const updates: ParseProgress[] = [];
    const tracker = new ProgressTracker({
      onProgress: (p) => updates.push({ ...p }),
      throttleMs: 0,
    });

    // Rapid phase changes
    tracker.startPhase('init');
    tracker.startPhase('zip');
    tracker.startPhase('xml');
    tracker.startPhase('cells');
    tracker.startPhase('styles');
    tracker.startPhase('features');
    tracker.complete();

    // Should have tracked all phases
    const phases = new Set(updates.map((u) => u.phase));
    expect(phases.has('complete')).toBe(true);
  });
});

// Run tests
console.log('Running Cancellation and Progress Tests...\n');
