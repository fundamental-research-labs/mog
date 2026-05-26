/**
 * App Instance Manager
 *
 * Manages the lifecycle of running app instances. Each instance tracks
 * state transitions, timestamps, and route/binding context independently.
 *
 */

import type {
  AppId,
  AppInstanceId,
  AppInstanceState,
  AppInstanceSnapshot,
  RouteSnapshot,
} from './types';
import { createAppInstanceId } from './types';
import type { IAppRegistryService } from './app-registry';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type LaunchResult =
  | { success: true; instanceId: AppInstanceId }
  | { success: false; reason: 'denied' | 'incompatible' | 'crashed'; message: string };

type StateChangeCallback = (instanceId: AppInstanceId, state: AppInstanceState) => void;

export interface IAppInstanceManager {
  // Lifecycle
  createInstance(appId: AppId, route: RouteSnapshot): AppInstanceId;
  launchInstance(instanceId: AppInstanceId): Promise<LaunchResult>;
  suspendInstance(instanceId: AppInstanceId): void;
  resumeInstance(instanceId: AppInstanceId): void;
  closeInstance(instanceId: AppInstanceId): void;

  // Queries
  getInstance(instanceId: AppInstanceId): AppInstanceSnapshot | undefined;
  getInstancesByApp(appId: AppId): readonly AppInstanceSnapshot[];
  listInstances(): readonly AppInstanceSnapshot[];
  getActiveInstance(): AppInstanceId | undefined;

  // Focus
  setActiveInstance(instanceId: AppInstanceId): void;

  // Events
  onInstanceStateChange(callback: StateChangeCallback): () => void;
}

// ---------------------------------------------------------------------------
// Internal mutable instance
// ---------------------------------------------------------------------------

interface MutableInstance {
  instanceId: AppInstanceId;
  appId: AppId;
  state: AppInstanceState;
  route: RouteSnapshot;
  createdAt: number;
  lastActiveAt: number;
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<AppInstanceState, readonly AppInstanceState[]> = {
  created: ['launching'],
  launching: ['running', 'launchDenied', 'crashed'],
  running: ['suspended', 'closing', 'crashed'],
  suspended: ['running', 'closing', 'crashed'],
  closing: ['closed', 'crashed'],
  closed: [],
  launchDenied: [],
  crashed: [],
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class AppInstanceManager implements IAppInstanceManager {
  private readonly instances = new Map<AppInstanceId, MutableInstance>();
  private readonly listeners = new Set<StateChangeCallback>();
  private activeInstanceId: AppInstanceId | undefined;

  constructor(private readonly appRegistry: IAppRegistryService) {}

  // ---- Lifecycle ----------------------------------------------------------

  createInstance(appId: AppId, route: RouteSnapshot): AppInstanceId {
    const instanceId = createAppInstanceId();
    const now = Date.now();

    this.instances.set(instanceId, {
      instanceId,
      appId,
      state: 'created',
      route,
      createdAt: now,
      lastActiveAt: now,
    });

    return instanceId;
  }

  async launchInstance(instanceId: AppInstanceId): Promise<LaunchResult> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return {
        success: false,
        reason: 'denied',
        message: `Instance '${instanceId}' does not exist`,
      };
    }

    // Transition: created -> launching
    this.transition(instance, 'launching');

    // Verify app is registered and enabled
    const app = this.appRegistry.getApp(instance.appId);
    if (!app) {
      this.transition(instance, 'launchDenied');
      return {
        success: false,
        reason: 'incompatible',
        message: `App '${instance.appId}' is not registered or not enabled`,
      };
    }

    try {
      // same-realm-first-party only, so we just mark as running.
      // In future versions, this would set up iframe/worker sandboxes,
      // resolve resource bindings, and initialize host services.
      this.transition(instance, 'running');
      instance.lastActiveAt = Date.now();

      return { success: true, instanceId };
    } catch (err) {
      this.transition(instance, 'crashed');
      return {
        success: false,
        reason: 'crashed',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  suspendInstance(instanceId: AppInstanceId): void {
    const instance = this.requireInstance(instanceId);
    this.transition(instance, 'suspended');
  }

  resumeInstance(instanceId: AppInstanceId): void {
    const instance = this.requireInstance(instanceId);
    this.transition(instance, 'running');
    instance.lastActiveAt = Date.now();
  }

  closeInstance(instanceId: AppInstanceId): void {
    const instance = this.requireInstance(instanceId);
    this.transition(instance, 'closing');
    // Dispose subscriptions and handles
    this.transition(instance, 'closed');
    if (this.activeInstanceId === instanceId) {
      this.activeInstanceId = undefined;
    }
  }

  // ---- Queries ------------------------------------------------------------

  getInstance(instanceId: AppInstanceId): AppInstanceSnapshot | undefined {
    const instance = this.instances.get(instanceId);
    return instance ? this.toSnapshot(instance) : undefined;
  }

  getInstancesByApp(appId: AppId): readonly AppInstanceSnapshot[] {
    return Array.from(this.instances.values())
      .filter((i) => i.appId === appId)
      .map((i) => this.toSnapshot(i));
  }

  listInstances(): readonly AppInstanceSnapshot[] {
    return Array.from(this.instances.values()).map((i) => this.toSnapshot(i));
  }

  getActiveInstance(): AppInstanceId | undefined {
    return this.activeInstanceId;
  }

  // ---- Focus --------------------------------------------------------------

  setActiveInstance(instanceId: AppInstanceId): void {
    const instance = this.requireInstance(instanceId);
    this.activeInstanceId = instanceId;
    instance.lastActiveAt = Date.now();
  }

  // ---- Events -------------------------------------------------------------

  onInstanceStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  // ---- Internal -----------------------------------------------------------

  private requireInstance(instanceId: AppInstanceId): MutableInstance {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance '${instanceId}' does not exist`);
    }
    return instance;
  }

  private transition(instance: MutableInstance, newState: AppInstanceState): void {
    const allowed = VALID_TRANSITIONS[instance.state];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: '${instance.state}' -> '${newState}' for instance '${instance.instanceId}'`,
      );
    }
    instance.state = newState;
    for (const listener of this.listeners) {
      listener(instance.instanceId, newState);
    }
  }

  private toSnapshot(instance: MutableInstance): AppInstanceSnapshot {
    return {
      instanceId: instance.instanceId,
      appId: instance.appId,
      state: instance.state,
      route: instance.route,
      createdAt: instance.createdAt,
      lastActiveAt: instance.lastActiveAt,
    };
  }
}
