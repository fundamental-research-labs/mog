/**
 * @jest-environment jsdom
 */
import type { SheetOverlayOptions } from '../capability-interfaces';
import { SheetViewOverlays } from '../capabilities/overlays';

function makeOptions(overrides?: Partial<SheetOverlayOptions>): SheetOverlayOptions {
  return {
    anchor: { type: 'cell', row: 0, col: 0 },
    placement: 'bottom',
    ...overrides,
  };
}

describe('SheetViewOverlays', () => {
  let container: HTMLElement;
  let overlays: SheetViewOverlays;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    overlays = new SheetViewOverlays({ getContainer: () => container });
  });

  afterEach(() => {
    container.remove();
  });

  it('mount appends the element inside a positioned wrapper', () => {
    const el = document.createElement('span');
    el.textContent = 'tooltip';

    overlays.mount(el, makeOptions());

    expect(container.children).toHaveLength(1);
    const wrapper = container.children[0] as HTMLElement;
    expect(wrapper.style.position).toBe('absolute');
    expect(wrapper.style.pointerEvents).toBe('auto');
    expect(wrapper.contains(el)).toBe(true);
  });

  it('handle.dispose removes the wrapper from the container', () => {
    const el = document.createElement('span');
    const handle = overlays.mount(el, makeOptions());

    expect(container.children).toHaveLength(1);

    handle.dispose();
    expect(container.children).toHaveLength(0);
  });

  it('handle.dispose is idempotent', () => {
    const el = document.createElement('span');
    const handle = overlays.mount(el, makeOptions());

    handle.dispose();
    handle.dispose(); // should not throw

    expect(container.children).toHaveLength(0);
  });

  it('handle.update changes options', () => {
    const el = document.createElement('span');
    const handle = overlays.mount(el, makeOptions({ placement: 'bottom' }));

    handle.update({ placement: 'top' });

    // We can't directly inspect private state, but the update should not throw
    // and the overlay should still exist
    expect(container.children).toHaveLength(1);
  });

  it('positions cell-anchored overlays from resolved viewport rects', () => {
    overlays = new SheetViewOverlays({
      getContainer: () => container,
      resolveAnchorRects: () => [{ x: 20, y: 30, width: 80, height: 24 }],
    });
    const el = document.createElement('span');

    overlays.mount(el, makeOptions({ placement: 'bottom-start' }));

    const wrapper = container.children[0] as HTMLElement;
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.top).toBe('54px');
    expect(wrapper.style.display).toBe('');
  });

  it('repositions overlays when options update', () => {
    overlays = new SheetViewOverlays({
      getContainer: () => container,
      resolveAnchorRects: () => [{ x: 20, y: 30, width: 80, height: 24 }],
    });
    const el = document.createElement('span');
    const handle = overlays.mount(el, makeOptions({ placement: 'bottom-start' }));

    handle.update({ placement: 'top-start' });

    const wrapper = container.children[0] as HTMLElement;
    expect(wrapper.style.left).toBe('20px');
    expect(wrapper.style.top).toBe('30px');
  });

  it('dismisses overlays that opt into scroll dismissal', () => {
    const el = document.createElement('span');
    overlays.mount(el, makeOptions({ dismissOnScroll: true }));

    overlays.handleScroll();

    expect(container.children).toHaveLength(0);
  });

  it('disposeAll removes all overlays', () => {
    const el1 = document.createElement('span');
    const el2 = document.createElement('span');
    overlays.mount(el1, makeOptions());
    overlays.mount(el2, makeOptions());

    expect(container.children).toHaveLength(2);

    overlays.disposeAll();
    expect(container.children).toHaveLength(0);
  });

  it('multiple overlays are independent', () => {
    const el1 = document.createElement('span');
    const el2 = document.createElement('span');
    const h1 = overlays.mount(el1, makeOptions());
    overlays.mount(el2, makeOptions());

    h1.dispose();

    expect(container.children).toHaveLength(1);
    // The remaining wrapper should contain el2
    expect(container.children[0].contains(el2)).toBe(true);
  });

  it('wrapper has z-index set', () => {
    const el = document.createElement('span');
    overlays.mount(el, makeOptions());

    const wrapper = container.children[0] as HTMLElement;
    expect(wrapper.style.zIndex).toBe('1000');
  });
});
