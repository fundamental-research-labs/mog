/**
 * @jest-environment jsdom
 */
import type { SheetDecorationSpec } from '../capability-interfaces';
import { SheetViewDecorations } from '../capabilities/decorations';

function makeSpec(overrides?: Partial<SheetDecorationSpec>): SheetDecorationSpec {
  return {
    anchor: { type: 'cell', row: 0, col: 0 },
    kind: 'fill',
    style: { color: '#ff0000' },
    ...overrides,
  };
}

describe('SheetViewDecorations', () => {
  let decorations: SheetViewDecorations;

  beforeEach(() => {
    decorations = new SheetViewDecorations();
  });

  it('add returns a handle with a unique id', () => {
    const h1 = decorations.add(makeSpec());
    const h2 = decorations.add(makeSpec());

    expect(h1.id).toBeTruthy();
    expect(h2.id).toBeTruthy();
    expect(h1.id).not.toBe(h2.id);
  });

  it('added decorations appear in the snapshot', () => {
    decorations.add(makeSpec());
    decorations.add(makeSpec({ kind: 'border' }));

    const snapshot = decorations.getSnapshot();
    expect(snapshot.size).toBe(2);
  });

  it('dispose removes a decoration from the snapshot', () => {
    const handle = decorations.add(makeSpec());
    expect(decorations.getSnapshot().size).toBe(1);

    handle.dispose();
    expect(decorations.getSnapshot().size).toBe(0);
  });

  it('remove by id removes the decoration', () => {
    const handle = decorations.add(makeSpec());
    decorations.remove(handle.id);

    expect(decorations.getSnapshot().size).toBe(0);
  });

  it('remove with unknown id does not throw', () => {
    expect(() => decorations.remove('nonexistent')).not.toThrow();
  });

  it('removeGroup removes only matching decorations', () => {
    decorations.add(makeSpec({ group: 'search' }));
    decorations.add(makeSpec({ group: 'search' }));
    decorations.add(makeSpec({ group: 'collab' }));

    decorations.removeGroup('search');

    const snapshot = decorations.getSnapshot();
    expect(snapshot.size).toBe(1);
    const remaining = [...snapshot.values()][0];
    expect(remaining.spec.group).toBe('collab');
  });

  it('clear removes all decorations', () => {
    decorations.add(makeSpec());
    decorations.add(makeSpec());
    decorations.add(makeSpec());

    decorations.clear();

    expect(decorations.getSnapshot().size).toBe(0);
  });

  it('handle.update changes kind', () => {
    const handle = decorations.add(makeSpec({ kind: 'fill' }));
    handle.update({ kind: 'border' });

    const entry = decorations.getSnapshot().get(handle.id);
    expect(entry?.spec.kind).toBe('border');
  });

  it('handle.update merges style', () => {
    const handle = decorations.add(makeSpec({ style: { color: '#ff0000', opacity: 0.5 } }));
    handle.update({ style: { color: '#00ff00' } });

    const entry = decorations.getSnapshot().get(handle.id);
    expect(entry?.spec.style?.color).toBe('#00ff00');
    expect(entry?.spec.style?.opacity).toBe(0.5);
  });

  it('handle.update changes group', () => {
    const handle = decorations.add(makeSpec({ group: 'a' }));
    handle.update({ group: 'b' });

    const entry = decorations.getSnapshot().get(handle.id);
    expect(entry?.spec.group).toBe('b');
  });

  it('handle.update changes animation', () => {
    const handle = decorations.add(makeSpec());
    handle.update({ animation: { preset: 'pulse', durationMs: 500 } });

    const entry = decorations.getSnapshot().get(handle.id);
    expect(entry?.spec.animation?.preset).toBe('pulse');
  });

  it('handle.update on disposed handle is a no-op', () => {
    const handle = decorations.add(makeSpec({ kind: 'fill' }));
    handle.dispose();

    // Should not throw
    expect(() => handle.update({ kind: 'border' })).not.toThrow();
    expect(decorations.getSnapshot().size).toBe(0);
  });

  it('add clones the spec so mutations to the original do not affect the store', () => {
    const spec = makeSpec({ group: 'original' });
    decorations.add(spec);

    // Mutate the original after passing it in
    (spec as { group: string }).group = 'mutated';

    const entry = [...decorations.getSnapshot().values()][0];
    expect(entry.spec.group).toBe('original');
  });

  it('renders decoration elements when anchored to visible geometry', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const domDecorations = new SheetViewDecorations({
      getContainer: () => container,
      resolveAnchorRects: () => [{ x: 10, y: 20, width: 90, height: 30 }],
    });

    const handle = domDecorations.add(
      makeSpec({ kind: 'border', style: { borderColor: '#00f', borderWidth: 3 } }),
    );

    const el = container.querySelector(
      `[data-mog-sheet-decoration-id="${handle.id}"]`,
    ) as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.width).toBe('90px');
    expect(el.style.height).toBe('30px');
    expect(el.style.border).toBe('3px solid rgb(0, 0, 255)');

    domDecorations.disposeAll();
    container.remove();
  });

  it('refresh updates rendered decoration geometry', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let x = 10;
    const domDecorations = new SheetViewDecorations({
      getContainer: () => container,
      resolveAnchorRects: () => [{ x, y: 20, width: 90, height: 30 }],
    });
    const handle = domDecorations.add(makeSpec());

    x = 40;
    domDecorations.refresh();

    const el = container.querySelector(
      `[data-mog-sheet-decoration-id="${handle.id}"]`,
    ) as HTMLElement;
    expect(el.style.left).toBe('40px');

    domDecorations.disposeAll();
    container.remove();
  });
});
