/**
 * Comprehensive tests for the Axis Navigator.
 *
 * Tests:
 * - parseAxisSpec: single, chained, invalid, empty
 * - parsePtTypeSpec: single, multiple, invalid, empty
 * - navigateAxis: single axis, chained axes, ptType filtering, multi-ptType
 * - applySubsequence: cnt, st, step, combinations
 * - hideLastTrans: sibTrans removal, non-sibTrans last, empty
 * - Integration: full navigation pipeline
 */

import {
  DataModel,
  DataModelConnection,
  DataModelPoint,
  PointType,
} from '../../../src/engine/data-model';

import {
  applySubsequence,
  navigateAxis,
  parseAxisSpec,
  parsePtTypeSpec,
} from '../../../src/engine/iteration/axis-navigator';

// ============================================================================
// Test Helpers
// ============================================================================

function pt(modelId: string, type: PointType, text: string = ''): DataModelPoint {
  return { modelId, type, text };
}

function parOf(
  modelId: string,
  srcId: string,
  destId: string,
  srcOrd: number,
): DataModelConnection {
  return { modelId, type: 'parOf', srcId, destId, srcOrd, destOrd: 0 };
}

function ids(points: DataModelPoint[]): string[] {
  return points.map((p) => p.modelId);
}

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Flat list with transitions:
 * doc -> [A(node), st1(sibTrans), B(node), st2(sibTrans), C(node), st3(sibTrans)]
 */
function createTransitionList(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('A', 'node', 'A'),
      pt('st1', 'sibTrans', 'T1'),
      pt('B', 'node', 'B'),
      pt('st2', 'sibTrans', 'T2'),
      pt('C', 'node', 'C'),
      pt('st3', 'sibTrans', 'T3'),
    ],
    [
      parOf('c1', '0', 'A', 0),
      parOf('c2', '0', 'st1', 1),
      parOf('c3', '0', 'B', 2),
      parOf('c4', '0', 'st2', 3),
      parOf('c5', '0', 'C', 4),
      parOf('c6', '0', 'st3', 5),
    ],
  );
}

/**
 * Org chart with mixed types:
 * doc -> boss(node) -> [asst1(asst), vp1(node), vp2(node)]
 *        vp1 -> [mgr1(node), mgr2(node)]
 *        vp2 -> [mgr3(node)]
 */
function createOrgChart(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('boss', 'node', 'Boss'),
      pt('asst1', 'asst', 'Assistant'),
      pt('vp1', 'node', 'VP1'),
      pt('vp2', 'node', 'VP2'),
      pt('mgr1', 'node', 'Mgr1'),
      pt('mgr2', 'node', 'Mgr2'),
      pt('mgr3', 'node', 'Mgr3'),
    ],
    [
      parOf('c1', '0', 'boss', 0),
      parOf('c2', 'boss', 'asst1', 0),
      parOf('c3', 'boss', 'vp1', 1),
      parOf('c4', 'boss', 'vp2', 2),
      parOf('c5', 'vp1', 'mgr1', 0),
      parOf('c6', 'vp1', 'mgr2', 1),
      parOf('c7', 'vp2', 'mgr3', 0),
    ],
  );
}

/**
 * Wide tree:
 * doc -> [A, B, C, D, E, F, G, H, I, J]  (10 node children)
 */
function createWideFlat(): DataModel {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const points: DataModelPoint[] = [pt('0', 'doc', 'Root')];
  const connections: DataModelConnection[] = [];

  for (let i = 0; i < names.length; i++) {
    points.push(pt(names[i], 'node', names[i]));
    connections.push(parOf(`c${i}`, '0', names[i], i));
  }

  return DataModel.fromPoints(points, connections);
}

/**
 * Deep hierarchy:
 * doc -> A -> B -> C -> D
 */
function createDeepHierarchy(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('A', 'node', 'A'),
      pt('B', 'node', 'B'),
      pt('C', 'node', 'C'),
      pt('D', 'node', 'D'),
    ],
    [
      parOf('c1', '0', 'A', 0),
      parOf('c2', 'A', 'B', 0),
      parOf('c3', 'B', 'C', 0),
      parOf('c4', 'C', 'D', 0),
    ],
  );
}

/**
 * Mixed type children:
 * doc -> [n1(node), pt1(parTrans), n2(node), st1(sibTrans), a1(asst), p1(pres)]
 */
function createMixedTypes(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('n1', 'node', 'Node1'),
      pt('pt1', 'parTrans', 'ParTrans1'),
      pt('n2', 'node', 'Node2'),
      pt('st1', 'sibTrans', 'SibTrans1'),
      pt('a1', 'asst', 'Asst1'),
      pt('p1', 'pres', 'Pres1'),
    ],
    [
      parOf('c1', '0', 'n1', 0),
      parOf('c2', '0', 'pt1', 1),
      parOf('c3', '0', 'n2', 2),
      parOf('c4', '0', 'st1', 3),
      parOf('c5', '0', 'a1', 4),
      parOf('c6', '0', 'p1', 5),
    ],
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Axis Navigator', () => {
  // ==========================================================================
  // parseAxisSpec
  // ==========================================================================

  describe('parseAxisSpec', () => {
    it('should parse a single axis', () => {
      expect(parseAxisSpec('ch')).toEqual(['ch']);
      expect(parseAxisSpec('des')).toEqual(['des']);
      expect(parseAxisSpec('self')).toEqual(['self']);
    });

    it('should parse chained axes', () => {
      expect(parseAxisSpec('ch ch')).toEqual(['ch', 'ch']);
      expect(parseAxisSpec('ch des')).toEqual(['ch', 'des']);
      expect(parseAxisSpec('ch ch ch')).toEqual(['ch', 'ch', 'ch']);
    });

    it('should handle all 13 axis types', () => {
      const all =
        'self ch des desOrSelf par ancst ancstOrSelf followSib precedSib follow preced root none';
      expect(parseAxisSpec(all)).toEqual([
        'self',
        'ch',
        'des',
        'desOrSelf',
        'par',
        'ancst',
        'ancstOrSelf',
        'followSib',
        'precedSib',
        'follow',
        'preced',
        'root',
        'none',
      ]);
    });

    it('should skip invalid axis names', () => {
      expect(parseAxisSpec('ch invalid des')).toEqual(['ch', 'des']);
      expect(parseAxisSpec('bogus')).toEqual([]);
    });

    it('should handle empty string', () => {
      expect(parseAxisSpec('')).toEqual([]);
    });

    it('should handle whitespace-only string', () => {
      expect(parseAxisSpec('   ')).toEqual([]);
    });

    it('should handle extra whitespace', () => {
      expect(parseAxisSpec('  ch   ch  ')).toEqual(['ch', 'ch']);
    });
  });

  // ==========================================================================
  // parsePtTypeSpec
  // ==========================================================================

  describe('parsePtTypeSpec', () => {
    it('should parse a single ptType', () => {
      expect(parsePtTypeSpec('node')).toEqual(['node']);
      expect(parsePtTypeSpec('all')).toEqual(['all']);
      expect(parsePtTypeSpec('asst')).toEqual(['asst']);
    });

    it('should parse multiple ptTypes', () => {
      expect(parsePtTypeSpec('node asst')).toEqual(['node', 'asst']);
      expect(parsePtTypeSpec('parTrans sibTrans')).toEqual(['parTrans', 'sibTrans']);
    });

    it('should handle all 10 element types', () => {
      const all = 'all doc node norm nonNorm asst nonAsst parTrans pres sibTrans';
      expect(parsePtTypeSpec(all)).toEqual([
        'all',
        'doc',
        'node',
        'norm',
        'nonNorm',
        'asst',
        'nonAsst',
        'parTrans',
        'pres',
        'sibTrans',
      ]);
    });

    it('should skip invalid ptType names', () => {
      expect(parsePtTypeSpec('node bogus asst')).toEqual(['node', 'asst']);
    });

    it('should handle empty string', () => {
      expect(parsePtTypeSpec('')).toEqual([]);
    });
  });

  // ==========================================================================
  // applySubsequence
  // ==========================================================================

  describe('applySubsequence', () => {
    const dm = createWideFlat();
    const allChildren = dm.navigate('0', 'ch');

    it('should return all points when default params', () => {
      const result = applySubsequence(allChildren);
      expect(ids(result)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    });

    it('should limit count with cnt', () => {
      const result = applySubsequence(allChildren, 1, 1, 3);
      expect(ids(result)).toEqual(['A', 'B', 'C']);
    });

    it('should start from st (1-based)', () => {
      const result = applySubsequence(allChildren, 3, 1, 0);
      expect(ids(result)).toEqual(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    });

    it('should step over items', () => {
      const result = applySubsequence(allChildren, 1, 2, 0);
      expect(ids(result)).toEqual(['A', 'C', 'E', 'G', 'I']);
    });

    it('should combine st + step', () => {
      const result = applySubsequence(allChildren, 2, 2, 0);
      expect(ids(result)).toEqual(['B', 'D', 'F', 'H', 'J']);
    });

    it('should combine st + step + cnt', () => {
      const result = applySubsequence(allChildren, 2, 2, 3);
      expect(ids(result)).toEqual(['B', 'D', 'F']);
    });

    it('should return empty for empty input', () => {
      expect(applySubsequence([])).toEqual([]);
    });

    it('should handle st beyond array length', () => {
      const result = applySubsequence(allChildren, 100, 1, 0);
      expect(result).toEqual([]);
    });

    it('should handle st=0 (treated as 1)', () => {
      const result = applySubsequence(allChildren, 0, 1, 3);
      expect(ids(result)).toEqual(['A', 'B', 'C']);
    });

    it('should handle step=0 (treated as 1)', () => {
      const result = applySubsequence(allChildren, 1, 0, 3);
      expect(ids(result)).toEqual(['A', 'B', 'C']);
    });

    it('should handle large step', () => {
      const result = applySubsequence(allChildren, 1, 5, 0);
      expect(ids(result)).toEqual(['A', 'F']);
    });

    it('should handle cnt=1 (just first)', () => {
      const result = applySubsequence(allChildren, 1, 1, 1);
      expect(ids(result)).toEqual(['A']);
    });

    it('should handle step=3 with cnt=2', () => {
      const result = applySubsequence(allChildren, 1, 3, 2);
      expect(ids(result)).toEqual(['A', 'D']);
    });
  });

  // ==========================================================================
  // navigateAxis — Single Axis
  // ==========================================================================

  describe('navigateAxis — single axis', () => {
    it('should navigate children (ch)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, '0', 'ch');
      expect(ids(result)).toEqual(['boss']);
    });

    it('should navigate descendants (des)', () => {
      const dm = createDeepHierarchy();
      const result = navigateAxis(dm, '0', 'des');
      expect(ids(result)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should navigate self', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'self');
      expect(ids(result)).toEqual(['boss']);
    });

    it('should navigate parent (par)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'mgr1', 'par');
      expect(ids(result)).toEqual(['vp1']);
    });

    it('should navigate following siblings', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'asst1', 'followSib');
      expect(ids(result)).toEqual(['vp1', 'vp2']);
    });

    it('should navigate preceding siblings', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'vp2', 'precedSib');
      expect(ids(result)).toEqual(['asst1', 'vp1']);
    });

    it('should navigate ancestors', () => {
      const dm = createDeepHierarchy();
      const result = navigateAxis(dm, 'D', 'ancst');
      expect(ids(result)).toEqual(['C', 'B', 'A', '0']);
    });

    it('should navigate root', () => {
      const dm = createDeepHierarchy();
      const result = navigateAxis(dm, 'D', 'root');
      expect(ids(result)).toEqual(['0']);
    });

    it('should navigate none (empty)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'none');
      expect(result).toEqual([]);
    });

    it('should return empty for empty axis spec', () => {
      const dm = createOrgChart();
      expect(navigateAxis(dm, 'boss', '')).toEqual([]);
    });
  });

  // ==========================================================================
  // navigateAxis — Chained Axes
  // ==========================================================================

  describe('navigateAxis — chained axes', () => {
    it('should navigate grandchildren with "ch ch"', () => {
      const dm = createOrgChart();
      // ch of doc = [boss], ch of boss = [asst1, vp1, vp2]
      const result = navigateAxis(dm, '0', 'ch ch');
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });

    it('should navigate great-grandchildren with "ch ch ch"', () => {
      const dm = createOrgChart();
      // ch ch ch of doc = children of [asst1, vp1, vp2]
      // asst1 has no children, vp1 has [mgr1, mgr2], vp2 has [mgr3]
      const result = navigateAxis(dm, '0', 'ch ch ch');
      expect(ids(result)).toEqual(['mgr1', 'mgr2', 'mgr3']);
    });

    it('should chain parent + children (siblings + self)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'vp1', 'par ch');
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });

    it('should chain self + children', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'self ch');
      // self of boss = [boss], ch of boss = [asst1, vp1, vp2]
      // But chained: from [boss], get ch of each → [asst1, vp1, vp2]
      // Wait — chained means: start with [boss], then for each point get ch
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });

    it('should handle empty result in chain', () => {
      const dm = createOrgChart();
      // asst1 has no children, so ch ch from asst1 = []
      const result = navigateAxis(dm, 'asst1', 'ch ch');
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // navigateAxis — ptType Filtering
  // ==========================================================================

  describe('navigateAxis — ptType filtering', () => {
    it('should filter by single ptType "node"', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch', 'node');
      expect(ids(result)).toEqual(['vp1', 'vp2']);
    });

    it('should filter by single ptType "asst"', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch', 'asst');
      expect(ids(result)).toEqual(['asst1']);
    });

    it('should filter by "nonAsst" (excludes asst, includes all other types)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch', 'nonAsst');
      expect(ids(result)).toEqual(['vp1', 'vp2']);
    });

    it('should filter by "nonAsst" to include parTrans and sibTrans', () => {
      const dm = createMixedTypes();
      // Children: n1(node), pt1(parTrans), n2(node), st1(sibTrans), a1(asst), p1(pres)
      const result = navigateAxis(dm, '0', 'ch', 'nonAsst');
      // All types except asst should be included
      expect(ids(result)).toEqual(['n1', 'pt1', 'n2', 'st1', 'p1']);
      expect(result.every((p) => p.type !== 'asst')).toBe(true);
    });

    it('should filter by "all" (no filter)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch', 'all');
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });

    it('should filter by "sibTrans"', () => {
      const dm = createTransitionList();
      // hideLastTrans=true (default) removes st3 BEFORE ptType filtering
      const result = navigateAxis(dm, '0', 'ch', 'sibTrans');
      expect(ids(result)).toEqual(['st1', 'st2']);
    });

    it('should filter by "sibTrans" with hideLastTrans=false', () => {
      const dm = createTransitionList();
      const result = navigateAxis(dm, '0', 'ch', 'sibTrans', { hideLastTrans: false });
      expect(ids(result)).toEqual(['st1', 'st2', 'st3']);
    });

    it('should filter by "parTrans"', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'parTrans');
      expect(ids(result)).toEqual(['pt1']);
    });

    it('should filter by "pres"', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'pres');
      expect(ids(result)).toEqual(['p1']);
    });

    it('should filter by "nonNorm" (everything except node)', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'nonNorm');
      // pt1(parTrans), st1(sibTrans), a1(asst), p1(pres)
      expect(ids(result)).toEqual(['pt1', 'st1', 'a1', 'p1']);
    });

    it('should filter by "norm" (same as node)', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'norm');
      expect(ids(result)).toEqual(['n1', 'n2']);
    });

    it('should default to "all" when empty ptType', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch');
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });
  });

  // ==========================================================================
  // navigateAxis — Multi-ptType Filtering
  // ==========================================================================

  describe('navigateAxis — multi-ptType filtering', () => {
    it('should filter by "node asst" (OR logic)', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch', 'node asst');
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });

    it('should filter by "parTrans sibTrans"', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'parTrans sibTrans');
      expect(ids(result)).toEqual(['pt1', 'st1']);
    });

    it('should filter by "node pres"', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'node pres');
      expect(ids(result)).toEqual(['n1', 'n2', 'p1']);
    });

    it('should handle "all" in multi-type (returns everything)', () => {
      const dm = createMixedTypes();
      const result = navigateAxis(dm, '0', 'ch', 'all node');
      // 'all' means no filter
      expect(result.length).toBe(6);
    });
  });

  // ==========================================================================
  // navigateAxis — cnt, st, step
  // ==========================================================================

  describe('navigateAxis — cnt, st, step', () => {
    it('should limit with cnt', () => {
      const dm = createWideFlat();
      const result = navigateAxis(dm, '0', 'ch', 'all', { cnt: 3 });
      expect(ids(result)).toEqual(['A', 'B', 'C']);
    });

    it('should start from st', () => {
      const dm = createWideFlat();
      const result = navigateAxis(dm, '0', 'ch', 'all', { st: 4 });
      expect(ids(result)).toEqual(['D', 'E', 'F', 'G', 'H', 'I', 'J']);
    });

    it('should step over items', () => {
      const dm = createWideFlat();
      const result = navigateAxis(dm, '0', 'ch', 'all', { step: 2 });
      expect(ids(result)).toEqual(['A', 'C', 'E', 'G', 'I']);
    });

    it('should combine cnt + st + step', () => {
      const dm = createWideFlat();
      const result = navigateAxis(dm, '0', 'ch', 'all', { st: 2, step: 3, cnt: 2 });
      expect(ids(result)).toEqual(['B', 'E']);
    });

    it('should apply subsequence AFTER ptType filtering', () => {
      const dm = createTransitionList();
      // Children: A, st1, B, st2, C, st3
      // Filter node: A, B, C
      // Then cnt=2: A, B
      const result = navigateAxis(dm, '0', 'ch', 'node', { cnt: 2, hideLastTrans: false });
      expect(ids(result)).toEqual(['A', 'B']);
    });
  });

  // ==========================================================================
  // navigateAxis — hideLastTrans
  // ==========================================================================

  describe('navigateAxis — hideLastTrans', () => {
    it('should hide last sibTrans by default', () => {
      const dm = createTransitionList();
      // Children: A, st1, B, st2, C, st3
      // hideLastTrans=true (default): st3 is sibTrans and last, so removed
      const result = navigateAxis(dm, '0', 'ch');
      expect(ids(result)).toEqual(['A', 'st1', 'B', 'st2', 'C']);
    });

    it('should NOT hide last sibTrans when hideLastTrans=false', () => {
      const dm = createTransitionList();
      const result = navigateAxis(dm, '0', 'ch', 'all', { hideLastTrans: false });
      expect(ids(result)).toEqual(['A', 'st1', 'B', 'st2', 'C', 'st3']);
    });

    it('should not remove last non-sibTrans node', () => {
      const dm = createOrgChart();
      // Children of boss: asst1, vp1, vp2 — last is node, not sibTrans
      const result = navigateAxis(dm, 'boss', 'ch');
      expect(ids(result)).toEqual(['asst1', 'vp1', 'vp2']);
    });

    it('should handle empty results', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'asst1', 'ch');
      expect(result).toEqual([]);
    });

    it('should handle single sibTrans child', () => {
      const dm = DataModel.fromPoints(
        [pt('0', 'doc', 'Root'), pt('st1', 'sibTrans', 'T1')],
        [parOf('c1', '0', 'st1', 0)],
      );
      const result = navigateAxis(dm, '0', 'ch');
      // hideLastTrans=true, single sibTrans → removed
      expect(result).toEqual([]);
    });

    it('should apply hideLastTrans BEFORE subsequence', () => {
      const dm = createTransitionList();
      // Default hideLastTrans=true → [A, st1, B, st2, C] (5 items)
      // Then cnt=3 → [A, st1, B]
      const result = navigateAxis(dm, '0', 'ch', 'all', { cnt: 3 });
      expect(ids(result)).toEqual(['A', 'st1', 'B']);
    });
  });

  // ==========================================================================
  // navigateAxis — Combined ptType + chained axes
  // ==========================================================================

  describe('navigateAxis — combined chained + ptType', () => {
    it('should chain then filter', () => {
      const dm = createOrgChart();
      // ch ch from doc → [asst1, vp1, vp2]
      // Then filter by node → [vp1, vp2]
      const result = navigateAxis(dm, '0', 'ch ch', 'node');
      expect(ids(result)).toEqual(['vp1', 'vp2']);
    });

    it('should chain then filter by asst', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, '0', 'ch ch', 'asst');
      expect(ids(result)).toEqual(['asst1']);
    });

    it('should chain three levels then filter', () => {
      const dm = createOrgChart();
      // ch ch ch from doc → children of [asst1, vp1, vp2] → [mgr1, mgr2, mgr3]
      // All are node type
      const result = navigateAxis(dm, '0', 'ch ch ch', 'node');
      expect(ids(result)).toEqual(['mgr1', 'mgr2', 'mgr3']);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle non-existent start point', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'ghost', 'ch');
      expect(result).toEqual([]);
    });

    it('should handle invalid axis in spec', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'invalid');
      expect(result).toEqual([]);
    });

    it('should handle invalid ptType in spec (returns empty — restrictive)', () => {
      const dm = createOrgChart();
      // Invalid ptTypes are skipped, resulting in empty ptType list.
      // Since a spec WAS provided but parsed to empty, this is restrictive: returns [].
      const result = navigateAxis(dm, 'boss', 'ch', 'invalid');
      expect(result).toEqual([]);
    });

    it('should handle ptType that matches nothing', () => {
      const dm = createOrgChart();
      const result = navigateAxis(dm, 'boss', 'ch', 'sibTrans');
      expect(result).toEqual([]);
    });

    it('should work with empty tree (just root)', () => {
      const dm = DataModel.fromPoints([pt('0', 'doc', 'Root')], []);
      expect(navigateAxis(dm, '0', 'ch')).toEqual([]);
      expect(navigateAxis(dm, '0', 'des')).toEqual([]);
      expect(ids(navigateAxis(dm, '0', 'self'))).toEqual(['0']);
    });

    it('should handle large subsequence parameters gracefully', () => {
      const dm = createWideFlat();
      const result = navigateAxis(dm, '0', 'ch', 'all', { st: 100 });
      expect(result).toEqual([]);
    });
  });
});
