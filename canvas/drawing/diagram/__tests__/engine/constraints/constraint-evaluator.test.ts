/**
 * Constraint Evaluator Tests
 *
 * Tests for the atomic constraint evaluation function. Each test verifies
 * a specific aspect of the evaluation formula:
 *   target.type = (reference.refType * fact) + val
 *
 * Tests are organized by evaluation mode:
 * - Absolute value (no reference)
 * - Reference-based value (refType + fact)
 * - Cross-node references (refForName)
 * - Self-references (refFor="self")
 * - User-defined variables
 * - Operator semantics (none, equ, gte, lte)
 * - Edge cases
 */

import { createDefaultConstraint } from '../../../src/ooxml-engine-runtime';
import {
  applyOperator,
  cloneResolvedConstraints,
  computeConstraintKey,
  computeReferenceKey,
  createResolvedConstraints,
  evaluateConstraint,
  type ResolvedConstraints,
} from '../../../src/engine/constraints/constraint-evaluator';

// =============================================================================
// Helper to create test fixtures
// =============================================================================

function makeResolved(entries: [string, number][]): ResolvedConstraints {
  const rc = createResolvedConstraints();
  for (const [key, value] of entries) {
    rc.values.set(key, value);
  }
  return rc;
}

function makeNodeMap(entries: [string, [string, number][]][]): Map<string, ResolvedConstraints> {
  const map = new Map<string, ResolvedConstraints>();
  for (const [name, values] of entries) {
    map.set(name, makeResolved(values));
  }
  return map;
}

// =============================================================================
// 1. Simple Absolute Constraints (val only, no ref)
// =============================================================================

describe('evaluateConstraint - absolute value (no reference)', () => {
  test('should resolve w=100 with no reference', () => {
    const constraint = createDefaultConstraint({ type: 'w', val: 100 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('w');
    expect(result!.value).toBe(100);
    expect(result!.op).toBe('none');
  });

  test('should resolve h=50 with no reference', () => {
    const constraint = createDefaultConstraint({ type: 'h', val: 50 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(50);
  });

  test('should resolve l=0 (zero value)', () => {
    const constraint = createDefaultConstraint({ type: 'l', val: 0 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(0);
  });

  test('should resolve negative value', () => {
    const constraint = createDefaultConstraint({ type: 'lOff', val: -10 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(-10);
  });

  test('should resolve large value', () => {
    const constraint = createDefaultConstraint({ type: 'w', val: 999999 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(999999);
  });

  test('should resolve primFontSz absolute value', () => {
    const constraint = createDefaultConstraint({ type: 'primFontSz', val: 12 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('primFontSz');
    expect(result!.value).toBe(12);
  });

  test('should resolve spacing absolute value', () => {
    const constraint = createDefaultConstraint({ type: 'sp', val: 8 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('sp');
    expect(result!.value).toBe(8);
  });

  test('should resolve margin absolute value', () => {
    const constraint = createDefaultConstraint({ type: 'lMarg', val: 5 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('lMarg');
    expect(result!.value).toBe(5);
  });
});

// =============================================================================
// 2. Reference Constraints (refType + fact)
// =============================================================================

describe('evaluateConstraint - reference-based value', () => {
  test('should resolve w = self.w * 0.5', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'w',
      refFor: 'self',
      fact: 0.5,
      val: 0,
    });
    const resolved = makeResolved([['w', 200]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(100); // 200 * 0.5 + 0
  });

  test('should resolve h = self.h * 0.8 + 10', () => {
    const constraint = createDefaultConstraint({
      type: 'h',
      refType: 'h',
      refFor: 'self',
      fact: 0.8,
      val: 10,
    });
    const resolved = makeResolved([['h', 100]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(90); // 100 * 0.8 + 10
  });

  test('should resolve w = self.h * 1.0 (cross-dimension reference)', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refFor: 'self',
      fact: 1,
      val: 0,
    });
    const resolved = makeResolved([['h', 75]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('w');
    expect(result!.value).toBe(75);
  });

  test('should return null when referenced value not yet resolved', () => {
    const constraint = createDefaultConstraint({
      type: 'h',
      refType: 'w',
      refFor: 'self',
      fact: 0.5,
    });
    const resolved = createResolvedConstraints(); // no 'w' value
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).toBeNull();
  });

  test('should resolve with zero factor', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refFor: 'self',
      fact: 0,
      val: 50,
    });
    const resolved = makeResolved([['h', 200]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(50); // 200 * 0 + 50
  });

  test('should resolve with factor > 1', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refFor: 'self',
      fact: 2,
      val: 0,
    });
    const resolved = makeResolved([['h', 100]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(200); // 100 * 2 + 0
  });

  test('should resolve with negative factor', () => {
    const constraint = createDefaultConstraint({
      type: 'lOff',
      refType: 'w',
      refFor: 'self',
      fact: -0.1,
      val: 0,
    });
    const resolved = makeResolved([['w', 100]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(-10); // 100 * -0.1 + 0
  });

  test('should resolve with negative val offset', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'w',
      refFor: 'self',
      fact: 1,
      val: -20,
    });
    const resolved = makeResolved([['w', 100]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(80); // 100 * 1 + (-20)
  });
});

// =============================================================================
// 3. Cross-Node References (refForName)
// =============================================================================

describe('evaluateConstraint - cross-node references', () => {
  test('should resolve w from named node', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'w',
      refForName: 'nodeA',
      fact: 1,
    });
    const resolved = createResolvedConstraints();
    const nodeNames = makeNodeMap([['nodeA', [['w', 150]]]]);
    const result = evaluateConstraint(constraint, resolved, nodeNames);

    expect(result).not.toBeNull();
    expect(result!.value).toBe(150);
  });

  test('should resolve h = nodeB.h * 0.5 + 5', () => {
    const constraint = createDefaultConstraint({
      type: 'h',
      refType: 'h',
      refForName: 'nodeB',
      fact: 0.5,
      val: 5,
    });
    const resolved = createResolvedConstraints();
    const nodeNames = makeNodeMap([['nodeB', [['h', 200]]]]);
    const result = evaluateConstraint(constraint, resolved, nodeNames);

    expect(result).not.toBeNull();
    expect(result!.value).toBe(105); // 200 * 0.5 + 5
  });

  test('should return null when named node not found', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'w',
      refForName: 'nonExistent',
      fact: 1,
    });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).toBeNull();
  });

  test('should return null when named node exists but value not resolved', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refForName: 'nodeA',
      fact: 1,
    });
    const resolved = createResolvedConstraints();
    const nodeNames = makeNodeMap([['nodeA', [['w', 100]]]]); // has 'w' not 'h'
    const result = evaluateConstraint(constraint, resolved, nodeNames);

    expect(result).toBeNull();
  });

  test('should resolve cross-dimension from named node (nodeA.h -> self.w)', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refForName: 'nodeA',
      fact: 1.5,
      val: 0,
    });
    const resolved = createResolvedConstraints();
    const nodeNames = makeNodeMap([['nodeA', [['h', 60]]]]);
    const result = evaluateConstraint(constraint, resolved, nodeNames);

    expect(result).not.toBeNull();
    expect(result!.value).toBe(90); // 60 * 1.5 + 0
  });
});

// =============================================================================
// 4. Self-References (refFor="self")
// =============================================================================

describe('evaluateConstraint - self-references', () => {
  test('should resolve r = self.l + self.w (requires both l and w)', () => {
    // This tests reading from own resolved values
    const constraint = createDefaultConstraint({
      type: 'r',
      refType: 'w',
      refFor: 'self',
      fact: 1,
      val: 0,
    });
    const resolved = makeResolved([
      ['l', 10],
      ['w', 100],
    ]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('r');
    expect(result!.value).toBe(100); // w * 1 + 0
  });

  test('should resolve ctrX from self.w', () => {
    const constraint = createDefaultConstraint({
      type: 'ctrX',
      refType: 'w',
      refFor: 'self',
      fact: 0.5,
      val: 0,
    });
    const resolved = makeResolved([['w', 200]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(100); // 200 * 0.5
  });
});

// =============================================================================
// 5. User-Defined Variables (userA-userZ)
// =============================================================================

describe('evaluateConstraint - user-defined variables', () => {
  test('should set userA to absolute value', () => {
    const constraint = createDefaultConstraint({ type: 'userA', val: 42 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('userA');
    expect(result!.value).toBe(42);
  });

  test('should reference userA from self', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'userA',
      refFor: 'self',
      fact: 2,
      val: 0,
    });
    const resolved = makeResolved([['userA', 50]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(100); // 50 * 2
  });

  test('should reference userZ from named node', () => {
    const constraint = createDefaultConstraint({
      type: 'h',
      refType: 'userZ',
      refForName: 'computeNode',
      fact: 1,
      val: 0,
    });
    const resolved = createResolvedConstraints();
    const nodeNames = makeNodeMap([['computeNode', [['userZ', 75]]]]);
    const result = evaluateConstraint(constraint, resolved, nodeNames);

    expect(result).not.toBeNull();
    expect(result!.value).toBe(75);
  });

  test('should chain user variables: userB = userA * 0.5', () => {
    const constraint = createDefaultConstraint({
      type: 'userB',
      refType: 'userA',
      refFor: 'self',
      fact: 0.5,
      val: 0,
    });
    const resolved = makeResolved([['userA', 100]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('userB');
    expect(result!.value).toBe(50);
  });

  test('should return null when user variable not yet defined', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'userC',
      refFor: 'self',
      fact: 1,
    });
    const resolved = createResolvedConstraints(); // no userC
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).toBeNull();
  });
});

// =============================================================================
// 6. Operator Semantics (none, equ, gte, lte)
// =============================================================================

describe('evaluateConstraint - operator semantics in result', () => {
  test('should return op="none" for default constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w', val: 100 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.op).toBe('none');
  });

  test('should return op="equ" for equality constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w', val: 100, op: 'equ' });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.op).toBe('equ');
  });

  test('should return op="gte" for minimum constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w', val: 50, op: 'gte' });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.op).toBe('gte');
  });

  test('should return op="lte" for maximum constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w', val: 200, op: 'lte' });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.op).toBe('lte');
  });
});

// =============================================================================
// 7. applyOperator Function Tests
// =============================================================================

describe('applyOperator', () => {
  test('op="none" with no existing value should set new value', () => {
    expect(applyOperator(undefined, 100, 'none')).toBe(100);
  });

  test('op="none" with existing value should keep existing', () => {
    expect(applyOperator(80, 100, 'none')).toBe(80);
  });

  test('op="equ" with no existing value should set new value', () => {
    expect(applyOperator(undefined, 100, 'equ')).toBe(100);
  });

  test('op="equ" with existing value should overwrite', () => {
    expect(applyOperator(80, 100, 'equ')).toBe(100);
  });

  test('op="gte" with no existing value should set new value', () => {
    expect(applyOperator(undefined, 50, 'gte')).toBe(50);
  });

  test('op="gte" with existing > new should keep existing', () => {
    expect(applyOperator(100, 50, 'gte')).toBe(100);
  });

  test('op="gte" with existing < new should use new', () => {
    expect(applyOperator(30, 50, 'gte')).toBe(50);
  });

  test('op="gte" with equal values should return the value', () => {
    expect(applyOperator(50, 50, 'gte')).toBe(50);
  });

  test('op="lte" with no existing value should set new value', () => {
    expect(applyOperator(undefined, 200, 'lte')).toBe(200);
  });

  test('op="lte" with existing < new should keep existing', () => {
    expect(applyOperator(100, 200, 'lte')).toBe(100);
  });

  test('op="lte" with existing > new should use new', () => {
    expect(applyOperator(300, 200, 'lte')).toBe(200);
  });

  test('op="lte" with equal values should return the value', () => {
    expect(applyOperator(200, 200, 'lte')).toBe(200);
  });

  test('op="none" preserves zero existing value', () => {
    expect(applyOperator(0, 100, 'none')).toBe(0);
  });

  test('op="gte" with negative values', () => {
    expect(applyOperator(-10, -5, 'gte')).toBe(-5);
    expect(applyOperator(-5, -10, 'gte')).toBe(-5);
  });

  test('op="lte" with negative values', () => {
    expect(applyOperator(-10, -5, 'lte')).toBe(-10);
    expect(applyOperator(-5, -10, 'lte')).toBe(-10);
  });
});

// =============================================================================
// 8. Key Computation Functions
// =============================================================================

describe('computeConstraintKey', () => {
  test('should return type for self-scoped constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w' });
    expect(computeConstraintKey(constraint)).toBe('w');
  });

  test('should return "forName:type" for named constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w', forName: 'node1' });
    expect(computeConstraintKey(constraint)).toBe('node1:w');
  });

  test('should return just type when forName is empty', () => {
    const constraint = createDefaultConstraint({ type: 'h', forName: '' });
    expect(computeConstraintKey(constraint)).toBe('h');
  });
});

describe('computeReferenceKey', () => {
  test('should return null when refType is none', () => {
    const constraint = createDefaultConstraint({ type: 'w' });
    expect(computeReferenceKey(constraint)).toBeNull();
  });

  test('should return refType for self-referenced constraint', () => {
    const constraint = createDefaultConstraint({ type: 'w', refType: 'h' });
    expect(computeReferenceKey(constraint)).toBe('h');
  });

  test('should return "refForName:refType" for named reference', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refForName: 'nodeA',
    });
    expect(computeReferenceKey(constraint)).toBe('nodeA:h');
  });
});

// =============================================================================
// 9. Utility Function Tests
// =============================================================================

describe('createResolvedConstraints', () => {
  test('should create empty resolved constraints', () => {
    const rc = createResolvedConstraints();
    expect(rc.values.size).toBe(0);
  });
});

describe('cloneResolvedConstraints', () => {
  test('should create a deep copy', () => {
    const original = makeResolved([
      ['w', 100],
      ['h', 50],
    ]);
    const cloned = cloneResolvedConstraints(original);

    expect(cloned.values.get('w')).toBe(100);
    expect(cloned.values.get('h')).toBe(50);

    // Modifying the clone should not affect the original
    cloned.values.set('w', 200);
    expect(original.values.get('w')).toBe(100);
    expect(cloned.values.get('w')).toBe(200);
  });

  test('should clone empty resolved constraints', () => {
    const original = createResolvedConstraints();
    const cloned = cloneResolvedConstraints(original);
    expect(cloned.values.size).toBe(0);
  });
});

// =============================================================================
// 10. ForName Target Constraints
// =============================================================================

describe('evaluateConstraint - forName target', () => {
  test('should produce key with forName prefix', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      forName: 'childNode',
      val: 120,
    });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('childNode:w');
    expect(result!.value).toBe(120);
  });

  test('should reference named node and target different named node', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      forName: 'nodeB',
      refType: 'w',
      refForName: 'nodeA',
      fact: 0.5,
      val: 0,
    });
    const resolved = createResolvedConstraints();
    const nodeNames = makeNodeMap([['nodeA', [['w', 200]]]]);
    const result = evaluateConstraint(constraint, resolved, nodeNames);

    expect(result).not.toBeNull();
    expect(result!.key).toBe('nodeB:w');
    expect(result!.value).toBe(100); // 200 * 0.5
  });
});

// =============================================================================
// 11. Edge Cases
// =============================================================================

describe('evaluateConstraint - edge cases', () => {
  test('should handle refType=none with fact (fact is ignored)', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'none',
      fact: 2,
      val: 50,
    });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    // When refType is 'none', val is used directly (fact is for reference only)
    expect(result!.value).toBe(50);
  });

  test('should handle very small factor', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'w',
      refFor: 'self',
      fact: 0.001,
      val: 0,
    });
    const resolved = makeResolved([['w', 1000]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(1, 5);
  });

  test('should handle reference to zero value', () => {
    const constraint = createDefaultConstraint({
      type: 'w',
      refType: 'h',
      refFor: 'self',
      fact: 2,
      val: 10,
    });
    const resolved = makeResolved([['h', 0]]);
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.value).toBe(10); // 0 * 2 + 10
  });

  test('should handle constraint type "none"', () => {
    const constraint = createDefaultConstraint({ type: 'none', val: 0 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('none');
    expect(result!.value).toBe(0);
  });

  test('should handle geometry constraint types', () => {
    const constraint = createDefaultConstraint({ type: 'connDist', val: 25 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('connDist');
    expect(result!.value).toBe(25);
  });

  test('should handle pyramid constraint type', () => {
    const constraint = createDefaultConstraint({ type: 'pyraAcctRatio', val: 0.33 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('pyraAcctRatio');
    expect(result!.value).toBeCloseTo(0.33);
  });

  test('should handle alignment constraint type', () => {
    const constraint = createDefaultConstraint({ type: 'alignOff', val: 15 });
    const resolved = createResolvedConstraints();
    const result = evaluateConstraint(constraint, resolved, new Map());

    expect(result).not.toBeNull();
    expect(result!.key).toBe('alignOff');
    expect(result!.value).toBe(15);
  });
});
