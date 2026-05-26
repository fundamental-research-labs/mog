/**
 * Group Management for Floating Objects
 *
 * Pure computation logic for grouping and ungrouping floating objects.
 * Extracted from kernel/src/floating-objects/operations/grouping.ts - all Yjs and eventBus removed.
 *
 * Groups form a hierarchy: a group can contain other groups (nested grouping).
 * The hierarchy is represented as two maps:
 * - groups: groupId -> GroupInfo (children, bounds)
 * - parentOf: objectId -> groupId (which group an object belongs to)
 */

import type { BoundingBox } from '@mog-sdk/contracts/geometry';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Information about a single group.
 */
export interface GroupInfo {
  id: string;
  childIds: string[];
  bounds: BoundingBox;
}

/**
 * Complete group hierarchy for a sheet.
 */
export interface GroupHierarchy {
  /** groupId -> group info */
  groups: Map<string, GroupInfo>;
  /** objectId -> groupId (if in a group) */
  parentOf: Map<string, string>;
}

/**
 * Structured validation issue from validateGroupHierarchy.
 */
export interface GroupValidationIssue {
  /** Machine-readable issue code */
  code: 'cycle' | 'empty' | 'orphan' | 'inconsistent';
  /** Human-readable description */
  message: string;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create an empty group hierarchy.
 */
export function createGroupHierarchy(): GroupHierarchy {
  return {
    groups: new Map(),
    parentOf: new Map(),
  };
}

// =============================================================================
// GROUP OPERATIONS
// =============================================================================

/**
 * Create a new group from the given object IDs.
 *
 * @param hierarchy - Current hierarchy
 * @param objectIds - IDs of objects to group (minimum 2)
 * @param bounds - Bounding box for the new group
 * @param idGenerator - Function to generate the group ID. Required to keep this function pure.
 * @returns Updated hierarchy and the new group ID
 */
export function createGroup(
  hierarchy: GroupHierarchy,
  objectIds: string[],
  bounds: BoundingBox,
  idGenerator: () => string,
): { hierarchy: GroupHierarchy; groupId: string } {
  // Deduplicate objectIds
  const uniqueIds = [...new Set(objectIds)];

  if (uniqueIds.length < 2) {
    throw new Error('Need at least 2 objects to create a group');
  }

  const groupId = idGenerator();

  const newGroups = new Map(hierarchy.groups);
  const newParentOf = new Map(hierarchy.parentOf);

  // Remove objects from their existing groups first
  const affectedParentIds = new Set<string>();
  for (const objectId of uniqueIds) {
    const existingParentId = newParentOf.get(objectId);
    if (existingParentId) {
      const existingParent = newGroups.get(existingParentId);
      if (existingParent) {
        newGroups.set(existingParentId, {
          ...existingParent,
          childIds: existingParent.childIds.filter((id) => id !== objectId),
        });
        affectedParentIds.add(existingParentId);
      }
    }
  }

  // Clean up any old groups that became empty or single-child (zombie groups)
  for (const parentId of affectedParentIds) {
    const parentGroup = newGroups.get(parentId);
    if (parentGroup && parentGroup.childIds.length === 0) {
      // Remove the empty group from its own parent's childIds
      const grandParentId = newParentOf.get(parentId);
      if (grandParentId) {
        const grandParent = newGroups.get(grandParentId);
        if (grandParent) {
          newGroups.set(grandParentId, {
            ...grandParent,
            childIds: grandParent.childIds.filter((id) => id !== parentId),
          });
        }
        newParentOf.delete(parentId);
      }
      newGroups.delete(parentId);
    } else if (parentGroup && parentGroup.childIds.length === 1) {
      // Dissolve single-child group: reparent the remaining child to the group's parent
      const remainingChildId = parentGroup.childIds[0];
      const grandParentId = newParentOf.get(parentId);
      if (grandParentId) {
        // Reparent the remaining child to the grandparent
        newParentOf.set(remainingChildId, grandParentId);
        const grandParent = newGroups.get(grandParentId);
        if (grandParent) {
          newGroups.set(grandParentId, {
            ...grandParent,
            childIds: grandParent.childIds.map((id) => (id === parentId ? remainingChildId : id)),
          });
        }
        newParentOf.delete(parentId);
      } else {
        // No grandparent - the child becomes a top-level object
        newParentOf.delete(remainingChildId);
        newParentOf.delete(parentId);
      }
      newGroups.delete(parentId);
    }
  }

  newGroups.set(groupId, {
    id: groupId,
    childIds: [...uniqueIds],
    bounds,
  });

  for (const objectId of uniqueIds) {
    newParentOf.set(objectId, groupId);
  }

  return {
    hierarchy: { groups: newGroups, parentOf: newParentOf },
    groupId,
  };
}

/**
 * Ungroup a group, leaving all member objects intact.
 *
 * @param hierarchy - Current hierarchy
 * @param groupId - ID of the group to ungroup
 * @returns Updated hierarchy
 */
export function ungroup(hierarchy: GroupHierarchy, groupId: string): GroupHierarchy {
  const group = hierarchy.groups.get(groupId);
  if (!group) return hierarchy;

  const newGroups = new Map(hierarchy.groups);
  const newParentOf = new Map(hierarchy.parentOf);

  // Check if this group has a parent (nested ungrouping)
  const parentGroupId = hierarchy.parentOf.get(groupId);

  // Reparent children: if this group has a parent, reparent children to grandparent
  // Otherwise, remove parent references for all children
  for (const childId of group.childIds) {
    if (newParentOf.get(childId) === groupId) {
      if (parentGroupId) {
        newParentOf.set(childId, parentGroupId);
      } else {
        newParentOf.delete(childId);
      }
    }
  }

  // Remove the group itself
  newGroups.delete(groupId);

  // If this group was a child of another group, update the parent group's childIds
  if (parentGroupId) {
    const parentGroup = newGroups.get(parentGroupId);
    if (parentGroup) {
      // Replace this group with its children in the parent's childIds
      const newChildIds = parentGroup.childIds.filter((id) => id !== groupId);
      newChildIds.push(...group.childIds);
      newGroups.set(parentGroupId, {
        ...parentGroup,
        childIds: newChildIds,
      });
    }
    newParentOf.delete(groupId);
  }

  return { groups: newGroups, parentOf: newParentOf };
}

/**
 * Get all objects in a group, recursively expanding nested groups.
 *
 * @param hierarchy - Current hierarchy
 * @param groupId - ID of the group
 * @returns Array of leaf object IDs (non-group members)
 */
export function getGroupMembers(
  hierarchy: GroupHierarchy,
  groupId: string,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(groupId)) return [];
  visited.add(groupId);

  const group = hierarchy.groups.get(groupId);
  if (!group) return [];

  const result: string[] = [];

  for (const childId of group.childIds) {
    if (hierarchy.groups.has(childId)) {
      // Child is a nested group - recurse
      result.push(...getGroupMembers(hierarchy, childId, visited));
    } else {
      result.push(childId);
    }
  }

  return result;
}

/**
 * Get the top-level parent group for an object.
 * Follows the parent chain up to the root.
 *
 * @param hierarchy - Current hierarchy
 * @param objectId - ID of the object
 * @returns Top-level group ID, or null if the object is not in any group
 */
export function getTopLevelGroup(hierarchy: GroupHierarchy, objectId: string): string | null {
  let currentId = objectId;
  let parentId = hierarchy.parentOf.get(currentId);

  if (!parentId) return null;

  const visited = new Set<string>();
  visited.add(currentId);

  while (parentId) {
    if (visited.has(parentId)) {
      // Cycle detected - return current parent as top-level
      return parentId;
    }
    visited.add(parentId);

    const grandParentId = hierarchy.parentOf.get(parentId);
    if (!grandParentId) {
      return parentId;
    }
    currentId = parentId;
    parentId = grandParentId;
  }

  return currentId;
}

/**
 * Validate the group hierarchy for consistency.
 * Checks for: cycles, orphaned children, empty groups.
 *
 * @param hierarchy - Hierarchy to validate
 * @returns Validation result with issues
 */
export function validateGroupHierarchy(hierarchy: GroupHierarchy): {
  valid: boolean;
  issues: GroupValidationIssue[];
} {
  const issues: GroupValidationIssue[] = [];

  // Check for empty groups
  for (const [groupId, group] of hierarchy.groups) {
    if (group.childIds.length === 0) {
      issues.push({ code: 'empty', message: `Group ${groupId} has no children` });
    }
  }

  // Check that all parentOf references point to existing groups
  for (const [objectId, groupId] of hierarchy.parentOf) {
    if (!hierarchy.groups.has(groupId)) {
      issues.push({
        code: 'orphan',
        message: `Object ${objectId} references non-existent group ${groupId}`,
      });
    }
  }

  // Check that all children in groups have matching parentOf entries
  for (const [groupId, group] of hierarchy.groups) {
    for (const childId of group.childIds) {
      const parentId = hierarchy.parentOf.get(childId);
      if (parentId !== groupId) {
        issues.push({
          code: 'inconsistent',
          message: `Group ${groupId} lists child ${childId} but parentOf says ${parentId ?? 'none'}`,
        });
      }
    }
  }

  // Check for cycles: follow parent chain from each group
  for (const groupId of hierarchy.groups.keys()) {
    const visited = new Set<string>();
    let currentId: string | undefined = groupId;

    while (currentId) {
      if (visited.has(currentId)) {
        issues.push({ code: 'cycle', message: `Cycle detected involving group ${currentId}` });
        break;
      }
      visited.add(currentId);
      currentId = hierarchy.parentOf.get(currentId);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
