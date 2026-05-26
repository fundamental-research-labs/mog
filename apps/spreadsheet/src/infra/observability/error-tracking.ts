/**
 * Error Tracking for Spreadsheet Application
 *
 * Provides error boundary support, error recovery strategies,
 * and error reporting infrastructure.
 *
 * Features:
 * - Error boundary wrapper for React components
 * - State machine error recovery
 * - Error categorization and reporting
 * - Recovery strategies (retry, reset, fallback)
 *
 * @see ARCHITECTURE.md - Error Recovery section
 */

import React, { Component, type ReactNode } from 'react';

import { getMetrics } from './metrics';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Error category for classification.
 */
export type ErrorCategory =
  | 'render' // React render errors
  | 'state' // State machine errors
  | 'network' // Network/API errors
  | 'data' // Data validation/parsing errors
  | 'collaboration' // Yjs/awareness errors
  | 'unknown'; // Uncategorized errors

/**
 * Error severity levels.
 */
export type ErrorSeverity =
  | 'fatal' // Application cannot continue
  | 'error' // Feature broken but app functional
  | 'warning' // Degraded but recoverable
  | 'info'; // Informational

/**
 * Tracked error with metadata.
 */
export interface TrackedError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  componentStack?: string;
  context?: Record<string, unknown>;
  timestamp: number;
  recovered: boolean;
  recoveryAttempts: number;
}

/**
 * Error handler configuration.
 */
export interface ErrorTrackingConfig {
  /** Callback when error is tracked */
  onError?: (error: TrackedError) => void;
  /** Maximum errors to retain in memory */
  maxErrors?: number;
  /** Whether to log errors to console */
  consoleLogging?: boolean;
  /** Whether to attempt automatic recovery */
  autoRecover?: boolean;
}

/**
 * Error recovery strategy.
 */
export interface RecoveryStrategy {
  /** Strategy name */
  name: string;
  /** Whether this strategy applies to the error */
  canHandle: (error: TrackedError) => boolean;
  /** Execute recovery - returns true if successful */
  recover: (error: TrackedError) => boolean | Promise<boolean>;
  /** Maximum retry attempts */
  maxAttempts: number;
}

// =============================================================================
// ERROR TRACKER
// =============================================================================

class ErrorTracker {
  private errors: TrackedError[] = [];
  private config: ErrorTrackingConfig;
  private recoveryStrategies: RecoveryStrategy[] = [];
  private errorIdCounter = 0;

  constructor(config: ErrorTrackingConfig = {}) {
    this.config = {
      maxErrors: 50,
      consoleLogging: true,
      autoRecover: true,
      ...config,
    };
  }

  /**
   * Track an error.
   */
  track(
    error: Error | string,
    options: {
      category?: ErrorCategory;
      severity?: ErrorSeverity;
      context?: Record<string, unknown>;
      componentStack?: string;
    } = {},
  ): TrackedError {
    const {
      category = this.categorizeError(error),
      severity = 'error',
      context,
      componentStack,
    } = options;

    const trackedError: TrackedError = {
      id: `err_${++this.errorIdCounter}_${Date.now()}`,
      category,
      severity,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      componentStack,
      context,
      timestamp: Date.now(),
      recovered: false,
      recoveryAttempts: 0,
    };

    // Add to error list
    this.errors.push(trackedError);
    if (this.errors.length > (this.config.maxErrors ?? 50)) {
      this.errors.shift();
    }

    // Log to console
    if (this.config.consoleLogging) {
      console.error(
        `[ErrorTracker] ${category}/${severity}:`,
        trackedError.message,
        trackedError.context,
      );
    }

    // Report to metrics
    getMetrics().incrementError(category, trackedError.message);

    // Call handler
    this.config.onError?.(trackedError);

    // Attempt recovery
    if (this.config.autoRecover) {
      this.attemptRecovery(trackedError);
    }

    return trackedError;
  }

  /**
   * Categorize an error based on its properties.
   */
  private categorizeError(error: Error | string): ErrorCategory {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';

    // Check for network errors
    if (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('CORS') ||
      message.includes('timeout')
    ) {
      return 'network';
    }

    // Check for state machine errors
    if (
      message.includes('state') ||
      message.includes('machine') ||
      message.includes('transition') ||
      stack?.includes('xstate')
    ) {
      return 'state';
    }

    // Check for collaboration errors
    if (
      message.includes('Yjs') ||
      message.includes('awareness') ||
      message.includes('sync') ||
      message.includes('CRDT')
    ) {
      return 'collaboration';
    }

    // Check for data errors
    if (
      message.includes('parse') ||
      message.includes('JSON') ||
      message.includes('validation') ||
      message.includes('undefined')
    ) {
      return 'data';
    }

    // Check for render errors
    if (stack?.includes('render') || stack?.includes('React') || message.includes('component')) {
      return 'render';
    }

    return 'unknown';
  }

  /**
   * Attempt to recover from an error.
   */
  async attemptRecovery(error: TrackedError): Promise<boolean> {
    for (const strategy of this.recoveryStrategies) {
      if (strategy.canHandle(error) && error.recoveryAttempts < strategy.maxAttempts) {
        error.recoveryAttempts++;

        try {
          const recovered = await strategy.recover(error);
          if (recovered) {
            error.recovered = true;
            if (this.config.consoleLogging) {
              console.log(
                `[ErrorTracker] Recovered from ${error.category} error using ${strategy.name}`,
              );
            }
            return true;
          }
        } catch (recoveryError) {
          console.warn(`[ErrorTracker] Recovery strategy ${strategy.name} failed:`, recoveryError);
        }
      }
    }
    return false;
  }

  /**
   * Register a recovery strategy.
   */
  registerRecoveryStrategy(strategy: RecoveryStrategy): void {
    this.recoveryStrategies.push(strategy);
  }

  /**
   * Get all tracked errors.
   */
  getErrors(): TrackedError[] {
    return [...this.errors];
  }

  /**
   * Get errors by category.
   */
  getErrorsByCategory(category: ErrorCategory): TrackedError[] {
    return this.errors.filter((e) => e.category === category);
  }

  /**
   * Clear all tracked errors.
   */
  clear(): void {
    this.errors = [];
  }

  /**
   * Get error count by severity.
   */
  getErrorCounts(): Record<ErrorSeverity, number> {
    return {
      fatal: this.errors.filter((e) => e.severity === 'fatal').length,
      error: this.errors.filter((e) => e.severity === 'error').length,
      warning: this.errors.filter((e) => e.severity === 'warning').length,
      info: this.errors.filter((e) => e.severity === 'info').length,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let errorTrackerInstance: ErrorTracker | null = null;

/**
 * Get the global error tracker instance.
 */
export function getErrorTracker(): ErrorTracker {
  if (!errorTrackerInstance) {
    errorTrackerInstance = new ErrorTracker();
  }
  return errorTrackerInstance;
}

/**
 * Initialize the error tracker with custom configuration.
 */
export function initializeErrorTracking(config: ErrorTrackingConfig): ErrorTracker {
  errorTrackerInstance = new ErrorTracker(config);
  return errorTrackerInstance;
}

// =============================================================================
// ERROR BOUNDARY COMPONENT
// =============================================================================

/**
 * Error boundary props.
 */
export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Component to render on error */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Whether to attempt automatic recovery */
  autoRecover?: boolean;
  /** Recovery delay in ms (for auto-recovery) */
  recoveryDelayMs?: number;
  /** Maximum recovery attempts */
  maxRecoveryAttempts?: number;
}

/**
 * Error boundary state.
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  recoveryAttempts: number;
}

/**
 * Error boundary component for catching render errors.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary
 * fallback={<ErrorFallback />}
 * onError={(error) => console.error(error)}
 * >
 * <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private recoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      recoveryAttempts: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { onError, autoRecover, recoveryDelayMs = 1000 } = this.props;

    // Track the error
    getErrorTracker().track(error, {
      category: 'render',
      severity: 'error',
      componentStack: errorInfo.componentStack ?? undefined,
      context: {
        recoveryAttempts: this.state.recoveryAttempts,
      },
    });

    // Call error callback
    onError?.(error, errorInfo);

    // Attempt auto-recovery
    if (autoRecover) {
      const maxAttempts = this.props.maxRecoveryAttempts ?? 3;
      if (this.state.recoveryAttempts < maxAttempts) {
        this.recoveryTimeoutId = setTimeout(
          () => {
            this.reset();
          },
          recoveryDelayMs * Math.pow(2, this.state.recoveryAttempts),
        ); // Exponential backoff
      }
    }
  }

  componentWillUnmount(): void {
    if (this.recoveryTimeoutId) {
      clearTimeout(this.recoveryTimeoutId);
    }
  }

  /**
   * Reset the error boundary to retry rendering.
   */
  reset = (): void => {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      recoveryAttempts: prevState.recoveryAttempts + 1,
    }));
  };

  render(): ReactNode {
    const { children, fallback } = this.props;
    const { hasError, error } = this.state;

    if (hasError && error) {
      // Render fallback
      if (typeof fallback === 'function') {
        return fallback(error, this.reset);
      }
      if (fallback) {
        return fallback;
      }
      // Default fallback
      return React.createElement(
        'div',
        {
          style: {
            padding: '20px',
            backgroundColor: '#fff0f0',
            border: '1px solid #ffcccc',
            borderRadius: '4px',
          },
        },
        React.createElement(
          'h3',
          { style: { color: '#cc0000', margin: '0 0 10px' } },
          'Something went wrong',
        ),
        React.createElement(
          'p',
          { style: { margin: '0 0 10px', fontFamily: 'monospace' } },
          error.message,
        ),
        React.createElement(
          'button',
          {
            onClick: this.reset,
            style: {
              padding: '8px 16px',
              cursor: 'pointer',
              backgroundColor: '#cc0000',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
            },
          },
          'Try Again',
        ),
      );
    }

    return children;
  }
}

// =============================================================================
// RECOVERY STRATEGIES
// =============================================================================

/**
 * Create a retry recovery strategy.
 */
export function createRetryStrategy(
  retryFn: () => void | Promise<void>,
  options: {
    name?: string;
    maxAttempts?: number;
    categories?: ErrorCategory[];
  } = {},
): RecoveryStrategy {
  const { name = 'retry', maxAttempts = 3, categories = ['network', 'state'] } = options;

  return {
    name,
    maxAttempts,
    canHandle: (error) => categories.includes(error.category),
    recover: async () => {
      try {
        await retryFn();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Create a state reset recovery strategy.
 */
export function createResetStrategy(
  resetFn: () => void,
  options: {
    name?: string;
    maxAttempts?: number;
    categories?: ErrorCategory[];
  } = {},
): RecoveryStrategy {
  const { name = 'reset', maxAttempts = 1, categories = ['state', 'data'] } = options;

  return {
    name,
    maxAttempts,
    canHandle: (error) => categories.includes(error.category),
    recover: () => {
      try {
        resetFn();
        return true;
      } catch {
        return false;
      }
    },
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Wrap a function with error tracking.
 */
export function withErrorTracking<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options: {
    category?: ErrorCategory;
    context?: Record<string, unknown>;
  } = {},
): T {
  return ((...args: Parameters<T>) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.catch((error) => {
          getErrorTracker().track(error, {
            category: options.category,
            context: { ...options.context, args },
          });
          throw error;
        });
      }
      return result;
    } catch (error) {
      getErrorTracker().track(error as Error, {
        category: options.category,
        context: { ...options.context, args },
      });
      throw error;
    }
  }) as T;
}

/**
 * Track an error without throwing.
 */
export function trackError(
  error: Error | string,
  options?: {
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    context?: Record<string, unknown>;
  },
): void {
  getErrorTracker().track(error, options);
}

/**
 * Create a safe wrapper that catches errors.
 */
export function safeFn<T extends (...args: unknown[]) => unknown>(
  fn: T,
  fallbackValue?: ReturnType<T>,
): T {
  return ((...args: Parameters<T>) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.catch((error) => {
          trackError(error, { severity: 'warning' });
          return fallbackValue;
        });
      }
      return result;
    } catch (error) {
      trackError(error as Error, { severity: 'warning' });
      return fallbackValue;
    }
  }) as T;
}
