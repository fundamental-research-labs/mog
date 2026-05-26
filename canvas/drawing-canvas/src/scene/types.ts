/**
 * Scene Object Types — Discriminated Union
 *
 * All floating objects in the drawing canvas are represented as a discriminated
 * union with `type` as the literal discriminant. This gives exhaustiveness
 * checking in the rendering dispatcher (switch on obj.type) and eliminates
 * unsafe `as` casts on data.
 *
 * SceneObject.bounds are in DOCUMENT SPACE (absolute sheet coordinates), NOT
 * viewport space. The DrawingLayer handles document-to-viewport conversion via
 * the engine's region transform.
 *
 * Group storage: flat list with groupId field. Objects with the same non-null
 * groupId form a group. Hit testing: clicking any member selects the group;
 * double-clicking selects the individual object.
 *
 * @module @mog/drawing-canvas/scene/types
 */

import type { Rect } from '@mog/canvas-engine';
import type { Scene3D, Shape3D } from '@mog-sdk/contracts/drawing/three-d';
import type { LineEndSize, LineEndType } from '@mog-sdk/contracts/floating-objects';

// =============================================================================
// Scene Object Data Types (per-type payloads)
// =============================================================================

export interface PictureData {
  readonly src: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly cropTop?: number;
  readonly cropBottom?: number;
  readonly cropLeft?: number;
  readonly cropRight?: number;
  readonly opacity?: number;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly border?: ObjectBorderConfig;
}

export interface TextboxData {
  readonly text: string;
  readonly richText?: ReadonlyArray<TextRun>;
  readonly fill?: ObjectFillConfig;
  readonly border?: ObjectBorderConfig;
  readonly padding?: { top: number; right: number; bottom: number; left: number };
  readonly verticalAlign?: 'top' | 'middle' | 'bottom';
  readonly textEffect?: TextEffectRef;
}

export interface TextRun {
  readonly text: string;
  readonly font?: string;
  readonly fontSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: string;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
}

export interface TextEffectRef {
  readonly warpPreset: string;
  readonly warpAdjustments?: { adj1?: number; adj2?: number };
  readonly textFill?: ObjectFillConfig;
  readonly textOutline?: ObjectBorderConfig;
}

export interface ShapeData {
  readonly shapeType: string;
  readonly fill?: ObjectFillConfig;
  readonly border?: ObjectBorderConfig;
  readonly adjustments?: ReadonlyArray<{ name: string; value: number }>;
  readonly text?: string;
  readonly richText?: ReadonlyArray<TextRun>;
  /** 3D scene properties (camera + lighting) from OOXML scene3d element. */
  readonly scene3d?: Scene3D;
  /** 3D shape properties (bevels, extrusion, material) from OOXML sp3d element. */
  readonly sp3d?: Shape3D;
}

export interface ChartData {
  readonly chartId: string;
  readonly chartType: string;
}

export interface InkData {
  readonly strokes: ReadonlyArray<InkStrokeData>;
}

export interface InkStrokeData {
  readonly points: ReadonlyArray<{ x: number; y: number; pressure?: number }>;
  readonly color: string;
  readonly width: number;
  readonly opacity?: number;
}

export interface EquationData {
  readonly latex: string;
  readonly style?: { fontSize?: number; color?: string };
}

export interface DiagramData {
  /** Floating object ID — key for kernel bridge lookup */
  readonly objectId: string;
  readonly diagramType: string;
  readonly nodes: ReadonlyArray<{ id: string; text: string; level: number }>;
  /** Maps to CT_StyleDefinition.uniqueId — quick style applied to the diagram */
  readonly quickStyleId?: string;
  /** Maps to CT_ColorTransform.uniqueId — color theme applied to the diagram */
  readonly colorThemeId?: string;
}

export interface OleObjectData {
  readonly progId: string;
  readonly dvAspect: 'content' | 'icon';
  readonly previewImageUrl: string | null;
  readonly iconLabel: string; // e.g., "Word Document", derived from progId
}

/** Re-exported from @mog-sdk/contracts/floating-objects (canonical source). */
export type { LineEndSize, LineEndType };

export interface ConnectorData {
  readonly shapeType: string;
  readonly startConnection?: { readonly shapeId: string; readonly siteIndex: number };
  readonly endConnection?: { readonly shapeId: string; readonly siteIndex: number };
  readonly headEnd?: {
    readonly type: LineEndType;
    readonly width?: LineEndSize;
    readonly length?: LineEndSize;
  };
  readonly tailEnd?: {
    readonly type: LineEndType;
    readonly width?: LineEndSize;
    readonly length?: LineEndSize;
  };
  readonly outline?: ObjectBorderConfig;
  readonly fill?: ObjectFillConfig;
}

// =============================================================================
// Shared Configuration Types
// =============================================================================

export interface ObjectFillConfig {
  readonly type: 'none' | 'solid' | 'gradient';
  readonly color?: string;
  readonly gradient?: {
    readonly type: 'linear' | 'radial';
    readonly angle?: number;
    readonly stops: ReadonlyArray<{ offset: number; color: string }>;
  };
}

export interface ObjectBorderConfig {
  readonly style: string;
  readonly color: string;
  readonly width: number;
}

// =============================================================================
// Scene Object — Discriminated Union
// =============================================================================

export interface SceneObjectBase {
  readonly id: string;
  readonly bounds: Rect;
  readonly zIndex: number;
  readonly visible: boolean;
  readonly groupId: string | null;
  readonly rotation?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
}

export interface PictureScene extends SceneObjectBase {
  readonly type: 'picture';
  readonly data: PictureData;
}

export interface TextboxScene extends SceneObjectBase {
  readonly type: 'textbox';
  readonly data: TextboxData;
}

export interface ShapeScene extends SceneObjectBase {
  readonly type: 'shape';
  readonly data: ShapeData;
}

export interface ChartScene extends SceneObjectBase {
  readonly type: 'chart';
  readonly data: ChartData;
}

export interface InkScene extends SceneObjectBase {
  readonly type: 'ink';
  readonly data: InkData;
}

export interface EquationScene extends SceneObjectBase {
  readonly type: 'equation';
  readonly data: EquationData;
}

export interface DiagramScene extends SceneObjectBase {
  readonly type: 'diagram';
  readonly data: DiagramData;
}

export interface ConnectorScene extends SceneObjectBase {
  readonly type: 'connector';
  readonly data: ConnectorData;
}

export interface OleObjectScene extends SceneObjectBase {
  readonly type: 'oleObject';
  readonly data: OleObjectData;
}

export type SceneObject =
  | PictureScene
  | TextboxScene
  | ShapeScene
  | ConnectorScene
  | ChartScene
  | InkScene
  | EquationScene
  | DiagramScene
  | OleObjectScene;

export type SceneObjectType = SceneObject['type'];

// =============================================================================
// Hit Region Types
// =============================================================================

export type ObjectHitRegion =
  | 'body'
  | 'resize-nw'
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  | 'rotation'
  | 'warp-adjust';
