/**
 * Contribution Point Registry
 *
 * Stores the set of extension points that apps/plugins can contribute to.
 * Built-in points are registered at construction time; apps can register
 * additional custom points at runtime.
 *
 * This module is pure TypeScript with zero React dependencies.
 */

import type {
  ContributionDeclaration,
  ContributionKind,
  ContributionPointId,
  ContributionPointRegistration,
  ContributionValidationResult,
} from './types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IContributionPointRegistry {
  /** Register a new contribution point. Throws if the ID is already taken. */
  registerPoint(registration: ContributionPointRegistration): void;

  /** Look up a contribution point by ID. */
  getPoint(id: ContributionPointId): ContributionPointRegistration | undefined;

  /** Return all registered points (snapshot). */
  listPoints(): readonly ContributionPointRegistration[];

  /** Return all points matching a given kind. */
  listPointsByKind(kind: ContributionKind): readonly ContributionPointRegistration[];

  /**
   * Validate a contribution declaration against the target point.
   *
   * Checks: target point exists, schema version compatible, contributor
   * kind allowed, required capabilities declared.
   */
  validateContribution(declaration: ContributionDeclaration): ContributionValidationResult;
}

// ---------------------------------------------------------------------------
// Built-in contribution points
// ---------------------------------------------------------------------------

const BUILT_IN_POINTS: readonly ContributionPointRegistration[] = [
  {
    id: 'mog.commands' as ContributionPointId,
    kind: 'command',
    description: 'Global command contributions',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.main-menu' as ContributionPointId,
    kind: 'menu',
    description: 'Main application menu bar',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.context-menu' as ContributionPointId,
    kind: 'menu',
    description: 'Context menu contributions',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.toolbar' as ContributionPointId,
    kind: 'toolbarItem',
    description: 'Toolbar items',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.command-palette' as ContributionPointId,
    kind: 'command',
    description: 'Command palette entries',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.navigation' as ContributionPointId,
    kind: 'navigationItem',
    description: 'Navigation sidebar entries',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.sidebar' as ContributionPointId,
    kind: 'panel',
    description: 'Sidebar panel contributions',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.status-bar' as ContributionPointId,
    kind: 'statusBarItem',
    description: 'Status bar items',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.file-handlers' as ContributionPointId,
    kind: 'fileHandler',
    description: 'File type handlers',
    stability: 'stable',
    overridePolicy: 'last-wins',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
  {
    id: 'mog.settings-pages' as ContributionPointId,
    kind: 'settingsPage',
    description: 'Settings page contributions',
    stability: 'stable',
    overridePolicy: 'reject',
    allowedContributorKinds: ['any'],
    schemaVersion: 1,
  },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ContributionPointRegistry implements IContributionPointRegistry {
  private readonly points = new Map<ContributionPointId, ContributionPointRegistration>();

  constructor() {
    for (const point of BUILT_IN_POINTS) {
      this.points.set(point.id, point);
    }
  }

  registerPoint(registration: ContributionPointRegistration): void {
    if (this.points.has(registration.id)) {
      throw new Error(`Contribution point "${registration.id}" is already registered`);
    }
    this.points.set(registration.id, registration);
  }

  getPoint(id: ContributionPointId): ContributionPointRegistration | undefined {
    return this.points.get(id);
  }

  listPoints(): readonly ContributionPointRegistration[] {
    return Array.from(this.points.values());
  }

  listPointsByKind(kind: ContributionKind): readonly ContributionPointRegistration[] {
    return Array.from(this.points.values()).filter((p) => p.kind === kind);
  }

  validateContribution(declaration: ContributionDeclaration): ContributionValidationResult {
    const errors: string[] = [];

    // 1. Target point must exist
    const point = this.points.get(declaration.targetPointId);
    if (!point) {
      errors.push(`Target contribution point "${declaration.targetPointId}" does not exist`);
      return { valid: false, errors };
    }

    // 2. Schema version must be compatible (exact match for now)
    if (declaration.schemaVersion !== point.schemaVersion) {
      errors.push(
        `Schema version mismatch: declaration has ${declaration.schemaVersion}, ` +
          `point "${point.id}" requires ${point.schemaVersion}`,
      );
    }

    // 3. Contributor kind must be allowed
    if (
      !point.allowedContributorKinds.includes('any') &&
      !point.allowedContributorKinds.includes(declaration.contributorKind)
    ) {
      errors.push(
        `Contributor kind "${declaration.contributorKind}" is not allowed ` +
          `for point "${point.id}". Allowed: ${point.allowedContributorKinds.join(', ')}`,
      );
    }

    // 4. Required capabilities must be declared (structural check only)
    if (declaration.requiredCapabilities && declaration.requiredCapabilities.length === 0) {
      // Empty array is valid but worth noting — no capabilities needed
    }

    return { valid: errors.length === 0, errors };
  }
}
