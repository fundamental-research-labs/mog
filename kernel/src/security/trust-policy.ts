/**
 * Trust Policy Service
 *
 * Evaluates trust for packages and determines grant policies.
 * Replaces the hardcoded FIRST_PARTY_APP_IDS / TRUSTED_FIRST_PARTY_APPS
 * sets with a configurable service.
 *
 * @module kernel/security
 */

// =============================================================================
// Types
// =============================================================================

/**
 * How a package's trust was established.
 */
export type TrustSource =
  | 'bundled-first-party'
  | 'signed-marketplace'
  | 'local-dev'
  | 'enterprise-policy';

/**
 * Record of a package's trust status.
 */
export interface PackageTrustRecord {
  /** Package ID */
  readonly packageId: string;

  /** How trust was established */
  readonly trustSource: TrustSource;

  /** When this trust record was created (Unix ms) */
  readonly establishedAt: number;

  /** Additional metadata from the trust source */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Minimal install record needed for trust evaluation.
 */
export interface PackageInstallRecord {
  /** Package ID */
  readonly packageId: string;

  /** Is this bundled with the platform? */
  readonly bundled?: boolean;

  /** Marketplace signature (if from marketplace) */
  readonly signature?: string;

  /** Is this a local development package? */
  readonly localDev?: boolean;

  /** Enterprise policy ID (if enterprise-managed) */
  readonly enterprisePolicyId?: string;

  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of evaluating trust for a package.
 */
export interface TrustPolicyDecision {
  /** Whether the package can be installed */
  readonly canInstall: boolean;

  /** Whether the package can be enabled (activated) */
  readonly canEnable: boolean;

  /** Capabilities that should be auto-granted without consent */
  readonly autoGrantList: readonly string[];

  /** Capabilities that require user consent before granting */
  readonly requireConsentList: readonly string[];

  /** Capabilities that are denied regardless of user consent */
  readonly denyList: readonly string[];

  /** The trust source used for this decision */
  readonly trustSource?: TrustSource;

  /** Human-readable reason for the decision */
  readonly reason?: string;
}

// =============================================================================
// Interface
// =============================================================================

/**
 * Service for evaluating package trust and determining grant policies.
 */
export interface ITrustPolicyService {
  /**
   * Evaluate trust for a package install record.
   * Returns a policy decision determining what capabilities can be granted.
   */
  evaluateTrust(installRecord: PackageInstallRecord): TrustPolicyDecision;

  /**
   * Check if a package is a trusted first-party package.
   */
  isTrustedFirstParty(packageId: string): boolean;

  /**
   * Check if a specific capability can be auto-granted to a package
   * (without user consent).
   */
  canAutoGrant(packageId: string, capabilityId: string): boolean;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Options for constructing TrustPolicyService.
 */
export interface TrustPolicyServiceOptions {
  /**
   * Set of package IDs that are bundled first-party packages.
   * These get full trust and auto-grant for all capabilities.
   */
  readonly bundledFirstPartyPackages: ReadonlySet<string>;

  /**
   * Capabilities that first-party packages get auto-granted.
   * If not specified, first-party packages auto-grant all requested capabilities.
   */
  readonly firstPartyAutoGrantCapabilities?: ReadonlySet<string>;

  /**
   * Capabilities that are always denied to non-first-party packages.
   */
  readonly restrictedCapabilities?: ReadonlySet<string>;

  /**
   * Capabilities that local-dev packages can auto-grant (for development).
   */
  readonly localDevAutoGrantCapabilities?: ReadonlySet<string>;
}

/**
 * In-memory implementation of ITrustPolicyService.
 */
export class TrustPolicyService implements ITrustPolicyService {
  private readonly bundledFirstParty: ReadonlySet<string>;
  private readonly firstPartyAutoGrant: ReadonlySet<string> | undefined;
  private readonly restricted: ReadonlySet<string>;
  private readonly localDevAutoGrant: ReadonlySet<string>;

  /** Cache of trust records for packages we've evaluated. */
  private readonly trustRecords = new Map<string, PackageTrustRecord>();

  constructor(options: TrustPolicyServiceOptions) {
    this.bundledFirstParty = options.bundledFirstPartyPackages;
    this.firstPartyAutoGrant = options.firstPartyAutoGrantCapabilities;
    this.restricted = options.restrictedCapabilities ?? new Set();
    this.localDevAutoGrant = options.localDevAutoGrantCapabilities ?? new Set();
  }

  evaluateTrust(installRecord: PackageInstallRecord): TrustPolicyDecision {
    // 1. Bundled first-party
    if (installRecord.bundled || this.bundledFirstParty.has(installRecord.packageId)) {
      this.recordTrust(installRecord.packageId, 'bundled-first-party');
      return {
        canInstall: true,
        canEnable: true,
        autoGrantList: [], // First-party auto-grants all requested — empty list means "all"
        requireConsentList: [],
        denyList: [],
        trustSource: 'bundled-first-party',
        reason: 'Trusted bundled first-party package',
      };
    }

    // 2. Enterprise policy
    if (installRecord.enterprisePolicyId) {
      this.recordTrust(installRecord.packageId, 'enterprise-policy');
      return {
        canInstall: true,
        canEnable: true,
        autoGrantList: [],
        requireConsentList: [],
        denyList: Array.from(this.restricted),
        trustSource: 'enterprise-policy',
        reason: `Approved by enterprise policy '${installRecord.enterprisePolicyId}'`,
      };
    }

    // 3. Signed marketplace
    if (installRecord.signature) {
      this.recordTrust(installRecord.packageId, 'signed-marketplace');
      return {
        canInstall: true,
        canEnable: true,
        autoGrantList: [],
        requireConsentList: [], // All capabilities require consent for marketplace
        denyList: Array.from(this.restricted),
        trustSource: 'signed-marketplace',
        reason: 'Signed marketplace package — requires user consent for capabilities',
      };
    }

    // 4. Local dev
    if (installRecord.localDev) {
      this.recordTrust(installRecord.packageId, 'local-dev');
      return {
        canInstall: true,
        canEnable: true,
        autoGrantList: Array.from(this.localDevAutoGrant),
        requireConsentList: [],
        denyList: Array.from(this.restricted),
        trustSource: 'local-dev',
        reason: 'Local development package',
      };
    }

    // 5. Unknown source — most restrictive
    return {
      canInstall: false,
      canEnable: false,
      autoGrantList: [],
      requireConsentList: [],
      denyList: [],
      reason: 'Package has no recognized trust source',
    };
  }

  isTrustedFirstParty(packageId: string): boolean {
    return this.bundledFirstParty.has(packageId);
  }

  canAutoGrant(packageId: string, capabilityId: string): boolean {
    // First-party packages auto-grant everything (or specific set)
    if (this.bundledFirstParty.has(packageId)) {
      if (this.firstPartyAutoGrant) {
        return this.firstPartyAutoGrant.has(capabilityId);
      }
      return true; // No restriction set — auto-grant all
    }

    // Check trust record
    const record = this.trustRecords.get(packageId);
    if (!record) return false;

    // Local-dev packages auto-grant from the dev allowlist
    if (record.trustSource === 'local-dev') {
      return this.localDevAutoGrant.has(capabilityId);
    }

    // Enterprise and marketplace require explicit consent
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private recordTrust(packageId: string, source: TrustSource): void {
    if (!this.trustRecords.has(packageId)) {
      this.trustRecords.set(packageId, {
        packageId,
        trustSource: source,
        establishedAt: Date.now(),
      });
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a trust policy service with the given first-party package set.
 */
export function createTrustPolicyService(options: TrustPolicyServiceOptions): TrustPolicyService {
  return new TrustPolicyService(options);
}

/**
 * Default first-party packages matching the existing hardcoded sets.
 */
export const DEFAULT_FIRST_PARTY_PACKAGES: ReadonlySet<string> = new Set([
  'spreadsheet',
  'crm',
  'analytics',
  'finance',
  'bug-tracker',
  'form-builder',
]);
