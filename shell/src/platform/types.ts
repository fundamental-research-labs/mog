/**
 * App Platform Types
 *
 * Product-neutral types for the shell app/plugin platform. These are
 * defined locally until `@mog-sdk/types-app-platform` is published by
 * the canonical contracts package. Once that package exists, this file
 * becomes a re-export shim.
 *
 * Mirrors `@mog-sdk/types-app-platform`.
 *
 */

import type { AppLoader } from '../apps/types';

// ===========================================================================
// Re-exports for convenience
// ===========================================================================

export type { AppLoader };

// ===========================================================================
// App Manifest (product-neutral canonical shape)
// ===========================================================================

// ===========================================================================
// App Identity
// ===========================================================================

/**
 * Branded app ID string.
 */
export type AppId = string & { readonly __brand?: 'AppId' };

// ===========================================================================
// App Kind
// ===========================================================================

export type AppKind =
  | 'document-app'
  | 'dataset-app'
  | 'workspace-app'
  | 'utility-app'
  | 'background-app';

// ===========================================================================
// Runtime Host Mode
// ===========================================================================

export type RuntimeHostMode =
  | 'same-realm-first-party'
  | 'iframe-sandbox'
  | 'worker-sandbox'
  | 'server-side'
  | 'remote-bridge'
  | 'disabled';

// ===========================================================================
// Stability Tier
// ===========================================================================

export type StabilityTier = 'experimental' | 'preview' | 'stable' | 'deprecated';

// ===========================================================================
// Compatibility
// ===========================================================================

export interface CompatibilityRequirement {
  readonly profile: string;
  readonly versionRange: string;
}

export interface AppEntryDescriptor {
  readonly module: string;
  readonly export?: string;
}

export interface ManifestContributionRef {
  readonly contributionPointId: string;
  readonly kind: string;
  readonly id: string;
  readonly label?: string;
  readonly icon?: string;
}

export interface ManifestRouteDeclaration {
  readonly path: string;
  readonly label?: string;
  readonly requiredCapabilities?: readonly string[];
}

export interface ManifestDataDeclaration {
  readonly stores?: readonly string[];
  readonly resourceKinds?: readonly string[];
}

export interface ManifestLifecycleDeclaration {
  readonly suspendable?: boolean;
  readonly background?: boolean;
  readonly maxStartupMs?: number;
}

export interface AppManifest {
  readonly id: AppId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly icon: string;
  readonly entry: AppEntryDescriptor;
  readonly kind: AppKind;
  readonly compatibility: readonly CompatibilityRequirement[];
  readonly capabilities: readonly string[];
  readonly routes: readonly ManifestRouteDeclaration[];
  readonly data: ManifestDataDeclaration;
  readonly contributions: readonly ManifestContributionRef[];
  readonly lifecycle: ManifestLifecycleDeclaration;
  readonly runtimeHost: RuntimeHostMode;
}

// ===========================================================================
// Validation shape used by package registry / validation module
// ===========================================================================

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

// ===========================================================================
// Package
// ===========================================================================

export type PackageSource = 'built-in' | 'local-dev' | 'marketplace' | 'runtime-provided';

export type PackageState =
  | 'discovered'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'incompatible'
  | 'uninstalled';

export interface PackageInstallationRecord {
  readonly packageId: string;
  readonly version: string;
  readonly source: PackageSource;
  readonly installedAt: number;
  readonly installedBy?: string;
  readonly manifestDigest?: string;
  readonly artifactDigest?: string;
}

// ===========================================================================
// App Instance
// ===========================================================================

export type AppInstanceId = string & { readonly __brand?: 'AppInstanceId' };

export type AppInstanceState =
  | 'created'
  | 'launching'
  | 'running'
  | 'suspended'
  | 'closing'
  | 'closed'
  | 'launchDenied'
  | 'crashed';

export interface AppInstanceSnapshot {
  readonly instanceId: AppInstanceId;
  readonly appId: AppId;
  readonly state: AppInstanceState;
  readonly route: RouteSnapshot;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export function createAppInstanceId(): AppInstanceId {
  return `inst_${Date.now()}_${Math.random().toString(36).slice(2, 10)}` as AppInstanceId;
}

// ===========================================================================
// Routing (merged from D + E)
// ===========================================================================

export type RouteTargetKind = 'workspace' | 'resource' | 'settings' | 'plugin-panel' | 'custom';

/** A resolved route target (from E). */
export interface RouteTarget {
  readonly appId: AppId;
  readonly resourceKind: string;
  readonly path: string;
}

/**
 * A snapshot of the current route state.
 *
 * Older manifests use `kind`; newer manifests use `target`. The merged type
 * includes both (both optional) so consumers from either shape compile.
 */
export interface RouteSnapshot {
  readonly kind?: RouteTargetKind;
  readonly path: string;
  readonly target?: RouteTarget | null;
  readonly params?: Readonly<Record<string, string>>;
}

// ===========================================================================
// Access Modes & Setup Policy (from E)
// ===========================================================================

/** How a resource binding accesses the underlying resource. */
export type AccessMode = 'read' | 'write' | 'readwrite';

/** When the resource should be provisioned. */
export type SetupPolicy = 'eager' | 'lazy';

// ===========================================================================
// Resource Binding (merged from D + E — E is the most complete)
// ===========================================================================

/** A reference to a resource instance. */
export interface ResourceRef {
  readonly kind: string;
  readonly id: string;
}

/** Describes a binding request before resolution. */
export interface ResourceBindingDescriptor {
  readonly bindingKey?: string;
  readonly resourceKind: string;
  readonly resourceId?: string;
  readonly accessMode: AccessMode | 'admin';
  readonly setupPolicy?: SetupPolicy;
  readonly label?: string;
}

/** A resolved binding with an active lease. */
export interface ResolvedResourceBinding {
  readonly descriptor: ResourceBindingDescriptor;
  readonly resourceRef?: ResourceRef;
  readonly resourceId?: string;
  readonly leaseId?: string;
  readonly grantSubject?: string;
  readonly resolvedAt?: number;
}

/** Public-facing snapshot of a binding (no internal lease details). */
export interface AppResourceBindingSnapshot {
  readonly bindingKey?: string;
  readonly resourceKind: string;
  readonly resourceId?: string;
  readonly accessMode: AccessMode | 'admin';
  readonly label?: string;
  readonly displayName?: string;
}

/** State of a resource lease. */
export type ResourceLeaseState =
  | 'active'
  | 'suspended-retain'
  | 'suspended-downgrade'
  | 'released'
  | 'transferred';

/** A resource lease tracking object. */
export interface ResourceLease {
  readonly leaseId: string;
  readonly resourceRef: ResourceRef;
  readonly grantSubject: string;
  state: ResourceLeaseState;
}

/** Diagnostics for binding failures. */
export interface BindingDiagnostics {
  readonly code: string;
  readonly message: string;
  readonly resourceKind: string;
}

// ===========================================================================
// Host Services (from E)
// ===========================================================================

/** Routing service exposed to apps. */
export interface AppRoutingService {
  navigate(path: string): void;
  getCurrentPath(): string;
}

/** Command service exposed to apps. */
export interface AppCommandService {
  register(id: string, handler: () => void | Promise<void>): void;
  unregister(id: string): void;
  execute(id: string): Promise<void>;
  isAvailable(id: string): boolean;
}

/** Resource service exposed to apps. */
export interface AppResourceService {
  getBindings(): readonly AppResourceBindingSnapshot[];
  getBinding(resourceKind: string): AppResourceBindingSnapshot | undefined;
}

/** Capability service exposed to apps. */
export interface AppCapabilityService {
  has(capability: string): boolean;
  list(): readonly string[];
}

/** Clipboard service exposed to apps. */
export interface AppClipboardService {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/** Dialog service exposed to apps. */
export interface AppDialogService {
  confirm(message: string): Promise<boolean>;
  alert(message: string): Promise<void>;
}

/** Notification service exposed to apps. */
export interface AppNotificationService {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Key-value storage service exposed to apps. */
export interface AppStorageService {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): readonly string[];
}

/** Telemetry service exposed to apps. */
export interface AppTelemetryService {
  track(event: string, properties?: Record<string, unknown>): void;
}

/** Focus service exposed to apps. */
export interface AppFocusService {
  requestFocus(elementId: string): void;
  releaseFocus(elementId: string): void;
  hasFocus(elementId: string): boolean;
}

/** Aggregate host services provided by the shell to apps. */
export interface ShellHostServices {
  readonly routing: AppRoutingService;
  readonly commands: AppCommandService;
  readonly resources: AppResourceService;
  readonly capabilities: AppCapabilityService;
  readonly clipboard: AppClipboardService;
  readonly dialogs: AppDialogService;
  readonly notifications: AppNotificationService;
  readonly storage: AppStorageService;
  readonly telemetry: AppTelemetryService;
  readonly focus: AppFocusService;
}

/** Runtime context provided to an app instance. */
export interface AppHostContext {
  readonly instanceId: string;
  readonly manifest: AppManifest;
  readonly route: RouteSnapshot;
  readonly bindings: readonly AppResourceBindingSnapshot[];
  readonly services: ShellHostServices;
  readonly capabilities: readonly string[];
}

/** Function signature for an app entry point. */
export type AppEntryFunction = (context: AppHostContext) => AppRuntimeHandle;

/** Handle returned by an app entry function for lifecycle control. */
export interface AppRuntimeHandle {
  dispose(): void;
}

// ===========================================================================
// Contribution Point types (from F)
// ===========================================================================

/** Dot-separated contribution point identifier, e.g. `mog.commands`. */
export type ContributionPointId = string & { readonly __brand?: 'ContributionPointId' };

/** Capability identifier required by a contribution. */
export type CapabilityId = string & { readonly __brand?: 'CapabilityId' };

export type ContributionKind =
  | 'command'
  | 'menu'
  | 'panel'
  | 'fileHandler'
  | 'settingsPage'
  | 'statusBarItem'
  | 'toolbarItem'
  | 'navigationItem';

export type CompatibilityProfileId = string;

/** How duplicate contribution IDs are handled at a given point. */
export type OverridePolicy = 'reject' | 'last-wins' | 'first-wins';

export interface OrderingGroupPolicy {
  readonly group: string;
  readonly sortOrder: 'ascending' | 'descending';
}

/** Which kinds of sources may contribute to a point. */
export type AllowedContributorKind = 'shell' | 'app' | 'plugin' | 'any';

export interface ContributionPointRegistration {
  readonly id: ContributionPointId;
  readonly kind: ContributionKind;
  readonly description: string;
  readonly stability: StabilityTier;
  readonly overridePolicy: OverridePolicy;
  readonly allowedContributorKinds: readonly AllowedContributorKind[];
  readonly schemaVersion: number;
}

export interface ContributionMetadata {
  readonly contributionId: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly when?: string;
}

export interface CommandContribution extends ContributionMetadata {
  readonly commandId: string;
  readonly shortcut?: string;
}

export interface MenuContribution extends ContributionMetadata {
  readonly group?: string;
  readonly order?: number;
  readonly commandId: string;
}

export interface PanelContribution extends ContributionMetadata {
  readonly location: 'sidebar' | 'bottom' | 'main';
  readonly defaultVisible?: boolean;
}

export interface FileHandlerContribution extends ContributionMetadata {
  readonly extensions: readonly string[];
  readonly mimeTypes?: readonly string[];
}

export interface ContributionDeclaration {
  readonly targetPointId: ContributionPointId;
  readonly contributorKind: AllowedContributorKind;
  readonly schemaVersion: number;
  readonly priority: number;
  readonly group?: string;
  readonly isOverride?: boolean;
  readonly requiredCapabilities?: readonly CapabilityId[];
  readonly metadata: ContributionMetadata;
}

export type ConflictKind = 'duplicate-id' | 'shortcut-conflict' | 'schema-mismatch';

export interface ContributionConflict {
  readonly kind: ConflictKind;
  readonly contributionIds: readonly string[];
  readonly message: string;
}

export interface ResolvedContribution {
  readonly sourceId: string;
  readonly declaration: ContributionDeclaration;
}

export interface ContributionResolutionResult {
  readonly pointId: ContributionPointId;
  readonly contributions: readonly ResolvedContribution[];
  readonly conflicts: readonly ContributionConflict[];
}

/**
 * Contribution-specific validation result (from F).
 * Uses `errors: string[]` instead of the legacy `issues` shape.
 */
export interface ContributionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// ===========================================================================
// Plugin types (from G)
// ===========================================================================

/** Branded plugin identifier. */
export type PluginId = string & { readonly __brand?: 'PluginId' };

/**
 * How a plugin's code is executed relative to the host process.
 *
 * Current only supports `same-realm-trusted`.
 */
export type PluginIsolationMode =
  | 'same-realm-trusted'
  | 'worker-sandbox'
  | 'iframe-sandbox'
  | 'server-side'
  | 'disabled';

/** Declares a plugin's identity, isolation requirements, and contributions. */
export interface PluginManifest {
  readonly id: PluginId;
  readonly name: string;
  readonly version: string;
  readonly isolation: PluginIsolationMode;
  readonly entry?: string;
  readonly requiredCapabilities?: readonly string[];
  readonly description?: string;
}

/** Lifecycle state of a registered plugin. */
export type PluginInstanceState =
  | 'registered'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'inactive'
  | 'denied'
  | 'unsupportedIsolation'
  | 'crashed';

/** Runtime record for an activated (or attempted) plugin. */
export interface PluginActivation {
  readonly pluginId: PluginId;
  readonly state: PluginInstanceState;
  readonly activatedAt?: number;
  readonly deactivatedAt?: number;
  readonly crashDiagnostics?: string;
}

// ===========================================================================
// Trust (from G)
// ===========================================================================

/** Where a package's trust originates. */
export type TrustSource =
  | 'bundled-first-party'
  | 'marketplace-verified'
  | 'marketplace-unverified'
  | 'local-dev'
  | 'unknown';

/** Trust record associated with a specific package (app or plugin). */
export interface PackageTrustRecord {
  readonly packageId: string;
  readonly trustSource: TrustSource;
  readonly verifiedAt?: string;
}

/** Result of a trust policy evaluation for app launch. */
export interface LaunchTrustDecision {
  readonly allowed: boolean;
  readonly trustSource: TrustSource;
  readonly autoGrant: boolean;
  readonly reason?: string;
}

/** Result of a trust policy evaluation for plugin activation. */
export interface ActivationTrustDecision {
  readonly allowed: boolean;
  readonly trustSource: TrustSource;
  readonly reason?: string;
}
