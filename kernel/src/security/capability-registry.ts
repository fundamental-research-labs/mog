/**
 * Capability Registry Service
 *
 * Manages capability metadata registration, validation, and discovery.
 * This is separate from the grant service — the registry knows WHAT
 * capabilities exist; the grant service knows WHO has them.
 *
 * Key behaviors:
 * - Capabilities are registered with a namespaced ID (e.g., 'mog:cells:read')
 * - Namespace ownership is enforced (only the owning package can register)
 * - Unknown capabilities fail validation
 * - Implied capability resolution is derived from registration metadata
 *
 * @module kernel/security
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Risk tier for a capability registration.
 * Maps to UI treatment and consent requirements.
 */
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

/**
 * Stability tier for a capability.
 * Determines API stability guarantees.
 */
export type StabilityTier = 'stable' | 'beta' | 'experimental' | 'deprecated';

/**
 * What kinds of subjects can hold this capability.
 */
export type AllowedSubjectKind = 'package' | 'app' | 'plugin' | 'instance' | 'workspace' | 'tenant';

/**
 * Metadata for a registered capability.
 */
export interface CapabilityRegistration {
  /** Namespaced capability ID (e.g., 'mog:cells:read', 'vendor:custom:feature') */
  readonly id: string;

  /** Package that owns this capability's namespace */
  readonly ownerPackage: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of what this capability grants */
  readonly description: string;

  /** Risk tier — affects consent UI */
  readonly riskTier: RiskTier;

  /** Stability tier — affects API guarantees */
  readonly stabilityTier: StabilityTier;

  /** Which subject kinds can hold this capability */
  readonly allowedSubjectKinds: readonly AllowedSubjectKind[];

  /**
   * JSON Schema for the scope parameter (optional).
   * When set, grants of this capability must provide a scope
   * that validates against this schema.
   */
  readonly scopeSchema?: Record<string, unknown>;

  /**
   * Capabilities that this one implies (grants transitively).
   * For example, 'mog:cells:write' implies ['mog:cells:read'].
   */
  readonly implies?: readonly string[];
}

/**
 * Result of validating a manifest's capability declarations.
 */
export interface ManifestCapabilityValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ManifestCapabilityValidationError[];
}

/**
 * A single validation error from manifest capability checking.
 */
export interface ManifestCapabilityValidationError {
  readonly capabilityId: string;
  readonly message: string;
}

// =============================================================================
// Interface
// =============================================================================

/**
 * Service for managing capability registrations.
 *
 * The registry is populated at boot time by core and by packages
 * as they activate. Once a capability is registered, it cannot be
 * re-registered (immutable).
 */
export interface ICapabilityRegistryService {
  /**
   * Register a new capability.
   * @throws if the capability ID is already registered
   * @throws if the caller doesn't own the capability's namespace
   */
  register(cap: CapabilityRegistration): void;

  /**
   * Register multiple capabilities at once.
   * @throws on the first invalid registration (atomic: none are registered on failure)
   */
  registerBatch(caps: readonly CapabilityRegistration[]): void;

  /** Get a capability registration by ID. Returns undefined if not registered. */
  get(id: string): CapabilityRegistration | undefined;

  /** Check if a capability is registered. */
  has(id: string): boolean;

  /** List all registered capabilities. */
  list(): readonly CapabilityRegistration[];

  /**
   * Validate that all capabilities referenced in a manifest are registered.
   * Returns errors for unknown or namespace-violating capabilities.
   */
  validateManifestCapabilities(
    capabilityIds: readonly string[],
  ): ManifestCapabilityValidationResult;

  /**
   * Get all capabilities implied by the given capability ID (transitive).
   * Returns an empty array if the capability has no implications.
   */
  getImplied(id: string): readonly string[];
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Extract the namespace from a capability ID.
 * Convention: 'namespace:domain:action' -> 'namespace'
 * Single-colon IDs like 'cells:read' have no namespace (legacy).
 */
function extractNamespace(capabilityId: string): string | undefined {
  const parts = capabilityId.split(':');
  if (parts.length >= 3) {
    return parts[0];
  }
  return undefined;
}

/**
 * In-memory implementation of ICapabilityRegistryService.
 *
 * The internal map is append-only — once registered, a capability
 * cannot be updated or removed during a session.
 */
export class CapabilityRegistryService implements ICapabilityRegistryService {
  private readonly capabilities = new Map<string, CapabilityRegistration>();

  /**
   * Map from namespace to the package ID that owns it.
   * First package to register a capability in a namespace owns it.
   */
  private readonly namespaceOwners = new Map<string, string>();

  constructor(coreCapabilities?: readonly CapabilityRegistration[]) {
    if (coreCapabilities) {
      for (const cap of coreCapabilities) {
        this.registerInternal(cap);
      }
    }
  }

  register(cap: CapabilityRegistration): void {
    if (this.capabilities.has(cap.id)) {
      throw new Error(
        `Capability '${cap.id}' is already registered by package '${this.capabilities.get(cap.id)!.ownerPackage}'`,
      );
    }
    this.validateNamespaceOwnership(cap);
    this.registerInternal(cap);
  }

  registerBatch(caps: readonly CapabilityRegistration[]): void {
    // Validate all first (atomic)
    for (const cap of caps) {
      if (this.capabilities.has(cap.id)) {
        throw new Error(
          `Capability '${cap.id}' is already registered by package '${this.capabilities.get(cap.id)!.ownerPackage}'`,
        );
      }
      // For batch, we also check within the batch for namespace conflicts
      this.validateNamespaceOwnershipForBatch(cap, caps);
    }
    // Then register all
    for (const cap of caps) {
      this.registerInternal(cap);
    }
  }

  get(id: string): CapabilityRegistration | undefined {
    return this.capabilities.get(id);
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  list(): readonly CapabilityRegistration[] {
    return Array.from(this.capabilities.values());
  }

  validateManifestCapabilities(
    capabilityIds: readonly string[],
  ): ManifestCapabilityValidationResult {
    const errors: ManifestCapabilityValidationError[] = [];

    for (const id of capabilityIds) {
      if (!this.capabilities.has(id)) {
        errors.push({
          capabilityId: id,
          message: `Unknown capability '${id}' — not registered in the capability registry`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  getImplied(id: string): readonly string[] {
    const result = new Set<string>();
    const queue = [id];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const cap = this.capabilities.get(current);
      if (cap?.implies) {
        for (const implied of cap.implies) {
          if (!result.has(implied)) {
            result.add(implied);
            queue.push(implied);
          }
        }
      }
    }

    return Array.from(result);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private registerInternal(cap: CapabilityRegistration): void {
    this.capabilities.set(cap.id, Object.freeze({ ...cap }));

    // Claim namespace ownership
    const ns = extractNamespace(cap.id);
    if (ns && !this.namespaceOwners.has(ns)) {
      this.namespaceOwners.set(ns, cap.ownerPackage);
    }
  }

  private validateNamespaceOwnership(cap: CapabilityRegistration): void {
    const ns = extractNamespace(cap.id);
    if (ns) {
      const owner = this.namespaceOwners.get(ns);
      if (owner && owner !== cap.ownerPackage) {
        throw new Error(
          `Namespace '${ns}' is owned by package '${owner}'; package '${cap.ownerPackage}' cannot register capabilities in it`,
        );
      }
    }
  }

  private validateNamespaceOwnershipForBatch(
    cap: CapabilityRegistration,
    batch: readonly CapabilityRegistration[],
  ): void {
    const ns = extractNamespace(cap.id);
    if (!ns) return;

    // Check existing owners
    const existingOwner = this.namespaceOwners.get(ns);
    if (existingOwner && existingOwner !== cap.ownerPackage) {
      throw new Error(
        `Namespace '${ns}' is owned by package '${existingOwner}'; package '${cap.ownerPackage}' cannot register capabilities in it`,
      );
    }

    // Check within the batch for conflicts
    for (const other of batch) {
      if (other === cap) continue;
      const otherNs = extractNamespace(other.id);
      if (otherNs === ns && other.ownerPackage !== cap.ownerPackage) {
        throw new Error(
          `Namespace '${ns}' claimed by both '${cap.ownerPackage}' and '${other.ownerPackage}' in the same batch`,
        );
      }
    }
  }
}

// =============================================================================
// Core Capabilities
// =============================================================================

/**
 * Built-in core capabilities registered by the platform.
 *
 * These are the platform-level capabilities that exist regardless of
 * what packages are installed. Spreadsheet-specific capabilities
 * (like 'mog:spreadsheet:full') are registered by the spreadsheet
 * app package, not by the core registry.
 */
export const CORE_CAPABILITIES: readonly CapabilityRegistration[] = [
  {
    id: 'mog:app:lifecycle',
    ownerPackage: '@mog/core',
    name: 'App Lifecycle',
    description: 'Manage app lifecycle (start, stop, restart)',
    riskTier: 'low',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin'],
  },
  {
    id: 'mog:storage:local',
    ownerPackage: '@mog/core',
    name: 'Local Storage',
    description: 'Read and write to app-scoped local storage',
    riskTier: 'low',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin', 'instance'],
  },
  {
    id: 'mog:ui:panel',
    ownerPackage: '@mog/core',
    name: 'UI Panel',
    description: 'Render content in a sidebar or panel',
    riskTier: 'low',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin'],
  },
  {
    id: 'mog:ui:dialog',
    ownerPackage: '@mog/core',
    name: 'UI Dialog',
    description: 'Show modal dialogs to the user',
    riskTier: 'low',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin'],
  },
  {
    id: 'mog:network:fetch',
    ownerPackage: '@mog/core',
    name: 'Network Fetch',
    description: 'Make HTTP requests to allowed domains',
    riskTier: 'high',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin'],
  },
  {
    id: 'mog:network:unrestricted',
    ownerPackage: '@mog/core',
    name: 'Unrestricted Network',
    description: 'Make HTTP requests to any domain',
    riskTier: 'critical',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app'],
    implies: ['mog:network:fetch'],
  },
  {
    id: 'mog:clipboard:read',
    ownerPackage: '@mog/core',
    name: 'Clipboard Read',
    description: 'Read from the system clipboard',
    riskTier: 'medium',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin'],
  },
  {
    id: 'mog:clipboard:write',
    ownerPackage: '@mog/core',
    name: 'Clipboard Write',
    description: 'Write to the system clipboard',
    riskTier: 'medium',
    stabilityTier: 'stable',
    allowedSubjectKinds: ['app', 'plugin'],
    implies: ['mog:clipboard:read'],
  },
];

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new capability registry service with core capabilities pre-registered.
 */
export function createCapabilityRegistryService(): CapabilityRegistryService {
  return new CapabilityRegistryService(CORE_CAPABILITIES);
}

/**
 * Create an empty capability registry service (for tests).
 */
export function createEmptyCapabilityRegistryService(): CapabilityRegistryService {
  return new CapabilityRegistryService();
}
