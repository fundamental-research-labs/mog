// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __packageIdBrand: unique symbol;

/** Opaque identifier for a registered package. */
export type PackageId = string & { readonly [__packageIdBrand]: typeof __packageIdBrand };

/** Create a branded PackageId from a raw string. */
export function createPackageId(raw: string): PackageId {
  return raw as PackageId;
}

// ─── Package State ───────────────────────────────────────────────────────────

/** Lifecycle state of a package within the registry. */
export type PackageState =
  | 'discovered'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'uninstalled'
  | 'incompatible';

// ─── Package Source ──────────────────────────────────────────────────────────

/** Origin from which a package was acquired. */
export type PackageSource =
  | 'built-in'
  | 'marketplace'
  | 'local-dev'
  | 'runtime-provided'
  | 'enterprise-policy';

// ─── Review Status ───────────────────────────────────────────────────────────

/** Marketplace review status. */
export type ReviewStatus = 'unreviewed' | 'approved' | 'rejected' | 'suspended';

// ─── Installation Record ─────────────────────────────────────────────────────

/** Persistent record of a package installation. */
export interface PackageInstallationRecord {
  /** Unique package identifier. */
  readonly packageId: PackageId;
  /** Installed semver version. */
  readonly version: string;
  /** Origin source. */
  readonly source: PackageSource;
  /** SHA-256 digest of the package artifact. */
  readonly artifactDigest: string;
  /** SHA-256 digest of the manifest at install time. */
  readonly manifestDigest: string;
  /** Optional code-signing signature. */
  readonly signature?: string;
  /** Publisher identity. */
  readonly publisherId: string;
  /** Marketplace review status at install time. */
  readonly reviewStatus: ReviewStatus;
  /** User or system principal that triggered the install. */
  readonly installedBy: string;
  /** ISO-8601 timestamp of installation. */
  readonly installedAt: string;
  /** Trust-policy decision that authorized installation. */
  readonly policyDecision: string;
}
