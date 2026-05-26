/**
 * Scene Graph Tests
 *
 * Tests for SceneGraph CRUD, z-order sorting, group operations,
 * dirty tracking, and mutation notification.
 */

import { jest } from '@jest/globals';

import { SceneGraph } from '../src/scene/scene-graph';
import type {
  ChartScene,
  PictureScene,
  SceneObject,
  ShapeScene,
  TextboxScene,
} from '../src/scene/types';

// =============================================================================
// Test Helpers
// =============================================================================

function makePicture(id: string, zIndex: number, opts?: Partial<PictureScene>): PictureScene {
  return {
    id,
    type: 'picture',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    zIndex,
    visible: true,
    groupId: null,
    data: { src: 'test.png', naturalWidth: 100, naturalHeight: 100 },
    ...opts,
  };
}

function makeTextbox(id: string, zIndex: number, opts?: Partial<TextboxScene>): TextboxScene {
  return {
    id,
    type: 'textbox',
    bounds: { x: 0, y: 0, width: 200, height: 50 },
    zIndex,
    visible: true,
    groupId: null,
    data: { text: 'Hello' },
    ...opts,
  };
}

function makeShape(id: string, zIndex: number, opts?: Partial<ShapeScene>): ShapeScene {
  return {
    id,
    type: 'shape',
    bounds: { x: 0, y: 0, width: 150, height: 150 },
    zIndex,
    visible: true,
    groupId: null,
    data: { shapeType: 'rect' },
    ...opts,
  };
}

function makeChart(id: string, zIndex: number, opts?: Partial<ChartScene>): ChartScene {
  return {
    id,
    type: 'chart',
    bounds: { x: 0, y: 0, width: 300, height: 200 },
    zIndex,
    visible: true,
    groupId: null,
    data: { chartId: `chart-${id}`, chartType: 'bar' },
    ...opts,
  };
}

// =============================================================================
// CRUD Tests
// =============================================================================

describe('SceneGraph', () => {
  describe('CRUD operations', () => {
    test('add and retrieve by ID', () => {
      const graph = new SceneGraph();
      const pic = makePicture('pic1', 10);
      graph.add(pic);

      expect(graph.getById('pic1')).toBe(pic);
      expect(graph.size).toBe(1);
    });

    test('add replaces existing object with same ID', () => {
      const graph = new SceneGraph();
      const pic1 = makePicture('pic1', 10);
      const pic2 = makePicture('pic1', 20);

      graph.add(pic1);
      graph.add(pic2);

      expect(graph.size).toBe(1);
      expect(graph.getById('pic1')?.zIndex).toBe(20);
    });

    test('remove returns true for existing object', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));

      expect(graph.remove('pic1')).toBe(true);
      expect(graph.size).toBe(0);
      expect(graph.getById('pic1')).toBeUndefined();
    });

    test('remove returns false for non-existing object', () => {
      const graph = new SceneGraph();
      expect(graph.remove('nonexistent')).toBe(false);
    });

    test('update modifies existing object fields', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));

      const result = graph.update('pic1', {
        bounds: { x: 50, y: 50, width: 200, height: 200 },
        visible: false,
      });

      expect(result).toBe(true);
      const updated = graph.getById('pic1')!;
      expect(updated.bounds.x).toBe(50);
      expect(updated.visible).toBe(false);
    });

    test('update returns false for non-existing object', () => {
      const graph = new SceneGraph();
      expect(graph.update('nonexistent', { visible: false })).toBe(false);
    });

    test('clear removes all objects', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.add(makeTextbox('tb1', 20));
      graph.add(makeShape('sh1', 30));

      graph.clear();

      expect(graph.size).toBe(0);
      expect(graph.isEmpty).toBe(true);
    });

    test('isEmpty returns correct state', () => {
      const graph = new SceneGraph();
      expect(graph.isEmpty).toBe(true);

      graph.add(makePicture('pic1', 10));
      expect(graph.isEmpty).toBe(false);

      graph.remove('pic1');
      expect(graph.isEmpty).toBe(true);
    });
  });

  // ===========================================================================
  // Z-Order Sorting Tests
  // ===========================================================================

  describe('z-order sorting', () => {
    test('getByZOrder returns objects sorted by zIndex ascending', () => {
      const graph = new SceneGraph();
      graph.add(makeShape('sh1', 30));
      graph.add(makePicture('pic1', 10));
      graph.add(makeTextbox('tb1', 20));

      const sorted = graph.getByZOrder();
      expect(sorted.map((o) => o.id)).toEqual(['pic1', 'tb1', 'sh1']);
    });

    test('charts interleave correctly with other objects by z-index', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 1));
      graph.add(makeChart('chart1', 2));
      graph.add(makeShape('sh1', 3));
      graph.add(makeChart('chart2', 4));
      graph.add(makeTextbox('tb1', 5));

      const sorted = graph.getByZOrder();
      expect(sorted.map((o) => o.id)).toEqual(['pic1', 'chart1', 'sh1', 'chart2', 'tb1']);
      expect(sorted.map((o) => o.type)).toEqual(['picture', 'chart', 'shape', 'chart', 'textbox']);
    });

    test('getByZOrder returns fresh data after bounds-only update', () => {
      const graph = new SceneGraph();
      graph.add(
        makePicture('pic1', 10, {
          bounds: { x: 0, y: 0, width: 100, height: 100 },
        }),
      );
      graph.getByZOrder(); // consume once

      graph.update('pic1', {
        bounds: { x: 200, y: 200, width: 100, height: 100 },
      });

      const objects = graph.getByZOrder();
      expect(objects[0].bounds.x).toBe(200);
      expect(objects[0].bounds.y).toBe(200);
    });

    test('getByZOrder returns fresh data after visibility toggle', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.getByZOrder(); // consume once

      graph.update('pic1', { visible: false });

      const objects = graph.getByZOrder();
      expect(objects[0].visible).toBe(false);
    });

    test('z-order correct after add', () => {
      const graph = new SceneGraph();
      graph.add(makeTextbox('tb1', 20));
      graph.getByZOrder(); // cache

      graph.add(makePicture('pic1', 10));
      const sorted = graph.getByZOrder();
      expect(sorted[0].id).toBe('pic1');
    });

    test('z-order rebuilt after update that changes zIndex', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.add(makeTextbox('tb1', 20));
      graph.getByZOrder(); // cache

      graph.update('pic1', { zIndex: 30 });
      const sorted = graph.getByZOrder();
      expect(sorted[0].id).toBe('tb1');
      expect(sorted[1].id).toBe('pic1');
    });
  });

  // ===========================================================================
  // Group Tests
  // ===========================================================================

  describe('group operations', () => {
    test('getGroupMembers returns objects with matching groupId', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10, { groupId: 'group1' }));
      graph.add(makeTextbox('tb1', 20, { groupId: 'group1' }));
      graph.add(makeShape('sh1', 30, { groupId: null }));

      const members = graph.getGroupMembers('group1');
      expect(members.map((o) => o.id).sort()).toEqual(['pic1', 'tb1']);
    });

    test('getGroupMembers returns empty array for unknown groupId', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10, { groupId: 'group1' }));
      expect(graph.getGroupMembers('unknown')).toEqual([]);
    });

    test('getGroupBounds returns union bounding box', () => {
      const graph = new SceneGraph();
      graph.add(
        makePicture('pic1', 10, {
          groupId: 'group1',
          bounds: { x: 10, y: 10, width: 50, height: 50 },
        }),
      );
      graph.add(
        makeTextbox('tb1', 20, {
          groupId: 'group1',
          bounds: { x: 100, y: 100, width: 50, height: 50 },
        }),
      );

      const bounds = graph.getGroupBounds('group1');
      expect(bounds).toEqual({
        x: 10,
        y: 10,
        width: 140,
        height: 140,
      });
    });

    test('getGroupBounds returns null for empty group', () => {
      const graph = new SceneGraph();
      expect(graph.getGroupBounds('nonexistent')).toBeNull();
    });
  });

  // ===========================================================================
  // Dirty Tracking Tests
  // ===========================================================================

  describe('dirty tracking', () => {
    test('add marks object ID as dirty', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      expect(graph.getDirtyIds().has('pic1')).toBe(true);
    });

    test('remove marks object ID as dirty', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.clearDirtyIds();

      graph.remove('pic1');
      expect(graph.getDirtyIds().has('pic1')).toBe(true);
    });

    test('update marks object ID as dirty', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.clearDirtyIds();

      graph.update('pic1', { visible: false });
      expect(graph.getDirtyIds().has('pic1')).toBe(true);
    });

    test('clearDirtyIds resets tracking', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.add(makeTextbox('tb1', 20));

      expect(graph.getDirtyIds().size).toBe(2);
      graph.clearDirtyIds();
      expect(graph.getDirtyIds().size).toBe(0);
    });

    test('clear marks all IDs as dirty', () => {
      const graph = new SceneGraph();
      graph.add(makePicture('pic1', 10));
      graph.add(makeTextbox('tb1', 20));
      graph.clearDirtyIds();

      graph.clear();
      expect(graph.getDirtyIds().has('pic1')).toBe(true);
      expect(graph.getDirtyIds().has('tb1')).toBe(true);
    });
  });

  // ===========================================================================
  // Mutation Notification Tests
  // ===========================================================================

  describe('mutation notification (onDirty callback)', () => {
    test('onDirty called on add with new object bounds', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);

      const pic = makePicture('pic1', 10, { bounds: { x: 10, y: 20, width: 100, height: 50 } });
      graph.add(pic);
      expect(onDirty).toHaveBeenCalledTimes(1);
      // New object: only new bounds reported
      expect(onDirty).toHaveBeenCalledWith([{ x: 10, y: 20, width: 100, height: 50 }]);
    });

    test('onDirty called on add (replace) with old + new bounds', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);

      const pic1 = makePicture('pic1', 10, { bounds: { x: 10, y: 20, width: 100, height: 50 } });
      graph.add(pic1);
      onDirty.mockClear();

      const pic1Moved = makePicture('pic1', 10, {
        bounds: { x: 200, y: 300, width: 100, height: 50 },
      });
      graph.add(pic1Moved);
      expect(onDirty).toHaveBeenCalledTimes(1);
      // Replace: old bounds + new bounds
      expect(onDirty).toHaveBeenCalledWith([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: 200, y: 300, width: 100, height: 50 },
      ]);
    });

    test('onDirty called on remove with old bounds', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);
      const pic = makePicture('pic1', 10, { bounds: { x: 50, y: 60, width: 80, height: 40 } });
      graph.add(pic);
      onDirty.mockClear();

      graph.remove('pic1');
      expect(onDirty).toHaveBeenCalledTimes(1);
      expect(onDirty).toHaveBeenCalledWith([{ x: 50, y: 60, width: 80, height: 40 }]);
    });

    test('onDirty NOT called on remove of nonexistent', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);

      graph.remove('nonexistent');
      expect(onDirty).not.toHaveBeenCalled();
    });

    test('onDirty called on update with old bounds (no position change)', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);
      const pic = makePicture('pic1', 10, { bounds: { x: 10, y: 20, width: 100, height: 50 } });
      graph.add(pic);
      onDirty.mockClear();

      // Visual-only change (no bounds change) — only old bounds reported
      graph.update('pic1', { visible: false });
      expect(onDirty).toHaveBeenCalledTimes(1);
      expect(onDirty).toHaveBeenCalledWith([{ x: 10, y: 20, width: 100, height: 50 }]);
    });

    test('onDirty called on update with old + new bounds (position change)', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);
      const pic = makePicture('pic1', 10, { bounds: { x: 10, y: 20, width: 100, height: 50 } });
      graph.add(pic);
      onDirty.mockClear();

      // Position change — old bounds + new bounds
      graph.update('pic1', { bounds: { x: 200, y: 300, width: 100, height: 50 } });
      expect(onDirty).toHaveBeenCalledTimes(1);
      expect(onDirty).toHaveBeenCalledWith([
        { x: 10, y: 20, width: 100, height: 50 },
        { x: 200, y: 300, width: 100, height: 50 },
      ]);
    });

    test('onDirty called on clear with empty bounds (signals full dirty)', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);
      graph.add(makePicture('pic1', 10));
      onDirty.mockClear();

      graph.clear();
      expect(onDirty).toHaveBeenCalledTimes(1);
      // Empty array signals full dirty
      expect(onDirty).toHaveBeenCalledWith([]);
    });

    test('onDirty NOT called on clear of empty graph', () => {
      const onDirty = jest.fn();
      const graph = new SceneGraph(onDirty);

      graph.clear();
      expect(onDirty).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Discriminated Union Exhaustiveness Test
  // ===========================================================================

  describe('discriminated union exhaustiveness', () => {
    test('all scene object types are handled by exhaustive switch', () => {
      const graph = new SceneGraph();

      // Add one of each type
      graph.add({
        id: '1',
        type: 'picture',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 1,
        visible: true,
        groupId: null,
        data: { src: '', naturalWidth: 1, naturalHeight: 1 },
      });
      graph.add({
        id: '2',
        type: 'textbox',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 2,
        visible: true,
        groupId: null,
        data: { text: '' },
      });
      graph.add({
        id: '3',
        type: 'shape',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 3,
        visible: true,
        groupId: null,
        data: { shapeType: 'rect' },
      });
      graph.add({
        id: '4',
        type: 'chart',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 4,
        visible: true,
        groupId: null,
        data: { chartId: 'c1', chartType: 'bar' },
      });
      graph.add({
        id: '5',
        type: 'ink',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 5,
        visible: true,
        groupId: null,
        data: { strokes: [] },
      });
      graph.add({
        id: '6',
        type: 'equation',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 6,
        visible: true,
        groupId: null,
        data: { latex: 'x^2' },
      });
      graph.add({
        id: '7',
        type: 'diagram',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        zIndex: 7,
        visible: true,
        groupId: null,
        data: { objectId: '7', diagramType: 'hierarchy', nodes: [] },
      });
      // Exhaustive switch — TypeScript will error if a case is missing
      const types: string[] = [];
      for (const obj of graph.getByZOrder()) {
        switch (obj.type) {
          case 'picture':
            types.push('picture');
            break;
          case 'textbox':
            types.push('textbox');
            break;
          case 'shape':
            types.push('shape');
            break;
          case 'connector':
            types.push('connector');
            break;
          case 'chart':
            types.push('chart');
            break;
          case 'ink':
            types.push('ink');
            break;
          case 'equation':
            types.push('equation');
            break;
          case 'diagram':
            types.push('diagram');
            break;
          case 'oleObject':
            types.push('oleObject');
            break;
          default: {
            const _exhaustive: never = obj;
            throw new Error(`Unhandled type: ${(_exhaustive as SceneObject).type}`);
          }
        }
      }

      expect(types).toEqual(['picture', 'textbox', 'shape', 'chart', 'ink', 'equation', 'diagram']);
    });
  });
});
