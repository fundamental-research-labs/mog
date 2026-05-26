/**
 * Request Tracker
 *
 * Tracks pending API requests from extensions with timeout management.
 * Provides request/response correlation and enforces limits on concurrent requests.
 *
 * Features:
 * - Request/response correlation via unique IDs
 * - Configurable timeout per request
 * - Maximum pending request limit enforcement
 * - Automatic cleanup of timed-out requests
 * - Request statistics for monitoring
 *
 * @module extensions/messaging/RequestTracker
 */

import { API_REQUEST_TIMEOUT, MAX_PENDING_REQUESTS } from '../constants';
import type { PendingRequest } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface RequestTrackerOptions {
  /** Default timeout for requests in ms (default: 30000) */
  defaultTimeout?: number;
  /** Maximum number of pending requests (default: 50) */
  maxPendingRequests?: number;
  /** Callback when a request times out */
  onTimeout?: (request: PendingRequest) => void;
}

export interface RequestTrackerStats {
  /** Number of currently pending requests */
  pending: number;
  /** Total requests tracked since creation */
  total: number;
  /** Number of requests that timed out */
  timedOut: number;
  /** Number of requests that completed successfully */
  completed: number;
  /** Number of requests that failed with error */
  failed: number;
}

export interface TrackRequestOptions {
  /** Timeout for this specific request (overrides default) */
  timeout?: number;
}

// =============================================================================
// Errors
// =============================================================================

export class RequestTrackerError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequestTrackerError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(
    public requestId: string,
    public method: string,
    public timeoutMs: number,
  ) {
    super(`Request ${requestId} (${method}) timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

export class TooManyRequestsError extends Error {
  constructor(
    public current: number,
    public max: number,
  ) {
    super(
      `Too many pending requests (${current}/${max}). Please wait for some requests to complete.`,
    );
    this.name = 'TooManyRequestsError';
  }
}

// =============================================================================
// Request Tracker Implementation
// =============================================================================

export class RequestTracker {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private timeoutHandles: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private defaultTimeout: number;
  private maxPendingRequests: number;
  private onTimeout?: (request: PendingRequest) => void;

  // Statistics
  private totalRequests = 0;
  private timedOutRequests = 0;
  private completedRequests = 0;
  private failedRequests = 0;

  constructor(options: RequestTrackerOptions = {}) {
    this.defaultTimeout = options.defaultTimeout ?? API_REQUEST_TIMEOUT;
    this.maxPendingRequests = options.maxPendingRequests ?? MAX_PENDING_REQUESTS;
    this.onTimeout = options.onTimeout;
  }

  // ---------------------------------------------------------------------------
  // Request Management
  // ---------------------------------------------------------------------------

  /**
   * Track a new pending request.
   *
   * @param id - Unique request ID
   * @param method - API method being called
   * @param options - Request options
   * @returns Promise that resolves/rejects when request completes
   * @throws TooManyRequestsError if at capacity
   */
  track<T = unknown>(id: string, method: string, options: TrackRequestOptions = {}): Promise<T> {
    // Check capacity
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      throw new TooManyRequestsError(this.pendingRequests.size, this.maxPendingRequests);
    }

    // Check for duplicate ID
    if (this.pendingRequests.has(id)) {
      throw new RequestTrackerError('DUPLICATE_ID', `Request with ID ${id} already exists`);
    }

    const timeout = options.timeout ?? this.defaultTimeout;

    return new Promise<T>((resolve, reject) => {
      const request: PendingRequest = {
        id,
        method,
        timestamp: Date.now(),
        resolve: resolve as (result: unknown) => void,
        reject,
      };

      // Store the request
      this.pendingRequests.set(id, request);
      this.totalRequests++;

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(id, method, timeout);
      }, timeout);

      this.timeoutHandles.set(id, timeoutHandle);
    });
  }

  /**
   * Resolve a pending request with a result.
   *
   * @param id - Request ID to resolve
   * @param result - Result value
   * @returns true if request was found and resolved, false otherwise
   */
  resolve(id: string, result: unknown): boolean {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return false;
    }

    this.cleanup(id);
    this.completedRequests++;
    request.resolve(result);
    return true;
  }

  /**
   * Reject a pending request with an error.
   *
   * @param id - Request ID to reject
   * @param error - Error to reject with
   * @returns true if request was found and rejected, false otherwise
   */
  reject(id: string, error: Error): boolean {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return false;
    }

    this.cleanup(id);
    this.failedRequests++;
    request.reject(error);
    return true;
  }

  /**
   * Check if a request is pending.
   *
   * @param id - Request ID to check
   * @returns true if request is pending
   */
  isPending(id: string): boolean {
    return this.pendingRequests.has(id);
  }

  /**
   * Get a pending request by ID.
   *
   * @param id - Request ID
   * @returns The pending request or undefined
   */
  get(id: string): PendingRequest | undefined {
    return this.pendingRequests.get(id);
  }

  /**
   * Get all pending requests.
   *
   * @returns Array of pending requests
   */
  getAll(): PendingRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Get pending requests for a specific method.
   *
   * @param method - API method to filter by
   * @returns Array of pending requests for the method
   */
  getByMethod(method: string): PendingRequest[] {
    return this.getAll().filter((r) => r.method === method);
  }

  // ---------------------------------------------------------------------------
  // Capacity Management
  // ---------------------------------------------------------------------------

  /**
   * Get the current number of pending requests.
   */
  get size(): number {
    return this.pendingRequests.size;
  }

  /**
   * Check if at capacity for pending requests.
   */
  get isAtCapacity(): boolean {
    return this.pendingRequests.size >= this.maxPendingRequests;
  }

  /**
   * Get remaining capacity for new requests.
   */
  get remainingCapacity(): number {
    return Math.max(0, this.maxPendingRequests - this.pendingRequests.size);
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get request statistics.
   */
  getStats(): RequestTrackerStats {
    return {
      pending: this.pendingRequests.size,
      total: this.totalRequests,
      timedOut: this.timedOutRequests,
      completed: this.completedRequests,
      failed: this.failedRequests,
    };
  }

  /**
   * Reset statistics (but not pending requests).
   */
  resetStats(): void {
    this.totalRequests = this.pendingRequests.size;
    this.timedOutRequests = 0;
    this.completedRequests = 0;
    this.failedRequests = 0;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Cancel a pending request without resolving or rejecting.
   *
   * @param id - Request ID to cancel
   * @returns true if request was found and cancelled
   */
  cancel(id: string): boolean {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return false;
    }

    this.cleanup(id);
    request.reject(new Error('Request cancelled'));
    return true;
  }

  /**
   * Cancel all pending requests.
   *
   * @param error - Error to reject with (default: 'All requests cancelled')
   */
  cancelAll(error?: Error): void {
    const rejectError = error ?? new Error('All requests cancelled');
    const requests = Array.from(this.pendingRequests.values());

    for (const request of requests) {
      this.cleanup(request.id);
      request.reject(rejectError);
    }
  }

  /**
   * Destroy the tracker and cancel all pending requests.
   * Pending request promises will be rejected with 'Request tracker destroyed'.
   */
  destroy(): void {
    // Cancel all pending requests
    const destroyError = new Error('Request tracker destroyed');
    const requests = Array.from(this.pendingRequests.values());

    for (const request of requests) {
      this.cleanup(request.id);
      request.reject(destroyError);
    }

    this.pendingRequests.clear();
    this.timeoutHandles.clear();
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Handle request timeout.
   */
  private handleTimeout(id: string, method: string, timeout: number): void {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return;
    }

    // Remove from pending
    this.pendingRequests.delete(id);
    this.timeoutHandles.delete(id);
    this.timedOutRequests++;

    // Create timeout error
    const error = new RequestTimeoutError(id, method, timeout);

    // Notify callback if provided
    if (this.onTimeout) {
      this.onTimeout(request);
    }

    // Reject the promise
    request.reject(error);
  }

  /**
   * Clean up a request (remove from maps and clear timeout).
   */
  private cleanup(id: string): void {
    this.pendingRequests.delete(id);

    const timeoutHandle = this.timeoutHandles.get(id);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.timeoutHandles.delete(id);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new RequestTracker instance.
 */
export function createRequestTracker(options?: RequestTrackerOptions): RequestTracker {
  return new RequestTracker(options);
}
