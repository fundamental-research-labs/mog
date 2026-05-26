/**
 * Shell App Platform
 *
 * Unified module for app/plugin registry, lifecycle, routing, resource
 * binding, host services, contribution points, trust, and isolation.
 *
 */

// ===========================================================================
// Types
// ===========================================================================

export type {
  // App identity & manifest
  AppId,
  AppKind,
  AppLoader,
  AppManifest,
  RuntimeHostMode,
  StabilityTier,
  CompatibilityRequirement,

  // Validation shape
  ValidationIssue,
  ValidationResult,

  // Package
  PackageSource,
  PackageState,
  PackageInstallationRecord,

  // App instance
  AppInstanceId,
  AppInstanceState,
  AppInstanceSnapshot,

  // Routing
  RouteTargetKind,
  RouteTarget,
  RouteSnapshot,

  // Resource binding
  AccessMode,
  SetupPolicy,
  ResourceRef,
  ResourceBindingDescriptor,
  ResolvedResourceBinding,
  AppResourceBindingSnapshot,
  ResourceLeaseState,
  ResourceLease,
  BindingDiagnostics,

  // Host services
  AppRoutingService,
  AppCommandService,
  AppResourceService,
  AppCapabilityService,
  AppClipboardService,
  AppDialogService,
  AppNotificationService,
  AppStorageService,
  AppTelemetryService,
  AppFocusService,
  ShellHostServices,
  AppHostContext,
  AppEntryFunction,
  AppRuntimeHandle,

  // Contribution points
  ContributionPointId,
  CapabilityId,
  ContributionKind,
  CompatibilityProfileId,
  OverridePolicy,
  OrderingGroupPolicy,
  AllowedContributorKind,
  ContributionPointRegistration,
  ContributionMetadata,
  CommandContribution,
  MenuContribution,
  PanelContribution,
  FileHandlerContribution,
  ContributionDeclaration,
  ConflictKind,
  ContributionConflict,
  ResolvedContribution,
  ContributionResolutionResult,
  ContributionValidationResult,

  // Plugin types
  PluginId,
  PluginIsolationMode,
  PluginManifest,
  PluginInstanceState,
  PluginActivation,

  // Trust
  TrustSource,
  PackageTrustRecord,
  LaunchTrustDecision,
  ActivationTrustDecision,
} from './types';

export { createAppInstanceId } from './types';

// ===========================================================================
// Validation
// ===========================================================================

export { validateAppManifest, validateRuntimeHostCompatibility } from './validation';

// ===========================================================================
// Package Registry
// ===========================================================================

export type {
  EnableResult,
  IPackageRegistryService,
  PackageRegistryEntry,
  PackageRegistrySnapshot,
} from './package-registry';
export { PackageRegistryService } from './package-registry';

// ===========================================================================
// App Registry
// ===========================================================================

export type { AppRegistryEntry, IAppRegistryService } from './app-registry';
export { AppRegistryService } from './app-registry';

// ===========================================================================
// Plugin Registry stub
// ===========================================================================

export type { IPluginRegistryService, PluginRegistryEntry } from './plugin-registry';
export { PluginRegistryService } from './plugin-registry';

// ===========================================================================
// App Instance Manager
// ===========================================================================

export type { IAppInstanceManager, LaunchResult } from './app-instance-manager';
export { AppInstanceManager } from './app-instance-manager';

// ===========================================================================
// Resource Provider Registry
// ===========================================================================

export type {
  ResourceProviderRegistration,
  IResourceProviderRegistry,
} from './resource-provider-registry';
export { createResourceProviderRegistry } from './resource-provider-registry';

// ===========================================================================
// Resource Binding Service
// ===========================================================================

export type { IResourceBindingService, BindingError } from './resource-binding-service';
export { createResourceBindingService } from './resource-binding-service';

// ===========================================================================
// Host Services
// ===========================================================================

export type { HostServiceDeps } from './host-services';
export { createShellHostServices } from './host-services';

// ===========================================================================
// App Host Context Factory
// ===========================================================================

export type { CreateAppHostContextParams } from './app-host-context-factory';
export { createAppHostContext } from './app-host-context-factory';

// ===========================================================================
// Spreadsheet Resource Adapter
// ===========================================================================

export {
  registerSpreadsheetResourceProvider,
  WORKBOOK_RESOURCE_KIND,
  WORKBOOK_OWNER_PACKAGE,
  WORKBOOK_FILE_EXTENSIONS,
} from './spreadsheet-resource-adapter';

// ===========================================================================
// Contribution Point Registry
// ===========================================================================

export type { IContributionPointRegistry } from './contribution-point-registry';
export { ContributionPointRegistry } from './contribution-point-registry';

// ===========================================================================
// Contribution Resolver
// ===========================================================================

export type { IContributionResolver } from './contribution-resolver';
export { ContributionResolver } from './contribution-resolver';

// ===========================================================================
// Contribution Enablement
// ===========================================================================

export type { EnablementContext } from './contribution-enablement';
export { evaluateEnablementPredicate } from './contribution-enablement';

// ===========================================================================
// Isolation Enforcer
// ===========================================================================

export type { IsolationDecision, IIsolationEnforcer } from './isolation-enforcer';
export { createIsolationEnforcer } from './isolation-enforcer';

// ===========================================================================
// Trust Integration
// ===========================================================================

export type { ShellTrustIntegration, ShellTrustConfig } from './trust-integration';
export { createShellTrustIntegration } from './trust-integration';

// ===========================================================================
// Plugin Activation Manager
// ===========================================================================

export type {
  IPluginActivationManager,
  PluginActivationTarget,
  ActivationResult,
  PluginStateChangeCallback,
} from './plugin-activation-manager';
export { createPluginActivationManager } from './plugin-activation-manager';

// ===========================================================================
// Package Boundary Validator
// ===========================================================================

export type {
  IPackageBoundaryValidator,
  BoundaryValidationResult,
  BoundaryViolation,
} from './package-boundary-validator';
export { createPackageBoundaryValidator } from './package-boundary-validator';
