/**
 * Kernel-internal: async writes to floating object persistent state.
 * All operations route through the storage engine (Rust ComputeBridge for
 * spreadsheets). The engine handles anchor resolution, position math, and
 * CRDT updates. Results flow back through EventBus → scene graph patches.
 *
 * Mutations are INTENT, not pixel arithmetic:
 * - "move 50px right" — Rust resolves to new cell anchor
 * - "resize to 200x150" — Rust recalculates end anchor
 * - "rotate to 45°" — Rust stores angle, recomputes bounds
 *
 * NOT exposed to apps layer. Apps use ws.objects.* which delegates here
 * through IFloatingObjectManager.
 *
 * The mutator resolves containerId (sheetId) internally from the object store.
 */
export interface IObjectMutator {
  // ── Spatial mutations (Rust handles anchor math) ────────────
  move(objectId: string, dx: number, dy: number): Promise<boolean>;
  resize(objectId: string, width: number, height: number): Promise<boolean>;
  rotate(objectId: string, angle: number): Promise<boolean>;
  flip(objectId: string, axis: 'horizontal' | 'vertical'): Promise<boolean>;

  // ── Lifecycle mutations ─────────────────────────────────────
  duplicate(objectId: string, offsetX: number, offsetY: number): Promise<string | null>;
  delete(objectId: string): Promise<boolean>;
  deleteMany(objectIds: string[]): Promise<number>;

  // ── Z-order mutations ───────────────────────────────────────
  bringToFront(objectId: string): Promise<boolean>;
  sendToBack(objectId: string): Promise<boolean>;
  bringForward(objectId: string): Promise<boolean>;
  sendBackward(objectId: string): Promise<boolean>;
}
