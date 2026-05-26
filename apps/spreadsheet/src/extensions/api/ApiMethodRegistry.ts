/**
 * API Method Registry
 *
 * Registry of available API methods that extensions can call.
 * Each method has a handler function that executes the actual operation.
 *
 * @module extensions/api
 */

import type { ExtensionPermission } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Context passed to API method handlers.
 * Contains information about the calling extension and current state.
 */
export interface ApiContext {
  /** Extension ID making the request */
  extensionId: string;
  /** Session ID for the current connection */
  sessionId: string;
  /** Permissions granted to the extension */
  permissions: ExtensionPermission[];
  /** Active sheet ID */
  activeSheetId: string;
  /** Active sheet name */
  activeSheetName: string;
}

/**
 * Handler function for an API method.
 * Takes a context and arguments, returns a promise with the result.
 */
export type ApiMethodHandler<TArgs extends unknown[] = unknown[], TResult = unknown> = (
  context: ApiContext,
  ...args: TArgs
) => Promise<TResult>;

/**
 * Definition of an API method in the registry.
 */
export interface ApiMethodDefinition<TArgs extends unknown[] = unknown[], TResult = unknown> {
  /** Unique method name (e.g., "sheet.getCell") */
  name: string;
  /** Handler function that executes the method */
  handler: ApiMethodHandler<TArgs, TResult>;
  /** Human-readable description */
  description?: string;
  /** Expected argument types (for documentation) */
  argTypes?: string[];
  /** Return type (for documentation) */
  returnType?: string;
}

/**
 * Options for creating an ApiMethodRegistry
 */
export interface ApiMethodRegistryOptions {
  /**
   * Callback when a method is called.
   * Useful for logging/debugging.
   */
  onMethodCall?: (method: string, context: ApiContext, args: unknown[]) => void;

  /**
   * Callback when a method call completes.
   */
  onMethodComplete?: (
    method: string,
    context: ApiContext,
    result: unknown,
    durationMs: number,
  ) => void;

  /**
   * Callback when a method call fails.
   */
  onMethodError?: (method: string, context: ApiContext, error: Error, durationMs: number) => void;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when a method is not found in the registry
 */
export class MethodNotRegisteredError extends Error {
  constructor(public readonly method: string) {
    super(`Method '${method}' is not registered`);
    this.name = 'MethodNotRegisteredError';
  }
}

/**
 * Error thrown when trying to register a duplicate method
 */
export class DuplicateMethodError extends Error {
  constructor(public readonly method: string) {
    super(`Method '${method}' is already registered`);
    this.name = 'DuplicateMethodError';
  }
}

/**
 * Error thrown when a method handler fails
 */
export class MethodExecutionError extends Error {
  constructor(
    public readonly method: string,
    public readonly cause: Error,
  ) {
    super(`Method '${method}' failed: ${cause.message}`);
    this.name = 'MethodExecutionError';
  }
}

// =============================================================================
// ApiMethodRegistry Class
// =============================================================================

/**
 * Registry of API methods that extensions can call.
 *
 * Usage:
 * ```typescript
 * const registry = new ApiMethodRegistry();
 *
 * // Register a method
 * registry.register({
 * name: 'sheet.getCell',
 * handler: async (ctx, row, col) => {
 * return spreadsheetApi.getCell(ctx.activeSheetId, row, col);
 * },
 * description: 'Get a cell value',
 * });
 *
 * // Execute a method
 * const result = await registry.execute('sheet.getCell', context, [0, 0]);
 * ```
 */
export class ApiMethodRegistry {
  private readonly methods: Map<string, ApiMethodDefinition> = new Map();
  private readonly options: ApiMethodRegistryOptions;

  constructor(options: ApiMethodRegistryOptions = {}) {
    this.options = options;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an API method.
   * @throws DuplicateMethodError if method is already registered
   */
  register<TArgs extends unknown[] = unknown[], TResult = unknown>(
    definition: ApiMethodDefinition<TArgs, TResult>,
  ): void {
    if (this.methods.has(definition.name)) {
      throw new DuplicateMethodError(definition.name);
    }
    this.methods.set(definition.name, definition as ApiMethodDefinition);
  }

  /**
   * Register multiple methods at once.
   */
  registerAll(definitions: ApiMethodDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  /**
   * Unregister a method.
   * @returns true if the method was removed, false if it wasn't registered
   */
  unregister(name: string): boolean {
    return this.methods.delete(name);
  }

  /**
   * Check if a method is registered.
   */
  has(name: string): boolean {
    return this.methods.has(name);
  }

  /**
   * Get a method definition.
   */
  get(name: string): ApiMethodDefinition | undefined {
    return this.methods.get(name);
  }

  /**
   * Get all registered method names.
   */
  getMethodNames(): string[] {
    return Array.from(this.methods.keys());
  }

  /**
   * Get all method definitions.
   */
  getAllMethods(): ApiMethodDefinition[] {
    return Array.from(this.methods.values());
  }

  /**
   * Get the number of registered methods.
   */
  get size(): number {
    return this.methods.size;
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute an API method.
   *
   * @param name - Method name
   * @param context - API context (extension info, permissions, etc.)
   * @param args - Arguments to pass to the handler
   * @returns Promise with the result
   * @throws MethodNotRegisteredError if method is not registered
   * @throws MethodExecutionError if the handler throws
   */
  async execute(name: string, context: ApiContext, args: unknown[] = []): Promise<unknown> {
    const definition = this.methods.get(name);
    if (!definition) {
      throw new MethodNotRegisteredError(name);
    }

    const startTime = performance.now();
    this.options.onMethodCall?.(name, context, args);

    try {
      const result = await definition.handler(context, ...args);
      const durationMs = performance.now() - startTime;
      this.options.onMethodComplete?.(name, context, result, durationMs);
      return result;
    } catch (error) {
      const durationMs = performance.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onMethodError?.(name, context, err, durationMs);
      throw new MethodExecutionError(name, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Documentation
  // ---------------------------------------------------------------------------

  /**
   * Generate documentation for all registered methods.
   * Returns a map of method names to their documentation.
   */
  generateDocs(): Map<string, { description?: string; argTypes?: string[]; returnType?: string }> {
    const docs = new Map<
      string,
      { description?: string; argTypes?: string[]; returnType?: string }
    >();
    for (const [name, def] of Array.from(this.methods.entries())) {
      docs.set(name, {
        description: def.description,
        argTypes: def.argTypes,
        returnType: def.returnType,
      });
    }
    return docs;
  }

  /**
   * Get methods grouped by namespace (e.g., "sheet", "chart", "selection").
   */
  getMethodsByNamespace(): Map<string, ApiMethodDefinition[]> {
    const byNamespace = new Map<string, ApiMethodDefinition[]>();
    for (const def of Array.from(this.methods.values())) {
      const namespace = def.name.split('.')[0] ?? 'other';
      const existing = byNamespace.get(namespace) ?? [];
      existing.push(def);
      byNamespace.set(namespace, existing);
    }
    return byNamespace;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clear all registered methods.
   */
  clear(): void {
    this.methods.clear();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ApiMethodRegistry.
 */
export function createApiMethodRegistry(options: ApiMethodRegistryOptions = {}): ApiMethodRegistry {
  return new ApiMethodRegistry(options);
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultRegistry: ApiMethodRegistry | null = null;

/**
 * Get the default ApiMethodRegistry instance (singleton).
 */
export function getDefaultApiMethodRegistry(): ApiMethodRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ApiMethodRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (for testing).
 */
export function resetDefaultApiMethodRegistry(): void {
  defaultRegistry = null;
}
