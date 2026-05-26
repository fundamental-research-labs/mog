/**
 * Observability module exports.
 *
 * Provides metrics collection, XState inspection, and error tracking
 * for the spreadsheet application.
 *
 * @see metrics.ts - Performance and state metrics
 * @see xstate-inspector.ts - Development debugging tools
 * @see error-tracking.ts - Error handling and recovery
 */

// Metrics
export {
  createMetricsCollector,
  createNoOpMetrics,
  frameTimeToFPS,
  getAverageFrameTime,
  getMetrics,
  initializeMetrics,
  performanceMark,
  performanceMeasure,
  type CounterMetric,
  type GaugeMetric,
  type Metric,
  type Metrics,
  type MetricsConfig,
  type TimingMetric,
} from './metrics';

// XState Inspector
export {
  assertMachineState,
  createInspectionCallback,
  logMachineStates,
  setupInspector,
  type InspectorConfig,
  type InspectorInstance,
} from './xstate-inspector';

// Error Tracking
export {
  ErrorBoundary,
  createResetStrategy,
  createRetryStrategy,
  getErrorTracker,
  initializeErrorTracking,
  safeFn,
  trackError,
  withErrorTracking,
  type ErrorBoundaryProps,
  type ErrorCategory,
  type ErrorSeverity,
  type ErrorTrackingConfig,
  type RecoveryStrategy,
  type TrackedError,
} from './error-tracking';
