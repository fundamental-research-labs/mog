/**
 * View Registry
 *
 * Central registry for all view types (Grid, Kanban, Timeline, etc.).
 * Views register themselves using ViewDefinition, enabling a pluggable view system.
 *
 * Design principle: Grid is just the first registered view - no special treatment.
 */

import type { ViewAdapter, ViewAdapterConfig, ViewDefinition, ViewType } from './types';

/**
 * ViewRegistry manages view type registration and adapter creation.
 *
 * Usage:
 * ```typescript
 * // Register a view type (typically in view definition file)
 * VIEW_REGISTRY.register(gridViewDefinition);
 *
 * // Create an adapter instance
 * const adapter = VIEW_REGISTRY.createAdapter('grid', config);
 *
 * // List available views
 * const views = VIEW_REGISTRY.list();
 * ```
 */
export class ViewRegistry {
  private definitions = new Map<ViewType, ViewDefinition>();

  /**
   * Register a view definition.
   * Idempotent — re-registering the same type replaces the previous definition
   * (required for Vite HMR where modules re-execute against a persistent singleton).
   */
  register<T extends ViewType>(definition: ViewDefinition<T>): void {
    this.definitions.set(definition.type, definition);
  }

  /**
   * Get a view definition by type.
   * @returns ViewDefinition or undefined if not registered
   */
  get(type: ViewType): ViewDefinition | undefined {
    return this.definitions.get(type);
  }

  /**
   * List all registered view definitions.
   * @returns Array of view definitions (order not guaranteed)
   */
  list(): ViewDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Create a view adapter instance.
   * @throws Error if view type is not registered
   */
  createAdapter<T extends ViewType>(type: T, config: ViewAdapterConfig<T>): ViewAdapter {
    const definition = this.definitions.get(type);
    if (!definition) {
      throw new Error(
        `View type '${type}' is not registered. Available types: ${Array.from(this.definitions.keys()).join(', ')}`,
      );
    }
    return definition.createAdapter(config);
  }

  /**
   * Check if a view type is registered.
   */
  has(type: ViewType): boolean {
    return this.definitions.has(type);
  }

  /**
   * Unregister a view type (primarily for testing).
   */
  unregister(type: ViewType): void {
    this.definitions.delete(type);
  }

  /**
   * Clear all registrations (primarily for testing).
   */
  clear(): void {
    this.definitions.clear();
  }
}

/**
 * Global view registry instance.
 * Views self-register by importing their definition files.
 */
export const VIEW_REGISTRY = new ViewRegistry();
