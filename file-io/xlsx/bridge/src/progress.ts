/**
 * Progress Tracking Utilities for XLSX Parsing
 *
 * This module provides utilities for tracking and reporting progress
 * during XLSX file parsing operations. It supports:
 *
 * - Phase-based progress reporting (zip, xml, cells, styles, features)
 * - Accurate progress calculation based on item counts
 * - Throttled progress callbacks to avoid performance overhead
 * - Integration with Web Workers via postMessage
 *
 * @module xlsx-parser/progress
 */

// =============================================================================
// Progress Types
// =============================================================================

/**
 * Parsing phases in order of execution.
 */
export type ParsePhase = 'init' | 'zip' | 'xml' | 'cells' | 'styles' | 'features' | 'complete';

/**
 * Progress state during parsing operations.
 */
export interface ParseProgress {
  /** Current phase of parsing */
  phase: ParsePhase;
  /** Overall percentage complete (0-100) */
  percentage: number;
  /** Current item being processed (e.g., sheet name, feature type) */
  currentItem?: string;
  /** Number of items processed in current phase */
  itemsProcessed?: number;
  /** Total items to process in current phase */
  totalItems?: number;
  /** Elapsed time in milliseconds */
  elapsedMs?: number;
  /** Estimated time remaining in milliseconds */
  estimatedRemainingMs?: number;
}

/**
 * Callback function for progress updates.
 */
export type ProgressCallback = (progress: ParseProgress) => void;

// =============================================================================
// Phase Weight Configuration
// =============================================================================

/**
 * Weight distribution for each phase (must sum to 100).
 * Based on typical parse time distribution:
 * - ZIP decompression: ~15% of total time
 * - XML parsing: ~25% of total time
 * - Cell processing: ~40% of total time
 * - Style processing: ~10% of total time
 * - Feature processing: ~10% of total time
 */
export const PHASE_WEIGHTS: Record<ParsePhase, { start: number; weight: number }> = {
  init: { start: 0, weight: 2 },
  zip: { start: 2, weight: 13 },
  xml: { start: 15, weight: 25 },
  cells: { start: 40, weight: 40 },
  styles: { start: 80, weight: 10 },
  features: { start: 90, weight: 9 },
  complete: { start: 100, weight: 0 },
};

// =============================================================================
// Progress Tracker Class
// =============================================================================

/**
 * Tracks and reports parsing progress.
 *
 * This class provides accurate progress tracking by:
 * 1. Dividing the parse into weighted phases
 * 2. Tracking item counts within each phase
 * 3. Throttling callbacks to avoid excessive updates
 * 4. Calculating time estimates based on current rate
 *
 * @example
 * ```typescript
 * const tracker = new ProgressTracker({
 *   onProgress: (p) => console.log(`${p.percentage}%: ${p.phase}`),
 *   throttleMs: 50
 * });
 *
 * tracker.startPhase('zip');
 * tracker.setTotalItems(10);
 *
 * for (let i = 0; i < 10; i++) {
 *   await processEntry(i);
 *   tracker.incrementProgress(1, `Entry ${i}`);
 * }
 *
 * tracker.complete();
 * ```
 */
export class ProgressTracker {
  private readonly callback: ProgressCallback | null;
  private readonly throttleMs: number;
  private readonly startTime: number;

  private currentPhase: ParsePhase = 'init';
  private itemsProcessed = 0;
  private totalItems = 0;
  private lastCallbackTime = 0;
  private lastProgress: ParseProgress | null = null;

  /**
   * Create a new progress tracker.
   *
   * @param options - Tracker configuration
   */
  constructor(
    options: {
      /** Callback invoked on progress updates */
      onProgress?: ProgressCallback | null;
      /** Minimum milliseconds between callbacks (default: 16ms for 60fps) */
      throttleMs?: number;
    } = {},
  ) {
    this.callback = options.onProgress ?? null;
    this.throttleMs = options.throttleMs ?? 16;
    this.startTime = performance.now();
  }

  /**
   * Start a new parsing phase.
   *
   * @param phase - The phase to start
   * @param totalItems - Optional total items for this phase
   */
  startPhase(phase: ParsePhase, totalItems?: number): void {
    this.currentPhase = phase;
    this.itemsProcessed = 0;
    this.totalItems = totalItems ?? 0;
    this.reportProgress();
  }

  /**
   * Set the total number of items for the current phase.
   *
   * @param total - Total items to process
   */
  setTotalItems(total: number): void {
    this.totalItems = total;
  }

  /**
   * Increment progress within the current phase.
   *
   * @param count - Number of items completed (default: 1)
   * @param currentItem - Optional description of current item
   */
  incrementProgress(count = 1, currentItem?: string): void {
    this.itemsProcessed += count;
    this.reportProgress(currentItem);
  }

  /**
   * Update progress with absolute values.
   *
   * @param processed - Number of items processed
   * @param total - Total items to process
   * @param currentItem - Optional description of current item
   */
  updateProgress(processed: number, total: number, currentItem?: string): void {
    this.itemsProcessed = processed;
    this.totalItems = total;
    this.reportProgress(currentItem);
  }

  /**
   * Mark parsing as complete.
   */
  complete(): void {
    this.currentPhase = 'complete';
    this.itemsProcessed = 0;
    this.totalItems = 0;
    // Force immediate callback for completion
    this.reportProgress(undefined, true);
  }

  /**
   * Get the current progress state.
   */
  getProgress(): ParseProgress {
    return this.calculateProgress();
  }

  /**
   * Get elapsed time in milliseconds.
   */
  getElapsedMs(): number {
    return performance.now() - this.startTime;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private calculateProgress(currentItem?: string): ParseProgress {
    const phaseConfig = PHASE_WEIGHTS[this.currentPhase];
    const elapsedMs = this.getElapsedMs();

    // Calculate phase progress (0-1)
    let phaseProgress = 0;
    if (this.totalItems > 0) {
      phaseProgress = Math.min(this.itemsProcessed / this.totalItems, 1);
    } else if (this.currentPhase === 'complete') {
      phaseProgress = 1;
    }

    // Calculate overall percentage
    const percentage = Math.min(
      Math.round(phaseConfig.start + phaseConfig.weight * phaseProgress),
      100,
    );

    // Estimate remaining time based on current rate
    let estimatedRemainingMs: number | undefined;
    if (percentage > 0 && percentage < 100) {
      const rate = elapsedMs / percentage;
      estimatedRemainingMs = Math.round(rate * (100 - percentage));
    }

    return {
      phase: this.currentPhase,
      percentage,
      currentItem,
      itemsProcessed: this.itemsProcessed > 0 ? this.itemsProcessed : undefined,
      totalItems: this.totalItems > 0 ? this.totalItems : undefined,
      elapsedMs: Math.round(elapsedMs),
      estimatedRemainingMs,
    };
  }

  private reportProgress(currentItem?: string, force = false): void {
    if (!this.callback) return;

    const now = performance.now();

    // Throttle callbacks unless forced
    if (!force && now - this.lastCallbackTime < this.throttleMs) {
      return;
    }

    const progress = this.calculateProgress(currentItem);

    // Skip if progress hasn't changed
    if (
      !force &&
      this.lastProgress &&
      this.lastProgress.phase === progress.phase &&
      this.lastProgress.percentage === progress.percentage
    ) {
      return;
    }

    this.lastCallbackTime = now;
    this.lastProgress = progress;
    this.callback(progress);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a simple progress reporter that maps phases to percentage ranges.
 *
 * This is a simpler alternative to ProgressTracker for cases where
 * you don't need item-level tracking.
 *
 * @param onProgress - Callback for progress updates
 * @returns Object with phase reporting methods
 *
 * @example
 * ```typescript
 * const report = createProgressReporter((p) => postMessage({ type: 'progress', ...p }));
 *
 * report.init();
 * await extractZip(data);
 * report.zip(50);  // 50% through ZIP phase
 * report.zip(100); // ZIP complete
 * report.cells(0);
 * // ... process cells ...
 * report.complete();
 * ```
 */
export function createProgressReporter(onProgress: ProgressCallback): {
  init: () => void;
  zip: (phasePercent: number) => void;
  xml: (phasePercent: number) => void;
  cells: (phasePercent: number, currentSheet?: string) => void;
  styles: (phasePercent: number) => void;
  features: (phasePercent: number, feature?: string) => void;
  complete: () => void;
} {
  const startTime = performance.now();

  const report = (phase: ParsePhase, phasePercent: number, currentItem?: string) => {
    const config = PHASE_WEIGHTS[phase];
    const percentage = Math.min(
      Math.round(config.start + config.weight * (phasePercent / 100)),
      100,
    );
    onProgress({
      phase,
      percentage,
      currentItem,
      elapsedMs: Math.round(performance.now() - startTime),
    });
  };

  return {
    init: () => report('init', 100),
    zip: (phasePercent) => report('zip', phasePercent),
    xml: (phasePercent) => report('xml', phasePercent),
    cells: (phasePercent, currentSheet) => report('cells', phasePercent, currentSheet),
    styles: (phasePercent) => report('styles', phasePercent),
    features: (phasePercent, feature) => report('features', phasePercent, feature),
    complete: () => report('complete', 100),
  };
}

/**
 * Wrap a progress callback with throttling.
 *
 * @param callback - Original callback
 * @param throttleMs - Minimum milliseconds between calls
 * @returns Throttled callback
 */
export function throttleProgress(callback: ProgressCallback, throttleMs = 16): ProgressCallback {
  let lastCall = 0;
  let lastProgress: ParseProgress | null = null;

  return (progress: ParseProgress) => {
    const now = performance.now();

    // Always call for complete phase
    if (progress.phase === 'complete') {
      callback(progress);
      return;
    }

    // Throttle other updates
    if (now - lastCall >= throttleMs) {
      // Skip if unchanged
      if (
        lastProgress &&
        lastProgress.phase === progress.phase &&
        lastProgress.percentage === progress.percentage
      ) {
        return;
      }
      lastCall = now;
      lastProgress = progress;
      callback(progress);
    }
  };
}

/**
 * Create a progress callback that posts messages to a parent context.
 *
 * Useful for Web Worker implementations.
 *
 * @param postMessage - The postMessage function (e.g., self.postMessage in worker)
 * @param messageType - The type field for the message (default: 'progress')
 * @returns Progress callback
 */
export function createPostMessageProgress(
  postMessage: (message: unknown) => void,
  messageType = 'progress',
): ProgressCallback {
  return (progress: ParseProgress) => {
    postMessage({
      type: messageType,
      ...progress,
    });
  };
}

// =============================================================================
// Cancellation Utilities
// =============================================================================

/**
 * Check if an abort signal has been triggered.
 * Throws DOMException with name 'AbortError' if aborted.
 *
 * @param signal - The abort signal to check
 * @throws DOMException if the signal is aborted
 */
export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation was aborted', 'AbortError');
  }
}

/**
 * Create a cancellation token that can be checked periodically.
 *
 * This is useful for long-running loops where you want to check
 * for cancellation without the overhead of checking on every iteration.
 *
 * @param signal - The abort signal
 * @param checkInterval - Check every N iterations (default: 100)
 * @returns Function to check for cancellation
 *
 * @example
 * ```typescript
 * const shouldCancel = createCancellationChecker(signal, 1000);
 *
 * for (let i = 0; i < cells.length; i++) {
 *   shouldCancel(i); // Throws if cancelled, but only checks every 1000 iterations
 *   processCell(cells[i]);
 * }
 * ```
 */
export function createCancellationChecker(
  signal?: AbortSignal,
  checkInterval = 100,
): (iteration: number) => void {
  if (!signal) {
    return () => {}; // No-op if no signal
  }

  return (iteration: number) => {
    if (iteration % checkInterval === 0) {
      checkAborted(signal);
    }
  };
}

/**
 * Wrap an async operation with abort signal support.
 *
 * @param signal - The abort signal
 * @param operation - The async operation to wrap
 * @returns Promise that rejects if aborted
 */
export function withAbortSignal<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!signal) {
    return operation();
  }

  return new Promise((resolve, reject) => {
    // Check if already aborted
    if (signal.aborted) {
      reject(new DOMException('Operation was aborted', 'AbortError'));
      return;
    }

    // Listen for abort
    const onAbort = () => {
      reject(new DOMException('Operation was aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // Run operation
    operation()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

// =============================================================================
// Phase Estimation Helpers
// =============================================================================

/**
 * Estimate total items for cell processing phase based on file size.
 *
 * @param fileSizeBytes - Size of the XLSX file in bytes
 * @returns Estimated cell count
 */
export function estimateCellCount(fileSizeBytes: number): number {
  // Empirical: ~50 bytes per cell on average in compressed form
  return Math.ceil(fileSizeBytes / 50);
}

/**
 * Estimate ZIP entries based on file structure.
 *
 * @param sheetCount - Number of sheets
 * @returns Estimated ZIP entry count
 */
export function estimateZipEntries(sheetCount: number): number {
  // Base entries: [Content_Types].xml, _rels/.rels, xl/workbook.xml,
  // xl/_rels/workbook.xml.rels, xl/styles.xml, xl/sharedStrings.xml
  const baseEntries = 6;
  // Per sheet: xl/worksheets/sheetN.xml, xl/worksheets/_rels/sheetN.xml.rels
  const perSheetEntries = 2;
  return baseEntries + sheetCount * perSheetEntries;
}
