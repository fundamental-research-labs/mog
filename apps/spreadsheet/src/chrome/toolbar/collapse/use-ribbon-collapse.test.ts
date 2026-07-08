import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import {
  CHARTS_COLLAPSE_CONFIG,
  LINKS_COLLAPSE_CONFIG,
  TABLES_INSERT_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';

import { deriveCollapseLadder } from './collapse-ladder';
import { __testing__ } from './use-ribbon-collapse';

const { pickCollapseStep } = __testing__;

/** Build a group snapshot for pickCollapseStep tests. */
function group(
  key: string,
  priority: number,
  rungs: GroupRenderMode[],
  canHide: boolean,
  current: GroupRenderMode,
  domIndex: number,
) {
  return { key, priority, rungs, canHide, current, domIndex };
}

describe('deriveCollapseLadder', () => {
  it('derives distinct rungs in order and excludes hidden', () => {
    // Tables: full, full, compact, icons, dropdown → never hidden.
    expect(deriveCollapseLadder(TABLES_INSERT_COLLAPSE_CONFIG)).toEqual({
      priority: 2,
      rungs: ['full', 'compact', 'icons', 'dropdown'],
      canHide: false,
    });
  });

  it('marks low-priority groups as hideable with a short ladder', () => {
    // Links: full, dropdown, dropdown, dropdown, hidden.
    expect(deriveCollapseLadder(LINKS_COLLAPSE_CONFIG)).toEqual({
      priority: 4,
      rungs: ['full', 'dropdown'],
      canHide: true,
    });
  });

  it('keeps Charts collapsing to a dropdown but never hidden', () => {
    const ladder = deriveCollapseLadder(CHARTS_COLLAPSE_CONFIG);
    expect(ladder.rungs).toEqual(['full', 'compact', 'icons', 'dropdown']);
    expect(ladder.canHide).toBe(false);
  });

  it('never-collapsing group when no config', () => {
    expect(deriveCollapseLadder(undefined)).toEqual({
      priority: 0,
      rungs: ['full'],
      canHide: false,
    });
  });
});

describe('pickCollapseStep — progressive, priority-ordered', () => {
  const tables = () => group('tables', 2, ['full', 'compact', 'icons', 'dropdown'], false, 'full', 0);
  const charts = () => group('charts', 3, ['full', 'compact', 'icons', 'dropdown'], false, 'full', 1);
  const links = () => group('links', 4, ['full', 'dropdown'], true, 'full', 2);

  it('collapses the least-important group first, one rung at a time', () => {
    // All full → the lowest-priority group (links, priority 4) steps first.
    expect(pickCollapseStep([tables(), charts(), links()])).toEqual({
      key: 'links',
      mode: 'dropdown',
    });
  });

  it('exhausts a group down its ladder before touching a more-important one', () => {
    // links already at its last rung (dropdown); charts (3) is next before tables (2).
    const links2 = group('links', 4, ['full', 'dropdown'], true, 'dropdown', 2);
    expect(pickCollapseStep([tables(), charts(), links2])).toEqual({
      key: 'charts',
      mode: 'compact',
    });
  });

  it('advances one rung at a time (compact → icons), not straight to dropdown', () => {
    const charts2 = group('charts', 3, ['full', 'compact', 'icons', 'dropdown'], false, 'compact', 1);
    const links2 = group('links', 4, ['full', 'dropdown'], true, 'dropdown', 2);
    expect(pickCollapseStep([tables(), charts2, links2])).toEqual({
      key: 'charts',
      mode: 'icons',
    });
  });

  it('only touches the most-important group after all others are fully collapsed', () => {
    const charts2 = group('charts', 3, ['full', 'compact', 'icons', 'dropdown'], false, 'dropdown', 1);
    const links2 = group('links', 4, ['full', 'dropdown'], true, 'dropdown', 2);
    expect(pickCollapseStep([tables(), charts2, links2])).toEqual({
      key: 'tables',
      mode: 'compact',
    });
  });

  it('hides only as a last resort, after every group is at its tightest rung', () => {
    const tables2 = group('tables', 2, ['full', 'compact', 'icons', 'dropdown'], false, 'dropdown', 0);
    const charts2 = group('charts', 3, ['full', 'compact', 'icons', 'dropdown'], false, 'dropdown', 1);
    const links2 = group('links', 4, ['full', 'dropdown'], true, 'dropdown', 2);
    // Everything is at its last non-hidden rung → hide the least-important
    // hideable group (links). Tables/Charts (canHide=false) are never chosen.
    expect(pickCollapseStep([tables2, charts2, links2])).toEqual({
      key: 'links',
      mode: 'hidden',
    });
  });

  it('returns null when nothing can collapse further (physically impossible)', () => {
    const tables2 = group('tables', 2, ['full', 'compact', 'icons', 'dropdown'], false, 'dropdown', 0);
    const charts2 = group('charts', 3, ['full', 'compact', 'icons', 'dropdown'], false, 'dropdown', 1);
    // Both at last rung and neither can hide → nothing left to do.
    expect(pickCollapseStep([tables2, charts2])).toBeNull();
  });

  it('breaks priority ties by collapsing the right-most group first', () => {
    const leftLink = group('linksA', 4, ['full', 'dropdown'], true, 'full', 0);
    const rightLink = group('linksB', 4, ['full', 'dropdown'], true, 'full', 3);
    expect(pickCollapseStep([leftLink, rightLink])).toEqual({
      key: 'linksB',
      mode: 'dropdown',
    });
  });
});
