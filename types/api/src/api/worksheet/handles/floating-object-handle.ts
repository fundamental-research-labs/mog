/**
 * FloatingObjectHandle — narrowing augmentation for the base handle.
 *
 * The core interface is declared in `./types.ts` so subtype handles can
 * extend it without importing this file (which imports each subtype for
 * the discriminated-union narrowing methods). Here we augment the interface
 * with `isShape()`, `asShape()`, etc. — one-way aggregation of the subtype
 * union. Runtime module edges only flow aggregator -> subtypes; subtypes
 * never import back through this file. This module is also kept as the
 * canonical re-export path for external consumers that import
 * `@mog-sdk/contracts/api/worksheet/handles/floating-object-handle`.
 */
import type { ChartHandle } from './chart-handle';
import type { ConnectorHandle } from './connector-handle';
import type { DrawingHandle } from './drawing-handle';
import type { EquationHandle } from './equation-handle';
import type { OleObjectHandle } from './ole-object-handle';
import type { PictureHandle } from './picture-handle';
import type { ShapeHandle } from './shape-handle';
import type { SlicerHandle } from './slicer-handle';
import type { DiagramHandle } from './diagram-handle';
import type { TextBoxHandle } from './textbox-handle';
import type { TextEffectHandle } from './text-effects-handle';

// Augment the interface declared in `./types.ts` with narrowing methods.
// Declaration merging means this augmentation contributes to the single
// `FloatingObjectHandle` interface — consumers that import it from `./types`
// or from this file see the merged shape.
declare module './types' {
  interface FloatingObjectHandle {
    // -- Type narrowing ----------------------------------------
    isShape(): this is ShapeHandle;
    isPicture(): this is PictureHandle;
    isTextBox(): this is TextBoxHandle;
    isDrawing(): this is DrawingHandle;
    isEquation(): this is EquationHandle;
    isTextEffect(): this is TextEffectHandle;
    isDiagram(): this is DiagramHandle;
    isChart(): this is ChartHandle;
    isConnector(): this is ConnectorHandle;
    isOleObject(): this is OleObjectHandle;
    isSlicer(): this is SlicerHandle;

    /** Narrowing with throw — use when type is expected. */
    asShape(): ShapeHandle;
    asPicture(): PictureHandle;
    asTextBox(): TextBoxHandle;
    asDrawing(): DrawingHandle;
    asEquation(): EquationHandle;
    asTextEffect(): TextEffectHandle;
    asDiagram(): DiagramHandle;
    asChart(): ChartHandle;
    asConnector(): ConnectorHandle;
    asOleObject(): OleObjectHandle;
    asSlicer(): SlicerHandle;
  }
}

export type { FloatingObjectHandle } from './types';
