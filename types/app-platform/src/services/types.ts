import type { AppId } from '../manifest/types';
import type { AppInstanceId } from '../lifecycle/types';
import type { AppManifest } from '../manifest/types';
import type { AppResourceBindingSnapshot } from '../routing/types';
import type { RouteSnapshot, RouteTarget } from '../routing/types';

// ─── Service Interfaces ──────────────────────────────────────────────────────

/** Navigate between routes and query current location. */
export interface IRoutingService {
  /** Navigate to a route target. */
  navigate(target: RouteTarget): Promise<void>;
  /** Get the current route snapshot. */
  getCurrentRoute(): RouteSnapshot;
  /** Subscribe to route changes. */
  onRouteChange(callback: (route: RouteSnapshot) => void): () => void;
}

/** Register and execute commands. */
export interface ICommandService {
  /** Execute a command by ID with optional arguments. */
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  /** Check whether a command is currently available. */
  isCommandAvailable(commandId: string): boolean;
}

/** Query and access bound resources. */
export interface IResourceService {
  /** Get the public binding snapshot for a logical key. */
  getBinding(logicalKey: string): AppResourceBindingSnapshot | undefined;
  /** List all active binding snapshots. */
  listBindings(): readonly AppResourceBindingSnapshot[];
}

/** Query granted capabilities. */
export interface ICapabilityService {
  /** Check whether a capability is granted. */
  hasCapability(capabilityId: string): boolean;
  /** Request a capability at runtime (may prompt the user). */
  requestCapability(capabilityId: string): Promise<boolean>;
}

/** Platform clipboard access. */
export interface IClipboardService {
  /** Read text from the clipboard. */
  readText(): Promise<string>;
  /** Write text to the clipboard. */
  writeText(text: string): Promise<void>;
}

/** Severity level for a dialog. */
export type DialogSeverity = 'info' | 'warning' | 'error';

/** Show modal dialogs. */
export interface IDialogService {
  /** Show a confirmation dialog and return the user's choice. */
  confirm(
    message: string,
    options?: { title?: string; severity?: DialogSeverity },
  ): Promise<boolean>;
  /** Show an alert dialog. */
  alert(message: string, options?: { title?: string; severity?: DialogSeverity }): Promise<void>;
}

/** Show transient notifications. */
export interface INotificationService {
  /** Show an informational notification. */
  info(message: string): void;
  /** Show a warning notification. */
  warn(message: string): void;
  /** Show an error notification. */
  error(message: string): void;
}

/** Scoped key-value storage for app state. */
export interface IStorageService {
  /** Read a value by key. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Write a value by key. */
  set<T = unknown>(key: string, value: T): Promise<void>;
  /** Delete a value by key. */
  delete(key: string): Promise<void>;
}

/** Structured telemetry for apps. */
export interface ITelemetryService {
  /** Track a named event with optional properties. */
  trackEvent(name: string, properties?: Record<string, unknown>): void;
  /** Track an error. */
  trackError(error: Error, properties?: Record<string, unknown>): void;
}

/** Focus management for the app host. */
export interface IFocusService {
  /** Request focus for the app's root element. */
  requestFocus(): void;
  /** Release focus back to the host. */
  releaseFocus(): void;
  /** Check whether the app currently has focus. */
  hasFocus(): boolean;
}

// ─── Shell Host Services ─────────────────────────────────────────────────────

/** Aggregate of all host services available to apps. */
export interface ShellHostServices {
  /** Route navigation and observation. */
  readonly routing: IRoutingService;
  /** Command execution. */
  readonly commands: ICommandService;
  /** Resource binding queries. */
  readonly resources: IResourceService;
  /** Capability queries and requests. */
  readonly capabilities: ICapabilityService;
  /** Clipboard access. */
  readonly clipboard: IClipboardService;
  /** Modal dialog display. */
  readonly dialogs: IDialogService;
  /** Transient notification display. */
  readonly notifications: INotificationService;
  /** Scoped key-value storage. */
  readonly storage: IStorageService;
  /** Structured telemetry. */
  readonly telemetry: ITelemetryService;
  /** Focus management. */
  readonly focus: IFocusService;
}

// ─── App Host Context ────────────────────────────────────────────────────────

/** Context provided to an app's entry function at launch. */
export interface AppHostContext {
  /** Running instance identity. */
  readonly instance: AppInstanceId;
  /** App manifest. */
  readonly manifest: AppManifest;
  /** Current route. */
  readonly route: RouteSnapshot;
  /** Active resource bindings. */
  readonly bindings: readonly AppResourceBindingSnapshot[];
  /** Host services. */
  readonly services: ShellHostServices;
  /** Granted capability IDs. */
  readonly capabilities: readonly string[];
}

// ─── App Runtime Handle ──────────────────────────────────────────────────────

/** Opaque handle returned by non-React app entry functions. */
export interface AppRuntimeHandle {
  /** Called when the host wants the app to clean up. */
  dispose(): void;
}

/** App entry function signature (generic return to avoid React dependency). */
export type AppEntryFunction<TRenderResult = unknown> = (
  context: AppHostContext,
) => TRenderResult | AppRuntimeHandle;
