/**
 * Scene object projection tests.
 *
 * Locks renderer-only projection rules for floating objects whose model
 * records must be preserved but whose structural containers do not paint.
 */

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import { GridRendererImpl } from '../grid-renderer';

function buildSceneObject(obj: FloatingObject) {
  const proto = GridRendererImpl.prototype as unknown as {
    buildSceneObject: (
      obj: FloatingObject,
      bounds: { x: number; y: number; width: number; height: number; rotation?: number },
    ) => unknown;
  };

  return proto.buildSceneObject.call({}, obj, {
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    rotation: 0,
  });
}

function shape(shapeType: string): FloatingObject {
  return {
    id: `shape-${shapeType}`,
    type: 'shape',
    sheetId: 'sheet-1',
    position: { x: 10, y: 20, width: 300, height: 200 },
    anchor: { x: 10, y: 20, width: 300, height: 200 },
    zIndex: 0,
    locked: false,
    printable: true,
    visible: true,
    shapeType,
  } as FloatingObject;
}

describe('GridRendererImpl scene object projection', () => {
  it('does not project structural OOXML group containers as drawable shape scenes', () => {
    expect(buildSceneObject(shape('group'))).toBeNull();
  });

  it('continues to project normal shapes', () => {
    const scene = buildSceneObject(shape('rect')) as {
      type?: string;
      data?: { shapeType?: string };
    };

    expect(scene?.type).toBe('shape');
    expect(scene?.data?.shapeType).toBe('rect');
  });
});
