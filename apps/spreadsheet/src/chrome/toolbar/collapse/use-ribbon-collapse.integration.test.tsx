/**
 * Integration test for progressive, per-group ribbon collapse.
 *
 * Drives the full hook (ResizeObserver width observer + layout-effect
 * convergence) in jsdom. Each mock group stamps the same ladder data attributes
 * a real ToolbarGroup does and reports a width for its currently-assigned mode
 * via `data-w`; the panel's mocked scrollWidth sums those widths. That lets us
 * assert the exact per-group modes the coordinator settles on — the behavior
 * jsdom's lack of real layout otherwise hides.
 */
import { useRef } from 'react';
import { act, render } from '@testing-library/react';

import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import { RibbonCollapseProvider, useRibbonCollapseLevel } from './context';
import { useRibbonCollapse } from './use-ribbon-collapse';

// ---------------------------------------------------------------------------
// Group model
// ---------------------------------------------------------------------------

interface GroupDef {
  key: string;
  priority: number;
  rungs: GroupRenderMode[];
  canHide: boolean;
  widthByMode: Partial<Record<GroupRenderMode, number>>;
}

// A sparse Insert-like tab (as under the public visibility profile, plus the
// low-priority groups the user said must not disappear).
const INSERT_DEFS: GroupDef[] = [
  { key: 'tables', priority: 2, rungs: ['full', 'compact', 'icons', 'dropdown'], canHide: false, widthByMode: { full: 180, compact: 140, icons: 110, dropdown: 70 } },
  { key: 'charts', priority: 3, rungs: ['full', 'compact', 'icons', 'dropdown'], canHide: false, widthByMode: { full: 120, compact: 100, icons: 80, dropdown: 70 } },
  { key: 'filters', priority: 4, rungs: ['full', 'dropdown'], canHide: true, widthByMode: { full: 110, dropdown: 70 } },
  { key: 'links', priority: 4, rungs: ['full', 'dropdown'], canHide: true, widthByMode: { full: 70, dropdown: 60 } },
  { key: 'comments', priority: 4, rungs: ['full', 'dropdown'], canHide: true, widthByMode: { full: 90, dropdown: 70 } },
];

// ---------------------------------------------------------------------------
// DOM measurement mocks
// ---------------------------------------------------------------------------

let containerWidth = 1920;
let resizeCallbacks: ResizeObserverCallback[] = [];

const originalRO = globalThis.ResizeObserver;
const originalGBCR = HTMLElement.prototype.getBoundingClientRect;
const originalScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

beforeEach(() => {
  resizeCallbacks = [];
  class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      resizeCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: containerWidth, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      // Sum the reported widths of the visible group children.
      let sum = 0;
      for (const el of Array.from(this.querySelectorAll<HTMLElement>('[data-w]'))) {
        sum += Number(el.getAttribute('data-w') ?? '0');
      }
      return sum;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return containerWidth;
    },
  });
});

afterEach(() => {
  globalThis.ResizeObserver = originalRO;
  HTMLElement.prototype.getBoundingClientRect = originalGBCR;
  if (originalScrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
});

function resizeTo(width: number) {
  containerWidth = width;
  act(() => {
    for (const cb of resizeCallbacks) {
      cb([{ contentRect: { width } }] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    }
  });
}

// ---------------------------------------------------------------------------
// Harness (mini TabbedToolbar + ToolbarGroup)
// ---------------------------------------------------------------------------

let latestModes: Record<string, GroupRenderMode> = {};

function MockGroup({ def }: { def: GroupDef }) {
  const { groupModes } = useRibbonCollapseLevel();
  const mode = groupModes[def.key] ?? def.rungs[0];
  if (mode === 'hidden') return null; // hidden groups render no element
  return (
    <div
      data-ribbon-group-key={def.key}
      data-ribbon-priority={String(def.priority)}
      data-ribbon-rungs={def.rungs.join(',')}
      data-ribbon-can-hide={def.canHide ? '1' : '0'}
      data-w={String(def.widthByMode[mode] ?? 0)}
    />
  );
}

function Harness({ defs, contentKey }: { defs: GroupDef[]; contentKey?: unknown }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const state = useRibbonCollapse(containerRef, panelRef, contentKey);
  latestModes = state.groupModes;
  return (
    <div ref={containerRef}>
      <RibbonCollapseProvider value={state}>
        <div ref={panelRef} data-testid="panel">
          {defs.map((d) => (
            <MockGroup key={d.key} def={d} />
          ))}
        </div>
      </RibbonCollapseProvider>
    </div>
  );
}

/** Resolve the effective mode for a group (absent assignment ⇒ most-expanded). */
function modeOf(key: string): GroupRenderMode {
  const def = INSERT_DEFS.find((d) => d.key === key)!;
  return latestModes[key] ?? def.rungs[0];
}

describe('progressive per-group ribbon collapse', () => {
  it('collapses one group at a time, least-important first, filling the space', () => {
    // Full total = 570; container 560 overflows by only 10. A single low-priority
    // group collapsing should be enough — the rest stay fully expanded.
    containerWidth = 560;
    render(<Harness defs={INSERT_DEFS} />);

    expect(modeOf('tables')).toBe('full'); // major groups untouched
    expect(modeOf('charts')).toBe('full');
    expect(modeOf('filters')).toBe('full');
    expect(modeOf('links')).toBe('full');
    // Only the right-most least-important group collapses.
    expect(modeOf('comments')).toBe('dropdown');
    // Nothing disappears.
    expect(Object.values(latestModes)).not.toContain('hidden');
  });

  it('never hides a group just because the window is narrow (degrades to dropdowns first)', () => {
    containerWidth = 400;
    render(<Harness defs={INSERT_DEFS} />);

    // Every group is still present — low-priority ones as dropdowns, and even
    // the most-important group only steps partway down its ladder.
    expect(Object.values(latestModes)).not.toContain('hidden');
    expect(modeOf('filters')).toBe('dropdown');
    expect(modeOf('links')).toBe('dropdown');
    expect(modeOf('comments')).toBe('dropdown');
    expect(modeOf('charts')).toBe('dropdown');
    expect(modeOf('tables')).toBe('icons'); // important group not fully collapsed
  });

  it('hides groups only when it is physically impossible to fit them, important ones last', () => {
    // 200px cannot fit five dropdowns; low-priority groups get hidden, but the
    // major groups (canHide=false) remain visible.
    containerWidth = 200;
    render(<Harness defs={INSERT_DEFS} />);

    expect(modeOf('tables')).toBe('dropdown'); // never hidden
    expect(modeOf('charts')).toBe('dropdown'); // never hidden
    expect(latestModes.comments).toBe('hidden');
    expect(latestModes.links).toBe('hidden');
    expect(latestModes.filters).toBe('hidden');
  });

  it('keeps everything fully expanded when there is ample room', () => {
    containerWidth = 2000;
    render(<Harness defs={INSERT_DEFS} />);

    expect(latestModes).toEqual({}); // no group collapsed
  });

  it('applies collapse immediately on tab switch, even from a fully-expanded tab (no resize needed)', () => {
    containerWidth = 560;
    // A sparse tab that fits fully → nothing collapsed (groupModes === {}).
    const sparse: GroupDef[] = [
      { key: 'a', priority: 2, rungs: ['full', 'dropdown'], canHide: false, widthByMode: { full: 180, dropdown: 70 } },
      { key: 'b', priority: 3, rungs: ['full', 'dropdown'], canHide: false, widthByMode: { full: 120, dropdown: 70 } },
    ];
    const { rerender } = render(<Harness defs={sparse} contentKey="sparse-tab" />);
    expect(latestModes).toEqual({});

    // Switch to a denser tab (new contentKey) at the SAME width — no resize.
    rerender(<Harness defs={INSERT_DEFS} contentKey="dense-tab" />);

    // The dense tab overflows 560 and must collapse right away.
    expect(modeOf('comments')).toBe('dropdown');
    expect(Object.values(latestModes)).not.toContain('hidden');
    // No stale keys from the previous tab leak in.
    expect(latestModes.a).toBeUndefined();
    expect(latestModes.b).toBeUndefined();
  });

  it('reclaims space for important groups when the window widens', () => {
    containerWidth = 400;
    render(<Harness defs={INSERT_DEFS} />);
    expect(modeOf('tables')).toBe('icons');

    resizeTo(2000);
    expect(latestModes).toEqual({}); // fully expanded again

    resizeTo(560);
    // Back to the minimal collapse that fits 560.
    expect(modeOf('comments')).toBe('dropdown');
    expect(modeOf('tables')).toBe('full');
  });
});
