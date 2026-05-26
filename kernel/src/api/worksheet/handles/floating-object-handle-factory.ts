/**
 * Factory function for creating type-narrowed floating object handles.
 *
 * Switches on the object type discriminant and returns the correct concrete
 * handle subclass. This replaces the god-class pattern where the base handle
 * carried runtime assertType() checks and as*() casts for polymorphic narrowing.
 *
 * TypeScript exhaustiveness checking ensures all variants are handled at compile
 * time — adding a new FloatingObjectType without a case here is a type error.
 */
import type { FloatingObjectHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { FloatingObjectType } from '@mog-sdk/contracts/api';
import type { ShapeType } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';
import { ShapeHandleImpl } from './shape-handle-impl';
import { PictureHandleImpl } from './picture-handle-impl';
import { TextBoxHandleImpl } from './textbox-handle-impl';
import { DrawingHandleImpl } from './drawing-handle-impl';
import { EquationHandleImpl } from './equation-handle-impl';
import { ConnectorHandleImpl } from './connector-handle-impl';
import { ChartHandleImpl } from './chart-handle-impl';
import { DiagramHandleImpl } from './diagram-handle-impl';
import { SlicerHandleImpl } from './slicer-handle-impl';
import { OleObjectHandleImpl } from './ole-object-handle-impl';
import { TextEffectHandleImpl } from './text-effects-handle-impl';

/**
 * Create a typed floating object handle from a type discriminant.
 *
 * @param id - The object's stable identifier
 * @param type - The FloatingObjectType discriminant (e.g., 'shape', 'picture')
 * @param objectsImpl - The worksheet objects implementation for delegation
 * @param boundsReader - Optional bounds reader for spatial queries
 * @param shapeType - Required when type is 'shape' (defaults to 'rect')
 * @returns The correct concrete handle subclass
 */
export function createFloatingObjectHandle(
  id: string,
  type: FloatingObjectType,
  objectsImpl: WorksheetObjectsImpl,
  boundsReader: IObjectBoundsReader | null,
  shapeType?: ShapeType,
): FloatingObjectHandle {
  switch (type) {
    case 'shape':
      return new ShapeHandleImpl(id, shapeType ?? ('rect' as ShapeType), objectsImpl, boundsReader);
    case 'picture':
      return new PictureHandleImpl(id, objectsImpl, boundsReader);
    case 'textbox':
      return new TextBoxHandleImpl(id, objectsImpl, boundsReader);
    case 'drawing':
      return new DrawingHandleImpl(id, objectsImpl, boundsReader);
    case 'equation':
      return new EquationHandleImpl(id, objectsImpl, boundsReader);
    case 'connector':
      return new ConnectorHandleImpl(id, objectsImpl, boundsReader);
    case 'chart':
      return new ChartHandleImpl(id, objectsImpl, boundsReader);
    case 'diagram':
      return new DiagramHandleImpl(id, objectsImpl, boundsReader);
    case 'slicer':
      return new SlicerHandleImpl(id, objectsImpl, boundsReader);
    case 'oleObject':
      return new OleObjectHandleImpl(id, objectsImpl, boundsReader);
    case 'camera':
    case 'formControl':
      return new FloatingObjectHandleImpl(id, type, objectsImpl, boundsReader);
    case 'text-effects':
      return new TextEffectHandleImpl(id, objectsImpl, boundsReader);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown floating object type "${type}"`);
    }
  }
}
