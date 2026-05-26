/**
 * Contribution Resolver — deterministic resolution engine.
 *
 * Contributions from multiple sources are collected then resolved into
 * an ordered list per contribution point. Resolution is synchronous,
 * pure, and data-only — it never imports or evaluates plugin entry code.
 *
 * Sort order: group (ascending) -> priority (descending) -> sourceId -> contributionId
 *
 * This module is pure TypeScript with zero React dependencies.
 */

import type {
  ContributionConflict,
  ContributionDeclaration,
  ContributionPointId,
  ContributionResolutionResult,
  OverridePolicy,
  ResolvedContribution,
} from './types';
import type { IContributionPointRegistry } from './contribution-point-registry';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IContributionResolver {
  /** Submit a contribution from a source (app/plugin). */
  addContribution(sourceId: string, declaration: ContributionDeclaration): void;

  /** Remove all contributions from a source. */
  removeContributions(sourceId: string): void;

  /** Resolve contributions for a single point into a deterministic ordered list. */
  resolve(pointId: ContributionPointId): ContributionResolutionResult;

  /** Resolve all known points. */
  resolveAll(): ReadonlyMap<ContributionPointId, ContributionResolutionResult>;

  /** Return all declarations submitted by a given source. */
  getContributionsBySource(sourceId: string): readonly ContributionDeclaration[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ContributionResolver implements IContributionResolver {
  /** sourceId -> declarations */
  private readonly contributions = new Map<string, ContributionDeclaration[]>();
  private readonly registry: IContributionPointRegistry;

  constructor(registry: IContributionPointRegistry) {
    this.registry = registry;
  }

  addContribution(sourceId: string, declaration: ContributionDeclaration): void {
    let list = this.contributions.get(sourceId);
    if (!list) {
      list = [];
      this.contributions.set(sourceId, list);
    }
    list.push(declaration);
  }

  removeContributions(sourceId: string): void {
    this.contributions.delete(sourceId);
  }

  resolve(pointId: ContributionPointId): ContributionResolutionResult {
    const point = this.registry.getPoint(pointId);
    const overridePolicy: OverridePolicy = point?.overridePolicy ?? 'reject';

    // Gather all contributions targeting this point
    const candidates: ResolvedContribution[] = [];
    for (const [sourceId, declarations] of this.contributions) {
      for (const decl of declarations) {
        if (decl.targetPointId === pointId) {
          candidates.push({ sourceId, declaration: decl });
        }
      }
    }

    // Deterministic sort: group asc -> priority desc -> sourceId asc -> contributionId asc
    candidates.sort((a, b) => {
      const groupA = a.declaration.group ?? '';
      const groupB = b.declaration.group ?? '';
      if (groupA !== groupB) return groupA < groupB ? -1 : 1;

      // Higher priority first
      if (a.declaration.priority !== b.declaration.priority) {
        return b.declaration.priority - a.declaration.priority;
      }

      // Stable tie-break by sourceId then contributionId
      if (a.sourceId !== b.sourceId) {
        return a.sourceId < b.sourceId ? -1 : 1;
      }

      const idA = a.declaration.metadata.contributionId;
      const idB = b.declaration.metadata.contributionId;
      if (idA !== idB) return idA < idB ? -1 : 1;

      return 0;
    });

    // Detect conflicts
    const conflicts: ContributionConflict[] = [];
    const seenIds = new Map<string, ResolvedContribution[]>();

    for (const rc of candidates) {
      const cid = rc.declaration.metadata.contributionId;
      let group = seenIds.get(cid);
      if (!group) {
        group = [];
        seenIds.set(cid, group);
      }
      group.push(rc);
    }

    // Filter resolved contributions based on override policy for duplicates
    let resolved: ResolvedContribution[];

    const duplicateIds = new Set<string>();
    for (const [cid, group] of seenIds) {
      if (group.length > 1) {
        // Check if any declare themselves as overrides
        const hasOverride = group.some((rc) => rc.declaration.isOverride);
        if (!hasOverride) {
          duplicateIds.add(cid);
          conflicts.push({
            kind: 'duplicate-id',
            contributionIds: group.map((rc) => cid),
            message: `Duplicate contribution ID "${cid}" from sources: ${group.map((rc) => rc.sourceId).join(', ')}`,
          });
        }
      }
    }

    if (duplicateIds.size > 0) {
      if (overridePolicy === 'reject') {
        // Exclude all duplicates
        resolved = candidates.filter(
          (rc) => !duplicateIds.has(rc.declaration.metadata.contributionId),
        );
      } else if (overridePolicy === 'last-wins') {
        // Keep only the last (lowest index after sort = highest priority) for each duplicate
        const kept = new Set<string>();
        resolved = [];
        for (const rc of candidates) {
          const cid = rc.declaration.metadata.contributionId;
          if (duplicateIds.has(cid)) {
            if (!kept.has(cid)) {
              kept.add(cid);
              resolved.push(rc);
            }
            // skip subsequent duplicates
          } else {
            resolved.push(rc);
          }
        }
      } else {
        // first-wins: keep first occurrence
        const kept = new Set<string>();
        resolved = [];
        for (const rc of candidates) {
          const cid = rc.declaration.metadata.contributionId;
          if (duplicateIds.has(cid)) {
            if (!kept.has(cid)) {
              kept.add(cid);
              resolved.push(rc);
            }
          } else {
            resolved.push(rc);
          }
        }
      }
    } else {
      resolved = candidates;
    }

    return {
      pointId,
      contributions: resolved,
      conflicts,
    };
  }

  resolveAll(): ReadonlyMap<ContributionPointId, ContributionResolutionResult> {
    // Collect all unique point IDs from contributions
    const pointIds = new Set<ContributionPointId>();
    for (const declarations of this.contributions.values()) {
      for (const decl of declarations) {
        pointIds.add(decl.targetPointId);
      }
    }

    const results = new Map<ContributionPointId, ContributionResolutionResult>();
    for (const pointId of pointIds) {
      results.set(pointId, this.resolve(pointId));
    }
    return results;
  }

  getContributionsBySource(sourceId: string): readonly ContributionDeclaration[] {
    return this.contributions.get(sourceId) ?? [];
  }
}
