import type { GridRenderer } from '@mog-sdk/contracts/rendering';
import type { SceneObjectSnapshot } from '@mog-sdk/contracts/objects/scene-graph-reader';

import { SheetViewObjects, type ObjectsInternals } from '../capabilities/objects';
import type { SheetFloatingObjectScenePatch } from '../public-types';

function sceneObject(id: string): SceneObjectSnapshot {
  return {
    id,
    type: 'chart',
    bounds: { x: 10, y: 20, width: 300, height: 180 },
    zIndex: 2,
    visible: true,
    groupId: null,
    rotation: 5,
    locked: false,
    opacity: 0.8,
    data: { chartId: 'chart-1' },
  };
}

function makeRenderer(objects: SceneObjectSnapshot[] = []): jest.Mocked<GridRenderer> {
  return {
    sceneGraphReader: {
      getByZOrder: jest.fn(() => objects),
      getById: jest.fn((id: string) => objects.find((obj) => obj.id === id) ?? null),
    },
    updateContext: jest.fn(),
    getCurrentSheetId: jest.fn(() => 'sheet-current'),
    switchSheet: jest.fn(),
    invalidateLayer: jest.fn(),
    hitTest: jest.fn(),
    getObjectBoundsSync: jest.fn(),
    boundsReader: {
      getBounds: jest.fn(),
    },
    updateObjectBounds: jest.fn(),
  } as unknown as jest.Mocked<GridRenderer>;
}

function makeObjects(renderer: GridRenderer): SheetViewObjects {
  const internals: ObjectsInternals = {
    getRenderer: () => renderer,
  };
  return new SheetViewObjects(internals);
}

describe('SheetViewObjects', () => {
  it('reads scene objects by z-order through the renderer scene graph reader', () => {
    const obj = sceneObject('chart-1');
    const renderer = makeRenderer([obj]);
    const objects = makeObjects(renderer);

    expect(objects.getSceneObjectsByZOrder()).toEqual([
      {
        id: 'chart-1',
        type: 'chart',
        bounds: { x: 10, y: 20, width: 300, height: 180 },
        zIndex: 2,
        visible: true,
        groupId: null,
        rotation: 5,
        locked: false,
        opacity: 0.8,
        data: { chartId: 'chart-1' },
      },
    ]);
    expect(renderer.sceneGraphReader.getByZOrder).toHaveBeenCalledTimes(1);
  });

  it('reads a single scene object by id', () => {
    const renderer = makeRenderer([sceneObject('chart-1')]);
    const objects = makeObjects(renderer);

    expect(objects.getSceneObject('chart-1')?.id).toBe('chart-1');
    expect(objects.getSceneObject('missing')).toBeNull();
    expect(renderer.sceneGraphReader.getById).toHaveBeenCalledWith('chart-1');
    expect(renderer.sceneGraphReader.getById).toHaveBeenCalledWith('missing');
  });

  it('applies data-bearing scene patches without dropping payload fields', () => {
    const renderer = makeRenderer();
    const objects = makeObjects(renderer);
    const data = {
      id: 'chart-1',
      type: 'chart',
      position: { type: 'absolute', x: 0, y: 0, width: 300, height: 180 },
    };
    const patches: SheetFloatingObjectScenePatch[] = [
      {
        objectId: 'chart-1',
        kind: 'created',
        data,
        bounds: { x: 10, y: 20, width: 300, height: 180, rotation: 0 },
        changedFields: ['position'],
      },
    ];

    objects.applyPatches(patches);

    expect(renderer.updateContext).toHaveBeenCalledWith({
      floatingObjectPatches: [
        {
          objectId: 'chart-1',
          kind: 'created',
          data,
          bounds: { x: 10, y: 20, width: 300, height: 180, rotation: 0 },
          changedFields: ['position'],
        },
      ],
    });
  });

  it('force resyncs the current sheet when no sheet id is supplied', () => {
    const renderer = makeRenderer();
    const objects = makeObjects(renderer);

    objects.resyncScene({ force: true });

    expect(renderer.getCurrentSheetId).toHaveBeenCalledTimes(1);
    expect(renderer.switchSheet).toHaveBeenCalledWith('sheet-current');
    expect(renderer.invalidateLayer).not.toHaveBeenCalled();
  });
});
