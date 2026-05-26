/**
 * Rule Engine Tests
 *
 * Tests for the adaptive rule engine that adjusts constraint values
 * when content doesn't fit within the initial constraints.
 *
 * Tests cover:
 * - Content fits immediately (no rules applied)
 * - Font shrinking rules
 * - Width expansion rules
 * - Spacing reduction rules
 * - Multiple rules tried in order
 * - All rules exhausted (content still doesn't fit)
 * - Named node rule targeting
 * - Rule max clamping
 * - Edge cases
 */

import { createDefaultRule } from '../../../src/ooxml-engine-runtime';
import {
  createResolvedConstraints,
  type ResolvedConstraints,
} from '../../../src/engine/constraints/constraint-evaluator';
import type { ConstraintSolverOutput } from '../../../src/engine/constraints/constraint-solver';
import { applyRules } from '../../../src/engine/rules/rule-engine';

// =============================================================================
// Helpers
// =============================================================================

function makeResolved(entries: [string, number][]): ResolvedConstraints {
  const rc = createResolvedConstraints();
  for (const [key, value] of entries) {
    rc.values.set(key, value);
  }
  return rc;
}

function makeSolverOutput(
  selfEntries: [string, number][],
  nodeEntries: [string, [string, number][]][] = [],
): ConstraintSolverOutput {
  const nodeValues = new Map<string, ResolvedConstraints>();
  for (const [name, entries] of nodeEntries) {
    nodeValues.set(name, makeResolved(entries));
  }
  return {
    selfValues: makeResolved(selfEntries),
    nodeValues,
    fullyResolved: true,
    unresolvedConstraints: [],
  };
}

// =============================================================================
// 1. Content Fits Immediately
// =============================================================================

describe('applyRules - content fits immediately', () => {
  test('should return unchanged when content fits', () => {
    const resolved = makeSolverOutput([
      ['w', 200],
      ['h', 100],
      ['primFontSz', 12],
    ]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', val: 5 })],
      contentFits: () => true, // always fits
    });

    expect(result.appliedRules).toHaveLength(0);
    expect(result.adjusted.selfValues.values.get('primFontSz')).toBe(12);
  });

  test('should not apply any rules when content fits initially', () => {
    const resolved = makeSolverOutput([
      ['w', 400],
      ['h', 300],
    ]);

    const result = applyRules({
      resolved,
      rules: [
        createDefaultRule({ type: 'w', val: 800 }),
        createDefaultRule({ type: 'primFontSz', val: 5 }),
      ],
      contentFits: () => true,
    });

    expect(result.appliedRules).toHaveLength(0);
    expect(result.adjusted.selfValues.values.get('w')).toBe(400);
  });
});

// =============================================================================
// 2. Font Shrinking Rules
// =============================================================================

describe('applyRules - font shrinking', () => {
  test('should shrink font to fit content', () => {
    const resolved = makeSolverOutput([
      ['w', 200],
      ['h', 100],
      ['primFontSz', 24],
    ]);

    // Content fits when font is <= 12
    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', val: 5 })],
      contentFits: (values: ResolvedConstraints) => {
        const fontSize = values.values.get('primFontSz') ?? 24;
        return fontSize <= 12;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0].type).toBe('primFontSz');
    // Font should be shrunk toward 5 from 24, stopping at some point <= 12
    const adjustedFont = result.adjusted.selfValues.values.get('primFontSz');
    expect(adjustedFont).toBeDefined();
    expect(adjustedFont!).toBeLessThanOrEqual(12);
    expect(adjustedFont!).toBeGreaterThanOrEqual(5);
  });

  test('should shrink secondary font', () => {
    const resolved = makeSolverOutput([['secFontSz', 18]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'secFontSz', val: 8 })],
      contentFits: (values: ResolvedConstraints) => {
        const fontSize = values.values.get('secFontSz') ?? 18;
        return fontSize <= 10;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedFont = result.adjusted.selfValues.values.get('secFontSz');
    expect(adjustedFont).toBeDefined();
    expect(adjustedFont!).toBeLessThanOrEqual(10);
  });

  test('should shrink font all the way to target if needed', () => {
    const resolved = makeSolverOutput([['primFontSz', 24]]);

    // Content never fits (force full shrink)
    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', val: 5 })],
      contentFits: () => false,
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedFont = result.adjusted.selfValues.values.get('primFontSz');
    expect(adjustedFont).toBeDefined();
    // Should reach the target value since content never fits
    expect(adjustedFont!).toBeCloseTo(5, 0);
  });
});

// =============================================================================
// 3. Width Expansion Rules
// =============================================================================

describe('applyRules - width expansion', () => {
  test('should expand width to fit content', () => {
    const resolved = makeSolverOutput([
      ['w', 100],
      ['h', 50],
    ]);

    // Content fits when width >= 200
    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'w', val: 500 })],
      contentFits: (values: ResolvedConstraints) => {
        const w = values.values.get('w') ?? 100;
        return w >= 200;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedW = result.adjusted.selfValues.values.get('w');
    expect(adjustedW).toBeDefined();
    expect(adjustedW!).toBeGreaterThanOrEqual(200);
    expect(adjustedW!).toBeLessThanOrEqual(500);
  });

  test('should expand height to fit content', () => {
    const resolved = makeSolverOutput([
      ['w', 200],
      ['h', 50],
    ]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'h', val: 200 })],
      contentFits: (values: ResolvedConstraints) => {
        const h = values.values.get('h') ?? 50;
        return h >= 100;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedH = result.adjusted.selfValues.values.get('h');
    expect(adjustedH).toBeDefined();
    expect(adjustedH!).toBeGreaterThanOrEqual(100);
  });
});

// =============================================================================
// 4. Spacing Reduction Rules
// =============================================================================

describe('applyRules - spacing reduction', () => {
  test('should reduce spacing to fit content', () => {
    const resolved = makeSolverOutput([
      ['sp', 20],
      ['w', 200],
    ]);

    // Content fits when spacing <= 10
    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'sp', val: 2 })],
      contentFits: (values: ResolvedConstraints) => {
        const sp = values.values.get('sp') ?? 20;
        return sp <= 10;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedSp = result.adjusted.selfValues.values.get('sp');
    expect(adjustedSp).toBeDefined();
    expect(adjustedSp!).toBeLessThanOrEqual(10);
  });

  test('should reduce sibling spacing', () => {
    const resolved = makeSolverOutput([['sibSp', 15]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'sibSp', val: 0 })],
      contentFits: (values: ResolvedConstraints) => {
        const sibSp = values.values.get('sibSp') ?? 15;
        return sibSp <= 5;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedSibSp = result.adjusted.selfValues.values.get('sibSp');
    expect(adjustedSibSp).toBeDefined();
    expect(adjustedSibSp!).toBeLessThanOrEqual(5);
  });
});

// =============================================================================
// 5. Multiple Rules Tried in Order
// =============================================================================

describe('applyRules - multiple rules in order', () => {
  test('should try rules sequentially until content fits', () => {
    const resolved = makeSolverOutput([
      ['primFontSz', 24],
      ['sp', 20],
      ['w', 200],
    ]);

    let fontCheckCount = 0;

    const result = applyRules({
      resolved,
      rules: [
        // Rule 1: shrink font (won't help here)
        createDefaultRule({ type: 'primFontSz', val: 5 }),
        // Rule 2: reduce spacing (this one will fix it)
        createDefaultRule({ type: 'sp', val: 2 }),
        // Rule 3: expand width (shouldn't be needed)
        createDefaultRule({ type: 'w', val: 500 }),
      ],
      contentFits: (values: ResolvedConstraints) => {
        fontCheckCount++;
        const sp = values.values.get('sp') ?? 20;
        // Content fits only when spacing is reduced enough
        return sp <= 10;
      },
    });

    // Rules 1 and 2 should be applied
    expect(result.appliedRules.length).toBeGreaterThanOrEqual(1);
    const appliedTypes = result.appliedRules.map((r) => r.type);
    expect(appliedTypes).toContain('sp');
  });

  test('should stop after first rule that makes content fit', () => {
    const resolved = makeSolverOutput([
      ['primFontSz', 24],
      ['w', 200],
    ]);

    const result = applyRules({
      resolved,
      rules: [
        // Rule 1: shrink font (this alone will fix it)
        createDefaultRule({ type: 'primFontSz', val: 10 }),
        // Rule 2: expand width (should not be applied)
        createDefaultRule({ type: 'w', val: 500 }),
      ],
      contentFits: (values: ResolvedConstraints) => {
        const fontSize = values.values.get('primFontSz') ?? 24;
        return fontSize <= 18;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0].type).toBe('primFontSz');
    // Width should NOT have been modified
    expect(result.adjusted.selfValues.values.get('w')).toBe(200);
  });
});

// =============================================================================
// 6. All Rules Exhausted
// =============================================================================

describe('applyRules - all rules exhausted', () => {
  test('should apply all rules when content never fits', () => {
    const resolved = makeSolverOutput([
      ['primFontSz', 24],
      ['sp', 20],
    ]);

    const result = applyRules({
      resolved,
      rules: [
        createDefaultRule({ type: 'primFontSz', val: 5 }),
        createDefaultRule({ type: 'sp', val: 2 }),
      ],
      contentFits: () => false,
    });

    // Both rules should be applied (all tried)
    expect(result.appliedRules).toHaveLength(2);
    expect(result.appliedRules[0].type).toBe('primFontSz');
    expect(result.appliedRules[1].type).toBe('sp');
  });

  test('should return best-effort values even when content does not fit', () => {
    const resolved = makeSolverOutput([['w', 100]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'w', val: 300 })],
      contentFits: () => false,
    });

    expect(result.appliedRules).toHaveLength(1);
    // Width should have been moved toward 300
    const adjustedW = result.adjusted.selfValues.values.get('w');
    expect(adjustedW).toBeDefined();
    expect(adjustedW!).toBeCloseTo(300, 0);
  });
});

// =============================================================================
// 7. Empty Rules
// =============================================================================

describe('applyRules - empty rules', () => {
  test('should handle empty rules list when content fits', () => {
    const resolved = makeSolverOutput([['w', 200]]);

    const result = applyRules({
      resolved,
      rules: [],
      contentFits: () => true,
    });

    expect(result.appliedRules).toHaveLength(0);
    expect(result.adjusted.selfValues.values.get('w')).toBe(200);
  });

  test('should handle empty rules list when content does NOT fit', () => {
    const resolved = makeSolverOutput([['w', 200]]);

    const result = applyRules({
      resolved,
      rules: [],
      contentFits: () => false,
    });

    expect(result.appliedRules).toHaveLength(0);
    // Returns original values since no rules to apply
    expect(result.adjusted.selfValues.values.get('w')).toBe(200);
  });
});

// =============================================================================
// 8. Rule with Factor
// =============================================================================

describe('applyRules - rule factor', () => {
  test('should apply rule with fact multiplier', () => {
    const resolved = makeSolverOutput([['w', 100]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'w', val: 200, fact: 1.5 })],
      contentFits: (values: ResolvedConstraints) => {
        const w = values.values.get('w') ?? 100;
        return w >= 250;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedW = result.adjusted.selfValues.values.get('w');
    expect(adjustedW).toBeDefined();
    // Target = 200 * 1.5 = 300
    expect(adjustedW!).toBeGreaterThanOrEqual(250);
    expect(adjustedW!).toBeLessThanOrEqual(300);
  });
});

// =============================================================================
// 9. Rule Max Clamping
// =============================================================================

describe('applyRules - max clamping', () => {
  test('should clamp rule target to max', () => {
    const resolved = makeSolverOutput([['w', 100]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'w', val: 1000, max: 200 })],
      contentFits: () => false,
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedW = result.adjusted.selfValues.values.get('w');
    expect(adjustedW).toBeDefined();
    // Target is 1000 but max is 200, so should be clamped to 200
    expect(adjustedW!).toBeLessThanOrEqual(200);
  });

  test('should not clamp when max is Infinity (default)', () => {
    const resolved = makeSolverOutput([['w', 100]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'w', val: 500 })],
      contentFits: () => false,
    });

    const adjustedW = result.adjusted.selfValues.values.get('w');
    expect(adjustedW).toBeDefined();
    expect(adjustedW!).toBeCloseTo(500, 0);
  });
});

// =============================================================================
// 10. Rule Targeting Constraint Without Existing Value
// =============================================================================

describe('applyRules - missing initial constraint value', () => {
  test('should set value when no initial constraint exists', () => {
    const resolved = makeSolverOutput([
      ['w', 200],
      // Note: no 'sp' value initially
    ]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'sp', val: 10 })],
      contentFits: (values: ResolvedConstraints) => {
        const sp = values.values.get('sp');
        return sp !== undefined && sp >= 5;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedSp = result.adjusted.selfValues.values.get('sp');
    expect(adjustedSp).toBeDefined();
  });
});

// =============================================================================
// 11. Rule Preserves Unrelated Values
// =============================================================================

describe('applyRules - value preservation', () => {
  test('should not modify unrelated constraint values', () => {
    const resolved = makeSolverOutput([
      ['w', 200],
      ['h', 100],
      ['primFontSz', 24],
      ['sp', 15],
    ]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', val: 8 })],
      contentFits: (values: ResolvedConstraints) => {
        const fontSize = values.values.get('primFontSz') ?? 24;
        return fontSize <= 16;
      },
    });

    // w, h, sp should be unchanged
    expect(result.adjusted.selfValues.values.get('w')).toBe(200);
    expect(result.adjusted.selfValues.values.get('h')).toBe(100);
    expect(result.adjusted.selfValues.values.get('sp')).toBe(15);
  });
});

// =============================================================================
// 12. fullyResolved Preservation
// =============================================================================

describe('applyRules - fullyResolved preservation', () => {
  test('should preserve fullyResolved status from solver output', () => {
    const resolved: ConstraintSolverOutput = {
      selfValues: makeResolved([['w', 200]]),
      nodeValues: new Map(),
      fullyResolved: false,
      unresolvedConstraints: [createDefaultRule({ type: 'userA', val: 0 }) as any],
    };

    const result = applyRules({
      resolved,
      rules: [],
      contentFits: () => true,
    });

    expect(result.adjusted.fullyResolved).toBe(false);
  });

  test('should preserve unresolvedConstraints from solver output', () => {
    const unresolved = createDefaultRule({ type: 'userB', val: 0 }) as any;
    const resolved: ConstraintSolverOutput = {
      selfValues: makeResolved([['w', 200]]),
      nodeValues: new Map(),
      fullyResolved: false,
      unresolvedConstraints: [unresolved],
    };

    const result = applyRules({
      resolved,
      rules: [],
      contentFits: () => true,
    });

    expect(result.adjusted.unresolvedConstraints).toHaveLength(1);
  });
});

// =============================================================================
// 13. Complex Scenarios
// =============================================================================

describe('applyRules - complex scenarios', () => {
  test('should handle font shrink + spacing reduction in sequence', () => {
    const resolved = makeSolverOutput([
      ['primFontSz', 24],
      ['sp', 20],
      ['w', 200],
      ['h', 100],
    ]);

    let callCount = 0;

    const result = applyRules({
      resolved,
      rules: [
        createDefaultRule({ type: 'primFontSz', val: 8 }),
        createDefaultRule({ type: 'sp', val: 2 }),
      ],
      contentFits: (values: ResolvedConstraints) => {
        callCount++;
        const fontSize = values.values.get('primFontSz') ?? 24;
        const sp = values.values.get('sp') ?? 20;
        // Need both font shrunk AND spacing reduced
        return fontSize <= 16 && sp <= 10;
      },
    });

    // Both rules should be applied
    expect(result.appliedRules.length).toBe(2);
  });

  test('should handle rule for constraint that is already at target', () => {
    const resolved = makeSolverOutput([
      ['primFontSz', 5], // already at minimum
    ]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', val: 5 })],
      contentFits: () => false,
    });

    // Rule is applied but value stays at 5
    expect(result.appliedRules).toHaveLength(1);
    expect(result.adjusted.selfValues.values.get('primFontSz')).toBe(5);
  });
});

// =============================================================================
// 14. Named Node Rule — contentFits receives nodeValues
// =============================================================================

describe('applyRules - named node contentFits', () => {
  test('contentFits should receive nodeValues when rule targets a named node', () => {
    const resolved = makeSolverOutput(
      [
        ['w', 200],
        ['h', 100],
      ],
      [['myBox', [['w', 300]]]],
    );

    let receivedNodeValues: Map<string, ResolvedConstraints> | undefined;

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'w', forName: 'myBox', val: 100 })],
      contentFits: (selfValues, nodeValues) => {
        receivedNodeValues = nodeValues;
        // Content fits when myBox.w <= 200
        if (nodeValues) {
          const myBox = nodeValues.get('myBox');
          if (myBox) {
            const w = myBox.values.get('w') ?? 300;
            return w <= 200;
          }
        }
        return false;
      },
    });

    // The callback should have received nodeValues
    expect(receivedNodeValues).toBeDefined();
    expect(result.appliedRules).toHaveLength(1);

    // myBox.w should have been adjusted toward 100, stopping when <= 200
    const adjustedBox = result.adjusted.nodeValues.get('myBox');
    expect(adjustedBox).toBeDefined();
    const adjustedW = adjustedBox!.values.get('w');
    expect(adjustedW).toBeDefined();
    expect(adjustedW!).toBeLessThanOrEqual(200);
  });

  test('named node rule should stop interpolation when nodeValues make content fit', () => {
    const resolved = makeSolverOutput([['primFontSz', 24]], [['textBox', [['primFontSz', 24]]]]);

    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', forName: 'textBox', val: 8 })],
      contentFits: (selfValues, nodeValues) => {
        // Content fits when textBox font size is <= 16
        if (nodeValues) {
          const textBox = nodeValues.get('textBox');
          if (textBox) {
            const fontSize = textBox.values.get('primFontSz') ?? 24;
            return fontSize <= 16;
          }
        }
        return false;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedBox = result.adjusted.nodeValues.get('textBox');
    expect(adjustedBox).toBeDefined();
    const adjustedFont = adjustedBox!.values.get('primFontSz');
    expect(adjustedFont).toBeDefined();
    // Font should be between 8 and 16 (stopped at a step <= 16)
    expect(adjustedFont!).toBeLessThanOrEqual(16);
    expect(adjustedFont!).toBeGreaterThanOrEqual(8);

    // selfValues should NOT be modified (rule targeted named node)
    expect(result.adjusted.selfValues.values.get('primFontSz')).toBe(24);
  });

  test('backward-compatible: contentFits with single arg still works', () => {
    const resolved = makeSolverOutput([
      ['w', 200],
      ['primFontSz', 24],
    ]);

    // Old-style callback that only uses first arg
    const result = applyRules({
      resolved,
      rules: [createDefaultRule({ type: 'primFontSz', val: 8 })],
      contentFits: (selfValues) => {
        const fontSize = selfValues.values.get('primFontSz') ?? 24;
        return fontSize <= 16;
      },
    });

    expect(result.appliedRules).toHaveLength(1);
    const adjustedFont = result.adjusted.selfValues.values.get('primFontSz');
    expect(adjustedFont).toBeDefined();
    expect(adjustedFont!).toBeLessThanOrEqual(16);
  });
});
