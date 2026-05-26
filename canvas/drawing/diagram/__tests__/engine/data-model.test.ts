/**
 * Comprehensive tests for DataModel navigation API.
 *
 * Tests all 13 OOXML axis types, element type filtering, hierarchy queries,
 * chained axis navigation, and edge cases across 7 different tree topologies.
 *
 * Test fixtures:
 * 1. Empty tree (just doc root)
 * 2. Flat list (doc -> 5 siblings)
 * 3. Deep hierarchy (doc -> A -> B -> C -> D, 4 levels)
 * 4. Wide tree (mixed widths)
 * 5. Org chart with assistants
 * 6. With sibling transitions
 * 7. Complex real-world (15+ nodes, 3 levels, mixed types)
 */

import {
  DataModel,
  DataModelConnection,
  DataModelPoint,
  PointType,
  ST_AxisType,
} from '../../src/engine/data-model';

// ============================================================================
// Test Fixture Builders
// ============================================================================

/** Helper to create a DataModelPoint */
function pt(modelId: string, type: PointType, text: string = ''): DataModelPoint {
  return { modelId, type, text };
}

/** Helper to create a parOf connection */
function parOf(
  modelId: string,
  srcId: string,
  destId: string,
  srcOrd: number,
  destOrd: number = 0,
): DataModelConnection {
  return { modelId, type: 'parOf', srcId, destId, srcOrd, destOrd };
}

// ============================================================================
// Fixture 1: Empty Tree (just doc root, no children)
// ============================================================================

function createEmptyTree(): DataModel {
  const points: DataModelPoint[] = [pt('0', 'doc', 'Root')];
  const connections: DataModelConnection[] = [];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Fixture 2: Flat List (doc -> [A, B, C, D, E])
// ============================================================================

function createFlatList(): DataModel {
  const points: DataModelPoint[] = [
    pt('0', 'doc', 'Root'),
    pt('1', 'node', 'A'),
    pt('2', 'node', 'B'),
    pt('3', 'node', 'C'),
    pt('4', 'node', 'D'),
    pt('5', 'node', 'E'),
  ];
  const connections: DataModelConnection[] = [
    parOf('c1', '0', '1', 0),
    parOf('c2', '0', '2', 1),
    parOf('c3', '0', '3', 2),
    parOf('c4', '0', '4', 3),
    parOf('c5', '0', '5', 4),
  ];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Fixture 3: Deep Hierarchy (doc -> A -> B -> C -> D, 4 levels deep)
// ============================================================================

function createDeepHierarchy(): DataModel {
  const points: DataModelPoint[] = [
    pt('0', 'doc', 'Root'),
    pt('1', 'node', 'A'),
    pt('2', 'node', 'B'),
    pt('3', 'node', 'C'),
    pt('4', 'node', 'D'),
  ];
  const connections: DataModelConnection[] = [
    parOf('c1', '0', '1', 0),
    parOf('c2', '1', '2', 0),
    parOf('c3', '2', '3', 0),
    parOf('c4', '3', '4', 0),
  ];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Fixture 4: Wide Tree (doc -> [A(->A1,A2,A3), B(->B1,B2), C])
// ============================================================================

function createWideTree(): DataModel {
  const points: DataModelPoint[] = [
    pt('0', 'doc', 'Root'),
    pt('A', 'node', 'A'),
    pt('B', 'node', 'B'),
    pt('C', 'node', 'C'),
    pt('A1', 'node', 'A1'),
    pt('A2', 'node', 'A2'),
    pt('A3', 'node', 'A3'),
    pt('B1', 'node', 'B1'),
    pt('B2', 'node', 'B2'),
  ];
  const connections: DataModelConnection[] = [
    parOf('c1', '0', 'A', 0),
    parOf('c2', '0', 'B', 1),
    parOf('c3', '0', 'C', 2),
    parOf('c4', 'A', 'A1', 0),
    parOf('c5', 'A', 'A2', 1),
    parOf('c6', 'A', 'A3', 2),
    parOf('c7', 'B', 'B1', 0),
    parOf('c8', 'B', 'B2', 1),
  ];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Fixture 5: Org Chart with Assistants
// doc -> Boss( -> [Asst(asst), VP1(-> [Mgr1, Mgr2]), VP2] )
// ============================================================================

function createOrgChart(): DataModel {
  const points: DataModelPoint[] = [
    pt('0', 'doc', 'Root'),
    pt('boss', 'node', 'Boss'),
    pt('asst', 'asst', 'Assistant'),
    pt('vp1', 'node', 'VP1'),
    pt('vp2', 'node', 'VP2'),
    pt('mgr1', 'node', 'Manager 1'),
    pt('mgr2', 'node', 'Manager 2'),
  ];
  const connections: DataModelConnection[] = [
    parOf('c1', '0', 'boss', 0),
    parOf('c2', 'boss', 'asst', 0),
    parOf('c3', 'boss', 'vp1', 1),
    parOf('c4', 'boss', 'vp2', 2),
    parOf('c5', 'vp1', 'mgr1', 0),
    parOf('c6', 'vp1', 'mgr2', 1),
  ];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Fixture 6: With Sibling Transitions
// doc -> [A, sibT1(sibTrans), B, sibT2(sibTrans), C]
// ============================================================================

function createWithTransitions(): DataModel {
  const points: DataModelPoint[] = [
    pt('0', 'doc', 'Root'),
    pt('A', 'node', 'A'),
    pt('st1', 'sibTrans', 'Trans 1'),
    pt('B', 'node', 'B'),
    pt('st2', 'sibTrans', 'Trans 2'),
    pt('C', 'node', 'C'),
  ];
  const connections: DataModelConnection[] = [
    parOf('c1', '0', 'A', 0),
    parOf('c2', '0', 'st1', 1),
    parOf('c3', '0', 'B', 2),
    parOf('c4', '0', 'st2', 3),
    parOf('c5', '0', 'C', 4),
  ];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Fixture 7: Complex Real-World (15+ nodes, 3 levels, mixed types)
//
// doc
//  ├── dept1 (node)
//  │   ├── pt_d1 (parTrans)
//  │   ├── team1 (node)
//  │   │   ├── pt_t1 (parTrans)
//  │   │   ├── dev1 (node)
//  │   │   ├── st_d1d2 (sibTrans)
//  │   │   └── dev2 (node)
//  │   ├── st_t1t2 (sibTrans)
//  │   └── team2 (node)
//  │       └── dev3 (node)
//  ├── st_d1d2_top (sibTrans)
//  ├── dept2 (node)
//  │   ├── pt_d2 (parTrans)
//  │   ├── asstDept2 (asst)
//  │   └── team3 (node)
//  │       └── dev4 (node)
//  └── dept3 (node)
//      └── presNode (pres)
// ============================================================================

function createComplexTree(): DataModel {
  const points: DataModelPoint[] = [
    pt('0', 'doc', 'Root'),
    pt('dept1', 'node', 'Department 1'),
    pt('pt_d1', 'parTrans', 'ParTrans D1'),
    pt('team1', 'node', 'Team 1'),
    pt('pt_t1', 'parTrans', 'ParTrans T1'),
    pt('dev1', 'node', 'Developer 1'),
    pt('st_d1d2', 'sibTrans', 'SibTrans D1-D2'),
    pt('dev2', 'node', 'Developer 2'),
    pt('st_t1t2', 'sibTrans', 'SibTrans T1-T2'),
    pt('team2', 'node', 'Team 2'),
    pt('dev3', 'node', 'Developer 3'),
    pt('st_d1d2_top', 'sibTrans', 'SibTrans Dept1-Dept2'),
    pt('dept2', 'node', 'Department 2'),
    pt('pt_d2', 'parTrans', 'ParTrans D2'),
    pt('asstDept2', 'asst', 'Assistant Dept2'),
    pt('team3', 'node', 'Team 3'),
    pt('dev4', 'node', 'Developer 4'),
    pt('dept3', 'node', 'Department 3'),
    pt('presNode', 'pres', 'Presentation Node'),
  ];
  const connections: DataModelConnection[] = [
    // Root -> departments
    parOf('c1', '0', 'dept1', 0),
    parOf('c2', '0', 'st_d1d2_top', 1),
    parOf('c3', '0', 'dept2', 2),
    parOf('c4', '0', 'dept3', 3),
    // dept1 -> children
    parOf('c5', 'dept1', 'pt_d1', 0),
    parOf('c6', 'dept1', 'team1', 1),
    parOf('c7', 'dept1', 'st_t1t2', 2),
    parOf('c8', 'dept1', 'team2', 3),
    // team1 -> children
    parOf('c9', 'team1', 'pt_t1', 0),
    parOf('c10', 'team1', 'dev1', 1),
    parOf('c11', 'team1', 'st_d1d2', 2),
    parOf('c12', 'team1', 'dev2', 3),
    // team2 -> children
    parOf('c13', 'team2', 'dev3', 0),
    // dept2 -> children
    parOf('c14', 'dept2', 'pt_d2', 0),
    parOf('c15', 'dept2', 'asstDept2', 1),
    parOf('c16', 'dept2', 'team3', 2),
    // team3 -> children
    parOf('c17', 'team3', 'dev4', 0),
    // dept3 -> children
    parOf('c18', 'dept3', 'presNode', 0),
  ];
  return DataModel.fromPoints(points, connections);
}

// ============================================================================
// Helper: extract modelIds from points
// ============================================================================

function ids(points: DataModelPoint[]): string[] {
  return points.map((p) => p.modelId);
}

// ============================================================================
// Tests
// ============================================================================

describe('DataModel', () => {
  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('construction', () => {
    it('should create from points and connections', () => {
      const dm = createFlatList();
      expect(dm.getRoot()).toBeDefined();
      expect(dm.getRoot().type).toBe('doc');
    });

    it('should throw if no doc point exists', () => {
      const points = [pt('1', 'node', 'A')];
      expect(() => DataModel.fromPoints(points, [])).toThrow(
        'DataModel must contain exactly one point of type "doc"',
      );
    });

    it('should handle empty connections', () => {
      const dm = createEmptyTree();
      expect(dm.getRoot().modelId).toBe('0');
      expect(dm.getChildren('0')).toEqual([]);
    });

    it('should handle duplicate modelIds gracefully (first wins)', () => {
      const points = [
        pt('0', 'doc', 'Root'),
        pt('1', 'node', 'First'),
        pt('1', 'node', 'Second'), // duplicate
      ];
      const dm = DataModel.fromPoints(points, [parOf('c1', '0', '1', 0)]);
      expect(dm.getPoint('1')?.text).toBe('First');
    });

    it('should ignore connections referencing non-existent points', () => {
      const points = [pt('0', 'doc', 'Root'), pt('1', 'node', 'A')];
      const connections = [
        parOf('c1', '0', '1', 0),
        parOf('c2', '0', 'ghost', 1), // ghost doesn't exist
        parOf('c3', 'ghost2', '1', 0), // ghost2 doesn't exist
      ];
      const dm = DataModel.fromPoints(points, connections);
      expect(ids(dm.getChildren('0'))).toEqual(['1']);
    });
  });

  // ==========================================================================
  // Point Lookup
  // ==========================================================================

  describe('getPoint', () => {
    it('should return point by modelId', () => {
      const dm = createFlatList();
      const point = dm.getPoint('3');
      expect(point).toBeDefined();
      expect(point!.text).toBe('C');
      expect(point!.type).toBe('node');
    });

    it('should return undefined for non-existent modelId', () => {
      const dm = createFlatList();
      expect(dm.getPoint('nonexistent')).toBeUndefined();
    });
  });

  describe('getRoot', () => {
    it('should return the doc type point', () => {
      const dm = createFlatList();
      const root = dm.getRoot();
      expect(root.modelId).toBe('0');
      expect(root.type).toBe('doc');
    });
  });

  describe('getAllPoints', () => {
    it('should return all points when no filter', () => {
      const dm = createFlatList();
      expect(dm.getAllPoints()).toHaveLength(6); // doc + 5 nodes
    });

    it('should filter by point type', () => {
      const dm = createOrgChart();
      expect(dm.getAllPoints('node')).toHaveLength(5); // Boss, VP1, VP2, Mgr1, Mgr2
      expect(dm.getAllPoints('asst')).toHaveLength(1); // Asst
      expect(dm.getAllPoints('doc')).toHaveLength(1); // Root
    });

    it('should return empty array for unmatched filter', () => {
      const dm = createFlatList();
      expect(dm.getAllPoints('asst')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Axis: self
  // ==========================================================================

  describe('axis: self', () => {
    it('should return the point itself', () => {
      const dm = createFlatList();
      const result = dm.navigate('3', 'self');
      expect(ids(result)).toEqual(['3']);
    });

    it('should return empty for non-existent point', () => {
      const dm = createFlatList();
      expect(dm.navigate('ghost', 'self')).toEqual([]);
    });

    it('should work on the root', () => {
      const dm = createFlatList();
      const result = dm.navigate('0', 'self');
      expect(ids(result)).toEqual(['0']);
      expect(result[0].type).toBe('doc');
    });

    it('should apply element type filter', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'self', 'doc')).toHaveLength(1);
      expect(dm.navigate('0', 'self', 'node')).toHaveLength(0);
      expect(dm.navigate('1', 'self', 'node')).toHaveLength(1);
      expect(dm.navigate('1', 'self', 'doc')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Axis: ch (children)
  // ==========================================================================

  describe('axis: ch', () => {
    it('should return direct children in srcOrd order', () => {
      const dm = createFlatList();
      const result = dm.navigate('0', 'ch');
      expect(ids(result)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('should return empty for leaf nodes', () => {
      const dm = createFlatList();
      expect(dm.navigate('1', 'ch')).toEqual([]);
    });

    it('should return children of nested nodes', () => {
      const dm = createWideTree();
      expect(ids(dm.navigate('A', 'ch'))).toEqual(['A1', 'A2', 'A3']);
      expect(ids(dm.navigate('B', 'ch'))).toEqual(['B1', 'B2']);
      expect(dm.navigate('C', 'ch')).toEqual([]);
    });

    it('should filter by element type', () => {
      const dm = createOrgChart();
      // Boss children: asst(asst), vp1(node), vp2(node)
      const allChildren = dm.navigate('boss', 'ch');
      expect(ids(allChildren)).toEqual(['asst', 'vp1', 'vp2']);

      const onlyNodes = dm.navigate('boss', 'ch', 'node');
      expect(ids(onlyNodes)).toEqual(['vp1', 'vp2']);

      const onlyAsst = dm.navigate('boss', 'ch', 'asst');
      expect(ids(onlyAsst)).toEqual(['asst']);

      const nonAsst = dm.navigate('boss', 'ch', 'nonAsst');
      expect(ids(nonAsst)).toEqual(['vp1', 'vp2']);
    });

    it('should filter by sibTrans element type', () => {
      const dm = createWithTransitions();
      const allChildren = dm.navigate('0', 'ch');
      expect(ids(allChildren)).toEqual(['A', 'st1', 'B', 'st2', 'C']);

      const onlyNodes = dm.navigate('0', 'ch', 'node');
      expect(ids(onlyNodes)).toEqual(['A', 'B', 'C']);

      const onlySibTrans = dm.navigate('0', 'ch', 'sibTrans');
      expect(ids(onlySibTrans)).toEqual(['st1', 'st2']);
    });

    it('should return empty for non-existent point', () => {
      const dm = createFlatList();
      expect(dm.navigate('ghost', 'ch')).toEqual([]);
    });

    it('should handle the root having no children', () => {
      const dm = createEmptyTree();
      expect(dm.navigate('0', 'ch')).toEqual([]);
    });
  });

  // ==========================================================================
  // Axis: des (descendants)
  // ==========================================================================

  describe('axis: des', () => {
    it('should return all descendants in depth-first order', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('0', 'des');
      expect(ids(result)).toEqual(['1', '2', '3', '4']);
    });

    it('should return descendants of intermediate node', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('1', 'des');
      expect(ids(result)).toEqual(['2', '3', '4']);
    });

    it('should return empty for leaf nodes', () => {
      const dm = createDeepHierarchy();
      expect(dm.navigate('4', 'des')).toEqual([]);
    });

    it('should handle wide tree depth-first', () => {
      const dm = createWideTree();
      const result = dm.navigate('0', 'des');
      expect(ids(result)).toEqual(['A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2', 'C']);
    });

    it('should filter descendants by element type', () => {
      const dm = createComplexTree();
      // descendants of dept1 include parTrans, sibTrans, and nodes
      const allDesc = dm.navigate('dept1', 'des');
      const nodeDesc = dm.navigate('dept1', 'des', 'node');
      const parTransDesc = dm.navigate('dept1', 'des', 'parTrans');
      const sibTransDesc = dm.navigate('dept1', 'des', 'sibTrans');

      expect(nodeDesc.every((p) => p.type === 'node')).toBe(true);
      expect(parTransDesc.every((p) => p.type === 'parTrans')).toBe(true);
      expect(sibTransDesc.every((p) => p.type === 'sibTrans')).toBe(true);
      expect(nodeDesc.length + parTransDesc.length + sibTransDesc.length).toBe(allDesc.length);
    });

    it('should return empty for empty tree', () => {
      const dm = createEmptyTree();
      expect(dm.navigate('0', 'des')).toEqual([]);
    });
  });

  // ==========================================================================
  // Axis: desOrSelf
  // ==========================================================================

  describe('axis: desOrSelf', () => {
    it('should include self then all descendants', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('1', 'desOrSelf');
      expect(ids(result)).toEqual(['1', '2', '3', '4']);
    });

    it('should return just self for leaf node', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('4', 'desOrSelf');
      expect(ids(result)).toEqual(['4']);
    });

    it('should include root for root node', () => {
      const dm = createFlatList();
      const result = dm.navigate('0', 'desOrSelf');
      expect(result[0].modelId).toBe('0');
      expect(result[0].type).toBe('doc');
      expect(result.length).toBe(6); // root + 5 children
    });

    it('should filter by element type (self included only if matches)', () => {
      const dm = createFlatList();
      // Root is 'doc', children are 'node'
      const onlyNodes = dm.navigate('0', 'desOrSelf', 'node');
      expect(onlyNodes.every((p) => p.type === 'node')).toBe(true);
      expect(onlyNodes).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Axis: par (parent)
  // ==========================================================================

  describe('axis: par', () => {
    it('should return the parent', () => {
      const dm = createFlatList();
      const result = dm.navigate('3', 'par');
      expect(ids(result)).toEqual(['0']);
    });

    it('should return empty for the root', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'par')).toEqual([]);
    });

    it('should return correct parent in deep hierarchy', () => {
      const dm = createDeepHierarchy();
      expect(ids(dm.navigate('4', 'par'))).toEqual(['3']);
      expect(ids(dm.navigate('3', 'par'))).toEqual(['2']);
      expect(ids(dm.navigate('2', 'par'))).toEqual(['1']);
      expect(ids(dm.navigate('1', 'par'))).toEqual(['0']);
    });

    it('should filter parent by element type', () => {
      const dm = createFlatList();
      // Parent of '1' is '0' (doc type)
      expect(dm.navigate('1', 'par', 'doc')).toHaveLength(1);
      expect(dm.navigate('1', 'par', 'node')).toHaveLength(0);
    });

    it('should return empty for non-existent point', () => {
      const dm = createFlatList();
      expect(dm.navigate('ghost', 'par')).toEqual([]);
    });
  });

  describe('getParent', () => {
    it('should return parent point', () => {
      const dm = createDeepHierarchy();
      expect(dm.getParent('4')?.modelId).toBe('3');
    });

    it('should return undefined for root', () => {
      const dm = createDeepHierarchy();
      expect(dm.getParent('0')).toBeUndefined();
    });

    it('should return undefined for non-existent point', () => {
      const dm = createDeepHierarchy();
      expect(dm.getParent('ghost')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Axis: ancst (ancestors)
  // ==========================================================================

  describe('axis: ancst', () => {
    it('should return ancestors from parent to root', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('4', 'ancst');
      expect(ids(result)).toEqual(['3', '2', '1', '0']);
    });

    it('should return empty for root', () => {
      const dm = createDeepHierarchy();
      expect(dm.navigate('0', 'ancst')).toEqual([]);
    });

    it('should return just parent for direct child of root', () => {
      const dm = createFlatList();
      const result = dm.navigate('3', 'ancst');
      expect(ids(result)).toEqual(['0']);
    });

    it('should filter ancestors by element type', () => {
      const dm = createDeepHierarchy();
      // Ancestors of '4': ['3'(node), '2'(node), '1'(node), '0'(doc)]
      const onlyNodes = dm.navigate('4', 'ancst', 'node');
      expect(ids(onlyNodes)).toEqual(['3', '2', '1']);

      const onlyDoc = dm.navigate('4', 'ancst', 'doc');
      expect(ids(onlyDoc)).toEqual(['0']);
    });
  });

  // ==========================================================================
  // Axis: ancstOrSelf
  // ==========================================================================

  describe('axis: ancstOrSelf', () => {
    it('should include self then ancestors', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('4', 'ancstOrSelf');
      expect(ids(result)).toEqual(['4', '3', '2', '1', '0']);
    });

    it('should return just self for root', () => {
      const dm = createDeepHierarchy();
      const result = dm.navigate('0', 'ancstOrSelf');
      expect(ids(result)).toEqual(['0']);
    });

    it('should filter by element type', () => {
      const dm = createDeepHierarchy();
      const onlyNodes = dm.navigate('4', 'ancstOrSelf', 'node');
      expect(ids(onlyNodes)).toEqual(['4', '3', '2', '1']);
    });
  });

  // ==========================================================================
  // Axis: followSib (following siblings)
  // ==========================================================================

  describe('axis: followSib', () => {
    it('should return siblings after current in srcOrd order', () => {
      const dm = createFlatList();
      expect(ids(dm.navigate('1', 'followSib'))).toEqual(['2', '3', '4', '5']);
      expect(ids(dm.navigate('3', 'followSib'))).toEqual(['4', '5']);
      expect(ids(dm.navigate('5', 'followSib'))).toEqual([]);
    });

    it('should return empty for root', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'followSib')).toEqual([]);
    });

    it('should return empty for only child', () => {
      const dm = createDeepHierarchy();
      // Each node in deep hierarchy is an only child
      expect(dm.navigate('1', 'followSib')).toEqual([]);
    });

    it('should filter by element type', () => {
      const dm = createWithTransitions();
      // Children of root: A(node), st1(sibTrans), B(node), st2(sibTrans), C(node)
      const afterA = dm.navigate('A', 'followSib');
      expect(ids(afterA)).toEqual(['st1', 'B', 'st2', 'C']);

      const afterA_nodes = dm.navigate('A', 'followSib', 'node');
      expect(ids(afterA_nodes)).toEqual(['B', 'C']);

      const afterA_trans = dm.navigate('A', 'followSib', 'sibTrans');
      expect(ids(afterA_trans)).toEqual(['st1', 'st2']);
    });

    it('should work for middle sibling', () => {
      const dm = createWideTree();
      // Root children: A, B, C
      expect(ids(dm.navigate('B', 'followSib'))).toEqual(['C']);
    });
  });

  describe('getFollowingSiblings', () => {
    it('should delegate to navigate with followSib axis', () => {
      const dm = createFlatList();
      expect(ids(dm.getFollowingSiblings('2'))).toEqual(['3', '4', '5']);
    });

    it('should accept ptType filter', () => {
      const dm = createWithTransitions();
      expect(ids(dm.getFollowingSiblings('A', 'node'))).toEqual(['B', 'C']);
    });
  });

  // ==========================================================================
  // Axis: precedSib (preceding siblings)
  // ==========================================================================

  describe('axis: precedSib', () => {
    it('should return siblings before current in srcOrd order', () => {
      const dm = createFlatList();
      expect(ids(dm.navigate('1', 'precedSib'))).toEqual([]);
      expect(ids(dm.navigate('3', 'precedSib'))).toEqual(['1', '2']);
      expect(ids(dm.navigate('5', 'precedSib'))).toEqual(['1', '2', '3', '4']);
    });

    it('should return empty for root', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'precedSib')).toEqual([]);
    });

    it('should return empty for only child', () => {
      const dm = createDeepHierarchy();
      expect(dm.navigate('1', 'precedSib')).toEqual([]);
    });

    it('should filter by element type', () => {
      const dm = createWithTransitions();
      // Before C: A(node), st1(sibTrans), B(node), st2(sibTrans)
      const beforeC = dm.navigate('C', 'precedSib');
      expect(ids(beforeC)).toEqual(['A', 'st1', 'B', 'st2']);

      const beforeC_nodes = dm.navigate('C', 'precedSib', 'node');
      expect(ids(beforeC_nodes)).toEqual(['A', 'B']);
    });
  });

  describe('getPrecedingSiblings', () => {
    it('should delegate to navigate with precedSib axis', () => {
      const dm = createFlatList();
      expect(ids(dm.getPrecedingSiblings('4'))).toEqual(['1', '2', '3']);
    });
  });

  // ==========================================================================
  // Axis: follow (all following in document order)
  // ==========================================================================

  describe('axis: follow', () => {
    it('should return all nodes after in document order', () => {
      const dm = createFlatList();
      // Document order: 0, 1, 2, 3, 4, 5
      expect(ids(dm.navigate('0', 'follow'))).toEqual(['1', '2', '3', '4', '5']);
      expect(ids(dm.navigate('3', 'follow'))).toEqual(['4', '5']);
      expect(ids(dm.navigate('5', 'follow'))).toEqual([]);
    });

    it('should follow depth-first document order', () => {
      const dm = createWideTree();
      // Doc order: 0, A, A1, A2, A3, B, B1, B2, C
      expect(ids(dm.navigate('A', 'follow'))).toEqual(['A1', 'A2', 'A3', 'B', 'B1', 'B2', 'C']);
      expect(ids(dm.navigate('A3', 'follow'))).toEqual(['B', 'B1', 'B2', 'C']);
      expect(ids(dm.navigate('B2', 'follow'))).toEqual(['C']);
    });

    it('should return empty for last node in document order', () => {
      const dm = createWideTree();
      expect(dm.navigate('C', 'follow')).toEqual([]);
    });

    it('should filter by element type', () => {
      const dm = createComplexTree();
      const allFollowing = dm.navigate('dept1', 'follow');
      const nodeFollowing = dm.navigate('dept1', 'follow', 'node');
      expect(nodeFollowing.every((p) => p.type === 'node')).toBe(true);
      expect(nodeFollowing.length).toBeLessThan(allFollowing.length);
    });
  });

  // ==========================================================================
  // Axis: preced (all preceding in document order)
  // ==========================================================================

  describe('axis: preced', () => {
    it('should return all nodes before in document order', () => {
      const dm = createFlatList();
      expect(ids(dm.navigate('5', 'preced'))).toEqual(['0', '1', '2', '3', '4']);
      expect(ids(dm.navigate('3', 'preced'))).toEqual(['0', '1', '2']);
      expect(ids(dm.navigate('0', 'preced'))).toEqual([]);
    });

    it('should follow depth-first document order', () => {
      const dm = createWideTree();
      // Doc order: 0, A, A1, A2, A3, B, B1, B2, C
      expect(ids(dm.navigate('C', 'preced'))).toEqual([
        '0',
        'A',
        'A1',
        'A2',
        'A3',
        'B',
        'B1',
        'B2',
      ]);
      expect(ids(dm.navigate('B', 'preced'))).toEqual(['0', 'A', 'A1', 'A2', 'A3']);
    });

    it('should return empty for root', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'preced')).toEqual([]);
    });

    it('should filter by element type', () => {
      const dm = createComplexTree();
      const nodePreceding = dm.navigate('dept3', 'preced', 'node');
      expect(nodePreceding.every((p) => p.type === 'node')).toBe(true);
    });
  });

  // ==========================================================================
  // Axis: root
  // ==========================================================================

  describe('axis: root', () => {
    it('should always return the doc root', () => {
      const dm = createDeepHierarchy();
      expect(ids(dm.navigate('4', 'root'))).toEqual(['0']);
      expect(ids(dm.navigate('0', 'root'))).toEqual(['0']);
      expect(ids(dm.navigate('2', 'root'))).toEqual(['0']);
    });

    it('should return the root even for non-existent point', () => {
      const dm = createFlatList();
      // root axis always returns root, regardless of fromPointId
      expect(ids(dm.navigate('ghost', 'root'))).toEqual(['0']);
    });

    it('should filter by element type', () => {
      const dm = createFlatList();
      expect(dm.navigate('1', 'root', 'doc')).toHaveLength(1);
      expect(dm.navigate('1', 'root', 'node')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Axis: none
  // ==========================================================================

  describe('axis: none', () => {
    it('should always return empty array', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'none')).toEqual([]);
      expect(dm.navigate('3', 'none')).toEqual([]);
      expect(dm.navigate('ghost', 'none')).toEqual([]);
    });

    it('should return empty regardless of element type', () => {
      const dm = createFlatList();
      expect(dm.navigate('0', 'none', 'doc')).toEqual([]);
      expect(dm.navigate('0', 'none', 'all')).toEqual([]);
    });
  });

  // ==========================================================================
  // getSiblings
  // ==========================================================================

  describe('getSiblings', () => {
    it('should return all siblings excluding self', () => {
      const dm = createFlatList();
      expect(ids(dm.getSiblings('3'))).toEqual(['1', '2', '4', '5']);
    });

    it('should return empty for root', () => {
      const dm = createFlatList();
      expect(dm.getSiblings('0')).toEqual([]);
    });

    it('should return empty for only child', () => {
      const dm = createDeepHierarchy();
      expect(dm.getSiblings('1')).toEqual([]);
    });

    it('should filter by element type', () => {
      const dm = createOrgChart();
      // boss children: asst, vp1, vp2
      expect(ids(dm.getSiblings('vp1', 'node'))).toEqual(['vp2']);
      expect(ids(dm.getSiblings('vp1', 'asst'))).toEqual(['asst']);
    });
  });

  // ==========================================================================
  // Hierarchy Queries
  // ==========================================================================

  describe('getDepth', () => {
    it('should return 0 for root', () => {
      const dm = createDeepHierarchy();
      expect(dm.getDepth('0')).toBe(0);
    });

    it('should return correct depth for children', () => {
      const dm = createDeepHierarchy();
      expect(dm.getDepth('1')).toBe(1);
      expect(dm.getDepth('2')).toBe(2);
      expect(dm.getDepth('3')).toBe(3);
      expect(dm.getDepth('4')).toBe(4);
    });

    it('should return correct depth in wide tree', () => {
      const dm = createWideTree();
      expect(dm.getDepth('0')).toBe(0);
      expect(dm.getDepth('A')).toBe(1);
      expect(dm.getDepth('A1')).toBe(2);
      expect(dm.getDepth('B1')).toBe(2);
      expect(dm.getDepth('C')).toBe(1);
    });

    it('should return -1 for non-existent point', () => {
      const dm = createFlatList();
      expect(dm.getDepth('ghost')).toBe(-1);
    });
  });

  describe('getMaxDepth', () => {
    it('should return 0 for empty tree', () => {
      const dm = createEmptyTree();
      expect(dm.getMaxDepth()).toBe(0);
    });

    it('should return 1 for flat list', () => {
      const dm = createFlatList();
      expect(dm.getMaxDepth()).toBe(1);
    });

    it('should return 4 for deep hierarchy', () => {
      const dm = createDeepHierarchy();
      expect(dm.getMaxDepth()).toBe(4);
    });

    it('should return 2 for wide tree', () => {
      const dm = createWideTree();
      expect(dm.getMaxDepth()).toBe(2);
    });

    it('should return correct depth for complex tree', () => {
      const dm = createComplexTree();
      // doc(0) -> dept1(1) -> team1(2) -> dev1(3)
      expect(dm.getMaxDepth()).toBe(3);
    });
  });

  describe('getPosition', () => {
    it('should return 1-based position among siblings', () => {
      const dm = createFlatList();
      expect(dm.getPosition('1')).toBe(1);
      expect(dm.getPosition('2')).toBe(2);
      expect(dm.getPosition('3')).toBe(3);
      expect(dm.getPosition('4')).toBe(4);
      expect(dm.getPosition('5')).toBe(5);
    });

    it('should return 0 for root (no parent)', () => {
      const dm = createFlatList();
      expect(dm.getPosition('0')).toBe(0);
    });

    it('should return 1 for only child', () => {
      const dm = createDeepHierarchy();
      expect(dm.getPosition('1')).toBe(1);
      expect(dm.getPosition('2')).toBe(1);
    });

    it('should work correctly in wide tree', () => {
      const dm = createWideTree();
      expect(dm.getPosition('A')).toBe(1);
      expect(dm.getPosition('B')).toBe(2);
      expect(dm.getPosition('C')).toBe(3);
      expect(dm.getPosition('A1')).toBe(1);
      expect(dm.getPosition('A2')).toBe(2);
      expect(dm.getPosition('A3')).toBe(3);
    });

    it('should return 0 for non-existent point', () => {
      const dm = createFlatList();
      expect(dm.getPosition('ghost')).toBe(0);
    });
  });

  describe('getReversePosition', () => {
    it('should count from end (1 = last)', () => {
      const dm = createFlatList();
      expect(dm.getReversePosition('5')).toBe(1); // last
      expect(dm.getReversePosition('4')).toBe(2);
      expect(dm.getReversePosition('3')).toBe(3);
      expect(dm.getReversePosition('2')).toBe(4);
      expect(dm.getReversePosition('1')).toBe(5); // first
    });

    it('should return 0 for root', () => {
      const dm = createFlatList();
      expect(dm.getReversePosition('0')).toBe(0);
    });

    it('should return 1 for only child', () => {
      const dm = createDeepHierarchy();
      expect(dm.getReversePosition('1')).toBe(1);
    });

    it('should be complementary to getPosition', () => {
      const dm = createFlatList();
      for (let i = 1; i <= 5; i++) {
        const pos = dm.getPosition(String(i));
        const revPos = dm.getReversePosition(String(i));
        expect(pos + revPos).toBe(6); // total siblings + 1
      }
    });
  });

  describe('getCount', () => {
    it('should count children', () => {
      const dm = createFlatList();
      expect(dm.getCount('0', 'ch')).toBe(5);
    });

    it('should count descendants', () => {
      const dm = createWideTree();
      expect(dm.getCount('0', 'des')).toBe(8); // A, A1, A2, A3, B, B1, B2, C
    });

    it('should count with ptType filter', () => {
      const dm = createOrgChart();
      expect(dm.getCount('boss', 'ch', 'node')).toBe(2); // VP1, VP2
      expect(dm.getCount('boss', 'ch', 'asst')).toBe(1); // Asst
      expect(dm.getCount('boss', 'ch', 'all')).toBe(3);
    });

    it('should return 0 for none axis', () => {
      const dm = createFlatList();
      expect(dm.getCount('0', 'none')).toBe(0);
    });

    it('should count following siblings', () => {
      const dm = createFlatList();
      expect(dm.getCount('1', 'followSib')).toBe(4);
      expect(dm.getCount('5', 'followSib')).toBe(0);
    });
  });

  // ==========================================================================
  // Chained Axis Navigation
  // ==========================================================================

  describe('navigateChained', () => {
    it('should navigate grandchildren with ch+ch', () => {
      const dm = createWideTree();
      const grandchildren = dm.navigateChained('0', ['ch', 'ch']);
      expect(ids(grandchildren)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
    });

    it('should navigate great-grandchildren with ch+ch+ch', () => {
      const dm = createDeepHierarchy();
      // Root -> A -> B -> C
      const result = dm.navigateChained('0', ['ch', 'ch', 'ch']);
      expect(ids(result)).toEqual(['3']); // C
    });

    it('should navigate children descendants with ch+des', () => {
      const dm = createWideTree();
      const result = dm.navigateChained('0', ['ch', 'des']);
      // For each child of root (A, B, C), get descendants
      // A.des = [A1, A2, A3], B.des = [B1, B2], C.des = []
      expect(ids(result)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
    });

    it('should apply per-axis ptType filters', () => {
      const dm = createWithTransitions();
      // ch(node) -> followSib: get first-level nodes, then their following siblings
      const result = dm.navigateChained('0', ['ch', 'followSib'], ['node', undefined]);
      // children filtered to nodes: A, B, C
      // A.followSib = [st1, B, st2, C]
      // B.followSib = [st2, C]
      // C.followSib = []
      expect(ids(result)).toEqual(['st1', 'B', 'st2', 'C', 'st2', 'C']);
    });

    it('should return empty for empty axes', () => {
      const dm = createFlatList();
      expect(dm.navigateChained('0', [])).toEqual([]);
    });

    it('should return empty for non-existent start point', () => {
      const dm = createFlatList();
      expect(dm.navigateChained('ghost', ['ch'])).toEqual([]);
    });

    it('should handle single axis (same as navigate)', () => {
      const dm = createFlatList();
      expect(ids(dm.navigateChained('0', ['ch']))).toEqual(ids(dm.navigate('0', 'ch')));
    });

    it('should handle parent then children (siblings + self)', () => {
      const dm = createFlatList();
      // Go to parent then back to children = all siblings including self
      const result = dm.navigateChained('3', ['par', 'ch']);
      expect(ids(result)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('should handle chained with ptType filters array shorter than axes', () => {
      const dm = createOrgChart();
      // Only first axis gets a filter, second axis gets 'all'
      const result = dm.navigateChained('0', ['ch', 'ch'], ['node']);
      // ch(node) of root = [boss]
      // ch(all) of boss = [asst, vp1, vp2]
      expect(ids(result)).toEqual(['asst', 'vp1', 'vp2']);
    });
  });

  // ==========================================================================
  // Element Type Filtering - Comprehensive
  // ==========================================================================

  describe('element type filtering', () => {
    it('should filter by "all" (no filter)', () => {
      const dm = createComplexTree();
      const all = dm.navigate('0', 'des', 'all');
      expect(all.length).toBe(dm.getAllPoints().length - 1); // all minus root itself
    });

    it('should filter by "doc"', () => {
      const dm = createComplexTree();
      const docs = dm.navigate('0', 'desOrSelf', 'doc');
      expect(docs).toHaveLength(1);
      expect(docs[0].type).toBe('doc');
    });

    it('should filter by "node"', () => {
      const dm = createComplexTree();
      const nodes = dm.navigate('0', 'des', 'node');
      expect(nodes.every((p) => p.type === 'node')).toBe(true);
    });

    it('should filter by "asst"', () => {
      const dm = createComplexTree();
      const assts = dm.navigate('0', 'des', 'asst');
      expect(assts).toHaveLength(1);
      expect(assts[0].modelId).toBe('asstDept2');
    });

    it('should filter by "nonAsst" (any type that is NOT asst)', () => {
      const dm = createOrgChart();
      const nonAsst = dm.navigate('boss', 'ch', 'nonAsst');
      expect(ids(nonAsst)).toEqual(['vp1', 'vp2']);
      // asst type is excluded, only node types remain in this fixture
      expect(nonAsst.every((p) => p.type !== 'asst')).toBe(true);
    });

    it('should filter by "nonAsst" to include parTrans, sibTrans, pres, doc (not just node)', () => {
      const dm = createComplexTree();
      // dept2 children: pt_d2(parTrans), asstDept2(asst), team3(node)
      const nonAsst = dm.navigate('dept2', 'ch', 'nonAsst');
      // Should include parTrans and node, but exclude asst
      expect(ids(nonAsst)).toEqual(['pt_d2', 'team3']);
      expect(nonAsst.every((p) => p.type !== 'asst')).toBe(true);
      // Verify parTrans IS included (this was the bug: old code excluded it)
      expect(nonAsst.some((p) => p.type === 'parTrans')).toBe(true);
    });

    it('should filter by "nonAsst" on descendants to include all non-assistant types', () => {
      const dm = createComplexTree();
      const nonAsstDes = dm.navigate('0', 'des', 'nonAsst');
      // Should include node, parTrans, sibTrans, pres — everything except asst
      expect(nonAsstDes.every((p) => p.type !== 'asst')).toBe(true);
      const types = new Set(nonAsstDes.map((p) => p.type));
      expect(types.has('node')).toBe(true);
      expect(types.has('parTrans')).toBe(true);
      expect(types.has('sibTrans')).toBe(true);
      expect(types.has('pres')).toBe(true);
      expect(types.has('asst')).toBe(false);
    });

    it('should filter by "parTrans"', () => {
      const dm = createComplexTree();
      const parTrans = dm.navigate('0', 'des', 'parTrans');
      expect(parTrans.every((p) => p.type === 'parTrans')).toBe(true);
      expect(parTrans.length).toBeGreaterThan(0);
    });

    it('should filter by "sibTrans"', () => {
      const dm = createComplexTree();
      const sibTrans = dm.navigate('0', 'des', 'sibTrans');
      expect(sibTrans.every((p) => p.type === 'sibTrans')).toBe(true);
      expect(sibTrans.length).toBeGreaterThan(0);
    });

    it('should filter by "pres"', () => {
      const dm = createComplexTree();
      const pres = dm.navigate('0', 'des', 'pres');
      expect(pres).toHaveLength(1);
      expect(pres[0].modelId).toBe('presNode');
    });

    it('should filter by "norm" (same as node)', () => {
      const dm = createComplexTree();
      const norm = dm.navigate('0', 'des', 'norm');
      expect(norm.every((p) => p.type === 'node')).toBe(true);
    });

    it('should filter by "nonNorm" (everything except node)', () => {
      const dm = createComplexTree();
      const nonNorm = dm.navigate('0', 'des', 'nonNorm');
      expect(nonNorm.every((p) => p.type !== 'node')).toBe(true);
      // Should include doc (no, doc is root and we're looking at descendants only),
      // asst, parTrans, sibTrans, pres
      const types = new Set(nonNorm.map((p) => p.type));
      expect(types.has('node')).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle single node tree (just root)', () => {
      const dm = createEmptyTree();
      expect(dm.getRoot().modelId).toBe('0');
      expect(dm.getChildren('0')).toEqual([]);
      expect(dm.getDescendants('0')).toEqual([]);
      expect(dm.getParent('0')).toBeUndefined();
      expect(dm.getDepth('0')).toBe(0);
      expect(dm.getMaxDepth()).toBe(0);
      expect(dm.getPosition('0')).toBe(0);
    });

    it('should handle nodes not reachable from root (orphans)', () => {
      const points = [
        pt('0', 'doc', 'Root'),
        pt('1', 'node', 'Connected'),
        pt('2', 'node', 'Orphan'), // not connected to anything
      ];
      const connections = [parOf('c1', '0', '1', 0)];
      const dm = DataModel.fromPoints(points, connections);

      // Orphan should still be retrievable
      expect(dm.getPoint('2')).toBeDefined();
      // But not reachable via navigation from root
      expect(ids(dm.getChildren('0'))).toEqual(['1']);
      // Orphan has no parent
      expect(dm.getParent('2')).toBeUndefined();
    });

    it('should handle circular connections without infinite loop', () => {
      const points = [pt('0', 'doc', 'Root'), pt('1', 'node', 'A'), pt('2', 'node', 'B')];
      // Create a cycle: 0->1->2->1 (circular)
      const connections = [
        parOf('c1', '0', '1', 0),
        parOf('c2', '1', '2', 0),
        parOf('c3', '2', '1', 0), // circular back to 1
      ];
      const dm = DataModel.fromPoints(points, connections);

      // Should not infinite loop
      const descendants = dm.getDescendants('0');
      expect(descendants.length).toBeGreaterThan(0);

      // Ancestors should not infinite loop
      const ancestors = dm.getAncestors('2');
      expect(ancestors.length).toBeGreaterThan(0);
    });

    it('should handle presOf connections (non-parOf)', () => {
      const points = [pt('0', 'doc', 'Root'), pt('1', 'node', 'A'), pt('p1', 'pres', 'Pres1')];
      const connections: DataModelConnection[] = [
        parOf('c1', '0', '1', 0),
        { modelId: 'c2', type: 'presOf', srcId: '1', destId: 'p1', srcOrd: 0, destOrd: 0 },
      ];
      const dm = DataModel.fromPoints(points, connections);

      // presOf should not affect hierarchy navigation
      expect(ids(dm.getChildren('0'))).toEqual(['1']);
      expect(dm.getParent('p1')).toBeUndefined(); // p1 is not connected via parOf
    });

    it('should handle out-of-order srcOrd values', () => {
      const points = [
        pt('0', 'doc', 'Root'),
        pt('A', 'node', 'A'),
        pt('B', 'node', 'B'),
        pt('C', 'node', 'C'),
      ];
      // Add in reverse srcOrd order
      const connections = [
        parOf('c3', '0', 'C', 20),
        parOf('c1', '0', 'A', 5),
        parOf('c2', '0', 'B', 10),
      ];
      const dm = DataModel.fromPoints(points, connections);

      // Should be sorted by srcOrd regardless of connection order
      expect(ids(dm.getChildren('0'))).toEqual(['A', 'B', 'C']);
    });

    it('should handle negative srcOrd values', () => {
      const points = [pt('0', 'doc', 'Root'), pt('A', 'node', 'A'), pt('B', 'node', 'B')];
      const connections = [parOf('c1', '0', 'A', -1), parOf('c2', '0', 'B', 0)];
      const dm = DataModel.fromPoints(points, connections);
      expect(ids(dm.getChildren('0'))).toEqual(['A', 'B']);
    });

    it('should handle large flat tree (100 children)', () => {
      const points: DataModelPoint[] = [pt('0', 'doc', 'Root')];
      const connections: DataModelConnection[] = [];
      for (let i = 1; i <= 100; i++) {
        points.push(pt(String(i), 'node', `Node ${i}`));
        connections.push(parOf(`c${i}`, '0', String(i), i - 1));
      }
      const dm = DataModel.fromPoints(points, connections);

      expect(dm.getChildren('0')).toHaveLength(100);
      expect(dm.getCount('0', 'ch')).toBe(100);
      expect(dm.getPosition('50')).toBe(50);
      expect(dm.getReversePosition('50')).toBe(51);
      expect(dm.getFollowingSiblings('1')).toHaveLength(99);
      expect(dm.getPrecedingSiblings('100')).toHaveLength(99);
    });

    it('should handle equal srcOrd values (stable order)', () => {
      const points = [
        pt('0', 'doc', 'Root'),
        pt('A', 'node', 'A'),
        pt('B', 'node', 'B'),
        pt('C', 'node', 'C'),
      ];
      // All have same srcOrd
      const connections = [
        parOf('c1', '0', 'A', 0),
        parOf('c2', '0', 'B', 0),
        parOf('c3', '0', 'C', 0),
      ];
      const dm = DataModel.fromPoints(points, connections);
      // Should still return 3 children (order may vary but all present)
      expect(dm.getChildren('0')).toHaveLength(3);
    });

    it('should handle non-existent point in all hierarchy queries', () => {
      const dm = createFlatList();
      expect(dm.getDepth('ghost')).toBe(-1);
      expect(dm.getPosition('ghost')).toBe(0);
      expect(dm.getReversePosition('ghost')).toBe(0);
      expect(dm.getCount('ghost', 'ch')).toBe(0);
    });
  });

  // ==========================================================================
  // Complex Real-World Fixture Tests
  // ==========================================================================

  describe('complex real-world tree', () => {
    let dm: DataModel;

    beforeEach(() => {
      dm = createComplexTree();
    });

    it('should have correct root', () => {
      expect(dm.getRoot().modelId).toBe('0');
    });

    it('should navigate root children', () => {
      expect(ids(dm.getChildren('0'))).toEqual(['dept1', 'st_d1d2_top', 'dept2', 'dept3']);
    });

    it('should navigate dept1 children', () => {
      expect(ids(dm.getChildren('dept1'))).toEqual(['pt_d1', 'team1', 'st_t1t2', 'team2']);
    });

    it('should navigate team1 children', () => {
      expect(ids(dm.getChildren('team1'))).toEqual(['pt_t1', 'dev1', 'st_d1d2', 'dev2']);
    });

    it('should count only node-type children at different levels', () => {
      expect(dm.getCount('0', 'ch', 'node')).toBe(3); // dept1, dept2, dept3
      expect(dm.getCount('dept1', 'ch', 'node')).toBe(2); // team1, team2
      expect(dm.getCount('team1', 'ch', 'node')).toBe(2); // dev1, dev2
    });

    it('should navigate ancestors correctly', () => {
      const ancestors = dm.getAncestors('dev1');
      expect(ids(ancestors)).toEqual(['team1', 'dept1', '0']);
    });

    it('should calculate depths correctly', () => {
      expect(dm.getDepth('0')).toBe(0);
      expect(dm.getDepth('dept1')).toBe(1);
      expect(dm.getDepth('team1')).toBe(2);
      expect(dm.getDepth('dev1')).toBe(3);
      expect(dm.getDepth('st_d1d2_top')).toBe(1);
      expect(dm.getDepth('asstDept2')).toBe(2);
    });

    it('should find all node-type descendants', () => {
      const nodes = dm.navigate('0', 'des', 'node');
      const nodeIds = ids(nodes);
      expect(nodeIds).toContain('dept1');
      expect(nodeIds).toContain('team1');
      expect(nodeIds).toContain('dev1');
      expect(nodeIds).toContain('dev2');
      expect(nodeIds).toContain('team2');
      expect(nodeIds).toContain('dev3');
      expect(nodeIds).toContain('dept2');
      expect(nodeIds).toContain('team3');
      expect(nodeIds).toContain('dev4');
      expect(nodeIds).toContain('dept3');
    });

    it('should find all transition points', () => {
      const parTransitions = dm.navigate('0', 'des', 'parTrans');
      expect(ids(parTransitions)).toContain('pt_d1');
      expect(ids(parTransitions)).toContain('pt_t1');
      expect(ids(parTransitions)).toContain('pt_d2');

      const sibTransitions = dm.navigate('0', 'des', 'sibTrans');
      expect(ids(sibTransitions)).toContain('st_d1d2');
      expect(ids(sibTransitions)).toContain('st_t1t2');
      expect(ids(sibTransitions)).toContain('st_d1d2_top');
    });

    it('should find the assistant', () => {
      const assts = dm.navigate('0', 'des', 'asst');
      expect(assts).toHaveLength(1);
      expect(assts[0].modelId).toBe('asstDept2');
    });

    it('should find the presentation node', () => {
      const pres = dm.navigate('0', 'des', 'pres');
      expect(pres).toHaveLength(1);
      expect(pres[0].modelId).toBe('presNode');
    });

    it('should navigate following siblings of dept1', () => {
      const following = dm.getFollowingSiblings('dept1');
      expect(ids(following)).toEqual(['st_d1d2_top', 'dept2', 'dept3']);
    });

    it('should navigate preceding siblings of dept3', () => {
      const preceding = dm.getPrecedingSiblings('dept3');
      expect(ids(preceding)).toEqual(['dept1', 'st_d1d2_top', 'dept2']);
    });

    it('should navigate chained grandchildren (ch ch)', () => {
      const grandchildren = dm.navigateChained('0', ['ch', 'ch']);
      // dept1 children: pt_d1, team1, st_t1t2, team2
      // st_d1d2_top children: none
      // dept2 children: pt_d2, asstDept2, team3
      // dept3 children: presNode
      expect(ids(grandchildren)).toEqual([
        'pt_d1',
        'team1',
        'st_t1t2',
        'team2',
        'pt_d2',
        'asstDept2',
        'team3',
        'presNode',
      ]);
    });

    it('should navigate chained grandchildren filtered by node type', () => {
      const result = dm.navigateChained('0', ['ch', 'ch'], ['node', 'node']);
      // ch(node) of root = dept1, dept2, dept3
      // ch(node) of dept1 = team1, team2
      // ch(node) of dept2 = team3
      // ch(node) of dept3 = none (presNode is 'pres' type)
      expect(ids(result)).toEqual(['team1', 'team2', 'team3']);
    });

    it('should handle desOrSelf with nonNorm filter', () => {
      const result = dm.navigate('dept2', 'desOrSelf', 'nonNorm');
      // dept2 is 'node', so excluded by nonNorm
      // pt_d2 is 'parTrans' - included
      // asstDept2 is 'asst' - included
      // team3 is 'node' - excluded
      // dev4 is 'node' - excluded
      expect(ids(result)).toEqual(['pt_d2', 'asstDept2']);
    });
  });

  // ==========================================================================
  // Org Chart Specific Tests
  // ==========================================================================

  describe('org chart with assistants', () => {
    let dm: DataModel;

    beforeEach(() => {
      dm = createOrgChart();
    });

    it('should distinguish assistants from regular nodes', () => {
      const bossChildren = dm.getChildren('boss');
      const assts = bossChildren.filter((p) => p.type === 'asst');
      const nodes = bossChildren.filter((p) => p.type === 'node');
      expect(assts).toHaveLength(1);
      expect(nodes).toHaveLength(2);
    });

    it('should navigate assistant ancestors', () => {
      const ancestors = dm.getAncestors('asst');
      expect(ids(ancestors)).toEqual(['boss', '0']);
    });

    it('should get position of assistant (first child)', () => {
      expect(dm.getPosition('asst')).toBe(1);
      expect(dm.getPosition('vp1')).toBe(2);
      expect(dm.getPosition('vp2')).toBe(3);
    });

    it('should get following siblings of assistant', () => {
      expect(ids(dm.getFollowingSiblings('asst'))).toEqual(['vp1', 'vp2']);
    });

    it('should filter ch by nonAsst to exclude assistant', () => {
      const nonAsst = dm.navigate('boss', 'ch', 'nonAsst');
      expect(ids(nonAsst)).toEqual(['vp1', 'vp2']);
    });

    it('should get descendants including assistant', () => {
      const allDesc = dm.getDescendants('boss');
      expect(ids(allDesc)).toContain('asst');
      expect(ids(allDesc)).toContain('vp1');
      expect(ids(allDesc)).toContain('mgr1');
    });

    it('should get max depth (boss -> vp1 -> mgr1 = depth 3)', () => {
      // 0(doc) -> boss(1) -> vp1(2) -> mgr1(3)
      expect(dm.getMaxDepth()).toBe(3);
    });
  });

  // ==========================================================================
  // Transition Nodes Specific Tests
  // ==========================================================================

  describe('sibling transition handling', () => {
    let dm: DataModel;

    beforeEach(() => {
      dm = createWithTransitions();
    });

    it('should include transitions in children', () => {
      const children = dm.getChildren('0');
      expect(children).toHaveLength(5);
      expect(children.map((c) => c.type)).toEqual(['node', 'sibTrans', 'node', 'sibTrans', 'node']);
    });

    it('should get only nodes with element type filter', () => {
      const nodes = dm.navigate('0', 'ch', 'node');
      expect(ids(nodes)).toEqual(['A', 'B', 'C']);
    });

    it('should get only transitions', () => {
      const trans = dm.navigate('0', 'ch', 'sibTrans');
      expect(ids(trans)).toEqual(['st1', 'st2']);
    });

    it('should get following siblings including transitions', () => {
      expect(ids(dm.navigate('A', 'followSib'))).toEqual(['st1', 'B', 'st2', 'C']);
    });

    it('should get preceding siblings including transitions', () => {
      expect(ids(dm.navigate('C', 'precedSib'))).toEqual(['A', 'st1', 'B', 'st2']);
    });

    it('should get position including transitions', () => {
      expect(dm.getPosition('A')).toBe(1);
      expect(dm.getPosition('st1')).toBe(2);
      expect(dm.getPosition('B')).toBe(3);
      expect(dm.getPosition('st2')).toBe(4);
      expect(dm.getPosition('C')).toBe(5);
    });
  });

  // ==========================================================================
  // Document Order Tests
  // ==========================================================================

  describe('document order', () => {
    it('should produce depth-first order for flat list', () => {
      const dm = createFlatList();
      // preced of last gives us the entire order before it
      const allBefore5 = dm.navigate('5', 'preced');
      expect(ids(allBefore5)).toEqual(['0', '1', '2', '3', '4']);
    });

    it('should produce depth-first order for wide tree', () => {
      const dm = createWideTree();
      // All preceding C tells us the full doc order before C
      const beforeC = dm.navigate('C', 'preced');
      expect(ids(beforeC)).toEqual(['0', 'A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2']);
    });

    it('should produce consistent follow/preced', () => {
      const dm = createWideTree();
      // For any point, preced + self + follow = all points
      const point = 'B';
      const preced = dm.navigate(point, 'preced');
      const self = dm.navigate(point, 'self');
      const follow = dm.navigate(point, 'follow');
      const total = [...preced, ...self, ...follow];
      expect(total).toHaveLength(dm.getAllPoints().length);
    });

    it('should handle deep hierarchy doc order', () => {
      const dm = createDeepHierarchy();
      const allAfterRoot = dm.navigate('0', 'follow');
      expect(ids(allAfterRoot)).toEqual(['1', '2', '3', '4']);
    });
  });

  // ==========================================================================
  // Immutability Tests
  // ==========================================================================

  describe('immutability', () => {
    it('should return new arrays from navigate', () => {
      const dm = createFlatList();
      const result1 = dm.navigate('0', 'ch');
      const result2 = dm.navigate('0', 'ch');
      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });

    it('should return new arrays from getAllPoints', () => {
      const dm = createFlatList();
      const result1 = dm.getAllPoints();
      const result2 = dm.getAllPoints();
      expect(result1).not.toBe(result2);
    });

    it('should not allow mutation of returned arrays to affect model', () => {
      const dm = createFlatList();
      const children = dm.getChildren('0');
      children.push(pt('fake', 'node', 'Fake'));
      // Original should be unchanged
      expect(dm.getChildren('0')).toHaveLength(5);
    });
  });

  // ==========================================================================
  // Consistency Tests
  // ==========================================================================

  describe('consistency across axes', () => {
    it('desOrSelf = self + des', () => {
      const dm = createWideTree();
      const desOrSelf = dm.navigate('A', 'desOrSelf');
      const selfResult = dm.navigate('A', 'self');
      const des = dm.navigate('A', 'des');
      expect(ids(desOrSelf)).toEqual([...ids(selfResult), ...ids(des)]);
    });

    it('ancstOrSelf = self + ancst', () => {
      const dm = createDeepHierarchy();
      const ancstOrSelf = dm.navigate('4', 'ancstOrSelf');
      const selfResult = dm.navigate('4', 'self');
      const ancst = dm.navigate('4', 'ancst');
      expect(ids(ancstOrSelf)).toEqual([...ids(selfResult), ...ids(ancst)]);
    });

    it('followSib + self + precedSib = all siblings (including self)', () => {
      const dm = createFlatList();
      for (const childId of ['1', '2', '3', '4', '5']) {
        const prec = dm.navigate(childId, 'precedSib');
        const self = dm.navigate(childId, 'self');
        const follow = dm.navigate(childId, 'followSib');
        const combined = [...prec, ...self, ...follow];
        expect(ids(combined)).toEqual(['1', '2', '3', '4', '5']);
      }
    });

    it('getCount equals navigate length', () => {
      const dm = createWideTree();
      const axes: ST_AxisType[] = [
        'ch',
        'des',
        'followSib',
        'precedSib',
        'ancst',
        'self',
        'root',
        'none',
      ];
      for (const axis of axes) {
        expect(dm.getCount('A', axis)).toBe(dm.navigate('A', axis).length);
      }
    });

    it('getChildren equals navigate ch', () => {
      const dm = createWideTree();
      expect(ids(dm.getChildren('0'))).toEqual(ids(dm.navigate('0', 'ch')));
      expect(ids(dm.getChildren('A'))).toEqual(ids(dm.navigate('A', 'ch')));
    });

    it('getDescendants equals navigate des', () => {
      const dm = createWideTree();
      expect(ids(dm.getDescendants('0'))).toEqual(ids(dm.navigate('0', 'des')));
    });

    it('getAncestors equals navigate ancst', () => {
      const dm = createDeepHierarchy();
      expect(ids(dm.getAncestors('4'))).toEqual(ids(dm.navigate('4', 'ancst')));
    });
  });
});
