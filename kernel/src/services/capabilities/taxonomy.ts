/**
 * Capability Taxonomy - Dependencies and composite capabilities
 *
 * This file defines:
 * - CAPABILITY_IMPLIES: Record showing dependencies (write implies read, etc.)
 * - COMPOSITE_CAPABILITIES: shortcuts like 'spreadsheet:full', 'tables:readonly'
 * - expandWithDependencies(caps): Expands capabilities with their dependencies
 *
 */

import type { CapabilityType } from './cap-types';

// =============================================================================
// Capability Dependencies
// =============================================================================

/**
 * Capability implication graph.
 *
 * When granting a capability, all implied capabilities are automatically included.
 * This creates a directed acyclic graph of dependencies.
 *
 * Key principles:
 * - Write implies read (you need to see what you're modifying)
 * - Create/delete implies read (you need to see what exists)
 * - Higher-tier all-access implies lower-tier specific access
 * - Network hierarchy: any > allowlist > sameorigin (localhost is orthogonal)
 *
 * Note: clipboard:read and clipboard:write are INDEPENDENT
 * (privacy risk of reading doesn't relate to the low risk of writing)
 */
export const CAPABILITY_IMPLIES: Readonly<
  Partial<Record<CapabilityType, readonly CapabilityType[]>>
> = {
  // =========================================================================
  // Tier 0: Spreadsheet Core
  // =========================================================================
  'cells:write': ['cells:read'],
  'sheets:create': ['sheets:read'],
  'sheets:delete': ['sheets:read'],
  'sheets:rename': ['sheets:read'],
  'formulas:write': ['formulas:read'],
  'formatting:write': ['formatting:read'],

  // =========================================================================
  // Tier 1: Data
  // =========================================================================
  'tables:write': ['tables:read'],
  'tables:create': ['tables:read'],
  'tables:delete': ['tables:read'],
  'columns:schema': ['tables:read'],

  // =========================================================================
  // Tier 2: Services
  // =========================================================================
  'undo:write': ['undo:read'],
  'checkpoints:create': ['checkpoints:read'],
  'checkpoints:restore': ['checkpoints:read'],
  'version:diff': ['version:read'],
  'version:commit': ['version:read'],
  'version:branch': ['version:read'],
  'version:checkout': ['version:branch'],
  'version:reviewRead': ['version:diff'],
  'version:reviewWrite': ['version:reviewRead'],
  'version:proposal': ['version:branch', 'version:reviewWrite'],
  'version:mergePreview': ['version:diff'],
  'version:mergeApply': ['version:mergePreview'],
  'version:revert': ['version:read'],
  'version:provenance': ['version:read'],
  // Note: clipboard:read and clipboard:write are INDEPENDENT

  // =========================================================================
  // Tier 3: Platform
  // =========================================================================
  'filesystem:write': ['filesystem:read'],
  'filesystem:delete': ['filesystem:read'],

  // =========================================================================
  // Tier 4: External
  // =========================================================================
  'connections:write': ['connections:read'],
  'connections:create': ['connections:read'],
  'connections:native': ['connections:read'], // Can run raw SQL → can also use Query interface

  // Network hierarchy (localhost is orthogonal - separate attack surface)
  'network:any': ['network:allowlist', 'network:sameorigin'], // Excludes localhost
  'network:allowlist': ['network:sameorigin'],
  // Note: network:localhost is INDEPENDENT - must be granted separately

  // =========================================================================
  // Tier 5: Sensitive
  // =========================================================================
  'tables:readAll': ['tables:read'],
  'tables:writeAll': ['tables:write', 'tables:readAll'],
  'cells:readAll': ['cells:read'],
  'cells:writeAll': ['cells:write', 'cells:readAll'],
} as const;

// =============================================================================
// Composite Capabilities
// =============================================================================

/**
 * Composite capability identifier type.
 * These are shortcuts that expand to multiple capabilities.
 */
export type CompositeCapability =
  | 'spreadsheet:full'
  | 'spreadsheet:readonly'
  | 'tables:full'
  | 'tables:readwrite'
  | 'tables:readonly'
  | 'filesystem:full'
  | 'filesystem:readwrite'
  | 'services:basic';

/**
 * Composite capability definitions.
 * These are convenience shortcuts for common capability combinations.
 *
 * Apps can request composite capabilities in their manifest,
 * and they will be expanded to the individual capabilities.
 */
export const COMPOSITE_CAPABILITIES: Readonly<
  Record<CompositeCapability, readonly CapabilityType[]>
> = {
  'spreadsheet:full': [
    'cells:read',
    'cells:write',
    'sheets:read',
    'sheets:create',
    'sheets:delete',
    'sheets:rename',
    'formulas:read',
    'formulas:write',
    'formatting:read',
    'formatting:write',
    'recalc:trigger',
  ],
  'spreadsheet:readonly': ['cells:read', 'sheets:read', 'formulas:read', 'formatting:read'],
  'tables:full': [
    'tables:read',
    'tables:write',
    'tables:create',
    'tables:delete',
    'columns:schema',
  ],
  'tables:readwrite': ['tables:read', 'tables:write'],
  'tables:readonly': ['tables:read'],
  'filesystem:full': ['filesystem:read', 'filesystem:write', 'filesystem:delete'],
  'filesystem:readwrite': ['filesystem:read', 'filesystem:write'],
  'services:basic': ['clipboard:write', 'notifications:send', 'undo:read'],
} as const;

// =============================================================================
// Dependency Expansion
// =============================================================================

/**
 * Expand a set of capabilities to include all implied dependencies.
 *
 * This performs a transitive closure over the CAPABILITY_IMPLIES graph.
 * The result is a deduplicated set containing the original capabilities
 * plus all capabilities they transitively imply.
 *
 * @param capabilities - The capabilities to expand
 * @returns A new array with all dependencies included (deduplicated)
 *
 * @example
 * expandWithDependencies(['cells:write'])
 * // Returns: ['cells:write', 'cells:read']
 *
 * @example
 * expandWithDependencies(['tables:writeAll'])
 * // Returns: ['tables:writeAll', 'tables:readAll', 'tables:write', 'tables:read']
 */
export function expandWithDependencies(capabilities: readonly CapabilityType[]): CapabilityType[] {
  const expanded = new Set<CapabilityType>(capabilities);
  const queue = [...capabilities];

  while (queue.length > 0) {
    const cap = queue.pop()!;
    const implied = CAPABILITY_IMPLIES[cap];
    if (implied) {
      for (const dep of implied) {
        if (!expanded.has(dep)) {
          expanded.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Expand composite capabilities to their individual capabilities.
 *
 * @param capability - A capability type or composite capability
 * @returns Array of individual capability types
 */
export function expandComposite(
  capability: CapabilityType | CompositeCapability,
): CapabilityType[] {
  if (capability in COMPOSITE_CAPABILITIES) {
    return [...COMPOSITE_CAPABILITIES[capability as CompositeCapability]];
  }
  return [capability as CapabilityType];
}

/**
 * Expand a mixed array of capabilities and composite capabilities.
 *
 * First expands any composite capabilities, then expands all dependencies.
 *
 * @param capabilities - Array of capability types and/or composite capabilities
 * @returns Fully expanded array of individual capability types
 */
export function expandCapabilities(
  capabilities: readonly (CapabilityType | CompositeCapability)[],
): CapabilityType[] {
  // First, expand composites
  const expanded: CapabilityType[] = [];
  for (const cap of capabilities) {
    expanded.push(...expandComposite(cap));
  }

  // Then, expand dependencies
  return expandWithDependencies(expanded);
}

/**
 * Check if one capability implies another (directly or transitively).
 *
 * @param capability - The capability that might imply the other
 * @param implied - The capability that might be implied
 * @returns True if capability implies the implied capability
 */
export function capabilityImplies(capability: CapabilityType, implied: CapabilityType): boolean {
  if (capability === implied) return true;

  const directImplied = CAPABILITY_IMPLIES[capability];
  if (!directImplied) return false;

  for (const dep of directImplied) {
    if (dep === implied || capabilityImplies(dep, implied)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all capabilities that a given capability directly implies.
 *
 * @param capability - The capability to check
 * @returns Array of directly implied capabilities (not transitive)
 */
export function getDirectDependencies(capability: CapabilityType): readonly CapabilityType[] {
  return CAPABILITY_IMPLIES[capability] ?? [];
}

/**
 * Get all capabilities that directly imply the given capability.
 * (Reverse lookup in the implication graph)
 *
 * @param capability - The capability to find impliers for
 * @returns Array of capabilities that directly imply this one
 */
export function getCapabilitiesImplying(capability: CapabilityType): CapabilityType[] {
  const result: CapabilityType[] = [];
  for (const [cap, implied] of Object.entries(CAPABILITY_IMPLIES)) {
    if (implied && implied.includes(capability)) {
      result.push(cap as CapabilityType);
    }
  }
  return result;
}

/**
 * Type guard to check if a string is a valid CompositeCapability.
 */
export function isCompositeCapability(value: string): value is CompositeCapability {
  return value in COMPOSITE_CAPABILITIES;
}

/**
 * Get all composite capability names.
 */
export function getAllCompositeCapabilities(): CompositeCapability[] {
  return Object.keys(COMPOSITE_CAPABILITIES) as CompositeCapability[];
}
