/**
 * `__dt` input-mode +
 * lifecycle readback gate.
 *
 * Validates the three `__dt` extensions added for Richard's plan:
 *
 *   - `getCellEditorBuffer()` — returns `activeElement.value` only when
 *     the active element is the cell editor input/textarea, else null.
 *     The test sets up a fake document with various activeElement
 *     candidates to assert the precondition gates.
 *
 *   - `getOverlayBounds(overlayId)` — returns the overlay's
 *     `getBoundingClientRect()`, the nearest clipping container's
 *     bounds, and the `allChildrenVisible` predicate. The test exercises
 *     the no-overlay, fully-visible, and clipped-children paths.
 *
 *   - `persistenceEnabled` — boolean getter reading
 *     `window.__SHELL__.persistenceEnabled`. Defaults `false` in the
 *     current build (IndexedDB hydration hasn't shipped); the test
 *     covers both branches via the global flag.
 *
 * Run via: `bun test --conditions development tools/devtools/src/__tests__/dt-input-mode.test.ts`.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createConsoleAPI } from '../console/api';
import { EventStore } from '../event-store';
import { ActorRecorder } from '../recorders/actor-recorder';
import type { DevToolsConsoleAPI } from '../types';

// ── Test scaffolding ──

interface FakeElement {
  tagName: string;
  value?: string;
  attrs: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  rect: { x: number; y: number; w: number; h: number };
  styleOverflow?: string;
  /** Marker matched by `closest('[data-testid=...]')` when set. */
  closestTestId?: string;
  classList: Set<string>;
}

function makeElement(opts: Partial<FakeElement>): FakeElement {
  const el: FakeElement = {
    tagName: opts.tagName ?? 'DIV',
    value: opts.value,
    attrs: opts.attrs ?? {},
    children: opts.children ?? [],
    parent: opts.parent ?? null,
    rect: opts.rect ?? { x: 0, y: 0, w: 100, h: 100 },
    styleOverflow: opts.styleOverflow,
    closestTestId: opts.closestTestId,
    classList: new Set(opts.classList ?? []),
  };
  for (const c of el.children) c.parent = el;
  return el;
}

/** Wire a fake DOM where querySelector resolves test-id selectors and the
 *  active element is the requested input. */
function setupDom(opts: {
  activeElement?: FakeElement | null;
  overlay?: { id: string; element: FakeElement } | null;
  shell?: { persistenceEnabled?: unknown } | null;
}): { cleanup: () => void } {
  const g = globalThis as Record<string, unknown> & {
    window?: Record<string, unknown>;
    document?: unknown;
  };
  const previousWindow = g.window;
  const previousDocument = g.document;

  const overlay = opts.overlay ?? null;

  const docLike = {
    activeElement: opts.activeElement ?? null,
    body: { children: [] },
    querySelector(selector: string) {
      // Match `[data-testid="overlay-<id>"]` or
      // `[data-overlay-id="<id>"]` — the two paths the implementation
      // tries.
      if (overlay) {
        if (
          selector === `[data-testid="overlay-${overlay.id}"]` ||
          selector === `[data-overlay-id="${overlay.id}"]`
        ) {
          return wrapElement(overlay.element);
        }
      }
      return null;
    },
  };

  const win: Record<string, unknown> = {
    addEventListener: () => {},
    removeEventListener: () => {},
    document: docLike,
    innerWidth: 1024,
    innerHeight: 768,
    __SHELL__: opts.shell ?? null,
    getComputedStyle(el: { _styleOverflow?: string }): CSSStyleDeclaration {
      const overflow = el?._styleOverflow ?? 'visible';
      return {
        overflow,
        overflowX: overflow,
        overflowY: overflow,
      } as CSSStyleDeclaration;
    },
  };

  g.window = win;
  g.document = docLike;

  return {
    cleanup() {
      if (previousWindow === undefined) delete g.window;
      else g.window = previousWindow;
      if (previousDocument === undefined) delete g.document;
      else g.document = previousDocument;
    },
  };
}

/** Wrap a FakeElement so the api.ts code path can call DOM-y methods.
 *
 *  Wrapping is per-element + lazy on `parentElement` and `children` access
 *  so a parent ↔ child cycle doesn't blow the stack. We memoize via a
 *  WeakMap keyed on the FakeElement so identity comparisons (`!==
 *  doc.body`) stay stable when the api walks up the tree. */
const wrapCache = new WeakMap<FakeElement, unknown>();
function wrapElement(el: FakeElement): unknown {
  const cached = wrapCache.get(el);
  if (cached) return cached;
  const wrapped: Record<string, unknown> = {
    tagName: el.tagName,
    value: el.value,
    _styleOverflow: el.styleOverflow,
    classList: el.classList,
    getAttribute(name: string): string | null {
      return el.attrs[name] ?? null;
    },
    closest(selector: string): unknown | null {
      let cur: FakeElement | null = el;
      while (cur) {
        if (selector.startsWith('[data-testid="') && selector.endsWith('"]')) {
          const id = selector.slice('[data-testid="'.length, -2);
          if (cur.attrs['data-testid'] === id) return wrapElement(cur);
          if (cur.closestTestId === id) return wrapElement(cur);
        } else if (selector.startsWith('.')) {
          const cls = selector.slice(1);
          if (cur.classList.has(cls)) return wrapElement(cur);
        }
        cur = cur.parent;
      }
      return null;
    },
    getBoundingClientRect(): DOMRect {
      return {
        x: el.rect.x,
        y: el.rect.y,
        left: el.rect.x,
        top: el.rect.y,
        right: el.rect.x + el.rect.w,
        bottom: el.rect.y + el.rect.h,
        width: el.rect.w,
        height: el.rect.h,
        toJSON: () => ({}),
      } as DOMRect;
    },
  };
  Object.defineProperty(wrapped, 'parentElement', {
    get() {
      return el.parent ? wrapElement(el.parent) : null;
    },
  });
  Object.defineProperty(wrapped, 'children', {
    get() {
      return el.children.map((c) => wrapElement(c));
    },
  });
  wrapCache.set(el, wrapped);
  return wrapped;
}

interface RuntimeBundle {
  api: DevToolsConsoleAPI;
  cleanup: () => void;
}

function setupRuntime(opts: {
  activeElement?: FakeElement | null;
  overlay?: { id: string; element: FakeElement } | null;
  shell?: { persistenceEnabled?: unknown } | null;
}): RuntimeBundle {
  const dom = setupDom(opts);
  const store = new EventStore();
  store.enable();
  const actorRecorder = new ActorRecorder(store);
  const api = createConsoleAPI(store, actorRecorder);
  return { api, cleanup: dom.cleanup };
}

// ── getCellEditorBuffer ──

describe('__dt.getCellEditorBuffer (Richard §0.1)', () => {
  let runtime: RuntimeBundle | null = null;
  beforeEach(() => {
    runtime = null;
  });
  afterEach(() => {
    runtime?.cleanup();
  });

  test('returns null when no element is focused', () => {
    runtime = setupRuntime({ activeElement: null });
    expect(runtime.api.getCellEditorBuffer()).toBeNull();
  });

  test('returns null when active element is not the cell editor (e.g. ribbon button)', () => {
    const button = makeElement({
      tagName: 'BUTTON',
      attrs: { 'data-testid': 'ribbon-button-bold' },
    });
    // Wrap so api can call methods directly off activeElement.
    runtime = setupRuntime({ activeElement: button });
    // The implementation reads activeElement.tagName / value /
    // closest — wrap before handing it in.
    (globalThis as { document?: { activeElement?: unknown } }).document!.activeElement =
      wrapElement(button);
    expect(runtime.api.getCellEditorBuffer()).toBeNull();
  });

  test('returns the textarea value when active element is the cell editor', () => {
    const editor = makeElement({
      tagName: 'TEXTAREA',
      value: 'hello',
      attrs: { 'data-testid': 'inline-cell-editor' },
    });
    runtime = setupRuntime({ activeElement: editor });
    (globalThis as { document?: { activeElement?: unknown } }).document!.activeElement =
      wrapElement(editor);
    expect(runtime.api.getCellEditorBuffer()).toBe('hello');
  });

  test('returns "" when the active editor input is empty (smoking-gun read for #110)', () => {
    const editor = makeElement({
      tagName: 'INPUT',
      value: '',
      attrs: { 'data-testid': 'inline-cell-editor' },
    });
    runtime = setupRuntime({ activeElement: editor });
    (globalThis as { document?: { activeElement?: unknown } }).document!.activeElement =
      wrapElement(editor);
    expect(runtime.api.getCellEditorBuffer()).toBe('');
  });

  test('returns null when active is an INPUT but not inside the cell-editor wrapper', () => {
    const stray = makeElement({
      tagName: 'INPUT',
      value: 'foo',
      attrs: {},
    });
    runtime = setupRuntime({ activeElement: stray });
    (globalThis as { document?: { activeElement?: unknown } }).document!.activeElement =
      wrapElement(stray);
    expect(runtime.api.getCellEditorBuffer()).toBeNull();
  });

  test('finds the editor via the wrapper class fallback (no test-id)', () => {
    const editor = makeElement({
      tagName: 'TEXTAREA',
      value: '=A1+B1',
      attrs: {},
      closestTestId: 'inline-cell-editor',
    });
    runtime = setupRuntime({ activeElement: editor });
    (globalThis as { document?: { activeElement?: unknown } }).document!.activeElement =
      wrapElement(editor);
    expect(runtime.api.getCellEditorBuffer()).toBe('=A1+B1');
  });
});

// ── getOverlayBounds ──

describe('__dt.getOverlayBounds (Richard §0.1)', () => {
  let runtime: RuntimeBundle | null = null;
  beforeEach(() => {
    runtime = null;
  });
  afterEach(() => {
    runtime?.cleanup();
  });

  test('returns null when the overlay is not mounted', () => {
    runtime = setupRuntime({});
    expect(runtime.api.getOverlayBounds('alt-hints')).toBeNull();
  });

  test('returns bounds + allChildrenVisible:true when every child fits the viewport', () => {
    const child1 = makeElement({
      tagName: 'DIV',
      rect: { x: 10, y: 10, w: 30, h: 20 },
    });
    const child2 = makeElement({
      tagName: 'DIV',
      rect: { x: 60, y: 10, w: 30, h: 20 },
    });
    const overlay = makeElement({
      tagName: 'DIV',
      attrs: { 'data-testid': 'overlay-alt-hints' },
      rect: { x: 0, y: 0, w: 100, h: 50 },
      children: [child1, child2],
    });
    runtime = setupRuntime({ overlay: { id: 'alt-hints', element: overlay } });
    const bounds = runtime.api.getOverlayBounds('alt-hints');
    expect(bounds).not.toBeNull();
    expect(bounds!.domRect).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(bounds!.clippedToContainer).toBeNull();
    expect(bounds!.allChildrenVisible).toBe(true);
  });

  test('reports clippedToContainer when an ancestor has overflow:hidden', () => {
    const child = makeElement({
      tagName: 'DIV',
      rect: { x: 5, y: 5, w: 20, h: 20 },
    });
    const overlay = makeElement({
      tagName: 'DIV',
      attrs: { 'data-testid': 'overlay-alt-hints' },
      rect: { x: 0, y: 0, w: 100, h: 50 },
      children: [child],
    });
    const container = makeElement({
      tagName: 'DIV',
      rect: { x: 0, y: 0, w: 50, h: 30 },
      styleOverflow: 'hidden',
      children: [overlay],
    });
    overlay.parent = container;
    runtime = setupRuntime({ overlay: { id: 'alt-hints', element: overlay } });
    const bounds = runtime.api.getOverlayBounds('alt-hints');
    expect(bounds).not.toBeNull();
    expect(bounds!.clippedToContainer).toEqual({ x: 0, y: 0, w: 50, h: 30 });
    // child rect (5,5,20,20) ⊂ container (0,0,50,30) → fully visible.
    expect(bounds!.allChildrenVisible).toBe(true);
  });

  test('flags allChildrenVisible:false when a child sits outside the clip rect (#118 case)', () => {
    const visibleChild = makeElement({
      tagName: 'DIV',
      rect: { x: 5, y: 5, w: 20, h: 20 },
    });
    const clippedChild = makeElement({
      tagName: 'DIV',
      // Sits at x=200 — entirely outside the 0..50 clip range.
      rect: { x: 200, y: 5, w: 20, h: 20 },
    });
    const overlay = makeElement({
      tagName: 'DIV',
      attrs: { 'data-testid': 'overlay-alt-hints' },
      rect: { x: 0, y: 0, w: 240, h: 50 },
      children: [visibleChild, clippedChild],
    });
    const container = makeElement({
      tagName: 'DIV',
      rect: { x: 0, y: 0, w: 50, h: 30 },
      styleOverflow: 'hidden',
      children: [overlay],
    });
    overlay.parent = container;
    runtime = setupRuntime({ overlay: { id: 'alt-hints', element: overlay } });
    const bounds = runtime.api.getOverlayBounds('alt-hints');
    expect(bounds).not.toBeNull();
    expect(bounds!.allChildrenVisible).toBe(false);
  });

  test('falls back to data-overlay-id when data-testid is absent', () => {
    const overlay = makeElement({
      tagName: 'DIV',
      attrs: { 'data-overlay-id': 'format-cells' },
      rect: { x: 0, y: 0, w: 200, h: 200 },
    });
    runtime = setupRuntime({
      overlay: { id: 'format-cells', element: overlay },
    });
    const bounds = runtime.api.getOverlayBounds('format-cells');
    expect(bounds).not.toBeNull();
    expect(bounds!.domRect).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });
});

// ── persistenceEnabled ──

describe('__dt.persistenceEnabled (Richard §0.2)', () => {
  let runtime: RuntimeBundle | null = null;
  beforeEach(() => {
    runtime = null;
  });
  afterEach(() => {
    runtime?.cleanup();
  });

  test('reads false against the current build (IndexedDB hydration not shipped)', () => {
    // No __SHELL__.persistenceEnabled set — the gate's default state.
    runtime = setupRuntime({ shell: null });
    expect(runtime.api.persistenceEnabled).toBe(false);
  });

  test('reads false when __SHELL__.persistenceEnabled is undefined', () => {
    runtime = setupRuntime({ shell: {} });
    expect(runtime.api.persistenceEnabled).toBe(false);
  });

  test('reads true when __SHELL__.persistenceEnabled === true', () => {
    runtime = setupRuntime({ shell: { persistenceEnabled: true } });
    expect(runtime.api.persistenceEnabled).toBe(true);
  });

  test('coerces non-boolean truthy values to false (strict === true gate)', () => {
    // The gate is strict-equality: anything other than literal `true`
    // must read false so a transitional partial-implementation doesn't
    // accidentally flip the contract.
    runtime = setupRuntime({ shell: { persistenceEnabled: 1 as unknown as boolean } });
    expect(runtime.api.persistenceEnabled).toBe(false);
  });
});
