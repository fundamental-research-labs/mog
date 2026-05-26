/**
 * Read-only, synchronous access to the rendering scene graph.
 *
 * The scene graph is the renderer's authoritative source for what is
 * currently drawn on the floating-object layer. Each `SceneObjectSnapshot`
 * mirrors the live scene-graph entry, so consumers see exactly what the
 * canvas painted on the most recent frame — not what the kernel "knows
 * about", which can drift if the parser dropped an entry or a bridge
 * failed to build a renderable.
 *
 * Used by:
 * - Devtools / app-eval rendered-state readbacks (`__dt.getRenderedDrawings`)
 *   to validate that drawings made it from the kernel into the canvas.
 *
 * Do NOT use for:
 * - Persistence (the scene graph is render-only — it does not capture
 *   anchor metadata, alt text, or other XLSX fields).
 * - Mutation (writes go through DrawingOps / FloatingObjectManager).
 *
 * The shape is deliberately structural and minimal. The full
 * `SceneObject` discriminated union lives in `canvas/drawing-canvas` and
 * carries renderer-internal payloads (3-D scenes, ink strokes,
 * connector geometry) that have no place in the public contract.
 */

export interface SceneObjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Public, read-only snapshot of a scene-graph entry.
 *
 * Field set is the intersection of what the renderer guarantees on every
 * SceneObject (see `canvas/drawing-canvas/src/scene/types.ts → SceneObjectBase`)
 * plus the type discriminator and an opaque `data` payload that consumers
 * can probe but not type.
 */
export interface SceneObjectSnapshot {
  readonly id: string;
  /**
   * Renderer-internal scene type: `'picture' | 'chart' | 'shape' |
   * 'textbox' | 'connector' | 'ink' | 'equation' | 'diagram' |
   * 'oleObject'`. Consumers map this to the user-visible drawing kind
   * (image, chart, textEffects, etc.) themselves — that mapping is a
   * scenario-side concern, not the renderer's.
   */
  readonly type: string;
  readonly bounds: SceneObjectBounds;
  readonly zIndex: number;
  readonly visible: boolean;
  readonly groupId: string | null;
  readonly rotation?: number;
  readonly locked?: boolean;
  readonly opacity?: number;
  /**
   * Per-type data payload. Untyped on purpose: the discriminated union
   * lives in `canvas/drawing-canvas` and is not part of the public
   * contract. Consumers that probe this should defensively check fields.
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * Read-only accessor over the rendering scene graph.
 *
 * Implementations are expected to return live snapshots — calling
 * `getByZOrder()` twice during the same frame returns the same set; a
 * subsequent frame may reflect mutations.
 */
export interface ISceneGraphReader {
  /** Every object, sorted ascending by zIndex. */
  getByZOrder(): ReadonlyArray<SceneObjectSnapshot>;

  /** Single object by id, or null if absent. */
  getById(id: string): SceneObjectSnapshot | null;
}
