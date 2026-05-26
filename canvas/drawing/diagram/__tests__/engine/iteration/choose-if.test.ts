/**
 * Comprehensive tests for Choose/If/Else evaluator and function evaluators.
 *
 * Tests:
 * - All 8 function types (cnt, pos, revPos, posEven, posOdd, var, depth, maxDepth)
 * - All 6 operators (equ, neq, gt, lt, gte, lte)
 * - evaluateCondition: every function x operator combination
 * - evaluateChoose: first match wins, else fallback, no match
 * - Variable lookups for all 10 argument types
 * - Edge cases: empty clauses, nested conditions
 */

import {
  DataModel,
  DataModelConnection,
  DataModelPoint,
  PointType,
} from '../../../src/engine/data-model';

import { evaluateChoose, evaluateCondition } from '../../../src/engine/iteration/choose-if';
import {
  applyOperator,
  evaluateFunction,
  lookupVariable,
} from '../../../src/engine/iteration/functions';

import type {
  Choose,
  IfClause,
  IterationContext,
  LayoutNodeChildRef,
  ST_FunctionArgument,
  ST_FunctionOperator,
  ST_FunctionType,
} from '@mog-sdk/contracts/diagram';
import {
  createDefaultChoose,
  createDefaultIfClause,
  createDefaultVariableList,
} from '../../../src/ooxml-engine-runtime';

import type { FunctionEvalContext } from '../../../src/engine/iteration/functions';

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

/** Create a minimal layout node child ref for testing */
function layoutNodeRef(name: string): LayoutNodeChildRef {
  return { kind: 'layoutNode', name };
}

/** Create a standard iteration context */
function createContext(overrides?: Partial<IterationContext>): IterationContext {
  return {
    currentPoint: overrides?.currentPoint ?? '1',
    position: overrides?.position ?? 1,
    count: overrides?.count ?? 5,
    depth: overrides?.depth ?? 1,
    variables: overrides?.variables ?? createDefaultVariableList(),
  };
}

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Standard test data model:
 * doc -> [A, B, C, D, E]
 * A -> [A1, A2, A3]
 * B -> [B1]
 */
function createTestModel(): DataModel {
  return DataModel.fromPoints(
    [
      pt('0', 'doc', 'Root'),
      pt('1', 'node', 'A'),
      pt('2', 'node', 'B'),
      pt('3', 'node', 'C'),
      pt('4', 'node', 'D'),
      pt('5', 'node', 'E'),
      pt('A1', 'node', 'A1'),
      pt('A2', 'node', 'A2'),
      pt('A3', 'node', 'A3'),
      pt('B1', 'node', 'B1'),
    ],
    [
      parOf('c1', '0', '1', 0),
      parOf('c2', '0', '2', 1),
      parOf('c3', '0', '3', 2),
      parOf('c4', '0', '4', 3),
      parOf('c5', '0', '5', 4),
      parOf('c6', '1', 'A1', 0),
      parOf('c7', '1', 'A2', 1),
      parOf('c8', '1', 'A3', 2),
      parOf('c9', '2', 'B1', 0),
    ],
  );
}

/**
 * Deep hierarchy for depth/maxDepth tests:
 * doc -> A -> B -> C -> D
 */
function createDeepModel(): DataModel {
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

// ============================================================================
// Tests
// ============================================================================

describe('Functions & Operators', () => {
  // ==========================================================================
  // applyOperator — All 6 operators
  // ==========================================================================

  describe('applyOperator', () => {
    describe('equ (equal)', () => {
      it('should return true for equal strings', () => {
        expect(applyOperator('equ', '5', '5')).toBe(true);
      });

      it('should return false for unequal strings', () => {
        expect(applyOperator('equ', '5', '3')).toBe(false);
      });

      it('should handle numeric equality ("1" == "1.0")', () => {
        expect(applyOperator('equ', '1', '1.0')).toBe(true);
      });

      it('should handle non-numeric strings', () => {
        expect(applyOperator('equ', 'norm', 'norm')).toBe(true);
        expect(applyOperator('equ', 'norm', 'rev')).toBe(false);
      });
    });

    describe('neq (not equal)', () => {
      it('should return true for unequal strings', () => {
        expect(applyOperator('neq', '5', '3')).toBe(true);
      });

      it('should return false for equal strings', () => {
        expect(applyOperator('neq', '5', '5')).toBe(false);
      });

      it('should handle non-numeric strings', () => {
        expect(applyOperator('neq', 'norm', 'rev')).toBe(true);
        expect(applyOperator('neq', 'std', 'std')).toBe(false);
      });
    });

    describe('gt (greater than)', () => {
      it('should return true when left > right', () => {
        expect(applyOperator('gt', '5', '3')).toBe(true);
      });

      it('should return false when left <= right', () => {
        expect(applyOperator('gt', '3', '5')).toBe(false);
        expect(applyOperator('gt', '3', '3')).toBe(false);
      });

      it('should treat non-numeric as 0', () => {
        expect(applyOperator('gt', 'abc', '0')).toBe(false);
        expect(applyOperator('gt', '1', 'abc')).toBe(true);
      });
    });

    describe('lt (less than)', () => {
      it('should return true when left < right', () => {
        expect(applyOperator('lt', '3', '5')).toBe(true);
      });

      it('should return false when left >= right', () => {
        expect(applyOperator('lt', '5', '3')).toBe(false);
        expect(applyOperator('lt', '3', '3')).toBe(false);
      });
    });

    describe('gte (greater than or equal)', () => {
      it('should return true when left > right', () => {
        expect(applyOperator('gte', '5', '3')).toBe(true);
      });

      it('should return true when left == right', () => {
        expect(applyOperator('gte', '3', '3')).toBe(true);
      });

      it('should return false when left < right', () => {
        expect(applyOperator('gte', '2', '3')).toBe(false);
      });
    });

    describe('lte (less than or equal)', () => {
      it('should return true when left < right', () => {
        expect(applyOperator('lte', '3', '5')).toBe(true);
      });

      it('should return true when left == right', () => {
        expect(applyOperator('lte', '3', '3')).toBe(true);
      });

      it('should return false when left > right', () => {
        expect(applyOperator('lte', '5', '3')).toBe(false);
      });
    });
  });

  // ==========================================================================
  // evaluateFunction — All 8 function types
  // ==========================================================================

  describe('evaluateFunction', () => {
    const dm = createTestModel();

    /** Build a FunctionEvalContext for testing. Accepts partial context and partial eval overrides. */
    function makeEvalContext(overrides?: {
      context?: Partial<IterationContext>;
      axis?: string;
      ptType?: string;
      arg?: ST_FunctionArgument;
      cnt?: number;
      st?: number;
      step?: number;
      hideLastTrans?: boolean;
    }): FunctionEvalContext {
      return {
        dataModel: dm,
        context: createContext(overrides?.context),
        axis: overrides?.axis ?? 'ch',
        ptType: overrides?.ptType ?? 'all',
        arg: overrides?.arg ?? 'none',
        cnt: overrides?.cnt,
        st: overrides?.st,
        step: overrides?.step,
        hideLastTrans: overrides?.hideLastTrans,
      };
    }

    describe('cnt (count)', () => {
      it('should count children of current point', () => {
        const ctx = makeEvalContext({
          context: { currentPoint: '1' },
          axis: 'ch',
          ptType: 'all',
        });
        // Point '1' (A) has 3 children: A1, A2, A3
        expect(evaluateFunction('cnt', ctx)).toBe('3');
      });

      it('should count with ptType filter', () => {
        const ctx = makeEvalContext({
          context: { currentPoint: '0' },
          axis: 'ch',
          ptType: 'node',
        });
        // Root has 5 node children
        expect(evaluateFunction('cnt', ctx)).toBe('5');
      });

      it('should return 0 for leaf node', () => {
        const ctx = makeEvalContext({
          context: { currentPoint: 'A1' },
          axis: 'ch',
        });
        expect(evaluateFunction('cnt', ctx)).toBe('0');
      });

      it('should count descendants', () => {
        const ctx = makeEvalContext({
          context: { currentPoint: '0' },
          axis: 'des',
          ptType: 'all',
        });
        // Root has 9 descendants
        expect(evaluateFunction('cnt', ctx)).toBe('9');
      });
    });

    describe('pos (position)', () => {
      it('should return the 1-based position', () => {
        const ctx = makeEvalContext({ context: { position: 3 } });
        expect(evaluateFunction('pos', ctx)).toBe('3');
      });

      it('should return 1 for first position', () => {
        const ctx = makeEvalContext({ context: { position: 1 } });
        expect(evaluateFunction('pos', ctx)).toBe('1');
      });
    });

    describe('revPos (reverse position)', () => {
      it('should compute count - position + 1', () => {
        // count=5, position=2 → revPos = 5 - 2 + 1 = 4
        const ctx = makeEvalContext({
          context: { position: 2, count: 5 },
        });
        expect(evaluateFunction('revPos', ctx)).toBe('4');
      });

      it('should return 1 for last item', () => {
        const ctx = makeEvalContext({
          context: { position: 5, count: 5 },
        });
        expect(evaluateFunction('revPos', ctx)).toBe('1');
      });

      it('should return count for first item', () => {
        const ctx = makeEvalContext({
          context: { position: 1, count: 5 },
        });
        expect(evaluateFunction('revPos', ctx)).toBe('5');
      });
    });

    describe('posEven', () => {
      it('should return 1 for even positions', () => {
        const ctx = makeEvalContext({ context: { position: 2 } });
        expect(evaluateFunction('posEven', ctx)).toBe('1');
      });

      it('should return 0 for odd positions', () => {
        const ctx = makeEvalContext({ context: { position: 1 } });
        expect(evaluateFunction('posEven', ctx)).toBe('0');
      });

      it('should return 1 for position 4', () => {
        const ctx = makeEvalContext({ context: { position: 4 } });
        expect(evaluateFunction('posEven', ctx)).toBe('1');
      });

      it('should return 0 for position 3', () => {
        const ctx = makeEvalContext({ context: { position: 3 } });
        expect(evaluateFunction('posEven', ctx)).toBe('0');
      });
    });

    describe('posOdd', () => {
      it('should return 1 for odd positions', () => {
        const ctx = makeEvalContext({ context: { position: 1 } });
        expect(evaluateFunction('posOdd', ctx)).toBe('1');
      });

      it('should return 0 for even positions', () => {
        const ctx = makeEvalContext({ context: { position: 2 } });
        expect(evaluateFunction('posOdd', ctx)).toBe('0');
      });

      it('should return 1 for position 5', () => {
        const ctx = makeEvalContext({ context: { position: 5 } });
        expect(evaluateFunction('posOdd', ctx)).toBe('1');
      });
    });

    describe('depth', () => {
      it('should return the depth from context', () => {
        const ctx = makeEvalContext({ context: { depth: 3 } });
        expect(evaluateFunction('depth', ctx)).toBe('3');
      });

      it('should return 0 for root depth', () => {
        const ctx = makeEvalContext({ context: { depth: 0 } });
        expect(evaluateFunction('depth', ctx)).toBe('0');
      });
    });

    describe('maxDepth', () => {
      it('should return the max depth from data model', () => {
        const deepDm = createDeepModel();
        const ctx: FunctionEvalContext = {
          dataModel: deepDm,
          context: createContext(),
          axis: 'ch',
          ptType: 'all',
          arg: 'none',
        };
        // Deep model: doc(0) -> A(1) -> B(2) -> C(3) -> D(4)
        expect(evaluateFunction('maxDepth', ctx)).toBe('4');
      });

      it('should return 1 for flat model', () => {
        const ctx = makeEvalContext();
        // Test model: doc -> [A, B, C, D, E], max depth = 2 (A -> A1)
        expect(evaluateFunction('maxDepth', ctx)).toBe('2');
      });
    });

    describe('var (variable lookup)', () => {
      it('should look up dir variable', () => {
        const ctx = makeEvalContext({
          arg: 'dir',
          context: {
            variables: createDefaultVariableList({ dir: 'norm' }),
          },
        });
        expect(evaluateFunction('var', ctx)).toBe('norm');
      });

      it('should look up hierBranch variable', () => {
        const ctx = makeEvalContext({
          arg: 'hierBranch',
          context: {
            variables: createDefaultVariableList({ hierBranch: 'hang' }),
          },
        });
        expect(evaluateFunction('var', ctx)).toBe('hang');
      });

      it('should look up orgChart as boolean→number', () => {
        const ctx = makeEvalContext({
          arg: 'orgChart',
          context: {
            variables: createDefaultVariableList({ orgChart: true }),
          },
        });
        expect(evaluateFunction('var', ctx)).toBe('1');
      });

      it('should look up orgChart=false', () => {
        const ctx = makeEvalContext({
          arg: 'orgChart',
          context: {
            variables: createDefaultVariableList({ orgChart: false }),
          },
        });
        expect(evaluateFunction('var', ctx)).toBe('0');
      });
    });
  });

  // ==========================================================================
  // lookupVariable — All 10 argument types
  // ==========================================================================

  describe('lookupVariable', () => {
    const defaultVars = createDefaultVariableList();

    it('should look up orgChart (boolean)', () => {
      expect(lookupVariable(defaultVars, 'orgChart')).toBe('0');
      expect(lookupVariable(createDefaultVariableList({ orgChart: true }), 'orgChart')).toBe('1');
    });

    it('should look up chMax (number)', () => {
      expect(lookupVariable(defaultVars, 'chMax')).toBe('-1');
      expect(lookupVariable(createDefaultVariableList({ chMax: 3 }), 'chMax')).toBe('3');
    });

    it('should look up chPref (number)', () => {
      expect(lookupVariable(defaultVars, 'chPref')).toBe('-1');
      expect(lookupVariable(createDefaultVariableList({ chPref: 5 }), 'chPref')).toBe('5');
    });

    it('should look up bulEnabled (boolean)', () => {
      expect(lookupVariable(defaultVars, 'bulEnabled')).toBe('0');
      expect(lookupVariable(createDefaultVariableList({ bulletEnabled: true }), 'bulEnabled')).toBe(
        '1',
      );
    });

    it('should look up dir (string)', () => {
      expect(lookupVariable(defaultVars, 'dir')).toBe('norm');
      expect(lookupVariable(createDefaultVariableList({ dir: 'rev' }), 'dir')).toBe('rev');
    });

    it('should look up hierBranch (string)', () => {
      expect(lookupVariable(defaultVars, 'hierBranch')).toBe('std');
      expect(lookupVariable(createDefaultVariableList({ hierBranch: 'l' }), 'hierBranch')).toBe(
        'l',
      );
      expect(lookupVariable(createDefaultVariableList({ hierBranch: 'r' }), 'hierBranch')).toBe(
        'r',
      );
      expect(lookupVariable(createDefaultVariableList({ hierBranch: 'hang' }), 'hierBranch')).toBe(
        'hang',
      );
      expect(lookupVariable(createDefaultVariableList({ hierBranch: 'init' }), 'hierBranch')).toBe(
        'init',
      );
    });

    it('should look up animOne (string)', () => {
      expect(lookupVariable(defaultVars, 'animOne')).toBe('none');
      expect(lookupVariable(createDefaultVariableList({ animOne: 'one' }), 'animOne')).toBe('one');
      expect(lookupVariable(createDefaultVariableList({ animOne: 'branch' }), 'animOne')).toBe(
        'branch',
      );
    });

    it('should look up animLvl (string)', () => {
      expect(lookupVariable(defaultVars, 'animLvl')).toBe('none');
      expect(lookupVariable(createDefaultVariableList({ animLvl: 'lvl' }), 'animLvl')).toBe('lvl');
    });

    it('should look up resizeHandles (string)', () => {
      expect(lookupVariable(defaultVars, 'resizeHandles')).toBe('rel');
      expect(
        lookupVariable(createDefaultVariableList({ resizeHandles: 'exact' }), 'resizeHandles'),
      ).toBe('exact');
    });

    it('should look up none (returns 0)', () => {
      expect(lookupVariable(defaultVars, 'none')).toBe('0');
    });
  });

  // ==========================================================================
  // Function × Operator Matrix Tests
  // ==========================================================================

  describe('function × operator combinations', () => {
    const dm = createTestModel();
    const variables = createDefaultVariableList();

    // Helper to create a minimal if clause and evaluate it
    function evalIfCondition(
      func: ST_FunctionType,
      op: ST_FunctionOperator,
      val: string,
      contextOverrides?: Partial<IterationContext>,
      clauseOverrides?: Partial<IfClause>,
    ): boolean {
      const ifClause = createDefaultIfClause({
        func,
        op,
        val,
        axis: clauseOverrides?.axis ?? 'ch',
        ptType: clauseOverrides?.ptType ?? 'all',
        arg: clauseOverrides?.arg ?? 'none',
        ...clauseOverrides,
      });

      const context: IterationContext = {
        currentPoint: '1',
        position: 3,
        count: 5,
        depth: 1,
        variables,
        ...contextOverrides,
      };

      return evaluateCondition(ifClause, dm, context, variables);
    }

    describe('cnt × all operators', () => {
      // Point '1' (A) has 3 children
      it('cnt equ 3 → true', () => {
        expect(evalIfCondition('cnt', 'equ', '3')).toBe(true);
      });
      it('cnt equ 4 → false', () => {
        expect(evalIfCondition('cnt', 'equ', '4')).toBe(false);
      });
      it('cnt neq 4 → true', () => {
        expect(evalIfCondition('cnt', 'neq', '4')).toBe(true);
      });
      it('cnt neq 3 → false', () => {
        expect(evalIfCondition('cnt', 'neq', '3')).toBe(false);
      });
      it('cnt gt 2 → true', () => {
        expect(evalIfCondition('cnt', 'gt', '2')).toBe(true);
      });
      it('cnt gt 3 → false', () => {
        expect(evalIfCondition('cnt', 'gt', '3')).toBe(false);
      });
      it('cnt lt 4 → true', () => {
        expect(evalIfCondition('cnt', 'lt', '4')).toBe(true);
      });
      it('cnt lt 3 → false', () => {
        expect(evalIfCondition('cnt', 'lt', '3')).toBe(false);
      });
      it('cnt gte 3 → true', () => {
        expect(evalIfCondition('cnt', 'gte', '3')).toBe(true);
      });
      it('cnt gte 4 → false', () => {
        expect(evalIfCondition('cnt', 'gte', '4')).toBe(false);
      });
      it('cnt lte 3 → true', () => {
        expect(evalIfCondition('cnt', 'lte', '3')).toBe(true);
      });
      it('cnt lte 2 → false', () => {
        expect(evalIfCondition('cnt', 'lte', '2')).toBe(false);
      });
    });

    describe('pos × all operators', () => {
      // position = 3
      it('pos equ 3 → true', () => {
        expect(evalIfCondition('pos', 'equ', '3')).toBe(true);
      });
      it('pos equ 2 → false', () => {
        expect(evalIfCondition('pos', 'equ', '2')).toBe(false);
      });
      it('pos neq 2 → true', () => {
        expect(evalIfCondition('pos', 'neq', '2')).toBe(true);
      });
      it('pos gt 2 → true', () => {
        expect(evalIfCondition('pos', 'gt', '2')).toBe(true);
      });
      it('pos lt 4 → true', () => {
        expect(evalIfCondition('pos', 'lt', '4')).toBe(true);
      });
      it('pos gte 3 → true', () => {
        expect(evalIfCondition('pos', 'gte', '3')).toBe(true);
      });
      it('pos lte 3 → true', () => {
        expect(evalIfCondition('pos', 'lte', '3')).toBe(true);
      });
    });

    describe('revPos × all operators', () => {
      // count=5, position=3 → revPos = 5-3+1 = 3
      it('revPos equ 3 → true', () => {
        expect(evalIfCondition('revPos', 'equ', '3')).toBe(true);
      });
      it('revPos neq 2 → true', () => {
        expect(evalIfCondition('revPos', 'neq', '2')).toBe(true);
      });
      it('revPos gt 2 → true', () => {
        expect(evalIfCondition('revPos', 'gt', '2')).toBe(true);
      });
      it('revPos lt 4 → true', () => {
        expect(evalIfCondition('revPos', 'lt', '4')).toBe(true);
      });
      it('revPos gte 3 → true', () => {
        expect(evalIfCondition('revPos', 'gte', '3')).toBe(true);
      });
      it('revPos lte 3 → true', () => {
        expect(evalIfCondition('revPos', 'lte', '3')).toBe(true);
      });
    });

    describe('posEven × all operators', () => {
      // position=3 (odd) → posEven = 0
      it('posEven equ 0 → true (odd position)', () => {
        expect(evalIfCondition('posEven', 'equ', '0')).toBe(true);
      });
      it('posEven equ 1 → false (odd position)', () => {
        expect(evalIfCondition('posEven', 'equ', '1')).toBe(false);
      });
      it('posEven neq 1 → true (odd position)', () => {
        expect(evalIfCondition('posEven', 'neq', '1')).toBe(true);
      });
      // position=2 (even) → posEven = 1
      it('posEven equ 1 → true (even position)', () => {
        expect(evalIfCondition('posEven', 'equ', '1', { position: 2 })).toBe(true);
      });
      it('posEven gt 0 → true (even position)', () => {
        expect(evalIfCondition('posEven', 'gt', '0', { position: 2 })).toBe(true);
      });
      it('posEven lt 1 → true (odd position)', () => {
        expect(evalIfCondition('posEven', 'lt', '1')).toBe(true);
      });
    });

    describe('posOdd × all operators', () => {
      // position=3 (odd) → posOdd = 1
      it('posOdd equ 1 → true (odd position)', () => {
        expect(evalIfCondition('posOdd', 'equ', '1')).toBe(true);
      });
      it('posOdd equ 0 → false (odd position)', () => {
        expect(evalIfCondition('posOdd', 'equ', '0')).toBe(false);
      });
      // position=2 (even) → posOdd = 0
      it('posOdd equ 0 → true (even position)', () => {
        expect(evalIfCondition('posOdd', 'equ', '0', { position: 2 })).toBe(true);
      });
      it('posOdd neq 1 → true (even position)', () => {
        expect(evalIfCondition('posOdd', 'neq', '1', { position: 2 })).toBe(true);
      });
      it('posOdd gte 1 → true (odd position)', () => {
        expect(evalIfCondition('posOdd', 'gte', '1')).toBe(true);
      });
      it('posOdd lte 0 → false (odd position)', () => {
        expect(evalIfCondition('posOdd', 'lte', '0')).toBe(false);
      });
    });

    describe('depth × all operators', () => {
      // depth=1
      it('depth equ 1 → true', () => {
        expect(evalIfCondition('depth', 'equ', '1')).toBe(true);
      });
      it('depth neq 0 → true', () => {
        expect(evalIfCondition('depth', 'neq', '0')).toBe(true);
      });
      it('depth gt 0 → true', () => {
        expect(evalIfCondition('depth', 'gt', '0')).toBe(true);
      });
      it('depth lt 2 → true', () => {
        expect(evalIfCondition('depth', 'lt', '2')).toBe(true);
      });
      it('depth gte 1 → true', () => {
        expect(evalIfCondition('depth', 'gte', '1')).toBe(true);
      });
      it('depth lte 1 → true', () => {
        expect(evalIfCondition('depth', 'lte', '1')).toBe(true);
      });
    });

    describe('maxDepth × all operators', () => {
      // maxDepth of test model = 2
      it('maxDepth equ 2 → true', () => {
        expect(evalIfCondition('maxDepth', 'equ', '2')).toBe(true);
      });
      it('maxDepth neq 3 → true', () => {
        expect(evalIfCondition('maxDepth', 'neq', '3')).toBe(true);
      });
      it('maxDepth gt 1 → true', () => {
        expect(evalIfCondition('maxDepth', 'gt', '1')).toBe(true);
      });
      it('maxDepth lt 3 → true', () => {
        expect(evalIfCondition('maxDepth', 'lt', '3')).toBe(true);
      });
      it('maxDepth gte 2 → true', () => {
        expect(evalIfCondition('maxDepth', 'gte', '2')).toBe(true);
      });
      it('maxDepth lte 2 → true', () => {
        expect(evalIfCondition('maxDepth', 'lte', '2')).toBe(true);
      });
    });

    describe('var × all operators', () => {
      it('var(dir) equ "norm" → true (default)', () => {
        expect(evalIfCondition('var', 'equ', 'norm', undefined, { arg: 'dir' })).toBe(true);
      });
      it('var(dir) neq "rev" → true (default)', () => {
        expect(evalIfCondition('var', 'neq', 'rev', undefined, { arg: 'dir' })).toBe(true);
      });
      it('var(chMax) equ "-1" → true (default)', () => {
        expect(evalIfCondition('var', 'equ', '-1', undefined, { arg: 'chMax' })).toBe(true);
      });
      it('var(chMax) gt "-2" → true', () => {
        expect(evalIfCondition('var', 'gt', '-2', undefined, { arg: 'chMax' })).toBe(true);
      });
      it('var(chMax) lt "0" → true', () => {
        expect(evalIfCondition('var', 'lt', '0', undefined, { arg: 'chMax' })).toBe(true);
      });
      it('var(hierBranch) equ "std" → true (default)', () => {
        expect(evalIfCondition('var', 'equ', 'std', undefined, { arg: 'hierBranch' })).toBe(true);
      });
    });
  });

  // ==========================================================================
  // evaluateChoose
  // ==========================================================================

  describe('evaluateChoose', () => {
    const dm = createTestModel();
    const variables = createDefaultVariableList();

    const childA: LayoutNodeChildRef = layoutNodeRef('childA');
    const childB: LayoutNodeChildRef = layoutNodeRef('childB');
    const childElse: LayoutNodeChildRef = layoutNodeRef('childElse');

    it('should return first matching if-clause children', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'pos',
            op: 'equ',
            val: '1',
            children: [childA],
          }),
          createDefaultIfClause({
            func: 'pos',
            op: 'equ',
            val: '2',
            children: [childB],
          }),
        ],
      });

      const context = createContext({ position: 1 });
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toEqual([childA]);
    });

    it('should return second if-clause when first does not match', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'pos',
            op: 'equ',
            val: '1',
            children: [childA],
          }),
          createDefaultIfClause({
            func: 'pos',
            op: 'equ',
            val: '2',
            children: [childB],
          }),
        ],
      });

      const context = createContext({ position: 2 });
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toEqual([childB]);
    });

    it('should return else-clause children when no if matches', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'pos',
            op: 'equ',
            val: '99',
            children: [childA],
          }),
        ],
        elseClauses: { name: '', children: [childElse] },
      });

      const context = createContext({ position: 3 });
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toEqual([childElse]);
    });

    it('should return null when no if matches and no else clause', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'pos',
            op: 'equ',
            val: '99',
            children: [childA],
          }),
        ],
      });

      const context = createContext({ position: 3 });
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toBeNull();
    });

    it('should stop at first matching if (even if later ones also match)', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'pos',
            op: 'gt',
            val: '0', // matches everything
            children: [childA],
          }),
          createDefaultIfClause({
            func: 'pos',
            op: 'gt',
            val: '0', // also matches
            children: [childB],
          }),
        ],
      });

      const context = createContext({ position: 5 });
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toEqual([childA]); // first wins
    });

    it('should handle empty if-clauses array', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [],
        elseClauses: { name: '', children: [childElse] },
      });

      const context = createContext();
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toEqual([childElse]);
    });

    it('should handle choose with no clauses at all → null', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [],
      });

      const context = createContext();
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toBeNull();
    });

    it('should evaluate cnt-based condition correctly', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'cnt',
            op: 'gte',
            val: '3',
            axis: 'ch',
            ptType: 'all',
            children: [childA],
          }),
        ],
        elseClauses: { name: '', children: [childElse] },
      });

      // Point '1' has 3 children → cnt=3, 3 >= 3 → true
      const context = createContext({ currentPoint: '1' });
      const result = evaluateChoose(choose, dm, context, variables);
      expect(result).toEqual([childA]);

      // Point '2' has 1 child → cnt=1, 1 >= 3 → false → else
      const context2 = createContext({ currentPoint: '2' });
      const result2 = evaluateChoose(choose, dm, context2, variables);
      expect(result2).toEqual([childElse]);
    });

    it('should evaluate depth-based condition', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'depth',
            op: 'equ',
            val: '0',
            children: [childA], // root level
          }),
          createDefaultIfClause({
            func: 'depth',
            op: 'equ',
            val: '1',
            children: [childB], // first level
          }),
        ],
        elseClauses: { name: '', children: [childElse] },
      });

      const rootContext = createContext({ depth: 0 });
      expect(evaluateChoose(choose, dm, rootContext, variables)).toEqual([childA]);

      const level1Context = createContext({ depth: 1 });
      expect(evaluateChoose(choose, dm, level1Context, variables)).toEqual([childB]);

      const level2Context = createContext({ depth: 2 });
      expect(evaluateChoose(choose, dm, level2Context, variables)).toEqual([childElse]);
    });

    it('should evaluate var-based condition for org chart detection', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'var',
            arg: 'orgChart',
            op: 'equ',
            val: '1',
            children: [childA], // org chart layout
          }),
        ],
        elseClauses: { name: '', children: [childElse] }, // non-org chart
      });

      const orgChartVars = createDefaultVariableList({ orgChart: true });
      const nonOrgVars = createDefaultVariableList({ orgChart: false });

      const context = createContext();
      expect(evaluateChoose(choose, dm, context, orgChartVars)).toEqual([childA]);
      expect(evaluateChoose(choose, dm, context, nonOrgVars)).toEqual([childElse]);
    });

    it('should evaluate posEven/posOdd for alternating layouts', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'posOdd',
            op: 'equ',
            val: '1',
            children: [childA], // odd position layout
          }),
        ],
        elseClauses: { name: '', children: [childB] }, // even position layout
      });

      const oddContext = createContext({ position: 1 });
      expect(evaluateChoose(choose, dm, oddContext, variables)).toEqual([childA]);

      const evenContext = createContext({ position: 2 });
      expect(evaluateChoose(choose, dm, evenContext, variables)).toEqual([childB]);

      const oddContext3 = createContext({ position: 3 });
      expect(evaluateChoose(choose, dm, oddContext3, variables)).toEqual([childA]);

      const evenContext4 = createContext({ position: 4 });
      expect(evaluateChoose(choose, dm, evenContext4, variables)).toEqual([childB]);
    });

    it('should evaluate revPos for last-item detection', () => {
      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'revPos',
            op: 'equ',
            val: '1',
            children: [childA], // last item
          }),
        ],
        elseClauses: { name: '', children: [childB] }, // not last
      });

      // Last item: position=5, count=5 → revPos=1
      const lastContext = createContext({ position: 5, count: 5 });
      expect(evaluateChoose(choose, dm, lastContext, variables)).toEqual([childA]);

      // Not last: position=3, count=5 → revPos=3
      const notLastContext = createContext({ position: 3, count: 5 });
      expect(evaluateChoose(choose, dm, notLastContext, variables)).toEqual([childB]);
    });

    it('should handle multiple conditions in complex org chart choose', () => {
      // Simulates a real org chart choose:
      // if var(hierBranch) == "l" → left branch layout
      // if var(hierBranch) == "r" → right branch layout
      // if var(hierBranch) == "hang" → hanging layout
      // else → standard layout
      const leftNode = layoutNodeRef('leftLayout');
      const rightNode = layoutNodeRef('rightLayout');
      const hangNode = layoutNodeRef('hangLayout');
      const stdNode = layoutNodeRef('stdLayout');

      const choose: Choose = createDefaultChoose({
        ifClauses: [
          createDefaultIfClause({
            func: 'var',
            arg: 'hierBranch',
            op: 'equ',
            val: 'l',
            children: [leftNode],
          }),
          createDefaultIfClause({
            func: 'var',
            arg: 'hierBranch',
            op: 'equ',
            val: 'r',
            children: [rightNode],
          }),
          createDefaultIfClause({
            func: 'var',
            arg: 'hierBranch',
            op: 'equ',
            val: 'hang',
            children: [hangNode],
          }),
        ],
        elseClauses: { name: '', children: [stdNode] },
      });

      const context = createContext();

      expect(
        evaluateChoose(choose, dm, context, createDefaultVariableList({ hierBranch: 'l' })),
      ).toEqual([leftNode]);
      expect(
        evaluateChoose(choose, dm, context, createDefaultVariableList({ hierBranch: 'r' })),
      ).toEqual([rightNode]);
      expect(
        evaluateChoose(choose, dm, context, createDefaultVariableList({ hierBranch: 'hang' })),
      ).toEqual([hangNode]);
      expect(
        evaluateChoose(choose, dm, context, createDefaultVariableList({ hierBranch: 'std' })),
      ).toEqual([stdNode]);
      expect(
        evaluateChoose(choose, dm, context, createDefaultVariableList({ hierBranch: 'init' })),
      ).toEqual([stdNode]);
    });
  });
});
