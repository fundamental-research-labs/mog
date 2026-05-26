/**
 * Message Bridge
 *
 * Core message sending/receiving infrastructure for extension communication.
 * Provides secure postMessage communication with origin validation,
 * rate limiting, and request/response correlation.
 *
 * Features:
 * - Strict origin validation on all incoming messages
 * - Request/response correlation via message IDs
 * - Configurable timeout handling
 * - Rate limiting per extension (100 req/s default)
 * - Automatic message ID generation
 *
 * @module extensions/messaging/MessageBridge
 */

import {
  API_REQUESTS_PER_SECOND,
  API_REQUEST_TIMEOUT,
  EXTENSION_PROTOCOL_VERSION,
  RATE_LIMIT_WINDOW,
  getHostOrigin,
} from '../constants';
import { validateMessage } from '../security/message-validator';
import { validateExtensionOrigin } from '../security/origin-validator';
import type {
  ApiResponseMessage,
  ConnectedMessage,
  EventMessage,
  ExtensionToHostMessage,
  HostToExtensionMessage,
  InitMessage,
  RateLimiterState,
} from '../types';
import { RequestTimeoutError, RequestTracker, TooManyRequestsError } from './RequestTracker';

// =============================================================================
// Types
// =============================================================================

export interface MessageBridgeOptions {
  /** Extension ID for this bridge */
  extensionId: string;
  /** Target window (iframe contentWindow) */
  targetWindow: Window;
  /** Target origin for outgoing messages */
  targetOrigin: string;
  /** Default timeout for API requests (ms) */
  defaultTimeout?: number;
  /** Maximum API requests per second */
  maxRequestsPerSecond?: number;
  /** Callback for incoming messages */
  onMessage?: (message: ExtensionToHostMessage, origin: string) => void;
  /** Callback for errors */
  onError?: (error: Error, context?: string) => void;
  /** Callback for activity (for heartbeat tracking) */
  onActivity?: () => void;
}

export interface SendMessageOptions {
  /** Timeout for this specific message */
  timeout?: number;
  /** Whether this message expects a response */
  expectResponse?: boolean;
}

export interface MessageBridgeStats {
  /** Messages sent to extension */
  messagesSent: number;
  /** Messages received from extension */
  messagesReceived: number;
  /** Messages rejected (invalid origin or structure) */
  messagesRejected: number;
  /** Messages dropped due to rate limiting */
  messagesRateLimited: number;
  /** Request statistics from tracker */
  requests: {
    pending: number;
    total: number;
    timedOut: number;
    completed: number;
    failed: number;
  };
}

// =============================================================================
// Errors
// =============================================================================

export class MessageBridgeError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'MessageBridgeError';
  }
}

export class OriginValidationError extends MessageBridgeError {
  constructor(origin: string, reason: string) {
    super('ORIGIN_VALIDATION_FAILED', `Origin validation failed for ${origin}: ${reason}`);
    this.name = 'OriginValidationError';
  }
}

export class RateLimitError extends MessageBridgeError {
  constructor(
    public current: number,
    public limit: number,
  ) {
    super(
      'RATE_LIMIT_EXCEEDED',
      `Rate limit exceeded: ${current} requests in window (limit: ${limit}/s)`,
    );
    this.name = 'RateLimitError';
  }
}

// =============================================================================
// Message Bridge Implementation
// =============================================================================

export class MessageBridge {
  private extensionId: string;
  private targetWindow: Window;
  private targetOrigin: string;
  private hostOrigin: string;

  private requestTracker: RequestTracker;
  private rateLimiter: RateLimiterState;
  private maxRequestsPerSecond: number;

  private onMessage?: (message: ExtensionToHostMessage, origin: string) => void;
  private onError?: (error: Error, context?: string) => void;
  private onActivity?: () => void;

  private messageListener: ((event: MessageEvent) => void) | null = null;
  private isDestroyed = false;

  // Statistics
  private messagesSent = 0;
  private messagesReceived = 0;
  private messagesRejected = 0;
  private messagesRateLimited = 0;

  // Message ID counter for unique IDs
  private messageIdCounter = 0;

  constructor(options: MessageBridgeOptions) {
    this.extensionId = options.extensionId;
    this.targetWindow = options.targetWindow;
    this.targetOrigin = options.targetOrigin;
    this.hostOrigin = getHostOrigin();
    this.maxRequestsPerSecond = options.maxRequestsPerSecond ?? API_REQUESTS_PER_SECOND;

    this.onMessage = options.onMessage;
    this.onError = options.onError;
    this.onActivity = options.onActivity;

    // Initialize request tracker
    this.requestTracker = new RequestTracker({
      defaultTimeout: options.defaultTimeout ?? API_REQUEST_TIMEOUT,
      onTimeout: (request) => {
        this.handleRequestTimeout(request.id, request.method);
      },
    });

    // Initialize rate limiter
    this.rateLimiter = {
      timestamps: [],
      count: 0,
    };

    // Start listening for messages
    this.startListening();
  }

  // ---------------------------------------------------------------------------
  // Message Sending
  // ---------------------------------------------------------------------------

  /**
   * Send a message to the extension.
   *
   * @param message - Message to send (without protocol/id/timestamp)
   * @returns The full message that was sent
   */
  send<T extends HostToExtensionMessage>(message: Omit<T, 'protocol' | 'id' | 'timestamp'>): T {
    if (this.isDestroyed) {
      throw new MessageBridgeError('BRIDGE_DESTROYED', 'Message bridge has been destroyed');
    }

    // Build full message
    const fullMessage = {
      ...message,
      protocol: EXTENSION_PROTOCOL_VERSION,
      id: this.generateMessageId(),
      timestamp: Date.now(),
    } as T;

    // Send to target window
    this.targetWindow.postMessage(fullMessage, this.targetOrigin);
    this.messagesSent++;

    return fullMessage;
  }

  /**
   * Send an INIT message to the extension.
   */
  sendInit(permissions: InitMessage['permissions'], context: InitMessage['context']): InitMessage {
    return this.send<InitMessage>({
      type: 'INIT',
      hostOrigin: this.hostOrigin,
      permissions,
      context,
    });
  }

  /**
   * Send a CONNECTED message to the extension.
   */
  sendConnected(sessionId: string): ConnectedMessage {
    return this.send<ConnectedMessage>({
      type: 'CONNECTED',
      sessionId,
    });
  }

  /**
   * Send an API_RESPONSE message to the extension.
   */
  sendApiResponse(
    requestId: string,
    success: boolean,
    result?: unknown,
    error?: { code: string; message: string; details?: unknown },
  ): ApiResponseMessage {
    return this.send<ApiResponseMessage>({
      type: 'API_RESPONSE',
      requestId,
      success,
      result,
      error,
    });
  }

  /**
   * Send an EVENT message to the extension.
   */
  sendEvent(event: string, data: unknown): EventMessage {
    return this.send<EventMessage>({
      type: 'EVENT',
      event,
      data,
    });
  }

  // ---------------------------------------------------------------------------
  // Request/Response Correlation
  // ---------------------------------------------------------------------------

  /**
   * Track an outgoing request that expects a response.
   * Used by the host when waiting for API call results from extension.
   *
   * @param id - Request ID
   * @param method - Method being called
   * @param timeout - Optional timeout override
   * @returns Promise that resolves/rejects when response is received
   */
  trackRequest<T = unknown>(id: string, method: string, timeout?: number): Promise<T> {
    return this.requestTracker.track<T>(id, method, { timeout });
  }

  /**
   * Resolve a tracked request with a result.
   */
  resolveRequest(id: string, result: unknown): boolean {
    return this.requestTracker.resolve(id, result);
  }

  /**
   * Reject a tracked request with an error.
   */
  rejectRequest(id: string, error: Error): boolean {
    return this.requestTracker.reject(id, error);
  }

  /**
   * Check if a request is pending.
   */
  isRequestPending(id: string): boolean {
    return this.requestTracker.isPending(id);
  }

  // ---------------------------------------------------------------------------
  // Rate Limiting
  // ---------------------------------------------------------------------------

  /**
   * Check if the current request should be rate limited.
   *
   * @returns true if rate limit is exceeded
   */
  isRateLimited(): boolean {
    this.cleanupRateLimiter();
    return this.rateLimiter.count >= this.maxRequestsPerSecond;
  }

  /**
   * Record a request for rate limiting.
   *
   * @throws RateLimitError if rate limit exceeded
   */
  recordRequest(): void {
    this.cleanupRateLimiter();

    if (this.rateLimiter.count >= this.maxRequestsPerSecond) {
      this.messagesRateLimited++;
      throw new RateLimitError(this.rateLimiter.count, this.maxRequestsPerSecond);
    }

    this.rateLimiter.timestamps.push(Date.now());
    this.rateLimiter.count++;
  }

  /**
   * Clean up old timestamps from rate limiter.
   */
  private cleanupRateLimiter(): void {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Remove timestamps outside the window
    this.rateLimiter.timestamps = this.rateLimiter.timestamps.filter((ts) => ts > windowStart);
    this.rateLimiter.count = this.rateLimiter.timestamps.length;
  }

  // ---------------------------------------------------------------------------
  // Message Listening
  // ---------------------------------------------------------------------------

  /**
   * Start listening for messages from the extension.
   */
  private startListening(): void {
    if (this.messageListener) {
      return;
    }

    this.messageListener = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    window.addEventListener('message', this.messageListener);
  }

  /**
   * Stop listening for messages.
   */
  private stopListening(): void {
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
  }

  /**
   * Handle incoming message event.
   */
  private handleMessage(event: MessageEvent): void {
    // Skip if destroyed
    if (this.isDestroyed) {
      return;
    }

    // Validate origin
    const originResult = validateExtensionOrigin(event.origin);
    if (!originResult.valid) {
      // Silently ignore messages from unrecognized origins
      // (they're probably not meant for us)
      return;
    }

    // Validate message structure
    const messageResult = validateMessage(event.data);
    if (!messageResult.valid) {
      this.messagesRejected++;
      this.onError?.(
        new MessageBridgeError('INVALID_MESSAGE', messageResult.reason || 'Invalid message'),
        'message_validation',
      );
      return;
    }

    const message = messageResult.message!;
    this.messagesReceived++;

    // Notify activity for heartbeat tracking
    this.onActivity?.();

    // Pass to message handler
    this.onMessage?.(message, event.origin);
  }

  // ---------------------------------------------------------------------------
  // Timeout Handling
  // ---------------------------------------------------------------------------

  /**
   * Handle request timeout.
   */
  private handleRequestTimeout(requestId: string, method: string): void {
    this.onError?.(
      new RequestTimeoutError(requestId, method, API_REQUEST_TIMEOUT),
      'request_timeout',
    );
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Generate a unique message ID.
   */
  private generateMessageId(): string {
    this.messageIdCounter++;
    return `${this.extensionId}-${this.messageIdCounter}-${Date.now()}`;
  }

  /**
   * Get the extension ID for this bridge.
   */
  getExtensionId(): string {
    return this.extensionId;
  }

  /**
   * Get the target origin.
   */
  getTargetOrigin(): string {
    return this.targetOrigin;
  }

  /**
   * Check if the bridge is destroyed.
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get bridge statistics.
   */
  getStats(): MessageBridgeStats {
    return {
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      messagesRejected: this.messagesRejected,
      messagesRateLimited: this.messagesRateLimited,
      requests: this.requestTracker.getStats(),
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.messagesRejected = 0;
    this.messagesRateLimited = 0;
    this.requestTracker.resetStats();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Destroy the bridge and clean up resources.
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.stopListening();
    this.requestTracker.destroy();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new MessageBridge instance.
 */
export function createMessageBridge(options: MessageBridgeOptions): MessageBridge {
  return new MessageBridge(options);
}

// Re-export errors for convenience
export { RequestTimeoutError, TooManyRequestsError };
