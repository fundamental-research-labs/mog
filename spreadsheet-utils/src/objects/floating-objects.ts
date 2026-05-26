/**
 * Floating Objects Type Guards
 *
 * Extracted from @mog-sdk/contracts/objects/floating-objects.
 */

import type {
  ChartObject,
  ConnectorObject,
  EquationObject,
  FloatingObject,
  OleObjectObject,
  PictureObject,
  ShapeObject,
  DiagramObject,
  TextBoxObject,
} from '@mog-sdk/contracts/objects/floating-objects';
import type { DrawingObject } from '@mog-sdk/contracts/ink/types';

export function isEquationObject(obj: FloatingObject): obj is EquationObject {
  return obj.type === 'equation';
}

export function isDiagramObject(obj: FloatingObject): obj is DiagramObject {
  return obj.type === 'diagram';
}

export function isPictureObject(obj: FloatingObject): obj is PictureObject {
  return obj.type === 'picture';
}

export function isDrawingObject(obj: FloatingObject): obj is DrawingObject {
  return obj.type === 'drawing';
}

export function isChartObject(obj: FloatingObject): obj is ChartObject {
  return obj.type === 'chart';
}

export function isShapeObject(obj: FloatingObject): obj is ShapeObject {
  return obj.type === 'shape';
}

export function isTextBoxObject(obj: FloatingObject): obj is TextBoxObject {
  return obj.type === 'textbox';
}

export function isConnectorObject(obj: FloatingObject): obj is ConnectorObject {
  return obj.type === 'connector';
}

export function isOleObjectObject(obj: FloatingObject): obj is OleObjectObject {
  return obj.type === 'oleObject';
}
