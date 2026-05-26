/**
 * Metrics System for Spreadsheet Observability
 *
 * Provides comprehensive metrics collection for state machine transitions,
 * render performance, and general application health.
 *
 * Features:
 * - Timing metrics (transitions, frame times, operations)
 * - Counting metrics (events, errors)
 * - Gauge metrics (queue depths, memory)
 * - Beacon API for reliable delivery on page unload
 * - Batching for reduced overhead
 *
 * @see ARCHITECTURE.md - Full Observability section
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Base metric interface.
 */
export interface BaseMetric {
  name: string;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * Timing metric (durations, latencies).
 */
export interface TimingMetric extends BaseMetric {
  type: 'timing';
  durationMs: number;
}

/**
 * Counter metric (events, errors).
 */
export interface CounterMetric extends BaseMetric {
  type: 'counter';
  value: number;
}

/**
 * Gauge metric (current values like queue depth).
 */
export interface GaugeMetric extends BaseMetric {
  type: 'gauge';
  value: number;
}

/**
 * Union type for all metrics.
 */
export type Metric = TimingMetric | CounterMetric | GaugeMetric;

/**
 * Metrics configuration.
 */
export interface MetricsConfig {
  /** Whether metrics are enabled */
  enabled: boolean;
  /** Batch interval in milliseconds (default: 5000) */
  batchIntervalMs?: number;
  /** Maximum batch size before forced flush */
  maxBatchSize?: number;
  /** Endpoint to send metrics to (if using remote collection) */
  endpoint?: string;
  /** Custom handler for metrics (alternative to endpoint) */
  onMetricsBatch?: (metrics: Metric[]) => void;
  /** Whether to log metrics to console in development */
  consoleLogging?: boolean;
}

/**
 * Metrics interface exposed to consumers.
 */
export interface Metrics {
  // Timing
  recordTransition(machine: string, from: string, to: string, durationMs: number): void;
  recordFrameTime(durationMs: number): void;
  recordOperationTime(operation: string, durationMs: number): void;
  startTimer(name: string): () => void;

  // Counting
  incrementTransition(machine: string, event: string): void;
  incrementError(machine: string, error: string): void;
  incrementCounter(name: string, value?: number, tags?: Record<string, string>): void;

  // Gauges
  setQueueDepth(depth: number): void;
  setGauge(name: string, value: number, tags?: Record<string, string>): void;

  // Lifecycle
  flush(): void;
  dispose(): void;
}

// =============================================================================
// METRICS COLLECTOR IMPLEMENTATION
// =============================================================================

/**
 * Creates a metrics collector with batching and beacon API support.
 */
export function createMetricsCollector(config: MetricsConfig): Metrics {
  const {
    enabled,
    batchIntervalMs = 5000,
    maxBatchSize = 100,
    endpoint,
    onMetricsBatch,
    consoleLogging = false,
  } = config;

  // Metrics buffer
  let buffer: Metric[] = [];
  let flushIntervalId: ReturnType<typeof setInterval> | null = null;

  // Rolling averages for frame time
  const frameTimes: number[] = [];
  const MAX_FRAME_SAMPLES = 60;

  // =============================================================================
  // INTERNAL HELPERS
  // =============================================================================

  /**
   * Add a metric to the buffer.
   */
  function addMetric(metric: Metric): void {
    if (!enabled) return;

    buffer.push(metric);

    // Log to console in development if enabled
    if (consoleLogging && typeof console !== 'undefined') {
      console.debug('[Metrics]', metric.name, metric);
    }

    // Force flush if buffer is full
    if (buffer.length >= maxBatchSize) {
      flush();
    }
  }

  /**
   * Flush metrics to destination.
   */
  function flush(): void {
    if (buffer.length === 0) return;

    const batch = buffer;
    buffer = [];

    // Call custom handler if provided
    if (onMetricsBatch) {
      try {
        onMetricsBatch(batch);
      } catch (e) {
        console.error('[Metrics] Error in onMetricsBatch:', e);
      }
    }

    // Send to endpoint if configured
    if (endpoint) {
      sendMetrics(batch, endpoint);
    }
  }

  /**
   * Send metrics to endpoint using beacon API for reliability.
   */
  function sendMetrics(metrics: Metric[], url: string): void {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
      // Fallback to fetch if beacon not available
      try {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metrics),
          keepalive: true,
        }).catch(() => {
          // Silently fail - metrics are best-effort
        });
      } catch {
        // Ignore errors
      }
      return;
    }

    // Use beacon API for reliable delivery even on page unload
    const blob = new Blob([JSON.stringify(metrics)], {
      type: 'application/json',
    });
    navigator.sendBeacon(url, blob);
  }

  // =============================================================================
  // TIMING METRICS
  // =============================================================================

  function recordTransition(machine: string, from: string, to: string, durationMs: number): void {
    addMetric({
      type: 'timing',
      name: 'state_transition',
      durationMs,
      timestamp: Date.now(),
      tags: { machine, from, to },
    });
  }

  function recordFrameTime(durationMs: number): void {
    // Track rolling average
    frameTimes.push(durationMs);
    if (frameTimes.length > MAX_FRAME_SAMPLES) {
      frameTimes.shift();
    }

    // Only record metric if frame is slow (> 16.67ms = below 60fps)
    if (durationMs > 16.67) {
      addMetric({
        type: 'timing',
        name: 'slow_frame',
        durationMs,
        timestamp: Date.now(),
      });
    }
  }

  function recordOperationTime(operation: string, durationMs: number): void {
    addMetric({
      type: 'timing',
      name: 'operation',
      durationMs,
      timestamp: Date.now(),
      tags: { operation },
    });
  }

  function startTimer(name: string): () => void {
    const start = performance.now();
    return () => {
      const durationMs = performance.now() - start;
      recordOperationTime(name, durationMs);
    };
  }

  // =============================================================================
  // COUNTER METRICS
  // =============================================================================

  function incrementTransition(machine: string, event: string): void {
    addMetric({
      type: 'counter',
      name: 'transition_count',
      value: 1,
      timestamp: Date.now(),
      tags: { machine, event },
    });
  }

  function incrementError(machine: string, error: string): void {
    addMetric({
      type: 'counter',
      name: 'error_count',
      value: 1,
      timestamp: Date.now(),
      tags: { machine, error },
    });
  }

  function incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    addMetric({
      type: 'counter',
      name,
      value,
      timestamp: Date.now(),
      tags,
    });
  }

  // =============================================================================
  // GAUGE METRICS
  // =============================================================================

  function setQueueDepth(depth: number): void {
    addMetric({
      type: 'gauge',
      name: 'render_queue_depth',
      value: depth,
      timestamp: Date.now(),
    });
  }

  function setGauge(name: string, value: number, tags?: Record<string, string>): void {
    addMetric({
      type: 'gauge',
      name,
      value,
      timestamp: Date.now(),
      tags,
    });
  }

  // =============================================================================
  // LIFECYCLE
  // =============================================================================

  function dispose(): void {
    // Flush remaining metrics
    flush();

    // Clear interval
    if (flushIntervalId) {
      clearInterval(flushIntervalId);
      flushIntervalId = null;
    }
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  // Start batch flush interval
  if (enabled && batchIntervalMs > 0) {
    flushIntervalId = setInterval(flush, batchIntervalMs);
  }

  // Flush on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    });
  }

  // =============================================================================
  // RETURN PUBLIC API
  // =============================================================================

  return {
    // Timing
    recordTransition,
    recordFrameTime,
    recordOperationTime,
    startTimer,

    // Counting
    incrementTransition,
    incrementError,
    incrementCounter,

    // Gauges
    setQueueDepth,
    setGauge,

    // Lifecycle
    flush,
    dispose,
  };
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let metricsInstance: Metrics | null = null;

/**
 * Get the global metrics instance.
 * Creates a no-op instance if not initialized.
 */
export function getMetrics(): Metrics {
  if (!metricsInstance) {
    // Return no-op metrics if not initialized
    return createNoOpMetrics();
  }
  return metricsInstance;
}

/**
 * Initialize the global metrics instance.
 */
export function initializeMetrics(config: MetricsConfig): Metrics {
  if (metricsInstance) {
    metricsInstance.dispose();
  }
  metricsInstance = createMetricsCollector(config);
  return metricsInstance;
}

/**
 * Create a no-op metrics instance for when metrics are disabled.
 */
export function createNoOpMetrics(): Metrics {
  const noop = (): void => {};
  return {
    recordTransition: noop,
    recordFrameTime: noop,
    recordOperationTime: noop,
    startTimer: () => noop,
    incrementTransition: noop,
    incrementError: noop,
    incrementCounter: noop,
    setQueueDepth: noop,
    setGauge: noop,
    flush: noop,
    dispose: noop,
  };
}

// =============================================================================
// PERFORMANCE UTILITIES
// =============================================================================

/**
 * Calculate average frame time from recent samples.
 */
export function getAverageFrameTime(frameTimes: number[]): number {
  if (frameTimes.length === 0) return 0;
  const sum = frameTimes.reduce((a, b) => a + b, 0);
  return sum / frameTimes.length;
}

/**
 * Calculate FPS from average frame time.
 */
export function frameTimeToFPS(frameTimeMs: number): number {
  if (frameTimeMs <= 0) return 60;
  return Math.min(60, 1000 / frameTimeMs);
}

/**
 * Performance mark wrapper for browser Performance API.
 */
export function performanceMark(name: string): void {
  if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark(name);
  }
}

/**
 * Performance measure wrapper for browser Performance API.
 */
export function performanceMeasure(
  name: string,
  startMark: string,
  endMark?: string,
): number | null {
  if (typeof performance === 'undefined' || !performance.measure) {
    return null;
  }

  try {
    if (endMark) {
      performance.mark(endMark);
    }
    const measure = performance.measure(name, startMark, endMark);
    return measure.duration;
  } catch {
    return null;
  }
}
