// ─── Route Target Kind ───────────────────────────────────────────────────────

/** Classification of a route target. */
export type RouteTargetKind = 'workspace' | 'resource' | 'settings' | 'plugin-panel' | 'custom';

// ─── Resource Ref ────────────────────────────────────────────────────────────

/** Universal reference to a platform resource. */
export interface ResourceRef {
  /** Provider that owns this resource. */
  readonly provider: string;
  /** Kind/type of resource. */
  readonly resourceKind: string;
  /** Unique identifier within the provider. */
  readonly resourceId: string;
  /** Optional sub-resource path. */
  readonly subresource?: string;
  /** Optional version identifier. */
  readonly version?: string;
  /** Optional entity tag for concurrency. */
  readonly etag?: string;
}

// ─── Route Targets (discriminated union) ─────────────────────────────────────

/** Route to a workspace-level view. */
export interface WorkspaceRouteTarget {
  readonly kind: 'workspace';
}

/** Route to a bound resource. */
export interface ResourceRouteTarget {
  readonly kind: 'resource';
  /** Primary resource reference. */
  readonly resource: ResourceRef;
  /** Optional sub-resource reference. */
  readonly subresource?: ResourceRef;
}

/** Route to a settings page. */
export interface SettingsRouteTarget {
  readonly kind: 'settings';
  /** Settings section identifier. */
  readonly section?: string;
}

/** Route to a plugin panel. */
export interface PluginPanelRouteTarget {
  readonly kind: 'plugin-panel';
  /** Panel identifier. */
  readonly panelId: string;
}

/** Route to a custom target. */
export interface CustomRouteTarget {
  readonly kind: 'custom';
  /** Opaque target path. */
  readonly path: string;
  /** Opaque parameters. */
  readonly params?: Record<string, string>;
}

/** Discriminated union of all route target kinds. */
export type RouteTarget =
  | WorkspaceRouteTarget
  | ResourceRouteTarget
  | SettingsRouteTarget
  | PluginPanelRouteTarget
  | CustomRouteTarget;

// ─── Route Snapshot ──────────────────────────────────────────────────────────

/** Current route state passed to an app. */
export interface RouteSnapshot {
  /** The resolved route target. */
  readonly target: RouteTarget;
  /** Original path string that resolved to this route. */
  readonly path: string;
  /** Query parameters. */
  readonly params: Readonly<Record<string, string>>;
}

// ─── Access Mode ─────────────────────────────────────────────────────────────

/** Access level for a resource binding. */
export type AccessMode = 'read' | 'write' | 'admin' | 'automation';

// ─── Setup Policy ────────────────────────────────────────────────────────────

/** How a required resource binding should be provisioned. */
export type SetupPolicy = 'create' | 'bind-existing' | 'prompt-user' | 'external-provider';

// ─── Resource Binding Descriptor ─────────────────────────────────────────────

/** App-authored requirement for a resource binding. */
export interface ResourceBindingDescriptor {
  /** Logical key to reference this binding within the app. */
  readonly logicalKey: string;
  /** Kind of resource required. */
  readonly resourceKind: string;
  /** Required access level. */
  readonly accessMode: AccessMode;
  /** How the binding should be set up. */
  readonly setupPolicy: SetupPolicy;
  /** Human-readable description. */
  readonly description?: string;
  /** Whether this binding is optional. */
  readonly optional?: boolean;
}

// ─── Binding Diagnostics ─────────────────────────────────────────────────────

/** Diagnostic severity for binding issues. */
export type BindingDiagnosticSeverity = 'error' | 'warning' | 'info';

/** Machine-readable diagnostic for a resource binding. */
export interface BindingDiagnostic {
  /** Severity. */
  readonly severity: BindingDiagnosticSeverity;
  /** Machine-readable code. */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
}

/** Collection of diagnostics for a resource binding. */
export interface BindingDiagnostics {
  /** All diagnostics. */
  readonly items: readonly BindingDiagnostic[];
  /** Whether any error-level diagnostics exist. */
  readonly hasErrors: boolean;
}

// ─── Resource Lease ──────────────────────────────────────────────────────────

/** Lifecycle state of a resource lease. */
export type ResourceLeaseState =
  | 'active'
  | 'suspendedRetained'
  | 'suspendedDowngraded'
  | 'transferred'
  | 'released';

/** Host-owned lifetime token for a resource binding. */
export interface ResourceLease {
  /** Unique lease identifier. */
  readonly leaseId: string;
  /** Current lifecycle state. */
  readonly state: ResourceLeaseState;
  /** ISO-8601 timestamp when the lease was acquired. */
  readonly acquiredAt: string;
  /** ISO-8601 timestamp when the lease expires (if applicable). */
  readonly expiresAt?: string;
}

// ─── Resolved Resource Binding (host-internal) ──────────────────────────────

/** Fully resolved resource binding with host-internal details. */
export interface ResolvedResourceBinding {
  /** The original descriptor from the app. */
  readonly descriptor: ResourceBindingDescriptor;
  /** Resolved resource reference. */
  readonly resolvedRef: ResourceRef;
  /** Grant subject for capability checks. */
  readonly grantSubject: string;
  /** Active lease. */
  readonly lease: ResourceLease;
  /** Binding diagnostics. */
  readonly diagnostics: BindingDiagnostics;
}

// ─── App Resource Binding Snapshot (public app-facing) ───────────────────────

/** Public app-facing snapshot of a resource binding (no lease IDs or grant internals). */
export interface AppResourceBindingSnapshot {
  /** Logical key from the binding descriptor. */
  readonly logicalKey: string;
  /** Resource kind. */
  readonly resourceKind: string;
  /** Human-readable display name for the bound resource. */
  readonly displayName?: string;
  /** Human-readable description. */
  readonly description?: string;
  /** Access mode granted. */
  readonly accessMode: AccessMode;
  /** Binding diagnostics. */
  readonly diagnostics: BindingDiagnostics;
}
