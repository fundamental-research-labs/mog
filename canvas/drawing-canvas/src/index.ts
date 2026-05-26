/**
 * @mog/drawing-canvas
 *
 * Drawing object rendering — scene graph, object type renderers (including
 * charts), and hit map. Consumes CanvasLayer interface from canvas-engine,
 * delegates rendering to existing drawing-engine and shape-engine packages.
 *
 * @module @mog/drawing-canvas
 */

// Scene graph
export { SceneGraph } from './scene/scene-graph';
export type { SceneGraphDirtyCallback } from './scene/scene-graph';
export type {
  ChartData,
  ChartScene,
  ConnectorData,
  ConnectorScene,
  EquationData,
  EquationScene,
  InkData,
  InkScene,
  InkStrokeData,
  LineEndSize,
  LineEndType,
  ObjectBorderConfig,
  ObjectFillConfig,
  ObjectHitRegion,
  OleObjectData,
  OleObjectScene,
  PictureData,
  PictureScene,
  SceneObject,
  SceneObjectBase,
  SceneObjectType,
  ShapeData,
  ShapeScene,
  DiagramData,
  DiagramScene,
  TextRun,
  TextboxData,
  TextboxScene,
  TextEffectRef,
} from './scene/types';

// Bridge interfaces
export { BridgeRegistry } from './bridges/bridge-registry';
export { DiagramCanvasBridge } from './bridges/diagram-canvas-bridge';
export { mapBridgeScene3D, mapBridgeShape3D } from './bridges/three-d-bridge';
export type {
  AstToLatexFn,
  DrawingBridgeConfig,
  IChartRenderBridge,
  IInkAccessorForRendering,
  IDiagramRenderBridge,
  ITextEffectBridge,
} from './bridges/types';

// Hit testing
export { HitMap } from './hit-testing/hit-map';

// Renderers, dispatcher, utilities, ImageCache, DrawingLayer
// are internal — only consumed within this package.

// Shape rendering info
export {
  getShapeRenderingInfo,
  getSupportedShapeTypes,
  getUnsupportedShapeTypes,
  isShapeTypeSupported,
  type ShapeRenderingInfo,
} from './shape-rendering-info';

// Factory
export { createDrawingLayer } from './factory';
export type { CreateDrawingLayerConfig, DrawingLayerHandle } from './factory';
