/**
 * Debug Lifecycle Logger
 *
 * Comprehensive logging for diagnosing renderer initialization issues.
 * Enable by setting ENABLE_LIFECYCLE_DEBUG = true
 *
 * Key events tracked:
 * 1. Renderer machine state transitions
 * 2. Dependency injection timing
 * 3. Effect execution order
 * 4. Render context coordination setup
 *
 * @see ISSUE-15-RENDER-CONTEXT-TIMING-RACE.md
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Enable/disable debug logging.
 * Set to true to see all lifecycle events.
 */
export const ENABLE_LIFECYCLE_DEBUG = true;

/**
 * Log level filter. Higher = more verbose.
 * 0 = critical only, 1 = info, 2 = verbose
 */
export const DEBUG_LOG_LEVEL = 2;

// =============================================================================
// STYLING
// =============================================================================

const STYLES = {
  // Major lifecycle events
  state: 'color: #4285f4; font-weight: bold',
  // Dependency injection
  deps: 'color: #34a853; font-weight: bold',
  // Effect execution
  effect: 'color: #fbbc04; font-weight: bold',
  // Render context
  context: 'color: #ea4335; font-weight: bold',
  // Warnings
  warn: 'color: #ff9800; font-weight: bold',
  // Errors
  error: 'color: #f44336; font-weight: bold',
  // Timing
  timing: 'color: #9c27b0; font-weight: bold',
  // Success
  success: 'color: #00c853; font-weight: bold',
} as const;

// =============================================================================
// TIMING TRACKER
// =============================================================================

const startTime = Date.now();
const eventTimings: Array<{ event: string; elapsed: number; timestamp: number }> = [];

function getElapsed(): number {
  return Date.now() - startTime;
}

// =============================================================================
// LOGGING FUNCTIONS
// =============================================================================

function log(style: string, prefix: string, message: string, data?: unknown): void {
  if (!ENABLE_LIFECYCLE_DEBUG) return;

  const elapsed = getElapsed();
  const timestamp = `[+${elapsed}ms]`;

  if (data !== undefined) {
    console.log(`%c${timestamp} ${prefix}%c ${message}`, STYLES.timing, style, data);
  } else {
    console.log(`%c${timestamp} ${prefix}%c ${message}`, STYLES.timing, style);
  }

  eventTimings.push({ event: `${prefix} ${message}`, elapsed, timestamp: Date.now() });
}

// =============================================================================
// PUBLIC API
// =============================================================================

export const lifecycleDebug = {
  // ---------------------------------------------------------------------------
  // State Machine Events
  // ---------------------------------------------------------------------------

  stateTransition(from: string | null, to: string, context?: Record<string, unknown>): void {
    log(STYLES.state, '[STATE]', `${from ?? 'initial'} → ${to}`, context);
  },

  stateEvent(event: string, payload?: unknown): void {
    if (DEBUG_LOG_LEVEL < 1) return;
    log(STYLES.state, '[EVENT]', event, payload);
  },

  // ---------------------------------------------------------------------------
  // Dependency Injection
  // ---------------------------------------------------------------------------

  setRendererDependencies(hasExistingSubscription: boolean): void {
    log(STYLES.deps, '[DEPS]', `setRendererDependencies called`, {
      firstCall: !hasExistingSubscription,
      willSetupExecution: !hasExistingSubscription,
    });
  },

  executionSubscriptionSetup(): void {
    log(STYLES.deps, '[DEPS]', 'Execution subscription set up - now listening for state changes');
  },

  // ---------------------------------------------------------------------------
  // Renderer Execution
  // ---------------------------------------------------------------------------

  canvasCreated(hasContainer: boolean): void {
    log(STYLES.effect, '[EXEC]', 'Canvas created', { hasContainer });
  },

  rendererCreating(hasCanvas: boolean, hasDeps: boolean, hasExistingRenderer: boolean): void {
    log(STYLES.effect, '[EXEC]', 'Attempting renderer creation', {
      hasCanvas,
      hasDeps,
      hasExistingRenderer,
      canCreate: hasCanvas && hasDeps && !hasExistingRenderer,
    });
  },

  rendererCreated(sheetId: string, width: number, height: number): void {
    log(STYLES.success, '[EXEC]', `Renderer created for sheet "${sheetId}"`, { width, height });
  },

  rendererStarted(): void {
    log(STYLES.success, '[EXEC]', 'Renderer render loop started');
  },

  // ---------------------------------------------------------------------------
  // Render Context Coordination
  // ---------------------------------------------------------------------------

  setRenderContextConfig(): void {
    log(STYLES.context, '[CTX]', 'setRenderContextConfig called');
  },

  renderContextCoordinationSetup(rendererStatus: string): void {
    log(STYLES.context, '[CTX]', 'Render context coordination set up', { rendererStatus });
  },

  sendContextUpdate(rendererStatus: string, willSend: boolean): void {
    log(
      willSend ? STYLES.context : STYLES.warn,
      '[CTX]',
      willSend
        ? 'Sending context update to renderer'
        : 'Skipping context update (renderer not ready)',
      { rendererStatus },
    );
  },

  contextUpdateReceived(): void {
    if (DEBUG_LOG_LEVEL < 2) return;
    log(STYLES.context, '[CTX]', 'Renderer received context update');
  },

  // ---------------------------------------------------------------------------
  // React Effects
  // ---------------------------------------------------------------------------

  effectRun(effectName: string, deps?: unknown): void {
    if (DEBUG_LOG_LEVEL < 1) return;
    log(STYLES.effect, '[EFFECT]', `${effectName} running`, deps);
  },

  effectCleanup(effectName: string): void {
    if (DEBUG_LOG_LEVEL < 2) return;
    log(STYLES.effect, '[EFFECT]', `${effectName} cleanup`);
  },

  // ---------------------------------------------------------------------------
  // Grid Component Lifecycle
  // ---------------------------------------------------------------------------

  gridLifecycleCase(status: string, action: string): void {
    log(STYLES.effect, '[GRID]', `Status "${status}" - ${action}`);
  },

  // ---------------------------------------------------------------------------
  // Dimension Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Log detailed dimension analysis to help diagnose CSS layout timing issues.
   * Call this when dimensions seem wrong (e.g., virtual scroll content size).
   */
  dimensionDiagnostic(container: HTMLElement | null, source: string): void {
    if (!container) {
      log(STYLES.warn, '[DIM]', `${source}: no container`);
      return;
    }

    const rect = container.getBoundingClientRect();
    const computed = window.getComputedStyle(container);

    // Check if dimensions look like virtual scroll content
    const MAX_REASONABLE = 16384;
    const isAbsurd = rect.width > MAX_REASONABLE || rect.height > MAX_REASONABLE;

    // Analyze parent chain
    const parentInfo: Array<{ tag: string; width: number; height: number; overflow: string }> = [];
    let parent = container.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      const parentRect = parent.getBoundingClientRect();
      const parentComputed = window.getComputedStyle(parent);
      parentInfo.push({
        tag: `${parent.tagName.toLowerCase()}${parent.className ? '.' + parent.className.split(' ')[0] : ''}`,
        width: Math.round(parentRect.width),
        height: Math.round(parentRect.height),
        overflow: parentComputed.overflow,
      });
      parent = parent.parentElement;
      depth++;
    }

    const style = isAbsurd ? STYLES.error : STYLES.success;
    log(style, '[DIM]', `${source}:`, {
      dimensions: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      isAbsurd,
      containerStyles: {
        width: computed.width,
        height: computed.height,
        overflow: computed.overflow,
        position: computed.position,
        display: computed.display,
      },
      parentChain: parentInfo,
      diagnosis: isAbsurd
        ? 'LIKELY CAUSE: CSS layout not computed, container measuring virtual scroll content'
        : 'Dimensions look reasonable',
    });
  },

  /**
   * Log ResizeObserver callback firing.
   */
  resizeObserverFired(
    width: number,
    height: number,
    source: 'contentRect' | 'borderBoxSize',
  ): void {
    const MAX_REASONABLE = 16384;
    const isAbsurd = width > MAX_REASONABLE || height > MAX_REASONABLE;
    const style = isAbsurd ? STYLES.warn : STYLES.success;

    log(style, '[RESIZE]', `ResizeObserver fired (${source})`, {
      dimensions: `${Math.round(width)}x${Math.round(height)}`,
      isAbsurd,
      willAccept: !isAbsurd && width > 0 && height > 0,
    });
  },

  /**
   * Log when dimensions are rejected.
   */
  dimensionsRejected(width: number, height: number, reason: string): void {
    log(STYLES.warn, '[DIM]', `Dimensions rejected: ${reason}`, {
      dimensions: `${Math.round(width)}x${Math.round(height)}`,
      waiting: 'ResizeObserver to fire with correct dimensions',
    });
  },

  /**
   * Log when dimensions are accepted.
   */
  dimensionsAccepted(width: number, height: number, source: string): void {
    log(STYLES.success, '[DIM]', `Dimensions accepted from ${source}`, {
      dimensions: `${Math.round(width)}x${Math.round(height)}`,
    });
  },

  // ---------------------------------------------------------------------------
  // Warnings
  // ---------------------------------------------------------------------------

  warn(message: string, data?: unknown): void {
    log(STYLES.warn, '[WARN]', message, data);
  },

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------

  error(message: string, error?: unknown): void {
    log(STYLES.error, '[ERROR]', message, error);
  },

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  printSummary(): void {
    if (!ENABLE_LIFECYCLE_DEBUG) return;

    console.group('%c[LIFECYCLE SUMMARY]', STYLES.timing);
    console.table(eventTimings);
    console.groupEnd();
  },

  getTimings(): typeof eventTimings {
    return [...eventTimings];
  },

  clearTimings(): void {
    eventTimings.length = 0;
  },
};

// Make globally available for debugging in console
if (typeof window !== 'undefined') {
  Object.assign(window, { __lifecycleDebug: lifecycleDebug });
}
