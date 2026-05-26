/**
 * Handshake Manager
 *
 * Manages the handshake protocol between host and extension.
 * Implements a secure multi-step handshake sequence:
 *
 * 1. Host loads extension iframe
 * 2. Extension sends READY message with extensionId and version
 * 3. Host validates and sends INIT with permissions and context
 * 4. Extension processes INIT and sends second READY
 * 5. Host sends CONNECTED with session ID
 * 6. Normal operation begins
 *
 * Features:
 * - Configurable handshake timeout (default 10s)
 * - Retry logic with exponential backoff
 * - Session ID generation
 * - Detailed handshake state tracking
 *
 * @module extensions/messaging/HandshakeManager
 */

import {
  HANDSHAKE_TIMEOUT,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY,
  RETRY_MAX_DELAY,
} from '../constants';
import type { ExtensionManifest, ExtensionPermission, ReadyMessage } from '../types';
import { MessageBridge } from './MessageBridge';

// =============================================================================
// Types
// =============================================================================

export type HandshakeState =
  | 'idle' // Not started
  | 'waiting_for_ready' // Waiting for first READY from extension
  | 'sent_init' // Sent INIT, waiting for second READY
  | 'connected' // Handshake complete
  | 'failed' // Handshake failed
  | 'timeout'; // Handshake timed out

export interface HandshakeContext {
  /** Active sheet ID */
  activeSheetId: string;
  /** Active sheet name */
  activeSheetName: string;
  /** Current selection (null if none) */
  selection: { range: string } | null;
}

export interface HandshakeOptions {
  /** Extension manifest */
  manifest: ExtensionManifest;
  /** Message bridge for communication */
  bridge: MessageBridge;
  /** Permissions granted to this extension */
  permissions: ExtensionPermission[];
  /** Current spreadsheet context */
  context: HandshakeContext;
  /** Handshake timeout in ms (default: 10000) */
  timeout?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Callback when handshake state changes */
  onStateChange?: (state: HandshakeState) => void;
  /** Callback when handshake completes successfully */
  onSuccess?: (sessionId: string) => void;
  /** Callback when handshake fails */
  onFailure?: (error: Error) => void;
}

export interface HandshakeResult {
  /** Whether handshake succeeded */
  success: boolean;
  /** Session ID if successful */
  sessionId?: string;
  /** Extension ID confirmed by extension */
  extensionId?: string;
  /** Extension version confirmed by extension */
  extensionVersion?: string;
  /** Shim version if Office JS shim is loaded */
  shimVersion?: string;
  /** Error if failed */
  error?: Error;
  /** Number of retries attempted */
  retryCount: number;
  /** Duration of handshake in ms */
  durationMs: number;
}

// =============================================================================
// Errors
// =============================================================================

export class HandshakeError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HandshakeError';
  }
}

export class HandshakeTimeoutError extends HandshakeError {
  constructor(state: HandshakeState, timeout: number) {
    super('HANDSHAKE_TIMEOUT', `Handshake timed out after ${timeout}ms in state: ${state}`);
    this.name = 'HandshakeTimeoutError';
  }
}

export class HandshakeValidationError extends HandshakeError {
  constructor(
    message: string,
    public field?: string,
  ) {
    super('HANDSHAKE_VALIDATION_FAILED', message);
    this.name = 'HandshakeValidationError';
  }
}

// =============================================================================
// Handshake Manager Implementation
// =============================================================================

export class HandshakeManager {
  private manifest: ExtensionManifest;
  private bridge: MessageBridge;
  private permissions: ExtensionPermission[];
  private context: HandshakeContext;

  private timeout: number;
  private maxRetries: number;

  private onStateChange?: (state: HandshakeState) => void;
  private onSuccess?: (sessionId: string) => void;
  private onFailure?: (error: Error) => void;

  private state: HandshakeState = 'idle';
  private sessionId: string | null = null;
  private retryCount = 0;
  private startTime = 0;

  // Extension info from READY message
  private receivedExtensionId: string | null = null;
  private receivedVersion: string | null = null;
  private receivedShimVersion: string | null = null;

  // Timeout handles
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private retryHandle: ReturnType<typeof setTimeout> | null = null;

  // Promise resolver for async handshake
  // Note: We resolve with result (success: false) rather than rejecting on failure
  private handshakeResolve: ((result: HandshakeResult) => void) | null = null;

  constructor(options: HandshakeOptions) {
    this.manifest = options.manifest;
    this.bridge = options.bridge;
    this.permissions = options.permissions;
    this.context = options.context;
    this.timeout = options.timeout ?? HANDSHAKE_TIMEOUT;
    this.maxRetries = options.maxRetries ?? MAX_RETRY_ATTEMPTS;
    this.onStateChange = options.onStateChange;
    this.onSuccess = options.onSuccess;
    this.onFailure = options.onFailure;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start the handshake process.
   * Waits for READY message from extension and performs handshake sequence.
   *
   * @returns Promise that resolves with handshake result
   */
  start(): Promise<HandshakeResult> {
    if (this.state !== 'idle' && this.state !== 'failed' && this.state !== 'timeout') {
      return Promise.reject(
        new HandshakeError('INVALID_STATE', `Cannot start handshake from state: ${this.state}`),
      );
    }

    // Reset state
    this.reset();
    this.startTime = Date.now();

    // Transition to waiting state
    this.setState('waiting_for_ready');

    // Set up timeout
    this.startTimeout();

    return new Promise((resolve) => {
      this.handshakeResolve = resolve;
    });
  }

  /**
   * Handle an incoming READY message from the extension.
   * Called by the message handler when a READY message is received.
   *
   * @param message - The READY message
   */
  handleReadyMessage(message: ReadyMessage): void {
    if (this.state === 'waiting_for_ready') {
      // First READY - validate and send INIT
      this.handleFirstReady(message);
    } else if (this.state === 'sent_init') {
      // Second READY - complete handshake
      this.handleSecondReady(message);
    }
    // Ignore READY in other states
  }

  /**
   * Cancel the handshake.
   */
  cancel(): void {
    this.clearTimeouts();

    if (this.state !== 'connected' && this.state !== 'failed' && this.state !== 'timeout') {
      const error = new HandshakeError('CANCELLED', 'Handshake was cancelled');
      this.completeWithFailure(error);
    }
  }

  /**
   * Get the current handshake state.
   */
  getState(): HandshakeState {
    return this.state;
  }

  /**
   * Get the session ID (only valid after successful handshake).
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if handshake completed successfully.
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * Destroy the handshake manager and clean up resources.
   */
  destroy(): void {
    this.clearTimeouts();
    this.handshakeResolve = null;
  }

  // ---------------------------------------------------------------------------
  // Handshake Sequence
  // ---------------------------------------------------------------------------

  /**
   * Handle the first READY message from extension.
   */
  private handleFirstReady(message: ReadyMessage): void {
    // Validate extension ID matches manifest
    if (message.extensionId !== this.manifest.id) {
      const error = new HandshakeValidationError(
        `Extension ID mismatch: expected "${this.manifest.id}", got "${message.extensionId}"`,
        'extensionId',
      );
      this.completeWithFailure(error);
      return;
    }

    // Store received info
    this.receivedExtensionId = message.extensionId;
    this.receivedVersion = message.version;
    this.receivedShimVersion = message.shimVersion ?? null;

    // Send INIT message
    this.bridge.sendInit(this.permissions, this.context);
    this.setState('sent_init');

    // Reset timeout for next phase
    this.resetTimeout();
  }

  /**
   * Handle the second READY message (after INIT processed).
   */
  private handleSecondReady(message: ReadyMessage): void {
    // Validate extension ID still matches
    if (message.extensionId !== this.manifest.id) {
      const error = new HandshakeValidationError(
        `Extension ID mismatch on second READY: expected "${this.manifest.id}", got "${message.extensionId}"`,
        'extensionId',
      );
      this.completeWithFailure(error);
      return;
    }

    // Generate session ID
    this.sessionId = this.generateSessionId();

    // Send CONNECTED message
    this.bridge.sendConnected(this.sessionId);

    // Complete handshake successfully
    this.completeWithSuccess();
  }

  // ---------------------------------------------------------------------------
  // State Management
  // ---------------------------------------------------------------------------

  /**
   * Transition to a new state.
   */
  private setState(newState: HandshakeState): void {
    const oldState = this.state;
    this.state = newState;

    if (oldState !== newState) {
      this.onStateChange?.(newState);
    }
  }

  /**
   * Reset handshake state for a new attempt.
   */
  private reset(): void {
    this.sessionId = null;
    this.receivedExtensionId = null;
    this.receivedVersion = null;
    this.receivedShimVersion = null;
    this.clearTimeouts();
  }

  // ---------------------------------------------------------------------------
  // Timeout Management
  // ---------------------------------------------------------------------------

  /**
   * Start the handshake timeout.
   */
  private startTimeout(): void {
    this.clearTimeouts();

    this.timeoutHandle = setTimeout(() => {
      this.handleTimeout();
    }, this.timeout);
  }

  /**
   * Reset the timeout (restart timer).
   */
  private resetTimeout(): void {
    this.startTimeout();
  }

  /**
   * Clear all timeouts.
   */
  private clearTimeouts(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.retryHandle) {
      clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
  }

  /**
   * Handle handshake timeout.
   */
  private handleTimeout(): void {
    const error = new HandshakeTimeoutError(this.state, this.timeout);

    // Check if we should retry
    if (this.retryCount < this.maxRetries) {
      this.scheduleRetry();
    } else {
      this.setState('timeout');
      this.completeWithFailure(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Retry Logic
  // ---------------------------------------------------------------------------

  /**
   * Schedule a retry attempt.
   */
  private scheduleRetry(): void {
    this.retryCount++;
    const delay = this.getRetryDelay(this.retryCount);

    this.retryHandle = setTimeout(() => {
      this.retry();
    }, delay);
  }

  /**
   * Retry the handshake from the beginning.
   */
  private retry(): void {
    // Reset state but preserve retry count
    const savedRetryCount = this.retryCount;
    this.reset();
    this.retryCount = savedRetryCount;

    // Transition back to waiting
    this.setState('waiting_for_ready');
    this.startTimeout();
  }

  /**
   * Calculate retry delay with exponential backoff.
   */
  private getRetryDelay(attempt: number): number {
    const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
    return Math.min(delay, RETRY_MAX_DELAY);
  }

  // ---------------------------------------------------------------------------
  // Completion
  // ---------------------------------------------------------------------------

  /**
   * Complete handshake successfully.
   */
  private completeWithSuccess(): void {
    this.clearTimeouts();
    this.setState('connected');

    const result: HandshakeResult = {
      success: true,
      sessionId: this.sessionId!,
      extensionId: this.receivedExtensionId!,
      extensionVersion: this.receivedVersion!,
      shimVersion: this.receivedShimVersion ?? undefined,
      retryCount: this.retryCount,
      durationMs: Date.now() - this.startTime,
    };

    this.onSuccess?.(this.sessionId!);
    this.handshakeResolve?.(result);
  }

  /**
   * Complete handshake with failure.
   */
  private completeWithFailure(error: Error): void {
    this.clearTimeouts();

    // Only set to 'failed' if not already in a terminal state
    // (allows 'timeout' state to be preserved)
    if (this.state !== 'timeout') {
      this.setState('failed');
    }

    const result: HandshakeResult = {
      success: false,
      error,
      retryCount: this.retryCount,
      durationMs: Date.now() - this.startTime,
    };

    this.onFailure?.(error);
    this.handshakeResolve?.(result);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Generate a unique session ID.
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${this.manifest.id}-${timestamp}-${random}`;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new HandshakeManager instance.
 */
export function createHandshakeManager(options: HandshakeOptions): HandshakeManager {
  return new HandshakeManager(options);
}
