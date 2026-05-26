/**
 * Grouping Tests
 */
import type { GroupHierarchy } from '../src/grouping/group-manager';
import {
  createGroup,
  createGroupHierarchy,
  getGroupMembers,
  getTopLevelGroup,
  ungroup,
  validateGroupHierarchy,
} from '../src/grouping/group-manager';
import { computeGroupBounds, resolveSelectionTarget } from '../src/grouping/group-operations';

// Test helper: deterministic ID generator
function makeIdGen(prefix = 'group'): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

// =============================================================================
// createGroupHierarchy
// =============================================================================

describe('createGroupHierarchy', () => {
  it('should create an empty hierarchy', () => {
    const h = createGroupHierarchy();
    expect(h.groups.size).toBe(0);
    expect(h.parentOf.size).toBe(0);
  });
});

// =============================================================================
// createGroup
// =============================================================================

describe('createGroup', () => {
  it('should create a group from 2 objects', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy, groupId } = createGroup(h, ['obj1', 'obj2'], bounds, makeIdGen());

    expect(groupId).toBeTruthy();
    expect(hierarchy.groups.get(groupId)!.childIds).toEqual(['obj1', 'obj2']);
    expect(hierarchy.parentOf.get('obj1')).toBe(groupId);
    expect(hierarchy.parentOf.get('obj2')).toBe(groupId);
  });

  it('should create a group from 3+ objects', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 200, height: 200 };
    const { hierarchy, groupId } = createGroup(h, ['a', 'b', 'c'], bounds, makeIdGen());

    expect(hierarchy.groups.get(groupId)!.childIds).toHaveLength(3);
    expect(hierarchy.parentOf.get('a')).toBe(groupId);
    expect(hierarchy.parentOf.get('b')).toBe(groupId);
    expect(hierarchy.parentOf.get('c')).toBe(groupId);
  });

  it('should throw for fewer than 2 objects', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(() => createGroup(h, ['obj1'], bounds, makeIdGen())).toThrow('at least 2');
    expect(() => createGroup(h, [], bounds, makeIdGen())).toThrow('at least 2');
  });

  it('should store bounds', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 10, y: 20, width: 300, height: 150 };
    const { hierarchy, groupId } = createGroup(h, ['a', 'b'], bounds, makeIdGen());
    expect(hierarchy.groups.get(groupId)!.bounds).toEqual(bounds);
  });

  it('should support nested groups', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const idGen = makeIdGen();
    const { hierarchy: h1, groupId: g1 } = createGroup(h, ['a', 'b'], bounds, idGen);
    const { hierarchy: h2, groupId: g2 } = createGroup(h1, [g1, 'c'], bounds, idGen);

    expect(h2.parentOf.get(g1)).toBe(g2);
    expect(h2.parentOf.get('c')).toBe(g2);
  });
});

// =============================================================================
// ungroup
// =============================================================================

describe('ungroup', () => {
  it('should remove the group and clear parent references', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy, groupId } = createGroup(h, ['a', 'b'], bounds, makeIdGen());

    const result = ungroup(hierarchy, groupId);
    expect(result.groups.has(groupId)).toBe(false);
    expect(result.parentOf.has('a')).toBe(false);
    expect(result.parentOf.has('b')).toBe(false);
  });

  it('should handle ungrouping non-existent group', () => {
    const h = createGroupHierarchy();
    const result = ungroup(h, 'nonexistent');
    expect(result.groups.size).toBe(0);
  });

  it('should handle nested ungrouping (reparent children to grandparent)', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const idGen = makeIdGen();
    const { hierarchy: h1, groupId: g1 } = createGroup(h, ['a', 'b'], bounds, idGen);
    const { hierarchy: h2, groupId: g2 } = createGroup(h1, [g1, 'c'], bounds, idGen);

    // Ungroup the inner group
    const result = ungroup(h2, g1);
    expect(result.groups.has(g1)).toBe(false);
    // Children of g1 should be reparented to g2 (the grandparent)
    expect(result.parentOf.get('a')).toBe(g2);
    expect(result.parentOf.get('b')).toBe(g2);
    // g2 still exists, now with g1's children as direct children
    const g2Info = result.groups.get(g2);
    expect(g2Info).toBeTruthy();
    expect(g2Info!.childIds).not.toContain(g1);
    expect(g2Info!.childIds).toContain('a');
    expect(g2Info!.childIds).toContain('b');
    expect(g2Info!.childIds).toContain('c');
  });
});

// =============================================================================
// getGroupMembers
// =============================================================================

describe('getGroupMembers', () => {
  it('should return leaf members for a flat group', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy, groupId } = createGroup(h, ['a', 'b', 'c'], bounds, makeIdGen());
    const members = getGroupMembers(hierarchy, groupId);
    expect(members.sort()).toEqual(['a', 'b', 'c']);
  });

  it('should recursively expand nested groups', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const idGen = makeIdGen();
    const { hierarchy: h1, groupId: g1 } = createGroup(h, ['a', 'b'], bounds, idGen);
    const { hierarchy: h2, groupId: g2 } = createGroup(h1, [g1, 'c'], bounds, idGen);

    const members = getGroupMembers(h2, g2);
    expect(members.sort()).toEqual(['a', 'b', 'c']);
  });

  it('should return empty for non-existent group', () => {
    const h = createGroupHierarchy();
    expect(getGroupMembers(h, 'nonexistent')).toEqual([]);
  });
});

// =============================================================================
// getTopLevelGroup
// =============================================================================

describe('getTopLevelGroup', () => {
  it('should return null for ungrouped object', () => {
    const h = createGroupHierarchy();
    expect(getTopLevelGroup(h, 'lonely')).toBeNull();
  });

  it('should return group ID for directly grouped object', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy, groupId } = createGroup(h, ['a', 'b'], bounds, makeIdGen());
    expect(getTopLevelGroup(hierarchy, 'a')).toBe(groupId);
  });

  it('should return top-level group for nested object', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const idGen = makeIdGen();
    const { hierarchy: h1, groupId: g1 } = createGroup(h, ['a', 'b'], bounds, idGen);
    const { hierarchy: h2, groupId: g2 } = createGroup(h1, [g1, 'c'], bounds, idGen);

    // 'a' is in g1, which is in g2. Top-level should be g2.
    expect(getTopLevelGroup(h2, 'a')).toBe(g2);
  });
});

// =============================================================================
// validateGroupHierarchy
// =============================================================================

describe('validateGroupHierarchy', () => {
  it('should validate a valid hierarchy', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy } = createGroup(h, ['a', 'b'], bounds, makeIdGen());
    const result = validateGroupHierarchy(hierarchy);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect empty group', () => {
    const hierarchy: GroupHierarchy = {
      groups: new Map([
        ['g1', { id: 'g1', childIds: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }],
      ]),
      parentOf: new Map(),
    };
    const result = validateGroupHierarchy(hierarchy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'empty')).toBe(true);
  });

  it('should detect orphaned parent references', () => {
    const hierarchy: GroupHierarchy = {
      groups: new Map(),
      parentOf: new Map([['a', 'nonexistent-group']]),
    };
    const result = validateGroupHierarchy(hierarchy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'orphan')).toBe(true);
  });

  it('should detect inconsistent child/parent references', () => {
    const hierarchy: GroupHierarchy = {
      groups: new Map([
        ['g1', { id: 'g1', childIds: ['a', 'b'], bounds: { x: 0, y: 0, width: 0, height: 0 } }],
      ]),
      parentOf: new Map([['a', 'g1']]), // 'b' missing from parentOf
    };
    const result = validateGroupHierarchy(hierarchy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'inconsistent')).toBe(true);
  });

  it('should validate empty hierarchy as valid', () => {
    const h = createGroupHierarchy();
    const result = validateGroupHierarchy(h);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// resolveSelectionTarget
// =============================================================================

describe('resolveSelectionTarget', () => {
  it('should return top-level group on single click', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy, groupId } = createGroup(h, ['a', 'b'], bounds, makeIdGen());

    expect(resolveSelectionTarget(hierarchy, 'a', false)).toBe(groupId);
  });

  it('should return individual object on double click', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy } = createGroup(h, ['a', 'b'], bounds, makeIdGen());

    expect(resolveSelectionTarget(hierarchy, 'a', true)).toBe('a');
  });

  it('should return ungrouped object directly', () => {
    const h = createGroupHierarchy();
    expect(resolveSelectionTarget(h, 'lonely', false)).toBe('lonely');
  });

  it('should return top-level group for nested object on single click', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const idGen = makeIdGen();
    const { hierarchy: h1, groupId: g1 } = createGroup(h, ['a', 'b'], bounds, idGen);
    const { hierarchy: h2, groupId: g2 } = createGroup(h1, [g1, 'c'], bounds, idGen);

    expect(resolveSelectionTarget(h2, 'a', false)).toBe(g2);
  });
});

// =============================================================================
// computeGroupBounds
// =============================================================================

describe('computeGroupBounds', () => {
  it('should compute bounding box from member bounds', () => {
    const bounds = computeGroupBounds([
      { id: 'a', bounds: { x: 10, y: 20, width: 50, height: 30 } },
      { id: 'b', bounds: { x: 100, y: 5, width: 40, height: 60 } },
    ]);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(5);
    expect(bounds.width).toBe(130); // 140 - 10
    expect(bounds.height).toBe(60); // 65 - 5
  });

  it('should handle single member', () => {
    const bounds = computeGroupBounds([
      { id: 'a', bounds: { x: 10, y: 20, width: 50, height: 30 } },
    ]);
    expect(bounds).toEqual({ x: 10, y: 20, width: 50, height: 30 });
  });

  it('should handle empty array', () => {
    const bounds = computeGroupBounds([]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('should handle overlapping members', () => {
    const bounds = computeGroupBounds([
      { id: 'a', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'b', bounds: { x: 50, y: 50, width: 100, height: 100 } },
    ]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });
});
