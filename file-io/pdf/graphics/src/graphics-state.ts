/**
 * GraphicsState — tracks the current graphics state for save/restore.
 *
 * PdfCanvas maintains a stack of GraphicsState objects. Each save() pushes
 * a clone, each restore() pops. This allows us to track the current transform,
 * colors, line style, font, and alpha without querying the PDF backend.
 */

import type { AffineTransform } from '@mog/geometry';
import type { FontHandle } from './types';

/**
 * A snapshot of the current graphics state.
 */
export interface GraphicsState {
  /** Current cumulative transform matrix. */
  transform: AffineTransform;

  /** Fill color [r, g, b] each 0-1. */
  fillColor: [number, number, number];

  /** Stroke color [r, g, b] each 0-1. */
  strokeColor: [number, number, number];

  /** Fill opacity 0.0-1.0. */
  fillAlpha: number;

  /** Stroke opacity 0.0-1.0. */
  strokeAlpha: number;

  /** Line width in points. */
  lineWidth: number;

  /** Dash pattern segments. */
  lineDash: number[];

  /** Dash phase offset. */
  lineDashPhase: number;

  /** Line cap style. */
  lineCap: 'butt' | 'round' | 'square';

  /** Line join style. */
  lineJoin: 'miter' | 'round' | 'bevel';

  /** Current font handle, if set. */
  font: FontHandle | null;

  /** Current font size in points. */
  fontSize: number;
}

/**
 * Create the default initial graphics state.
 */
export function createDefaultState(): GraphicsState {
  return {
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    fillColor: [0, 0, 0],
    strokeColor: [0, 0, 0],
    fillAlpha: 1.0,
    strokeAlpha: 1.0,
    lineWidth: 1.0,
    lineDash: [],
    lineDashPhase: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: null,
    fontSize: 12,
  };
}

/**
 * Deep-clone a GraphicsState for the save stack.
 */
export function cloneState(state: GraphicsState): GraphicsState {
  return {
    transform: { ...state.transform },
    fillColor: [...state.fillColor] as [number, number, number],
    strokeColor: [...state.strokeColor] as [number, number, number],
    fillAlpha: state.fillAlpha,
    strokeAlpha: state.strokeAlpha,
    lineWidth: state.lineWidth,
    lineDash: [...state.lineDash],
    lineDashPhase: state.lineDashPhase,
    lineCap: state.lineCap,
    lineJoin: state.lineJoin,
    font: state.font ? { ...state.font } : null,
    fontSize: state.fontSize,
  };
}

/**
 * Manages a stack of GraphicsState objects.
 */
export class GraphicsStateStack {
  private _current: GraphicsState;
  private _stack: GraphicsState[] = [];

  constructor() {
    this._current = createDefaultState();
  }

  /** Get the current (mutable) state. */
  get current(): GraphicsState {
    return this._current;
  }

  /** Push a copy of the current state onto the stack. */
  save(): void {
    this._stack.push(cloneState(this._current));
  }

  /**
   * Pop the top state and restore it as current.
   * Throws if the stack is empty.
   */
  restore(): void {
    const popped = this._stack.pop();
    if (!popped) {
      throw new Error('GraphicsStateStack: restore() called with empty stack');
    }
    this._current = popped;
  }

  /** Current depth of the save stack. */
  get depth(): number {
    return this._stack.length;
  }

  /** Reset to initial state with empty stack. */
  reset(): void {
    this._current = createDefaultState();
    this._stack = [];
  }
}
