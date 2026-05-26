/**
 * Pane Focus Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * Manages F6 pane navigation for cycling focus between major UI panes:
 * toolbar -> formulaBar -> grid -> statusBar (and back)
 *
 * States:
 * - toolbar: Quick Access Toolbar / Ribbon has focus
 * - formulaBar: Formula bar input has focus
 * - grid: Spreadsheet grid has focus (default state)
 * - statusBar: Status bar has focus
 *
 * @see state-machines/src/pane-focus-machine.ts
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Types of panes that can receive focus.
 * Order determines navigation cycle: toolbar -> formulaBar -> grid -> statusBar
 */
export type PaneType = 'toolbar' | 'formulaBar' | 'grid' | 'statusBar';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface PaneFocusState {
  context: {
    /** Currently focused pane */
    currentPane: PaneType;
    /** Previously focused pane (for restoration after overlays) */
    previousPane: PaneType | null;
  };
  // Use \`any\` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
  value: string;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface PaneFocusAccessor {
  // Value accessors
  getCurrentPane(): PaneType;
  getPreviousPane(): PaneType | null;

  // State matching accessors
  isToolbarFocused(): boolean;
  isFormulaBarFocused(): boolean;
  isGridFocused(): boolean;
  isStatusBarFocused(): boolean;

  // Derived accessors
  isGrid(): boolean;
  getMachineState(): string;
}

// =============================================================================
// COMMANDS INTERFACE
// =============================================================================

export interface PaneFocusCommands {
  /** Move to the next pane in the cycle (F6) */
  focusNextPane(): void;

  /** Move to the previous pane in the cycle (Shift+F6) */
  focusPreviousPane(): void;

  /** Focus a specific pane */
  focusPane(pane: PaneType): void;

  /** Reset focus to the grid */
  resetToGrid(): void;
}
