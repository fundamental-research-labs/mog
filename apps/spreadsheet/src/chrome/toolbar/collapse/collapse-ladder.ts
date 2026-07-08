/**
 * Collapse ladder derivation.
 *
 * Progressive collapse treats each group as a ladder of render modes ordered
 * from most-expanded to most-collapsed. The coordinator collapses groups one
 * rung at a time, least-important first, until the ribbon fits — instead of
 * moving the whole ribbon through discrete global levels in lock-step.
 *
 * We DERIVE the ladder from the group's existing GroupCollapseConfig.levels so
 * the per-group progression stays authored in one place (collapse-configs.ts):
 * the distinct render modes, in order, become the rungs. `hidden` is pulled out
 * of the rung list into `canHide`, because hiding a group is a LAST RESORT used
 * only when every group is already at its most-compact non-hidden rung and the
 * ribbon still overflows — "important buttons never disappear unless it is
 * physically impossible to fit them".
 */

import type {
  CollapseLevel,
  GroupCollapseConfig,
  GroupRenderMode,
} from '@mog-sdk/contracts/ribbon';

const LEVELS: readonly CollapseLevel[] = [0, 1, 2, 3, 4];

export interface CollapseLadder {
  /** Lower number = more important = collapses later. */
  priority: number;
  /**
   * Render modes from most-expanded (`rungs[0]`, always the mode the group
   * shows when nothing needs to collapse) to most-collapsed, EXCLUDING
   * `hidden`. Always has at least one entry.
   */
  rungs: GroupRenderMode[];
  /** Whether the group may be hidden as an absolute last resort. */
  canHide: boolean;
}

/**
 * Derive a group's collapse ladder from its collapse config.
 *
 * A group with no config never collapses (single `full` rung, never hidden).
 */
export function deriveCollapseLadder(config: GroupCollapseConfig | undefined): CollapseLadder {
  if (!config) {
    return { priority: 0, rungs: ['full'], canHide: false };
  }

  const rungs: GroupRenderMode[] = [];
  let canHide = false;

  for (const level of LEVELS) {
    const mode = config.levels[level];
    if (!mode) continue;
    if (mode === 'hidden') {
      canHide = true;
      continue;
    }
    if (rungs[rungs.length - 1] !== mode) {
      rungs.push(mode);
    }
  }

  if (rungs.length === 0) rungs.push('full');

  return { priority: config.priority, rungs, canHide };
}

/**
 * Serialize a ladder into the compact form stored on the group's DOM element as
 * data attributes, so the (DOM-driven) coordinator can read each visible
 * group's priority/rungs without a React registration handshake.
 */
export const LADDER_DATA_ATTRS = {
  key: 'data-ribbon-group-key',
  priority: 'data-ribbon-priority',
  rungs: 'data-ribbon-rungs',
  canHide: 'data-ribbon-can-hide',
} as const;
