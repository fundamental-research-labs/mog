/**
 * Diagnostics Tests
 */
import type { CellDimensionLookup } from '../src/anchor/anchor-types';
import { traceAnchorResolution } from '../src/diagnostics/anchor-diagnostics';
import { generateDrawingSummary } from '../src/diagnostics/reporters';
import { validateGroups, validateZOrder } from '../src/diagnostics/validators';
import type { GroupHierarchy } from '../src/grouping/group-manager';
import { createGroup, createGroupHierarchy } from '../src/grouping/group-manager';
import type { SpatialObject } from '../src/spatial/spatial-query';

// Test helper: deterministic ID generator
function makeIdGen(prefix = 'group'): () => string {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

// =============================================================================
// HELPERS
// =============================================================================

function uniformDims(colWidth: number, rowHeight: number): CellDimensionLookup {
  return {
    getRowHeight: () => rowHeight,
    getColWidth: () => colWidth,
    getRowTop: (row: number) => row * rowHeight,
    getColLeft: (col: number) => col * colWidth,
  };
}

// =============================================================================
// validateZOrder
// =============================================================================

describe('validateZOrder', () => {
  it('should validate correct z-order', () => {
    const result = validateZOrder([
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 1 },
      { id: 'c', zIndex: 2 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect duplicate z-indices', () => {
    const result = validateZOrder([
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 0 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DRAWING_ZORDER_DUPLICATE')).toBe(true);
  });

  it('should detect gaps in z-indices', () => {
    const result = validateZOrder([
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 5 },
    ]);
    expect(result.issues.some((i) => i.code === 'DRAWING_ZORDER_GAP')).toBe(true);
  });

  it('should detect negative z-indices', () => {
    const result = validateZOrder([
      { id: 'a', zIndex: -1 },
      { id: 'b', zIndex: 0 },
    ]);
    expect(result.issues.some((i) => i.code === 'DRAWING_ZORDER_NEGATIVE')).toBe(true);
  });

  it('should handle empty array', () => {
    const result = validateZOrder([]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should handle single item', () => {
    const result = validateZOrder([{ id: 'a', zIndex: 0 }]);
    expect(result.valid).toBe(true);
  });

  it('should report multiple issues', () => {
    const result = validateZOrder([
      { id: 'a', zIndex: -1 },
      { id: 'b', zIndex: -1 },
      { id: 'c', zIndex: 5 },
    ]);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('should consider gaps as warnings, not errors', () => {
    const result = validateZOrder([
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 10 },
    ]);
    // Gaps are warnings, not errors, so valid should be true
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

// =============================================================================
// validateGroups
// =============================================================================

describe('validateGroups', () => {
  it('should validate a valid hierarchy', () => {
    const h = createGroupHierarchy();
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const { hierarchy } = createGroup(h, ['a', 'b'], bounds, makeIdGen());
    const result = validateGroups(hierarchy);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect cycles', () => {
    // Manually create a cycle
    const hierarchy: GroupHierarchy = {
      groups: new Map([
        ['g1', { id: 'g1', childIds: ['g2'], bounds: { x: 0, y: 0, width: 0, height: 0 } }],
        ['g2', { id: 'g2', childIds: ['g1'], bounds: { x: 0, y: 0, width: 0, height: 0 } }],
      ]),
      parentOf: new Map([
        ['g2', 'g1'],
        ['g1', 'g2'],
      ]),
    };
    const result = validateGroups(hierarchy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DRAWING_GROUP_CYCLE')).toBe(true);
  });

  it('should detect empty groups', () => {
    const hierarchy: GroupHierarchy = {
      groups: new Map([
        ['g1', { id: 'g1', childIds: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }],
      ]),
      parentOf: new Map(),
    };
    const result = validateGroups(hierarchy);
    expect(result.issues.some((i) => i.code === 'DRAWING_GROUP_EMPTY')).toBe(true);
  });

  it('should detect orphaned parent references', () => {
    const hierarchy: GroupHierarchy = {
      groups: new Map(),
      parentOf: new Map([['a', 'nonexistent']]),
    };
    const result = validateGroups(hierarchy);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === 'DRAWING_GROUP_ORPHAN')).toBe(true);
  });

  it('should validate empty hierarchy', () => {
    const result = validateGroups(createGroupHierarchy());
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// traceAnchorResolution
// =============================================================================

describe('traceAnchorResolution', () => {
  const dims = uniformDims(64, 20);

  it('should trace absolute anchor', () => {
    const trace = traceAnchorResolution(
      { type: 'absolute', x: 100, y: 200, width: 300, height: 150 },
      dims,
    );
    expect(trace.resolved).toEqual({ x: 100, y: 200, width: 300, height: 150 });
    expect(trace.steps.length).toBeGreaterThanOrEqual(3);
    expect(trace.steps.some((s) => s.description.includes('Absolute'))).toBe(true);
  });

  it('should trace oneCell anchor', () => {
    const trace = traceAnchorResolution(
      { type: 'oneCell', from: { row: 1, col: 2, xOffset: 5, yOffset: 3 }, width: 100, height: 50 },
      dims,
    );
    expect(trace.resolved.width).toBe(100);
    expect(trace.resolved.height).toBe(50);
    expect(trace.steps.length).toBeGreaterThanOrEqual(4);
    expect(trace.steps.some((s) => s.description.includes('From anchor'))).toBe(true);
  });

  it('should trace twoCell anchor', () => {
    const trace = traceAnchorResolution(
      {
        type: 'twoCell',
        from: { row: 0, col: 0, xOffset: 0, yOffset: 0 },
        to: { row: 2, col: 3, xOffset: 0, yOffset: 0 },
      },
      dims,
    );
    expect(trace.resolved.width).toBe(3 * 64);
    expect(trace.resolved.height).toBe(2 * 20);
    expect(trace.steps.length).toBeGreaterThanOrEqual(5);
    expect(trace.steps.some((s) => s.description.includes('To anchor'))).toBe(true);
  });

  it('should include input anchor in steps', () => {
    const anchor = { type: 'absolute' as const, x: 0, y: 0, width: 10, height: 10 };
    const trace = traceAnchorResolution(anchor, dims);
    expect(trace.anchor).toBe(anchor);
    expect(trace.steps[0].description).toContain('Input');
  });

  it('should include final resolved bounds in steps', () => {
    const trace = traceAnchorResolution(
      { type: 'absolute', x: 50, y: 60, width: 70, height: 80 },
      dims,
    );
    const lastStep = trace.steps[trace.steps.length - 1];
    expect(lastStep.description).toContain('Final');
  });
});

// =============================================================================
// generateDrawingSummary
// =============================================================================

describe('generateDrawingSummary', () => {
  it('should generate summary for objects', () => {
    const objects: SpatialObject[] = [
      { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 50 }, zIndex: 0 },
      { id: 'obj2', bounds: { x: 50, y: 50, width: 80, height: 60 }, zIndex: 1 },
    ];
    const groups = createGroupHierarchy();

    const summary = generateDrawingSummary(objects, groups);
    expect(summary).toContain('Total objects: 2');
    expect(summary).toContain('Total groups: 0');
    expect(summary).toContain('Z-index range: 0 to 1');
    expect(summary).toContain('obj1');
    expect(summary).toContain('obj2');
  });

  it('should include group information', () => {
    const objects: SpatialObject[] = [
      { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 50 }, zIndex: 0 },
      { id: 'obj2', bounds: { x: 50, y: 50, width: 80, height: 60 }, zIndex: 1 },
    ];
    const h = createGroupHierarchy();
    const { hierarchy } = createGroup(
      h,
      ['obj1', 'obj2'],
      { x: 0, y: 0, width: 130, height: 110 },
      makeIdGen(),
    );

    const summary = generateDrawingSummary(objects, hierarchy);
    expect(summary).toContain('Total groups: 1');
    expect(summary).toContain('2 children');
  });

  it('should handle empty state', () => {
    const summary = generateDrawingSummary([], createGroupHierarchy());
    expect(summary).toContain('Total objects: 0');
    expect(summary).toContain('Total groups: 0');
  });

  it('should sort objects by z-order in output', () => {
    const objects: SpatialObject[] = [
      { id: 'back', bounds: { x: 0, y: 0, width: 50, height: 50 }, zIndex: 0 },
      { id: 'front', bounds: { x: 10, y: 10, width: 50, height: 50 }, zIndex: 5 },
    ];
    const summary = generateDrawingSummary(objects, createGroupHierarchy());
    const backIdx = summary.indexOf('back');
    const frontIdx = summary.indexOf('front');
    expect(backIdx).toBeLessThan(frontIdx);
  });
});
