// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __appIdBrand: unique symbol;

/** Opaque identifier for a registered app. */
export type AppId = string & { readonly [__appIdBrand]: typeof __appIdBrand };

/** Create a branded AppId from a raw string. */
export function createAppId(raw: string): AppId {
  return raw as AppId;
}

// ─── App Kind ────────────────────────────────────────────────────────────────

/** Top-level classification of an app's runtime shape. */
export type AppKind =
  | 'document-app'
  | 'dataset-app'
  | 'workspace-app'
  | 'utility-app'
  | 'background-app';

// ─── Compatibility ───────────────────────────────────────────────────────────

/** Well-known compatibility profile identifiers. */
export type CompatibilityProfileId =
  | 'mog.app-platform/v1'
  | 'mog.plugin-worker/v1'
  | 'mog.embed-runtime/v1'
  | 'mog.server-runtime/v1'
  | (string & {});

/** A single compatibility profile with its ID and version range. */
export interface CompatibilityProfile {
  /** Profile identifier. */
  readonly id: CompatibilityProfileId;
  /** Human-readable description. */
  readonly description?: string;
}

/** A requirement for a specific compatibility profile at a semver range. */
export interface CompatibilityRequirement {
  /** Profile that must be satisfied. */
  readonly profile: CompatibilityProfileId;
  /** Semver range the host must satisfy. */
  readonly versionRange: string;
}

// ─── Runtime Host ────────────────────────────────────────────────────────────

/** How the host should load and isolate an app's entry point. */
export type RuntimeHostMode =
  | 'same-realm-first-party'
  | 'iframe-sandbox'
  | 'worker-sandbox'
  | 'server-side'
  | 'remote-bridge'
  | 'disabled';

// ─── Stability ───────────────────────────────────────────────────────────────

/** Stability tier for a contract surface. */
export type StabilityTier = 'stable' | 'experimental' | 'internal' | 'private';

// ─── Entry Point ─────────────────────────────────────────────────────────────

/** Entry point loader descriptor. */
export interface AppEntryDescriptor {
  /** Module specifier or URL for the app entry. */
  readonly module: string;
  /** Named export to invoke (default: "default"). */
  readonly export?: string;
}

// ─── Contribution Reference ──────────────────────────────────────────────────

/** Inline contribution declaration within the manifest. */
export interface ManifestContributionRef {
  /** Contribution point ID this declaration targets. */
  readonly contributionPointId: string;
  /** Kind of contribution (command, menu, panel, etc.). */
  readonly kind: string;
  /** Unique ID for this contribution within the app. */
  readonly id: string;
  /** Human-readable label. */
  readonly label?: string;
  /** Icon identifier. */
  readonly icon?: string;
}

// ─── Route Declaration ───────────────────────────────────────────────────────

/** Route declaration within the manifest. */
export interface ManifestRouteDeclaration {
  /** Route path pattern (e.g. "/settings", "/view/:id"). */
  readonly path: string;
  /** Human-readable label for this route. */
  readonly label?: string;
  /** Required capabilities for this route. */
  readonly requiredCapabilities?: readonly string[];
}

// ─── Data Declaration ────────────────────────────────────────────────────────

/** Data/storage requirements declared by the app. */
export interface ManifestDataDeclaration {
  /** Logical data store keys the app requires. */
  readonly stores?: readonly string[];
  /** Resource kinds the app can bind to. */
  readonly resourceKinds?: readonly string[];
}

// ─── Lifecycle Declaration ───────────────────────────────────────────────────

/** Lifecycle configuration within the manifest. */
export interface ManifestLifecycleDeclaration {
  /** Whether the app supports suspend/resume. */
  readonly suspendable?: boolean;
  /** Whether the app supports background operation. */
  readonly background?: boolean;
  /** Maximum allowed startup time in milliseconds. */
  readonly maxStartupMs?: number;
}

// ─── App Manifest ────────────────────────────────────────────────────────────

/** Complete app manifest describing an installable app. */
export interface AppManifest {
  /** Unique app identifier. */
  readonly id: AppId;
  /** Human-readable display name. */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
  /** Short description of the app. */
  readonly description: string;
  /** Author or publisher name. */
  readonly author: string;
  /** Icon identifier or URL. */
  readonly icon: string;
  /** Entry point loader descriptor. */
  readonly entry: AppEntryDescriptor;
  /** Top-level app classification. */
  readonly kind: AppKind;
  /** Compatibility requirements the host must satisfy. */
  readonly compatibility: readonly CompatibilityRequirement[];
  /** Capability IDs this app may request. */
  readonly capabilities: readonly string[];
  /** Route declarations exposed by this app. */
  readonly routes: readonly ManifestRouteDeclaration[];
  /** Data and storage requirements. */
  readonly data: ManifestDataDeclaration;
  /** Contribution point declarations. */
  readonly contributions: readonly ManifestContributionRef[];
  /** Lifecycle configuration. */
  readonly lifecycle: ManifestLifecycleDeclaration;
  /** Runtime isolation mode for the host to enforce. */
  readonly runtimeHost: RuntimeHostMode;
}
