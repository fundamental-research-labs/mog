import type { SpreadsheetDecoration, SpreadsheetDecorationHandle } from './public-types';

export class InternalDecorationHandle implements SpreadsheetDecorationHandle {
  private readonly items = new Map<string, SpreadsheetDecoration & { readonly id: string }>();
  private nextId = 0;

  constructor(private readonly onChange: () => void) {}

  add(decoration: SpreadsheetDecoration): string {
    const id = decoration.id ?? `decoration-${++this.nextId}`;
    this.items.set(id, { ...decoration, id });
    this.onChange();
    return id;
  }

  addMany(decorations: readonly SpreadsheetDecoration[]): readonly string[] {
    const ids = decorations.map((decoration) => {
      const id = decoration.id ?? `decoration-${++this.nextId}`;
      this.items.set(id, { ...decoration, id });
      return id;
    });
    this.onChange();
    return ids;
  }

  clear(id: string): void {
    if (this.items.delete(id)) this.onChange();
  }

  clearGroup(group: string): void {
    let changed = false;
    for (const [id, decoration] of this.items) {
      if (decoration.group === group) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  clearAll(): void {
    if (this.items.size === 0) return;
    this.items.clear();
    this.onChange();
  }

  list(): readonly SpreadsheetDecoration[] {
    return [...this.items.values()].map((item) => ({ ...item }));
  }
}

export function createDecorationPayload(
  handle: SpreadsheetDecorationHandle,
): SpreadsheetDecoration['id'][] {
  return handle.list().map((decoration) => decoration.id);
}
