/**
 * Feature Gates — Configurable Feature Visibility
 *
 * A typed config object that controls which UI features are shown/hidden.
 * Every key defaults to `true` (shown) when omitted — only set keys to `false` to hide.
 *
 * Four levels of granularity:
 * 1. Top-level modes (ribbon, editing) — coarsest
 * 2. Tabs — hide entire ribbon tabs
 * 3. Groups — hide ribbon groups within tabs
 * 4. Capabilities — hide individual features (finest)
 * 5. Ribbon visibility — typed tab/group/button rollout config
 *
 * @example
 * ```ts
 * // Hide the entire ribbon
 * const gates: FeatureGates = { ribbon: false };
 *
 * // Read-only viewer
 * const gates: FeatureGates = { editing: false };
 *
 * // Hide specific tabs
 * const gates: FeatureGates = { tabs: { draw: false, review: false } };
 * ```
 */

import type { RibbonVisibilityConfig } from './ribbon';

// =============================================================================
// FeatureGates Type
// =============================================================================

/**
 * Granular feature visibility config.
 * Every key defaults to `true` (shown) when omitted.
 * Only set keys to `false` to hide things.
 */
export interface FeatureGates {
  // ── Top-Level Modes ────────────────────────────────────────
  /** Hide the entire ribbon toolbar (replaces old `hideRibbon` prop) */
  ribbon?: boolean;
  /**
   * Strongly typed tab -> group -> button visibility config for staged
   * ribbon rollouts. This is evaluated after the legacy tabs/groups gates.
   */
  ribbonVisibility?: RibbonVisibilityConfig;
  /** Allow editing (replaces old `readOnly` prop). When false, all mutation UI is suppressed. */
  editing?: boolean;

  // ── Ribbon Tabs ──────────────────────────────────────────
  /** Hide entire tabs from the tab bar + their content */
  tabs?: {
    home?: boolean;
    insert?: boolean;
    draw?: boolean;
    page?: boolean;
    pageLayout?: boolean;
    formulas?: boolean;
    data?: boolean;
    review?: boolean;
    view?: boolean;
  };

  // ── Ribbon Groups (within tabs) ──────────────────────────
  /** Hide specific groups within a tab */
  groups?: {
    clipboard?: boolean;
    font?: boolean;
    alignment?: boolean;
    number?: boolean;
    styles?: boolean;
    cells?: boolean;
    editing?: boolean;
    // Insert tab groups
    tables?: boolean;
    illustrations?: boolean;
    charts?: boolean;
    sparklines?: boolean;
    filters?: boolean;
    links?: boolean;
    comments?: boolean;
    text?: boolean;
  };

  // ── Specific Capabilities ────────────────────────────────
  /** Hide individual capabilities/features */
  capabilities?: {
    undo?: boolean;
    redo?: boolean;
    save?: boolean;
    /** Show the File backstage trigger and allow OPEN_BACKSTAGE / Alt+F. */
    fileMenu?: boolean;
    print?: boolean;
    export?: boolean;
    formulaBar?: boolean;
    sheetTabs?: boolean;
    contextMenu?: boolean;
    freezePanes?: boolean;
    dataValidation?: boolean;
    /** Show in-cell date picker affordances and calendar popovers for date cells. */
    datePicker?: boolean;
    conditionalFormatting?: boolean;
  };
}

// =============================================================================
// Preset Configs
// =============================================================================

/** Read-only viewer — no editing, no ribbon */
export const VIEWER_GATES: FeatureGates = {
  editing: false,
  ribbon: false,
};

/** Minimal editor — Home + Insert + Formulas + View */
export const MINIMAL_EDITOR_GATES: FeatureGates = {
  tabs: { draw: false, data: false, review: false },
  capabilities: { save: false, print: false, export: false },
};

/** Desktop default — hide unsupported/internal-only tabs from end users */
export const DESKTOP_GATES: FeatureGates = {
  tabs: { draw: false },
};
