/**
 * Constraint Solver Tests
 *
 * Tests for the iterative constraint resolution system. The solver takes
 * a set of constraints + bounds and produces resolved numeric values for
 * all constraint targets.
 *
 * Tests cover:
 * - Simple absolute constraints
 * - Reference chains (A -> B -> C)
 * - Composite pairs (l+w -> r, t+h -> b)
 * - Multiple named nodes
 * - User-defined variables as intermediaries
 * - Circular dependency detection
 * - Operator semantics in solving context
 * - Bounds propagation
 * - Large constraint sets
 * - Center derivations
 */

import type { OoxmlConstraint } from '@mog-sdk/contracts/diagram';
import { createDefaultConstraint } from '../../../src/ooxml-engine-runtime';
import { solveConstraints } from '../../../src/engine/constraints/constraint-solver';

// =============================================================================
// Helper
// =============================================================================

function solve(
  constraints: OoxmlConstraint[],
  nodeNames: string[] = [],
  bounds = { width: 400, height: 300 },
): ReturnType<typeof solveConstraints> {
  return solveConstraints({ constraints, nodeNames, bounds });
}

// =============================================================================
// 1. Simple Absolute Constraints
// =============================================================================

describe('solveConstraints - simple absolute', () => {
  test('should resolve w=100, h=50', () => {
    const result = solve([
      createDefaultConstraint({ type: 'w', val: 100, op: 'equ' }),
      createDefaultConstraint({ type: 'h', val: 50, op: 'equ' }),
    ]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('w')).toBe(100);
    expect(result.selfValues.values.get('h')).toBe(50);
  });

  test('should start with bounds as initial w/h', () => {
    const result = solve([], [], { width: 800, height: 600 });

    expect(result.selfValues.values.get('w')).toBe(800);
    expect(result.selfValues.values.get('h')).toBe(600);
    expect(result.fullyResolved).toBe(true);
  });

  test('should resolve l=10, t=20, w=100, h=50', () => {
    const result = solve([
      createDefaultConstraint({ type: 'l', val: 10, op: 'equ' }),
      createDefaultConstraint({ type: 't', val: 20, op: 'equ' }),
      createDefaultConstraint({ type: 'w', val: 100, op: 'equ' }),
      createDefaultConstraint({ type: 'h', val: 50, op: 'equ' }),
    ]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('l')).toBe(10);
    expect(result.selfValues.values.get('t')).toBe(20);
    expect(result.selfValues.values.get('w')).toBe(100);
    expect(result.selfValues.values.get('h')).toBe(50);
  });

  test('should resolve with no constraints (just bounds)', () => {
    const result = solve([]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('w')).toBe(400);
    expect(result.selfValues.values.get('h')).toBe(300);
    expect(result.unresolvedConstraints).toHaveLength(0);
  });

  test('should resolve multiple spacing/margin/font constraints', () => {
    const result = solve([
      createDefaultConstraint({ type: 'sp', val: 10 }),
      createDefaultConstraint({ type: 'sibSp', val: 5 }),
      createDefaultConstraint({ type: 'lMarg', val: 8 }),
      createDefaultConstraint({ type: 'tMarg', val: 4 }),
      createDefaultConstraint({ type: 'primFontSz', val: 12 }),
    ]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('sp')).toBe(10);
    expect(result.selfValues.values.get('sibSp')).toBe(5);
    expect(result.selfValues.values.get('lMarg')).toBe(8);
    expect(result.selfValues.values.get('tMarg')).toBe(4);
    expect(result.selfValues.values.get('primFontSz')).toBe(12);
  });
});

// =============================================================================
// 2. Reference Chains
// =============================================================================

describe('solveConstraints - reference chains', () => {
  test('should resolve chain: h = 0.5 * w (using bounds w)', () => {
    const result = solve(
      [
        createDefaultConstraint({
          type: 'h',
          refType: 'w',
          refFor: 'self',
          fact: 0.5,
          op: 'equ',
        }),
      ],
      [],
      { width: 200, height: 300 },
    );

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('h')).toBe(100); // 200 * 0.5
  });

  test('should resolve named node chain: nodeA.w = 0.8 * self.w', () => {
    const result = solve(
      [
        createDefaultConstraint({
          type: 'w',
          forName: 'nodeA',
          refType: 'w',
          refFor: 'self',
          fact: 0.8,
          op: 'equ',
        }),
      ],
      ['nodeA'],
      { width: 500, height: 300 },
    );

    expect(result.fullyResolved).toBe(true);
    const nodeA = result.nodeValues.get('nodeA');
    expect(nodeA).toBeDefined();
    expect(nodeA!.values.get('w')).toBe(400); // 500 * 0.8
  });

  test('should resolve multi-step chain: A.w -> B.w -> B.h', () => {
    const constraints: OoxmlConstraint[] = [
      // nodeA.w = self.w * 0.5
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeA',
        refType: 'w',
        refFor: 'self',
        fact: 0.5,
        op: 'equ',
      }),
      // nodeB.w = nodeA.w * 0.8
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeB',
        refType: 'w',
        refForName: 'nodeA',
        fact: 0.8,
        op: 'equ',
      }),
      // nodeB.h = nodeB.w * 0.5
      createDefaultConstraint({
        type: 'h',
        forName: 'nodeB',
        refType: 'w',
        refForName: 'nodeB',
        fact: 0.5,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['nodeA', 'nodeB'], { width: 1000, height: 600 });

    expect(result.fullyResolved).toBe(true);
    const nodeA = result.nodeValues.get('nodeA');
    const nodeB = result.nodeValues.get('nodeB');
    expect(nodeA!.values.get('w')).toBe(500); // 1000 * 0.5
    expect(nodeB!.values.get('w')).toBe(400); // 500 * 0.8
    expect(nodeB!.values.get('h')).toBe(200); // 400 * 0.5
  });

  test('should handle forward references (resolved in later iteration)', () => {
    // B references A, but A is defined after B
    const constraints: OoxmlConstraint[] = [
      // nodeB.w = nodeA.w * 0.5 (forward reference)
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeB',
        refType: 'w',
        refForName: 'nodeA',
        fact: 0.5,
        op: 'equ',
      }),
      // nodeA.w = self.w * 0.8
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeA',
        refType: 'w',
        refFor: 'self',
        fact: 0.8,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['nodeA', 'nodeB'], { width: 100, height: 50 });

    expect(result.fullyResolved).toBe(true);
    expect(result.nodeValues.get('nodeA')!.values.get('w')).toBe(80); // 100 * 0.8
    expect(result.nodeValues.get('nodeB')!.values.get('w')).toBe(40); // 80 * 0.5
  });
});

// =============================================================================
// 3. Composite Pairs
// =============================================================================

describe('solveConstraints - composite pair derivation', () => {
  test('should derive r from l + w', () => {
    const result = solve([
      createDefaultConstraint({ type: 'l', val: 10, op: 'equ' }),
      createDefaultConstraint({ type: 'w', val: 100, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('r')).toBe(110); // 10 + 100
  });

  test('should derive w from l + r', () => {
    const result = solve([
      createDefaultConstraint({ type: 'l', val: 20, op: 'equ' }),
      createDefaultConstraint({ type: 'r', val: 120, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('w')).toBe(100); // 120 - 20
  });

  test('should derive l from w + r', () => {
    const result = solve([
      createDefaultConstraint({ type: 'w', val: 80, op: 'equ' }),
      createDefaultConstraint({ type: 'r', val: 100, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('l')).toBe(20); // 100 - 80
  });

  test('should derive b from t + h', () => {
    const result = solve([
      createDefaultConstraint({ type: 't', val: 5, op: 'equ' }),
      createDefaultConstraint({ type: 'h', val: 50, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('b')).toBe(55); // 5 + 50
  });

  test('should derive h from t + b', () => {
    const result = solve([
      createDefaultConstraint({ type: 't', val: 10, op: 'equ' }),
      createDefaultConstraint({ type: 'b', val: 60, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('h')).toBe(50); // 60 - 10
  });

  test('should derive t from h + b', () => {
    const result = solve([
      createDefaultConstraint({ type: 'h', val: 40, op: 'equ' }),
      createDefaultConstraint({ type: 'b', val: 80, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('t')).toBe(40); // 80 - 40
  });

  test('should derive ctrX from l + w', () => {
    const result = solve([
      createDefaultConstraint({ type: 'l', val: 10, op: 'equ' }),
      createDefaultConstraint({ type: 'w', val: 100, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('ctrX')).toBe(60); // 10 + 100/2
  });

  test('should derive ctrY from t + h', () => {
    const result = solve([
      createDefaultConstraint({ type: 't', val: 20, op: 'equ' }),
      createDefaultConstraint({ type: 'h', val: 60, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('ctrY')).toBe(50); // 20 + 60/2
  });

  test('should derive l from ctrX + w', () => {
    const result = solve([
      createDefaultConstraint({ type: 'ctrX', val: 50, op: 'equ' }),
      createDefaultConstraint({ type: 'w', val: 60, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('l')).toBe(20); // 50 - 60/2
  });

  test('should derive w from ctrX + l', () => {
    const result = solve([
      createDefaultConstraint({ type: 'ctrX', val: 50, op: 'equ' }),
      createDefaultConstraint({ type: 'l', val: 20, op: 'equ' }),
    ]);

    expect(result.selfValues.values.get('w')).toBe(60); // 2 * (50 - 20)
  });
});

// =============================================================================
// 4. Circular Dependencies
// =============================================================================

describe('solveConstraints - circular dependencies', () => {
  test('should detect circular: A.w refs B.w, B.w refs A.w', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeA',
        refType: 'w',
        refForName: 'nodeB',
        fact: 0.5,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeB',
        refType: 'w',
        refForName: 'nodeA',
        fact: 0.5,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['nodeA', 'nodeB']);

    expect(result.fullyResolved).toBe(false);
    expect(result.unresolvedConstraints.length).toBeGreaterThan(0);
  });

  test('should detect circular: A -> B -> C -> A', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'userA',
        refType: 'userC',
        refFor: 'self',
        fact: 1,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'userB',
        refType: 'userA',
        refFor: 'self',
        fact: 1,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'userC',
        refType: 'userB',
        refFor: 'self',
        fact: 1,
        op: 'equ',
      }),
    ];

    const result = solve(constraints);

    expect(result.fullyResolved).toBe(false);
    expect(result.unresolvedConstraints.length).toBe(3);
  });

  test('should resolve partial circular (one chain resolvable, one circular)', () => {
    const constraints: OoxmlConstraint[] = [
      // This one resolves: sp = 10
      createDefaultConstraint({ type: 'sp', val: 10, op: 'equ' }),
      // Circular: userA -> userB -> userA
      createDefaultConstraint({
        type: 'userA',
        refType: 'userB',
        refFor: 'self',
        fact: 1,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'userB',
        refType: 'userA',
        refFor: 'self',
        fact: 1,
        op: 'equ',
      }),
    ];

    const result = solve(constraints);

    expect(result.fullyResolved).toBe(false);
    expect(result.selfValues.values.get('sp')).toBe(10);
    expect(result.unresolvedConstraints.length).toBe(2);
  });
});

// =============================================================================
// 5. User-Defined Variables as Intermediaries
// =============================================================================

describe('solveConstraints - user variables', () => {
  test('should use userA as intermediary: set userA, then use it', () => {
    const constraints: OoxmlConstraint[] = [
      // Set userA = self.w * 0.3
      createDefaultConstraint({
        type: 'userA',
        refType: 'w',
        refFor: 'self',
        fact: 0.3,
      }),
      // Use userA: nodeA.w = userA * 1
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeA',
        refType: 'userA',
        refFor: 'self',
        fact: 1,
      }),
    ];

    const result = solve(constraints, ['nodeA'], { width: 1000, height: 500 });

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('userA')).toBe(300); // 1000 * 0.3
    expect(result.nodeValues.get('nodeA')!.values.get('w')).toBe(300);
  });

  test('should chain user variables: userA -> userB -> final value', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({ type: 'userA', val: 100 }),
      createDefaultConstraint({
        type: 'userB',
        refType: 'userA',
        refFor: 'self',
        fact: 2,
      }),
      createDefaultConstraint({
        type: 'sp',
        refType: 'userB',
        refFor: 'self',
        fact: 0.1,
      }),
    ];

    const result = solve(constraints);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('userA')).toBe(100);
    expect(result.selfValues.values.get('userB')).toBe(200);
    expect(result.selfValues.values.get('sp')).toBe(20);
  });
});

// =============================================================================
// 6. Operator Semantics in Solver
// =============================================================================

describe('solveConstraints - operator semantics', () => {
  test('op="none" should not overwrite an existing value', () => {
    const constraints: OoxmlConstraint[] = [
      // Set w = 100 (equality, strong)
      createDefaultConstraint({ type: 'w', val: 100, op: 'equ' }),
      // Try to set w = 200 (none, weak) — should NOT overwrite
      createDefaultConstraint({ type: 'w', val: 200, op: 'none' }),
    ];

    const result = solve(constraints);
    // The equ constraint sets it to 100, the none constraint is weak so it
    // doesn't overwrite. However, order matters — equ is processed first.
    expect(result.selfValues.values.get('w')).toBe(100);
  });

  test('op="gte" should enforce minimum', () => {
    const constraints: OoxmlConstraint[] = [
      // Set w = 50
      createDefaultConstraint({ type: 'w', val: 50, op: 'equ' }),
      // Enforce w >= 100
      createDefaultConstraint({ type: 'w', val: 100, op: 'gte' }),
    ];

    const result = solve(constraints);
    expect(result.selfValues.values.get('w')).toBe(100); // max(50, 100)
  });

  test('op="lte" should enforce maximum', () => {
    const constraints: OoxmlConstraint[] = [
      // Set w = 200
      createDefaultConstraint({ type: 'w', val: 200, op: 'equ' }),
      // Enforce w <= 150
      createDefaultConstraint({ type: 'w', val: 150, op: 'lte' }),
    ];

    const result = solve(constraints);
    expect(result.selfValues.values.get('w')).toBe(150); // min(200, 150)
  });

  test('op="gte" and "lte" together create a clamped range', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({ type: 'w', val: 300, op: 'equ' }),
      createDefaultConstraint({ type: 'w', val: 50, op: 'gte' }),
      createDefaultConstraint({ type: 'w', val: 200, op: 'lte' }),
    ];

    const result = solve(constraints);
    // 300 clamped to [50, 200] -> 200
    expect(result.selfValues.values.get('w')).toBe(200);
  });

  test('op="gte" keeps value when already above minimum', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({ type: 'h', val: 100, op: 'equ' }),
      createDefaultConstraint({ type: 'h', val: 50, op: 'gte' }),
    ];

    const result = solve(constraints);
    expect(result.selfValues.values.get('h')).toBe(100);
  });
});

// =============================================================================
// 7. All Nodes Resolved
// =============================================================================

describe('solveConstraints - all nodes', () => {
  test('should resolve constraints for multiple named nodes', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        forName: 'n1',
        val: 100,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'h',
        forName: 'n1',
        val: 80,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'w',
        forName: 'n2',
        val: 200,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'h',
        forName: 'n2',
        val: 60,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'w',
        forName: 'n3',
        val: 150,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['n1', 'n2', 'n3']);

    expect(result.fullyResolved).toBe(true);
    expect(result.nodeValues.get('n1')!.values.get('w')).toBe(100);
    expect(result.nodeValues.get('n1')!.values.get('h')).toBe(80);
    expect(result.nodeValues.get('n2')!.values.get('w')).toBe(200);
    expect(result.nodeValues.get('n2')!.values.get('h')).toBe(60);
    expect(result.nodeValues.get('n3')!.values.get('w')).toBe(150);
  });

  test('should create empty resolved maps for unreferenced nodes', () => {
    const result = solve([], ['unused1', 'unused2']);

    expect(result.nodeValues.has('unused1')).toBe(true);
    expect(result.nodeValues.has('unused2')).toBe(true);
    expect(result.nodeValues.get('unused1')!.values.size).toBe(0);
  });
});

// =============================================================================
// 8. Bounds Propagation
// =============================================================================

describe('solveConstraints - bounds propagation', () => {
  test('should use bounds.width as initial self.w', () => {
    const result = solve([], [], { width: 1024, height: 768 });
    expect(result.selfValues.values.get('w')).toBe(1024);
  });

  test('should use bounds.height as initial self.h', () => {
    const result = solve([], [], { width: 1024, height: 768 });
    expect(result.selfValues.values.get('h')).toBe(768);
  });

  test('constraints can reference bounds-initialized values', () => {
    const result = solve(
      [
        createDefaultConstraint({
          type: 'w',
          forName: 'child',
          refType: 'w',
          refFor: 'self',
          fact: 0.9,
          op: 'equ',
        }),
      ],
      ['child'],
      { width: 500, height: 300 },
    );

    expect(result.nodeValues.get('child')!.values.get('w')).toBe(450); // 500 * 0.9
  });

  test('should allow bounds override via equ constraint', () => {
    const result = solve([createDefaultConstraint({ type: 'w', val: 100, op: 'equ' })], [], {
      width: 500,
      height: 300,
    });

    expect(result.selfValues.values.get('w')).toBe(100);
  });
});

// =============================================================================
// 9. Large Constraint Set
// =============================================================================

describe('solveConstraints - large constraint sets', () => {
  test('should handle 50+ constraints', () => {
    const constraints: OoxmlConstraint[] = [];
    const nodeNames: string[] = [];

    // Create 20 nodes with w and h constraints
    for (let i = 0; i < 20; i++) {
      const name = `node${i}`;
      nodeNames.push(name);
      constraints.push(
        createDefaultConstraint({
          type: 'w',
          forName: name,
          refType: 'w',
          refFor: 'self',
          fact: 0.04, // Each gets 4% of parent width
          op: 'equ',
        }),
      );
      constraints.push(
        createDefaultConstraint({
          type: 'h',
          forName: name,
          refType: 'h',
          refFor: 'self',
          fact: 0.8,
          op: 'equ',
        }),
      );
    }

    // Add 10+ spacing/margin/font constraints
    constraints.push(createDefaultConstraint({ type: 'sp', val: 5 }));
    constraints.push(createDefaultConstraint({ type: 'sibSp', val: 3 }));
    constraints.push(createDefaultConstraint({ type: 'lMarg', val: 10 }));
    constraints.push(createDefaultConstraint({ type: 'tMarg', val: 10 }));
    constraints.push(createDefaultConstraint({ type: 'rMarg', val: 10 }));
    constraints.push(createDefaultConstraint({ type: 'bMarg', val: 10 }));
    constraints.push(createDefaultConstraint({ type: 'primFontSz', val: 12 }));
    constraints.push(createDefaultConstraint({ type: 'secFontSz', val: 10 }));
    constraints.push(createDefaultConstraint({ type: 'userA', val: 42 }));
    constraints.push(createDefaultConstraint({ type: 'userB', val: 84 }));

    expect(constraints.length).toBeGreaterThanOrEqual(50);

    const result = solve(constraints, nodeNames, { width: 1000, height: 500 });

    expect(result.fullyResolved).toBe(true);

    // Verify some values
    expect(result.nodeValues.get('node0')!.values.get('w')).toBe(40); // 1000 * 0.04
    expect(result.nodeValues.get('node0')!.values.get('h')).toBe(400); // 500 * 0.8
    expect(result.nodeValues.get('node19')!.values.get('w')).toBe(40);
    expect(result.selfValues.values.get('sp')).toBe(5);
    expect(result.selfValues.values.get('userA')).toBe(42);
  });

  test('should handle performance with 100 constraints', () => {
    const constraints: OoxmlConstraint[] = [];
    const nodeNames: string[] = [];

    for (let i = 0; i < 50; i++) {
      const name = `n${i}`;
      nodeNames.push(name);
      constraints.push(
        createDefaultConstraint({
          type: 'w',
          forName: name,
          val: 10 + i,
          op: 'equ',
        }),
      );
      constraints.push(
        createDefaultConstraint({
          type: 'h',
          forName: name,
          val: 5 + i,
          op: 'equ',
        }),
      );
    }

    const start = Date.now();
    const result = solve(constraints, nodeNames);
    const elapsed = Date.now() - start;

    expect(result.fullyResolved).toBe(true);
    // Should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});

// =============================================================================
// 10. Composite Pair Derivation on Named Nodes
// =============================================================================

describe('solveConstraints - composite pairs on named nodes', () => {
  test('should derive r for named node from l + w', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'l',
        forName: 'child',
        val: 10,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'w',
        forName: 'child',
        val: 80,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['child']);

    const child = result.nodeValues.get('child')!;
    expect(child.values.get('l')).toBe(10);
    expect(child.values.get('w')).toBe(80);
    expect(child.values.get('r')).toBe(90); // 10 + 80
  });

  test('should derive ctrX for named node from l + w', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'l',
        forName: 'box',
        val: 0,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'w',
        forName: 'box',
        val: 100,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['box']);

    const box = result.nodeValues.get('box')!;
    expect(box.values.get('ctrX')).toBe(50); // 0 + 100/2
  });
});

// =============================================================================
// 11. Mixed Constraints
// =============================================================================

describe('solveConstraints - mixed constraint types', () => {
  test('should handle geometry constraints', () => {
    const result = solve([
      createDefaultConstraint({ type: 'connDist', val: 25 }),
      createDefaultConstraint({ type: 'diam', val: 100 }),
      createDefaultConstraint({ type: 'stemThick', val: 5 }),
      createDefaultConstraint({ type: 'begPad', val: 10 }),
      createDefaultConstraint({ type: 'endPad', val: 10 }),
    ]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('connDist')).toBe(25);
    expect(result.selfValues.values.get('diam')).toBe(100);
    expect(result.selfValues.values.get('stemThick')).toBe(5);
  });

  test('should handle pyraAcctRatio constraint', () => {
    const result = solve([createDefaultConstraint({ type: 'pyraAcctRatio', val: 0.33 })]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('pyraAcctRatio')).toBeCloseTo(0.33);
  });

  test('should handle alignOff constraint', () => {
    const result = solve([createDefaultConstraint({ type: 'alignOff', val: 15 })]);

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('alignOff')).toBe(15);
  });
});

// =============================================================================
// 12. Edge Cases
// =============================================================================

describe('solveConstraints - edge cases', () => {
  test('should handle zero bounds', () => {
    const result = solve([], [], { width: 0, height: 0 });
    expect(result.selfValues.values.get('w')).toBe(0);
    expect(result.selfValues.values.get('h')).toBe(0);
    expect(result.fullyResolved).toBe(true);
  });

  test('should handle constraint referencing non-existent named node', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        refType: 'w',
        refForName: 'ghost',
        fact: 1,
        op: 'equ',
      }),
    ];

    const result = solve(constraints);

    expect(result.fullyResolved).toBe(false);
    expect(result.unresolvedConstraints.length).toBe(1);
  });

  test('should not derive triple when all three values are already set', () => {
    const result = solve([
      createDefaultConstraint({ type: 'l', val: 10, op: 'equ' }),
      createDefaultConstraint({ type: 'w', val: 100, op: 'equ' }),
      createDefaultConstraint({ type: 'r', val: 110, op: 'equ' }),
    ]);

    // All three are explicitly set — derivation should not overwrite
    expect(result.selfValues.values.get('l')).toBe(10);
    expect(result.selfValues.values.get('w')).toBe(100);
    expect(result.selfValues.values.get('r')).toBe(110);
  });

  test('should handle constraint targeting self with forName that is also a node name', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        forName: 'myNode',
        val: 75,
        op: 'equ',
      }),
    ];

    const result = solve(constraints, ['myNode']);
    expect(result.nodeValues.get('myNode')!.values.get('w')).toBe(75);
  });
});

// =============================================================================
// 13. for="ch" / for="des" scope broadcasting
// =============================================================================

describe('solveConstraints - for scope attribute', () => {
  test('for="ch" should broadcast constraint to all named child nodes', () => {
    const constraints: OoxmlConstraint[] = [
      // for="ch" without forName: broadcast w=80 to all child nodes
      createDefaultConstraint({
        type: 'w',
        for: 'ch',
        val: 80,
        op: 'equ',
      }),
    ];

    const result = solveConstraints({
      constraints,
      nodeNames: ['child1', 'child2', 'child3'],
      bounds: { width: 400, height: 300 },
    });

    expect(result.fullyResolved).toBe(true);
    // All named nodes should have w=80
    expect(result.nodeValues.get('child1')!.values.get('w')).toBe(80);
    expect(result.nodeValues.get('child2')!.values.get('w')).toBe(80);
    expect(result.nodeValues.get('child3')!.values.get('w')).toBe(80);
    // Self should NOT be overwritten
    expect(result.selfValues.values.get('w')).toBe(400);
  });

  test('for="des" should broadcast constraint to all named descendant nodes', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'h',
        for: 'des',
        val: 50,
        op: 'equ',
      }),
    ];

    const result = solveConstraints({
      constraints,
      nodeNames: ['n1', 'n2'],
      bounds: { width: 400, height: 300 },
    });

    expect(result.fullyResolved).toBe(true);
    expect(result.nodeValues.get('n1')!.values.get('h')).toBe(50);
    expect(result.nodeValues.get('n2')!.values.get('h')).toBe(50);
    // Self should NOT be overwritten
    expect(result.selfValues.values.get('h')).toBe(300);
  });

  test('for="self" should apply only to self', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        for: 'self',
        val: 200,
        op: 'equ',
      }),
    ];

    const result = solveConstraints({
      constraints,
      nodeNames: ['child1'],
      bounds: { width: 400, height: 300 },
    });

    expect(result.fullyResolved).toBe(true);
    expect(result.selfValues.values.get('w')).toBe(200);
    // Named node should NOT be affected
    expect(result.nodeValues.get('child1')!.values.has('w')).toBe(false);
  });

  test('forName should take precedence over for scope', () => {
    const constraints: OoxmlConstraint[] = [
      // forName is set, so for="ch" should be ignored
      createDefaultConstraint({
        type: 'w',
        for: 'ch',
        forName: 'child1',
        val: 100,
        op: 'equ',
      }),
    ];

    const result = solveConstraints({
      constraints,
      nodeNames: ['child1', 'child2'],
      bounds: { width: 400, height: 300 },
    });

    expect(result.fullyResolved).toBe(true);
    expect(result.nodeValues.get('child1')!.values.get('w')).toBe(100);
    // child2 should NOT be affected since forName targets only child1
    expect(result.nodeValues.get('child2')!.values.has('w')).toBe(false);
  });

  test('for="ch" with reference should work', () => {
    const constraints: OoxmlConstraint[] = [
      // All children should get w = self.w * 0.8
      createDefaultConstraint({
        type: 'w',
        for: 'ch',
        refType: 'w',
        refFor: 'self',
        fact: 0.8,
        op: 'equ',
      }),
    ];

    const result = solveConstraints({
      constraints,
      nodeNames: ['a', 'b'],
      bounds: { width: 500, height: 300 },
    });

    expect(result.fullyResolved).toBe(true);
    expect(result.nodeValues.get('a')!.values.get('w')).toBe(400); // 500 * 0.8
    expect(result.nodeValues.get('b')!.values.get('w')).toBe(400); // 500 * 0.8
  });
});

// =============================================================================
// 14. ptType and refPtType filtering
// =============================================================================

describe('solveConstraints - ptType filtering', () => {
  test('ptType="node" should only apply constraint to node-type targets', () => {
    const constraints: OoxmlConstraint[] = [
      // Only apply w=80 to targets associated with 'node' data points
      createDefaultConstraint({
        type: 'w',
        for: 'ch',
        ptType: 'node',
        val: 80,
        op: 'equ',
      }),
    ];

    const nodePointTypes = new Map([
      ['nodeChild', 'node' as const],
      ['asstChild', 'asst' as const],
    ]);

    const result = solveConstraints({
      constraints,
      nodeNames: ['nodeChild', 'asstChild'],
      bounds: { width: 400, height: 300 },
      nodePointTypes,
    });

    expect(result.fullyResolved).toBe(true);
    // nodeChild has node type, should get w=80
    expect(result.nodeValues.get('nodeChild')!.values.get('w')).toBe(80);
    // asstChild has asst type, should NOT get w=80
    expect(result.nodeValues.get('asstChild')!.values.has('w')).toBe(false);
  });

  test('ptType="nonAsst" should apply to all non-assistant types', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'h',
        for: 'ch',
        ptType: 'nonAsst',
        val: 50,
        op: 'equ',
      }),
    ];

    const nodePointTypes = new Map([
      ['n1', 'node' as const],
      ['a1', 'asst' as const],
      ['t1', 'parTrans' as const],
    ]);

    const result = solveConstraints({
      constraints,
      nodeNames: ['n1', 'a1', 't1'],
      bounds: { width: 400, height: 300 },
      nodePointTypes,
    });

    // node and parTrans should get h=50, asst should not
    expect(result.nodeValues.get('n1')!.values.get('h')).toBe(50);
    expect(result.nodeValues.get('a1')!.values.has('h')).toBe(false);
    expect(result.nodeValues.get('t1')!.values.get('h')).toBe(50);
  });

  test('refPtType should filter based on reference node type', () => {
    const constraints: OoxmlConstraint[] = [
      // Set widths for reference nodes
      createDefaultConstraint({
        type: 'w',
        forName: 'nodeRef',
        val: 200,
        op: 'equ',
      }),
      createDefaultConstraint({
        type: 'w',
        forName: 'asstRef',
        val: 100,
        op: 'equ',
      }),
      // This constraint references nodeRef.w but requires refPtType="node"
      createDefaultConstraint({
        type: 'h',
        refType: 'w',
        refForName: 'nodeRef',
        refPtType: 'node',
        fact: 0.5,
        op: 'equ',
      }),
      // This constraint references asstRef.w but requires refPtType="node"
      // Since asstRef is 'asst' type, this should NOT match
      createDefaultConstraint({
        type: 'sp',
        refType: 'w',
        refForName: 'asstRef',
        refPtType: 'node',
        fact: 0.1,
        op: 'equ',
      }),
    ];

    const nodePointTypes = new Map([
      ['nodeRef', 'node' as const],
      ['asstRef', 'asst' as const],
    ]);

    const result = solveConstraints({
      constraints,
      nodeNames: ['nodeRef', 'asstRef'],
      bounds: { width: 400, height: 300 },
      nodePointTypes,
    });

    // h should be resolved (nodeRef matches refPtType="node")
    expect(result.selfValues.values.get('h')).toBe(100); // 200 * 0.5
    // sp should NOT be resolved (asstRef doesn't match refPtType="node")
    expect(result.fullyResolved).toBe(false);
    expect(result.unresolvedConstraints.length).toBe(1);
    expect(result.unresolvedConstraints[0].type).toBe('sp');
  });

  test('ptType="all" should not filter (backward compatible)', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        for: 'ch',
        ptType: 'all',
        val: 80,
        op: 'equ',
      }),
    ];

    const nodePointTypes = new Map([
      ['nodeChild', 'node' as const],
      ['asstChild', 'asst' as const],
    ]);

    const result = solveConstraints({
      constraints,
      nodeNames: ['nodeChild', 'asstChild'],
      bounds: { width: 400, height: 300 },
      nodePointTypes,
    });

    // Both should get w=80
    expect(result.nodeValues.get('nodeChild')!.values.get('w')).toBe(80);
    expect(result.nodeValues.get('asstChild')!.values.get('w')).toBe(80);
  });

  test('no nodePointTypes should skip filtering (backward compatible)', () => {
    const constraints: OoxmlConstraint[] = [
      createDefaultConstraint({
        type: 'w',
        for: 'ch',
        ptType: 'node',
        val: 80,
        op: 'equ',
      }),
    ];

    // No nodePointTypes provided
    const result = solveConstraints({
      constraints,
      nodeNames: ['child1', 'child2'],
      bounds: { width: 400, height: 300 },
    });

    // Without nodePointTypes, filtering is skipped — both get the value
    expect(result.nodeValues.get('child1')!.values.get('w')).toBe(80);
    expect(result.nodeValues.get('child2')!.values.get('w')).toBe(80);
  });
});
