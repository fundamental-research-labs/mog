/**
 * Host Services — concrete `ShellHostServices` implementation.
 *
 * Wraps existing shell services into the product-neutral host-services
 * contract that apps consume. Current implementations are intentionally
 * simple (in-memory storage, no-op telemetry).
 *
 */

import type { AppResourceBindingSnapshot, ShellHostServices } from './types';

// ============================================================
// Dependency injection
// ============================================================

export interface HostServiceDeps {
  /** Existing shell navigation (optional — stub if absent). */
  routing?: {
    navigate: (path: string) => void;
    getCurrentPath: () => string;
  };

  /** Existing shell notification service (optional). */
  notifications?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };

  /** Pre-resolved bindings to expose via the resources service. */
  bindings?: readonly AppResourceBindingSnapshot[];

  /** Capability strings granted to this app instance. */
  capabilities?: readonly string[];
}

// ============================================================
// Factory
// ============================================================

export function createShellHostServices(deps: HostServiceDeps): ShellHostServices {
  // ----- routing -----
  const routingDep = deps.routing;
  const routing = {
    navigate(path: string): void {
      if (routingDep) {
        routingDep.navigate(path);
      }
    },
    getCurrentPath(): string {
      return routingDep ? routingDep.getCurrentPath() : '/';
    },
  };

  // ----- commands (in-memory registry) -----
  const commandHandlers = new Map<string, () => void | Promise<void>>();
  const commands = {
    register(id: string, handler: () => void | Promise<void>): void {
      commandHandlers.set(id, handler);
    },
    unregister(id: string): void {
      commandHandlers.delete(id);
    },
    async execute(id: string): Promise<void> {
      const handler = commandHandlers.get(id);
      if (!handler) throw new Error(`Command not found: ${id}`);
      await handler();
    },
    isAvailable(id: string): boolean {
      return commandHandlers.has(id);
    },
  };

  // ----- resources -----
  const bindingsList = deps.bindings ?? [];
  const resources = {
    getBindings(): readonly AppResourceBindingSnapshot[] {
      return bindingsList;
    },
    getBinding(resourceKind: string): AppResourceBindingSnapshot | undefined {
      return bindingsList.find((b) => b.resourceKind === resourceKind);
    },
  };

  // ----- capabilities -----
  const capList = deps.capabilities ?? [];
  const capabilities = {
    has(capability: string): boolean {
      return capList.includes(capability);
    },
    list(): readonly string[] {
      return capList;
    },
  };

  // ----- clipboard (navigator.clipboard with graceful fallback) -----
  const clipboard = {
    async readText(): Promise<string> {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        return navigator.clipboard.readText();
      }
      return '';
    },
    async writeText(text: string): Promise<void> {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    },
  };

  // ----- dialogs (simple confirm/alert) -----
  const dialogs = {
    async confirm(message: string): Promise<boolean> {
      if (typeof window !== 'undefined') {
        return window.confirm(message);
      }
      return false;
    },
    async alert(message: string): Promise<void> {
      if (typeof window !== 'undefined') {
        window.alert(message);
      }
    },
  };

  // ----- notifications -----
  const notifDep = deps.notifications;
  const notifications = {
    info(message: string): void {
      if (notifDep) notifDep.info(message);
    },
    warn(message: string): void {
      if (notifDep) notifDep.warn(message);
    },
    error(message: string): void {
      if (notifDep) notifDep.error(message);
    },
  };

  // ----- storage (in-memory key-value for current implementation) -----
  const store = new Map<string, string>();
  const storage = {
    get(key: string): string | undefined {
      return store.get(key);
    },
    set(key: string, value: string): void {
      store.set(key, value);
    },
    delete(key: string): void {
      store.delete(key);
    },
    keys(): readonly string[] {
      return Array.from(store.keys());
    },
  };

  // ----- telemetry (no-op for current implementation) -----
  const telemetry = {
    track(_event: string, _properties?: Record<string, unknown>): void {
      // no-op
    },
  };

  // ----- focus (simple tracking) -----
  const focusedElements = new Set<string>();
  const focus = {
    requestFocus(elementId: string): void {
      focusedElements.add(elementId);
    },
    releaseFocus(elementId: string): void {
      focusedElements.delete(elementId);
    },
    hasFocus(elementId: string): boolean {
      return focusedElements.has(elementId);
    },
  };

  return {
    routing,
    commands,
    resources,
    capabilities,
    clipboard,
    dialogs,
    notifications,
    storage,
    telemetry,
    focus,
  };
}
