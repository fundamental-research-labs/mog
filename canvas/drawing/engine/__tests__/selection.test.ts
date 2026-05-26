/**
 * Selection State Tests
 */
import {
  addToSelection,
  createEmptySelection,
  getSelectionBounds,
  removeFromSelection,
  setSelection,
  toggleSelection,
} from '../src/spatial/selection';

// =============================================================================
// createEmptySelection
// =============================================================================

describe('createEmptySelection', () => {
  it('should create empty selection', () => {
    const state = createEmptySelection();
    expect(state.selectedIds.size).toBe(0);
    expect(state.anchorId).toBeNull();
  });
});

// =============================================================================
// addToSelection
// =============================================================================

describe('addToSelection', () => {
  it('should add IDs to selection', () => {
    const state = createEmptySelection();
    const result = addToSelection(state, ['a', 'b']);
    expect(result.selectedIds.has('a')).toBe(true);
    expect(result.selectedIds.has('b')).toBe(true);
    expect(result.selectedIds.size).toBe(2);
  });

  it('should set anchor to first added', () => {
    const state = createEmptySelection();
    const result = addToSelection(state, ['a', 'b']);
    expect(result.anchorId).toBe('a');
  });

  it('should not change anchor if already set', () => {
    const state = { selectedIds: new Set(['x']), anchorId: 'x' };
    const result = addToSelection(state, ['a']);
    expect(result.anchorId).toBe('x');
  });

  it('should not add duplicates', () => {
    const state = { selectedIds: new Set(['a']), anchorId: 'a' };
    const result = addToSelection(state, ['a', 'b']);
    expect(result.selectedIds.size).toBe(2);
  });

  it('should return same state for empty ids', () => {
    const state = createEmptySelection();
    const result = addToSelection(state, []);
    expect(result).toBe(state);
  });

  it('should not mutate original state', () => {
    const state = createEmptySelection();
    addToSelection(state, ['a']);
    expect(state.selectedIds.size).toBe(0);
  });
});

// =============================================================================
// removeFromSelection
// =============================================================================

describe('removeFromSelection', () => {
  it('should remove IDs from selection', () => {
    const state = { selectedIds: new Set(['a', 'b', 'c']), anchorId: 'a' };
    const result = removeFromSelection(state, ['b']);
    expect(result.selectedIds.has('b')).toBe(false);
    expect(result.selectedIds.size).toBe(2);
  });

  it('should update anchor when it is removed', () => {
    const state = { selectedIds: new Set(['a', 'b']), anchorId: 'a' };
    const result = removeFromSelection(state, ['a']);
    expect(result.anchorId).toBe('b');
  });

  it('should set anchor to null when all removed', () => {
    const state = { selectedIds: new Set(['a']), anchorId: 'a' };
    const result = removeFromSelection(state, ['a']);
    expect(result.anchorId).toBeNull();
    expect(result.selectedIds.size).toBe(0);
  });

  it('should handle removing non-existent IDs', () => {
    const state = { selectedIds: new Set(['a']), anchorId: 'a' };
    const result = removeFromSelection(state, ['nonexistent']);
    expect(result.selectedIds.size).toBe(1);
    expect(result.anchorId).toBe('a');
  });

  it('should not mutate original state', () => {
    const state = { selectedIds: new Set(['a', 'b']), anchorId: 'a' };
    removeFromSelection(state, ['a']);
    expect(state.selectedIds.has('a')).toBe(true);
  });
});

// =============================================================================
// toggleSelection
// =============================================================================

describe('toggleSelection', () => {
  it('should add if not selected', () => {
    const state = createEmptySelection();
    const result = toggleSelection(state, 'a');
    expect(result.selectedIds.has('a')).toBe(true);
  });

  it('should remove if selected', () => {
    const state = { selectedIds: new Set(['a']), anchorId: 'a' };
    const result = toggleSelection(state, 'a');
    expect(result.selectedIds.has('a')).toBe(false);
  });

  it('should work repeatedly', () => {
    let state = createEmptySelection();
    state = toggleSelection(state, 'a');
    expect(state.selectedIds.has('a')).toBe(true);
    state = toggleSelection(state, 'a');
    expect(state.selectedIds.has('a')).toBe(false);
    state = toggleSelection(state, 'a');
    expect(state.selectedIds.has('a')).toBe(true);
  });
});

// =============================================================================
// setSelection
// =============================================================================

describe('setSelection', () => {
  it('should replace selection with given IDs', () => {
    const result = setSelection(['a', 'b']);
    expect(result.selectedIds.size).toBe(2);
    expect(result.selectedIds.has('a')).toBe(true);
    expect(result.selectedIds.has('b')).toBe(true);
    expect(result.anchorId).toBe('a');
  });

  it('should handle empty array', () => {
    const result = setSelection([]);
    expect(result.selectedIds.size).toBe(0);
    expect(result.anchorId).toBeNull();
  });

  it('should handle single item', () => {
    const result = setSelection(['x']);
    expect(result.selectedIds.size).toBe(1);
    expect(result.anchorId).toBe('x');
  });
});

// =============================================================================
// getSelectionBounds
// =============================================================================

describe('getSelectionBounds', () => {
  it('should compute combined bounds of selected objects', () => {
    const selectedIds = new Set(['a', 'b']);
    const objectBounds = new Map([
      ['a', { x: 10, y: 20, width: 50, height: 30 }],
      ['b', { x: 100, y: 5, width: 40, height: 60 }],
      ['c', { x: 500, y: 500, width: 10, height: 10 }],
    ]);
    const bounds = getSelectionBounds(selectedIds, objectBounds);
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(10);
    expect(bounds!.y).toBe(5);
    expect(bounds!.width).toBe(130); // 140 - 10
    expect(bounds!.height).toBe(60); // 65 - 5
  });

  it('should return null for empty selection', () => {
    const bounds = getSelectionBounds(new Set(), new Map());
    expect(bounds).toBeNull();
  });

  it('should return null when no bounds found', () => {
    const selectedIds = new Set(['missing']);
    const objectBounds = new Map([['other', { x: 0, y: 0, width: 10, height: 10 }]]);
    const bounds = getSelectionBounds(selectedIds, objectBounds);
    expect(bounds).toBeNull();
  });

  it('should handle single object', () => {
    const selectedIds = new Set(['a']);
    const objectBounds = new Map([['a', { x: 10, y: 20, width: 50, height: 30 }]]);
    const bounds = getSelectionBounds(selectedIds, objectBounds);
    expect(bounds).toEqual({ x: 10, y: 20, width: 50, height: 30 });
  });

  it('should handle overlapping objects', () => {
    const selectedIds = new Set(['a', 'b']);
    const objectBounds = new Map([
      ['a', { x: 0, y: 0, width: 100, height: 100 }],
      ['b', { x: 50, y: 50, width: 100, height: 100 }],
    ]);
    const bounds = getSelectionBounds(selectedIds, objectBounds);
    expect(bounds).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });
});
