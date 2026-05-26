import type { StabilityTier, CompatibilityProfileId } from '../manifest/types';
import type { CapabilityId } from '../capabilities/types';

// ─── Branded Types ───────────────────────────────────────────────────────────

declare const __contributionPointIdBrand: unique symbol;

/** Opaque identifier for a contribution point. */
export type ContributionPointId = string & {
  readonly [__contributionPointIdBrand]: typeof __contributionPointIdBrand;
};

/** Create a branded ContributionPointId from a raw string. */
export function createContributionPointId(raw: string): ContributionPointId {
  return raw as ContributionPointId;
}

// ─── Contribution Kind ───────────────────────────────────────────────────────

/** Classification of a contribution. */
export type ContributionKind =
  | 'command'
  | 'menu'
  | 'context-menu'
  | 'toolbar'
  | 'command-palette'
  | 'navigation'
  | 'panel'
  | 'inspector'
  | 'sidebar'
  | 'status'
  | 'file-handler'
  | 'import-export'
  | 'settings-page'
  | 'app-extension-slot';

// ─── Override Policy ─────────────────────────────────────────────────────────

/** How conflicts between contributions to the same point are resolved. */
export type OverridePolicy = 'first-wins' | 'last-wins' | 'merge' | 'reject';

// ─── Ordering Group Policy ───────────────────────────────────────────────────

/** How contributions within the same group are ordered. */
export type OrderingGroupPolicy = 'priority' | 'alphabetical' | 'registration-order';

// ─── Allowed Contributor Kind ────────────────────────────────────────────────

/** What kind of entity is allowed to contribute to a point. */
export type AllowedContributorKind = 'app' | 'plugin' | 'built-in';

// ─── Contribution Point Registration ─────────────────────────────────────────

/** Registration of a contribution point that others can contribute to. */
export interface ContributionPointRegistration {
  /** Unique contribution point identifier. */
  readonly id: ContributionPointId;
  /** Owner that registered this point. */
  readonly owner: string;
  /** Kind of contributions this point accepts. */
  readonly kind: ContributionKind;
  /** Schema version for contribution declarations. */
  readonly schemaVersion: string;
  /** Stability tier. */
  readonly stabilityTier: StabilityTier;
  /** What kinds of entities can contribute. */
  readonly allowedContributorKinds: readonly AllowedContributorKind[];
  /** Capabilities required to contribute. */
  readonly requiredCapabilities: readonly CapabilityId[];
  /** Isolation constraints for contributors. */
  readonly isolationConstraints?: string;
  /** How contributions within groups are ordered. */
  readonly orderingGroupPolicy: OrderingGroupPolicy;
  /** How conflicts are resolved. */
  readonly overridePolicy: OverridePolicy;
  /** Compatibility profile. */
  readonly compatibilityProfile: CompatibilityProfileId;
}

// ─── Contribution Metadata ───────────────────────────────────────────────────

/** Display metadata for a contribution. */
export interface ContributionMetadata {
  /** Human-readable label. */
  readonly label: string;
  /** Icon identifier. */
  readonly icon?: string;
  /** Default keyboard shortcut. */
  readonly shortcutDefault?: string;
}

// ─── Contribution Declaration ────────────────────────────────────────────────

/** Base declaration of a contribution to a contribution point. */
export interface ContributionDeclaration {
  /** Unique ID for this contribution. */
  readonly id: string;
  /** Target contribution point ID. */
  readonly targetContributionPointId: ContributionPointId;
  /** Kind of this contribution. */
  readonly kind: ContributionKind;
  /** Display metadata. */
  readonly metadata: ContributionMetadata;
  /** Declarative enablement predicate (expression string). */
  readonly enablementPredicate?: string;
  /** Capability IDs required for this contribution. */
  readonly capabilityRequirements: readonly CapabilityId[];
  /** Placement group within the contribution point. */
  readonly placementGroup?: string;
  /** Priority within the placement group. */
  readonly priority?: number;
}

// ─── Specific Contribution Types ─────────────────────────────────────────────

/** Command contribution with handler registration. */
export interface CommandContribution extends ContributionDeclaration {
  readonly kind: 'command';
  /** Command ID to register. */
  readonly commandId: string;
}

/** Menu item contribution. */
export interface MenuContribution extends ContributionDeclaration {
  readonly kind: 'menu';
  /** Parent menu identifier. */
  readonly parentMenuId?: string;
}

/** Panel contribution. */
export interface PanelContribution extends ContributionDeclaration {
  readonly kind: 'panel';
  /** Panel location. */
  readonly location: 'sidebar' | 'bottom' | 'floating';
  /** Default visibility. */
  readonly defaultVisible?: boolean;
}

/** File handler contribution. */
export interface FileHandlerContribution extends ContributionDeclaration {
  readonly kind: 'file-handler';
  /** File extensions handled (e.g. [".csv", ".tsv"]). */
  readonly extensions: readonly string[];
  /** MIME types handled. */
  readonly mimeTypes?: readonly string[];
}

// ─── Resolution Result ───────────────────────────────────────────────────────

/** Resolved contribution with its source information. */
export interface ResolvedContribution {
  /** The contribution declaration. */
  readonly declaration: ContributionDeclaration;
  /** Source app or plugin ID. */
  readonly sourceId: string;
  /** Whether the contribution is currently enabled. */
  readonly enabled: boolean;
}

/** Result of resolving all contributions for a contribution point. */
export interface ContributionResolutionResult {
  /** Target contribution point ID. */
  readonly contributionPointId: ContributionPointId;
  /** Ordered list of resolved contributions. */
  readonly contributions: readonly ResolvedContribution[];
  /** Any conflicts detected during resolution. */
  readonly conflicts: readonly ContributionConflict[];
}

// ─── Contribution Conflict ───────────────────────────────────────────────────

/** Kind of conflict between contributions. */
export type ConflictKind = 'duplicate-id' | 'shortcut-conflict' | 'override-rejected';

/** A detected conflict between contributions. */
export interface ContributionConflict {
  /** Kind of conflict. */
  readonly kind: ConflictKind;
  /** IDs of the conflicting contributions. */
  readonly contributionIds: readonly string[];
  /** Human-readable description. */
  readonly message: string;
}
