/**
 * App Bindings API Implementation
 *
 * Manages app instances and their data bindings.
 * Replaced CRDT maps with in-memory cache.
 *
 * Architecture:
 * - In-memory Map for app instances (synchronous reads)
 * - ComputeBridge delegation for persistence (when available)
 *
 * // TODO: Wire ComputeBridge binding methods for cross-session persistence
 *
 */

import type { AppInstance, IAppBindingsAPI, TableBinding } from '@mog-sdk/contracts/apps';
import { KernelError } from '../../errors';

// =============================================================================
// AppBindingsAPI Implementation
// =============================================================================

/**
 * Implementation of IAppBindingsAPI.
 *
 * Replaced CRDT maps with in-memory storage.
 * App instances are stored in a plain Map for fast synchronous access.
 *
 * // TODO: Add ComputeBridge binding CRUD for cross-session persistence
 */
export class AppBindingsAPIImpl implements IAppBindingsAPI {
  private instances: Map<string, AppInstance> = new Map();

  constructor() {
    // No external dependencies needed for in-memory storage
  }

  /**
   * Get all instances for an app type.
   */
  getInstances(appId: string): AppInstance[] {
    const result: AppInstance[] = [];
    this.instances.forEach((instance) => {
      if (instance.appId === appId) {
        result.push(instance);
      }
    });
    return result;
  }

  /**
   * Get a specific instance by ID.
   */
  getInstance(instanceId: string): AppInstance | null {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * Create a new app instance.
   */
  createInstance(appId: string, name: string): AppInstance {
    const instance: AppInstance = {
      instanceId: `${appId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      appId,
      name,
      bindings: {},
      setupComplete: false,
      createdAt: Date.now(),
    };

    this.instances.set(instance.instanceId, instance);

    return instance;
  }

  /**
   * Update instance bindings.
   */
  updateBindings(instanceId: string, bindings: Record<string, TableBinding>): void {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new KernelError('OPERATION_FAILED', `App instance not found: ${instanceId}`);
    }

    this.instances.set(instanceId, { ...instance, bindings });
  }

  /**
   * Mark instance setup as complete.
   */
  completeSetup(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new KernelError('OPERATION_FAILED', `App instance not found: ${instanceId}`);
    }

    this.instances.set(instanceId, { ...instance, setupComplete: true });
  }

  /**
   * Delete an instance.
   */
  deleteInstance(instanceId: string): void {
    this.instances.delete(instanceId);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an AppBindingsAPI instance.
 *
 * No longer requires IKernelContext (no CRDT dependency).
 */
export function createAppBindingsAPI(): IAppBindingsAPI {
  return new AppBindingsAPIImpl();
}
