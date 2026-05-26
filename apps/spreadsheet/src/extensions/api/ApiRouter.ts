/**
 * API Router
 *
 * Routes API_REQUEST messages from extensions to the appropriate handlers.
 * Integrates permission enforcement, method registry, and result serialization.
 *
 * @module extensions/api
 */

import { EXTENSION_PROTOCOL_VERSION } from '../constants';
import {
  PermissionDeniedError,
  PermissionEnforcer,
  MethodNotFoundError as PermissionMethodNotFoundError,
  type PermissionEnforcerOptions,
} from '../permissions';
import type {
  ApiError,
  ApiRequestMessage,
  ApiResponseMessage,
  ExtensionInstance,
  ExtensionPermission,
} from '../types';
import {
  ApiMethodRegistry,
  MethodExecutionError,
  MethodNotRegisteredError,
  type ApiContext,
  type ApiMethodDefinition,
  type ApiMethodRegistryOptions,
} from './ApiMethodRegistry';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of routing an API request
 */
export interface RouteResult {
  /** The response message to send back */
  response: ApiResponseMessage;
  /** Duration of the request in milliseconds */
  durationMs: number;
}

/**
 * Options for creating an ApiRouter
 */
export interface ApiRouterOptions {
  /** Custom permission enforcer */
  permissionEnforcer?: PermissionEnforcer;
  /** Custom method registry */
  methodRegistry?: ApiMethodRegistry;
  /** Options for the permission enforcer (if not providing a custom one) */
  permissionOptions?: PermissionEnforcerOptions;
  /** Options for the method registry (if not providing a custom one) */
  registryOptions?: ApiMethodRegistryOptions;
  /**
   * Callback when a request starts processing.
   */
  onRequestStart?: (request: ApiRequestMessage, extension: ExtensionInstance) => void;
  /**
   * Callback when a request completes (success or failure).
   */
  onRequestComplete?: (
    request: ApiRequestMessage,
    response: ApiResponseMessage,
    durationMs: number,
  ) => void;
  /**
   * Callback for audit logging permission denials.
   */
  onPermissionDenied?: (
    method: string,
    extension: ExtensionInstance,
    required: ExtensionPermission[],
    granted: ExtensionPermission[],
  ) => void;
}

/**
 * Statistics about API routing
 */
export interface ApiRouterStats {
  /** Total requests processed */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests (permission denied, method not found, execution error) */
  failedRequests: number;
  /** Permission denials */
  permissionDenials: number;
  /** Method not found errors */
  methodNotFound: number;
  /** Execution errors */
  executionErrors: number;
  /** Average request duration in milliseconds */
  averageDurationMs: number;
}

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Standard error codes for API responses
 */
export const API_ERROR_CODES = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_CONNECTED: 'NOT_CONNECTED',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// =============================================================================
// ApiRouter Class
// =============================================================================

/**
 * Routes API requests from extensions to handlers with permission enforcement.
 *
 * Usage:
 * ```typescript
 * const router = new ApiRouter();
 *
 * // Register method handlers
 * router.registerMethod({
 * name: 'sheet.getCell',
 * handler: async (ctx, row, col) => spreadsheetApi.getCell(row, col),
 * });
 *
 * // Route a request
 * const { response } = await router.route(request, extension);
 * messageBridge.send(response);
 * ```
 */
export class ApiRouter {
  private readonly permissionEnforcer: PermissionEnforcer;
  private readonly methodRegistry: ApiMethodRegistry;
  private readonly options: ApiRouterOptions;

  // Statistics
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private permissionDenials = 0;
  private methodNotFound = 0;
  private executionErrors = 0;
  private totalDurationMs = 0;

  constructor(options: ApiRouterOptions = {}) {
    this.options = options;
    this.permissionEnforcer =
      options.permissionEnforcer ?? new PermissionEnforcer(options.permissionOptions);
    this.methodRegistry = options.methodRegistry ?? new ApiMethodRegistry(options.registryOptions);
  }

  // ---------------------------------------------------------------------------
  // Method Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an API method handler.
   */
  registerMethod<TArgs extends unknown[] = unknown[], TResult = unknown>(
    definition: ApiMethodDefinition<TArgs, TResult>,
  ): void {
    this.methodRegistry.register(definition);
  }

  /**
   * Register multiple method handlers.
   */
  registerMethods(definitions: ApiMethodDefinition[]): void {
    this.methodRegistry.registerAll(definitions);
  }

  /**
   * Unregister a method handler.
   */
  unregisterMethod(name: string): boolean {
    return this.methodRegistry.unregister(name);
  }

  /**
   * Check if a method is registered.
   */
  hasMethod(name: string): boolean {
    return this.methodRegistry.has(name);
  }

  // ---------------------------------------------------------------------------
  // Request Routing
  // ---------------------------------------------------------------------------

  /**
   * Route an API request to the appropriate handler.
   *
   * This method:
   * 1. Validates the request
   * 2. Checks permissions
   * 3. Executes the handler
   * 4. Serializes the result
   * 5. Returns an API response
   *
   * @param request - The API_REQUEST message from the extension
   * @param extension - The extension instance making the request
   * @returns RouteResult with the response and duration
   */
  async route(request: ApiRequestMessage, extension: ExtensionInstance): Promise<RouteResult> {
    const startTime = performance.now();
    this.totalRequests++;
    this.options.onRequestStart?.(request, extension);

    try {
      // Step 1: Validate extension is connected
      if (extension.state !== 'ready' || !extension.sessionId) {
        return this.createErrorResult(request, startTime, {
          code: API_ERROR_CODES.NOT_CONNECTED,
          message: 'Extension is not connected',
        });
      }

      // Step 2: Check permissions
      try {
        this.permissionEnforcer.enforce(request.method, extension.manifest.permissions);
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          this.permissionDenials++;
          this.options.onPermissionDenied?.(
            request.method,
            extension,
            error.requiredPermissions,
            error.grantedPermissions,
          );
          return this.createErrorResult(request, startTime, {
            code: API_ERROR_CODES.PERMISSION_DENIED,
            message: error.message,
            details: {
              required: error.requiredPermissions,
              granted: error.grantedPermissions,
            },
          });
        }
        if (error instanceof PermissionMethodNotFoundError) {
          this.methodNotFound++;
          return this.createErrorResult(request, startTime, {
            code: API_ERROR_CODES.METHOD_NOT_FOUND,
            message: error.message,
          });
        }
        throw error;
      }

      // Step 3: Check if method is registered
      if (!this.methodRegistry.has(request.method)) {
        this.methodNotFound++;
        return this.createErrorResult(request, startTime, {
          code: API_ERROR_CODES.METHOD_NOT_FOUND,
          message: `Method '${request.method}' is not implemented`,
        });
      }

      // Step 4: Build context and execute
      const context: ApiContext = {
        extensionId: extension.manifest.id,
        sessionId: extension.sessionId,
        permissions: extension.manifest.permissions,
        activeSheetId: '', // TODO: Get from spreadsheet state
        activeSheetName: '', // TODO: Get from spreadsheet state
      };

      const result = await this.methodRegistry.execute(request.method, context, request.args);

      // Step 5: Serialize result and return success response
      const serializedResult = this.serializeForPostMessage(result);
      this.successfulRequests++;

      return this.createSuccessResult(request, startTime, serializedResult);
    } catch (error) {
      this.executionErrors++;

      // Handle known error types
      if (error instanceof MethodNotRegisteredError) {
        this.methodNotFound++;
        return this.createErrorResult(request, startTime, {
          code: API_ERROR_CODES.METHOD_NOT_FOUND,
          message: error.message,
        });
      }

      if (error instanceof MethodExecutionError) {
        return this.createErrorResult(request, startTime, {
          code: API_ERROR_CODES.EXECUTION_ERROR,
          message: error.message,
          details: { cause: error.cause.message },
        });
      }

      // Unknown error
      const message = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(request, startTime, {
        code: API_ERROR_CODES.INTERNAL_ERROR,
        message: `Internal error: ${message}`,
      });
    }
  }

  /**
   * Route multiple requests in batch.
   * Useful for batched operations from extensions.
   */
  async routeBatch(
    requests: ApiRequestMessage[],
    extension: ExtensionInstance,
  ): Promise<RouteResult[]> {
    return Promise.all(requests.map((req) => this.route(req, extension)));
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get routing statistics.
   */
  getStats(): ApiRouterStats {
    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      permissionDenials: this.permissionDenials,
      methodNotFound: this.methodNotFound,
      executionErrors: this.executionErrors,
      averageDurationMs: this.totalRequests > 0 ? this.totalDurationMs / this.totalRequests : 0,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.permissionDenials = 0;
    this.methodNotFound = 0;
    this.executionErrors = 0;
    this.totalDurationMs = 0;
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get the permission enforcer.
   */
  getPermissionEnforcer(): PermissionEnforcer {
    return this.permissionEnforcer;
  }

  /**
   * Get the method registry.
   */
  getMethodRegistry(): ApiMethodRegistry {
    return this.methodRegistry;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Create a success response.
   */
  private createSuccessResult(
    request: ApiRequestMessage,
    startTime: number,
    result: unknown,
  ): RouteResult {
    const durationMs = performance.now() - startTime;
    this.totalDurationMs += durationMs;

    const response: ApiResponseMessage = {
      protocol: EXTENSION_PROTOCOL_VERSION,
      type: 'API_RESPONSE',
      id: this.generateMessageId(),
      timestamp: Date.now(),
      requestId: request.id,
      success: true,
      result,
    };

    this.options.onRequestComplete?.(request, response, durationMs);

    return { response, durationMs };
  }

  /**
   * Create an error response.
   */
  private createErrorResult(
    request: ApiRequestMessage,
    startTime: number,
    error: ApiError,
  ): RouteResult {
    const durationMs = performance.now() - startTime;
    this.totalDurationMs += durationMs;
    this.failedRequests++;

    const response: ApiResponseMessage = {
      protocol: EXTENSION_PROTOCOL_VERSION,
      type: 'API_RESPONSE',
      id: this.generateMessageId(),
      timestamp: Date.now(),
      requestId: request.id,
      success: false,
      error,
    };

    this.options.onRequestComplete?.(request, response, durationMs);

    return { response, durationMs };
  }

  /**
   * Generate a unique message ID.
   */
  private generateMessageId(): string {
    return `resp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Serialize a value for postMessage (must be structured-cloneable).
   *
   * This ensures the result can be sent via postMessage without errors.
   * Functions, symbols, and other non-cloneable types are removed.
   */
  private serializeForPostMessage(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Primitives are fine
    if (typeof value !== 'object' && typeof value !== 'function') {
      return value;
    }

    // Functions cannot be cloned
    if (typeof value === 'function') {
      return undefined;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.serializeForPostMessage(item));
    }

    // Handle Date
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Handle Map
    if (value instanceof Map) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Array.from(value.entries())) {
        if (typeof k === 'string') {
          obj[k] = this.serializeForPostMessage(v);
        }
      }
      return obj;
    }

    // Handle Set
    if (value instanceof Set) {
      return Array.from(value).map((item) => this.serializeForPostMessage(item));
    }

    // Handle plain objects
    if (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    ) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // Skip symbols and functions
        if (typeof v !== 'function' && typeof v !== 'symbol') {
          obj[k] = this.serializeForPostMessage(v);
        }
      }
      return obj;
    }

    // For other objects (class instances), try to convert to plain object
    try {
      const plain = JSON.parse(JSON.stringify(value));
      return plain;
    } catch {
      // If JSON serialization fails, return undefined
      return undefined;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ApiRouter.
 */
export function createApiRouter(options: ApiRouterOptions = {}): ApiRouter {
  return new ApiRouter(options);
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultRouter: ApiRouter | null = null;

/**
 * Get the default ApiRouter instance (singleton).
 */
export function getDefaultApiRouter(): ApiRouter {
  if (!defaultRouter) {
    defaultRouter = new ApiRouter();
  }
  return defaultRouter;
}

/**
 * Reset the default router (for testing).
 */
export function resetDefaultApiRouter(): void {
  defaultRouter = null;
}
