/**
 * Keyboard Coordinator
 *
 * Slim keyboard event handler that dispatches to the Unified Action System.
 * All action implementations are in engine/src/state/actions/handlers/.
 *
 * ARCHITECTURE:
 * ```
 * KeyboardEvent
 * │
 * ▼ KeyboardEventProcessor.process
 * KeyboardInput (normalized)
 * │
 * ▼ ShortcutMatcher.matchWithReason
 * { shortcut, hadCandidates, blockedByRepeat }
 * │
 * ▼ dispatch(shortcut.action, deps)
 * HANDLER_MAP[action](deps)
 * ```
 *
 * The coordinator delegates event normalization and shortcut matching to the
 * kernel's KeyboardEventProcessor and ShortcutMatcher. It owns:
 * - Pre-match modal interceptors (End Mode, F8 Extend Mode)
 * - Context determination (from XState actor snapshots)
 * - ActionDependencies assembly and dispatch
 * - IME guard (editor machine state fallback)
 * - KeyUp handling (paste options menu)
 *
 */

import {
  type ChordMatchResult,
  type KeyboardInput,
  KeyboardEventProcessor,
  type PendingShortcut,
  type Platform,
  PRIORITY_ORDER,
  ShortcutMatcher,
  isRegisterTransitionKey,
  resolveBinding,
} from '@mog-sdk/kernel/keyboard';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { KEYBOARD_SHORTCUTS, type KeyboardShortcut, type ShortcutContext } from '../../../keyboard';
import {
  isEditableChromeKeyboardTarget,
  keyboardEventTargetElement,
  shouldDeferNavigationKeyToEditableTarget,
} from '../../shared/utils/focus-utils';

import type { ActionDependencies, ActionType } from '@mog-sdk/contracts/actions';
import type { ActorAccessors, ActorCommands } from '@mog-sdk/contracts/actors';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type { StoreApi } from 'zustand';
import type {
  ChartActor,
  ClipboardActor,
  CommentActor,
  EditorActor,
  FindReplaceActor,
  ObjectInteractionActor,
  PaneFocusActor,
  RendererActor,
  SelectionActor,
} from '../../shared/actor-types';
import type { KeyboardUIStore } from '../shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by KeyboardCoordinator.
 * Injected from SheetCoordinator.
 */
export interface KeyboardCoordinatorDependencies {
  /** Unified Workbook API for all data/compute operations */
  workbook: import('@mog-sdk/contracts/api').WorkbookInternal;
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Editor machine actor */
  editorActor: EditorActor;
  /** Clipboard machine actor */
  clipboardActor: ClipboardActor;
  /** Object interaction actor for floating objects */
  objectInteractionActor: ObjectInteractionActor;
  /** Chart machine actor */
  chartActor: ChartActor;
  /** Find-Replace machine actor */
  findReplaceActor: FindReplaceActor;
  /** Comment machine actor */
  commentActor: CommentActor;
  /** Pane focus machine actor (E1: F6 Pane Navigation) */
  paneFocusActor: PaneFocusActor;
  /**
   * Renderer machine actor (E4: Ctrl+Backspace scroll-to-active).
   * Optional — test contexts may stub it out; production wiring always
   * supplies the real renderer actor.
   */
  rendererActor?: RendererActor;
  /** Active sheet ID getter */
  getActiveSheetId: () => string;
  /**
   * Platform abstraction (01). Required so dispatched
   * handlers can route file dialogs / clipboard / shell ops through the
   * typed surface instead of reaching for inline browser primitives.
   */
  platform: import('@mog-sdk/contracts/platform').IPlatform;
  /**
   * Shell service for document lifecycle (01). Required
   * so dispatched handlers (SAVE, OPEN, NEW_WORKBOOK, etc. in) can
   * load bytes / open / close documents without reaching `window.__SHELL__`.
   *
   * NOTE: imported from `@mog-sdk/types-document/shell/types` because
   * platform-action-wiring.md.
   */
  shellService: import('@mog-sdk/types-document/shell/types').ShellService;
  /** UI event handler for dialogs */
  onUIAction?: (action: string) => void;
  /** Check if objects are selected (includes charts - single owner principle) */
  hasObjectSelection?: () => boolean;
  /** Check if editing text in an object */
  isEditingObjectText?: () => boolean;
  /**
   * Check if a Flash Fill suggestion preview is currently visible.
   * When true and the editor is idle, the active context is reported as
   * `'flashFillPreview'` instead of `'grid'`, which routes Enter / Tab /
   * Escape to ACCEPT_FLASH_FILL / REJECT_FLASH_FILL via the unified
   * shortcut registry. Without this, the popup would need to register a
   * global keydown listener and would race the cell editor for Enter.
   */
  isFlashFillPreviewActive?: () => boolean;
  /** UI Store for action handlers that need UI state access */
  uiStore?: StoreApi<KeyboardUIStore>;
  /** Get coordinator instance for viewport/scroll operations and floating object management */
  getCoordinator?: () => unknown;
  /** Action dispatch function (injected to avoid actions/ dependency) */
  dispatch?: (action: ActionType, deps: ActionDependencies, payload?: unknown) => unknown;
  /** Whether the document is in read-only mode (blocks mutating keyboard shortcuts) */
  readOnly?: boolean;
  /** UI feature gates used by keyboard-dispatched actions. */
  featureGates?: FeatureGates;
  /** Host command bridge for embed save/export routing. */
  hostCommands?: import('@mog-sdk/contracts/actions').HostSpreadsheetCommandBridge;
  /**
   * Create actor access layer for type-safe accessors and commands.
   * Injected from coordinator layer.
   * systems/ must NOT import from coordinator/actor-access/ directly.
   */
  createAccessLayer: (actors: {
    selectionActor: { getSnapshot(): unknown; send(event: unknown): void };
    editorActor: { getSnapshot(): unknown; send(event: unknown): void };
    clipboardActor: { getSnapshot(): unknown; send(event: unknown): void };
    chartActor: { getSnapshot(): unknown; send(event: unknown): void };
    objectActor: { getSnapshot(): unknown; send(event: unknown): void };
    commentActor?: { getSnapshot(): unknown; send(event: unknown): void };
    findReplaceActor?: { getSnapshot(): unknown; send(event: unknown): void };
    rendererActor?: { getSnapshot(): unknown; send(event: unknown): void };
  }) => { accessors: ActorAccessors; commands: ActorCommands };
}

/**
 * Result from handling a keyboard event.
 */
export interface KeyboardHandleResult {
  /** Whether the event was handled (should preventDefault) */
  handled: boolean;
  /** The action that was dispatched, if any */
  action?: string;
  /** Reason for not handling, if applicable */
  reason?: 'not_found' | 'not_implemented' | 'wrong_context' | 'browser_defer' | 'ime_composing';
}

// =============================================================================
// Helper: Extract handled boolean from sync/async result
// =============================================================================

/**
 * Extract the `handled` boolean from an ActionResult that may be sync or async.
 *
 * Since keyboard handlers must return synchronously, async results are treated
 * as "handled" (we optimistically assume the action will succeed).
 * The async action runs in the background.
 *
 * @param result - ActionResult or Promise<ActionResult>
 * @returns boolean - Whether the action was/will be handled
 */
function getHandledSync(
  result:
    | import('@mog-sdk/contracts/actions').ActionResult
    | Promise<import('@mog-sdk/contracts/actions').ActionResult>,
): boolean {
  if (result instanceof Promise) {
    // Async action - treat as handled (optimistic)
    // The action runs in the background
    return true;
  }
  return result.handled;
}

/**
 * Map a physical arrow key code to its uppercase direction suffix.
 * Used by `resolveSelectionAction` to compose canonical action names like
 * `MOVE_TO_EDGE_DOWN`, `EXTEND_SELECTION_LEFT`.
 *
 * Returns `null` for non-arrow keys.
 */
function arrowKeyToDirection(keyCode: string): 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | null {
  switch (keyCode) {
    case 'ArrowUp':
      return 'UP';
    case 'ArrowDown':
      return 'DOWN';
    case 'ArrowLeft':
      return 'LEFT';
    case 'ArrowRight':
      return 'RIGHT';
    default:
      return null;
  }
}

// =============================================================================
// Read-Only Mode: Allowlist of non-mutating actions
// =============================================================================

/**
 * Actions that are safe in read-only mode (view-only, navigation, copy).
 * Any action NOT in this set is blocked when readOnly is true.
 * Using an allowlist (vs blocklist) ensures new actions are blocked by default.
 */
const READ_ONLY_ALLOWED_ACTIONS = new Set<ActionType>([
  // Navigation
  'MOVE_UP',
  'MOVE_DOWN',
  'MOVE_LEFT',
  'MOVE_RIGHT',
  'MOVE_TO_A1',
  'MOVE_TO_EDGE_UP',
  'MOVE_TO_EDGE_DOWN',
  'MOVE_TO_EDGE_LEFT',
  'MOVE_TO_EDGE_RIGHT',
  'MOVE_TO_LAST_USED_CELL',
  'MOVE_TO_ROW_START',
  'PAGE_UP',
  'PAGE_DOWN',
  'PAGE_LEFT',
  'PAGE_RIGHT',
  'SCROLL_TO_ACTIVE_CELL',
  'ENTER_NAVIGATE',
  'SHIFT_ENTER_NAVIGATE',
  'TAB_FORWARD',
  'TAB_BACKWARD',
  // Selection
  'SELECT_ALL',
  'EXTEND_SELECTION_UP',
  'EXTEND_SELECTION_DOWN',
  'EXTEND_SELECTION_LEFT',
  'EXTEND_SELECTION_RIGHT',
  'EXTEND_SELECTION_PAGE_UP',
  'EXTEND_SELECTION_PAGE_DOWN',
  'EXTEND_TO_A1',
  'EXTEND_TO_EDGE_UP',
  'EXTEND_TO_EDGE_DOWN',
  'EXTEND_TO_EDGE_LEFT',
  'EXTEND_TO_EDGE_RIGHT',
  'EXTEND_TO_LAST_USED_CELL',
  'EXTEND_TO_ROW_START',
  'EXTEND_TO_ROW_END',
  'SELECT_ENTIRE_ROW',
  'SELECT_CURRENT_REGION',
  'SELECT_CURRENT_ARRAY',
  'SELECT_VISIBLE_CELLS',
  'SELECT_CONSTANTS',
  'SELECT_PRECEDENTS',
  'SELECT_DEPENDENTS',
  'SELECT_COLUMN_DIFFERENCES',
  'SELECT_ROW_DIFFERENCES',
  'ROTATE_SELECTION_CORNER',
  'TOGGLE_ADD_TO_SELECTION',
  'TOGGLE_EXTEND_SELECTION_MODE',
  // Selection modes
  'ACTIVATE_END_MODE',
  'TOGGLE_SCROLL_LOCK',
  // Table/data navigation (non-mutating)
  'CYCLE_TABLE_SELECTION',
  'CYCLE_TABLE_COLUMN_SELECTION',
  // Copy (NOT cut)
  'COPY',
  'COPY_CHART',
  // Find (NOT replace)
  'OPEN_FIND_DIALOG',
  'FIND_NEXT',
  'FIND_PREVIOUS',
  // View operations
  'ZOOM_IN',
  'ZOOM_OUT',
  'ZOOM_RESET',
  'FULL_SCREEN',
  'TOGGLE_FORMULA_VIEW',
  'TOGGLE_FORMULA_BAR_EXPAND',
  'TOGGLE_NL_BAR',
  'TOGGLE_RIBBON',
  'TOGGLE_RIBBON_TABS_MODE',
  'TOGGLE_OUTLINE_SYMBOLS',
  'TOGGLE_PAGE_BREAK_PREVIEW',
  'TOGGLE_OBJECTS_VISIBILITY',
  // Sheet navigation
  'NEXT_SHEET',
  'PREVIOUS_SHEET',
  // Pane navigation
  'FOCUS_NEXT_PANE',
  'FOCUS_PREVIOUS_PANE',
  // UI dialogs (read-only safe)
  'OPEN_GO_TO_DIALOG',
  'OPEN_GO_TO_SPECIAL_DIALOG',
  'OPEN_HELP',
  'OPEN_COMMAND_PALETTE',
  'OPEN_SEARCH_BOX',
  'OPEN_BACKSTAGE',
  'OPEN_PRINT_PREVIEW',
  'PRINT',
  'QUICK_PRINT',
  // Accessibility
  'READ_ACTIVE_CELL',
  'ANNOUNCE_CELL_FORMAT',
  'CHECK_ACCESSIBILITY',
  'OPEN_ACCESSIBILITY_GUIDE',
  // Ribbon keytips (navigation only)
  'ACTIVATE_RIBBON_KEYTIPS',
  // Context menu (items will be filtered separately)
  'INVOKE_CONTEXT_MENU',
  // Object deselection (non-mutating)
  'DESELECT_OBJECT',
  // Go-to special read-only variants
  'OPEN_QUICK_ANALYSIS',
  // Formula auditing (view-only)
  'EVALUATE_FORMULA_SELECTION',
  // Cancel (always safe)
  'CANCEL_EDIT',
  // Export (non-mutating to document)
  'EXPORT_FILE',
  'SAVE',
  'SAVE_AS',
  'OPEN',
  // Extension panel
  'TOGGLE_EXTENSION_PANEL',
  // Threaded comments (view only)
  'OPEN_THREADED_COMMENTS',
  'SHOW_HIDE_COMMENTS',
]);

// =============================================================================
// Chord-mode router
// =============================================================================

/**
 * Maximum elapsed time for an Alt-tap to enter keytip mode.
 *
 * Excel's actual threshold is roughly 500ms, but we use 400ms so coordinator
 * chord tests can assert a deterministic boundary.
 * Hold-and-type Alt+letter takes < 400ms in practice; bare Alt taps land
 * well under that. Tightening below 400ms starts dropping legitimate taps
 * on slower machines, so 400 is the deliberate compromise.
 *
 */
export const ALT_TAP_MAX_MS = 400;

/**
 * Maximum elapsed time the coordinator waits for a chord follow-on before
 * committing the buffered single-key default (Bug 1 fix).
 *
 * When `Alt+A` arrives and both `Alt+A` (single-key tab switch) and
 * `Alt+A,V,V` (chord) are registered, the coordinator buffers a pending
 * chord with the single-key as a default. If no follow-on arrives within
 * `CHORD_DISAMBIG_MS`, the default is committed (Excel parity: typing
 * speed disambiguates). The Alt-up path is the primary commit signal for
 * `Alt+letter` (Alt-held entry); this timeout is a backup so a stuck
 * pending buffer doesn't survive forever when Alt is never released.
 *
 */
export const CHORD_DISAMBIG_MS = 250;

/**
 * In-flight chord buffer state.
 *
 * `shortcuts` is the priority-sorted list of candidates whose `sequence`
 * field is being walked; each entry carries the cursor position
 * (`PendingShortcut.cursor` from the kernel matcher). `enteredAt` is the
 * `performance.now()` timestamp when the buffer was created.
 *
 * `altHeldEntry` is `true` when the buffer was created by an Alt-held
 * leader keystroke (e.g. `Alt+A` with no prior Alt-tap). On the matching
 * Alt-up, if no chord follow-on advanced the buffer, the embedded
 * single-key default commits — Excel parity for "user pressed Alt+A and
 * released Alt; switch the Data tab".
 *
 * When the buffer originated from an Alt-tap (`tryPromoteAltTap`), this
 * flag is `false`; Alt-up is benign because the user typed the chord
 * leader without holding Alt.
 */
interface ChordPending {
  readonly shortcuts: readonly PendingShortcut<KeyboardShortcut>[];
  readonly enteredAt: number;
  readonly altHeldEntry: boolean;
}

/**
 * Sub-state for the Alt-tap detector.
 *
 * `armedAt` is set on a clean `keydown` Alt (no other modifier already
 * held, no intervening keydown since the last clean state). `keyup`
 * Alt within `ALT_TAP_MAX_MS` AND with no intervening keydown
 * promotes the tap into `'keyTipMode'`. Any intervening keydown
 * (Alt+Tab, Alt+F4, Alt+letter, Alt+click) clears `armedAt` so the
 * release becomes a no-op.
 */
interface AltTapState {
  /** Timestamp of the most recent clean Alt-down, or `null` when not armed. */
  armedAt: number | null;
  /** Whether any keydown has occurred since `armedAt` was set. */
  hadInterveningKeydown: boolean;
}

/**
 * Read-only snapshot of the chord state, for the KeyTip overlay layer.
 *
 * The overlay reads this via a coordinator-owned selector (wires the
 * subscription). only ships the public read shape; subscribers land
 * once the listener migration deletes the parallel state machine.
 */
export interface ChordSnapshot {
  readonly active: boolean;
  /**
   * Number of bindings the chord buffer has consumed.
   * - `0` when the buffer is empty (post Alt-tap, no leader yet).
   * - `1` once a leader has matched (e.g. `Alt+H` — buffer holds the
   * `Home` chord candidates; the next keystroke advances the chord).
   * - `n+1` after the buffer advances past the n-th follow-on.
   *
   * Computed as `maxCursor + 1` when `candidateCount > 0`, where
   * `maxCursor` is the deepest pending entry's cursor (the cursor field
   * counts un-consumed follow-ons, so the leader contributes the `+1`).
   */
  readonly depth: number;
  /** When `active`, the count of candidates currently buffered. */
  readonly candidateCount: number;
}

// =============================================================================
// Keyboard Coordinator
// =============================================================================

/**
 * KeyboardCoordinator - Slim Keyboard Event Handler
 *
 * Responsibilities:
 * 1. Normalize keyboard events to key strings
 * 2. Look up shortcuts in registry
 * 3. Determine context from machine states
 * 4. Dispatch to Unified Action System
 * 5. Own the chord-buffer state machine for Excel Alt+H,L style chords.
 *
 * All action logic is in state/actions/handlers/.
 */
export class KeyboardCoordinator {
  /** Kernel processor: normalizes raw KeyboardEvent → KeyboardInput */
  private processor: KeyboardEventProcessor;

  /** Kernel matcher: O(1) shortcut lookup with context hierarchy */
  private matcher: ShortcutMatcher<KeyboardShortcut, ShortcutContext>;

  /** Platform detection */
  private platform: Platform;

  /** Dependencies (injected) */
  private deps: KeyboardCoordinatorDependencies | null = null;

  /**
   * Active chord buffer, or `null` when no chord is in flight.
   *
   * Owned exclusively by the coordinator: the matcher (`@mog-sdk/kernel/keyboard`)
   * is stateless and reports `'pending'`/`'matched'`/`'noMatch'` per input;
   * this field stores the buffered pending shortcuts between inputs.
   *
   * Set when:
   * - {@link ALT_TAP_MAX_MS}-bounded Alt-tap completes and a chord
   * candidate's leading binding is later matched, OR
   * - the chord continues to advance (cursor increments).
   * Cleared when:
   * - a shortcut completes (`'matched'` from `matchChordContinuation`),
   * - {@link cancelChord} fires (ESC, Tab/Enter, click outside, dialog
   * opens, cell-edit starts, modifier+key shortcut takes priority),
   * - or the cascade winner above `keyTipMode` becomes active.
   */
  private chordPending: ChordPending | null = null;

  /** Alt-tap detector sub-state machine; see {@link AltTapState}. */
  private altTap: AltTapState = { armedAt: null, hadInterveningKeydown: false };

  /**
   * Timer ID for the chord-disambig deadline (Bug 1 fix). Set when a
   * chord-pending buffer with a single-key default is created via
   * `Alt+letter` (Alt-held entry); cleared on advancement, completion,
   * cancellation, or when the timer fires and commits the default.
   *
   * Stored as `unknown` so the field works under both Node `Timeout` and
   * browser `number` typings without importing `@types/node`.
   */
  private chordDisambigTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Click-outside-to-cancel listener, installed when dependencies are set
   * and torn down on {@link dispose}. Mirrors the listener at
   * `KeyTipContext.tsx:278-281`; the listener there survives the commit
   * and is removed by. Both gate on the same logical state — `KeyTipContext`
   * reads `mode`, this listener reads `chordPending` — so duplicate firing
   * during the transitional window is benign (each independently clears its
   * own state).
   */
  private clickOutsideListener: ((e: MouseEvent) => void) | null = null;

  /**
   * Subscribers notified when {@link chordPending} mutates.
   *
   * The KeyTip overlay reads {@link getChordSnapshot} via React's
   * `useSyncExternalStore`; we notify listeners whenever the chord
   * buffer is set/cleared/advanced so React knows to re-read the
   * snapshot. Inserted, advanced, or cleared chord buffers all flow
   * through this set. Listeners are added by {@link subscribeChord}
   * and removed via the returned unsubscribe function.
   *
   * Each callback is invoked synchronously on the mutating call;
   * subscribers must be safe to re-enter (the React adapter caches
   * the snapshot on the next read).
   */
  private chordListeners: Set<() => void> = new Set();

  /**
   * Cached chord snapshot returned by {@link getChordSnapshot}.
   *
   * `useSyncExternalStore` requires `getSnapshot()` to return the same
   * reference across calls when the underlying state has not changed.
   * We invalidate this cache in {@link notifyChordChange} (called on
   * every chord mutation) so the next read recomputes a fresh object;
   * between mutations, the cached snapshot is reused so React's
   * snapshot equality short-circuits and subscribers don't tear.
   */
  private chordSnapshotCache: ChordSnapshot | null = null;

  constructor(platform: Platform, shortcuts: readonly KeyboardShortcut[] = KEYBOARD_SHORTCUTS) {
    this.platform = platform;
    this.processor = new KeyboardEventProcessor(platform);
    this.matcher = new ShortcutMatcher<KeyboardShortcut, ShortcutContext>(shortcuts, platform);
  }

  // ===========================================================================
  // DEPENDENCY INJECTION
  // ===========================================================================

  setDependencies(deps: KeyboardCoordinatorDependencies): void {
    this.deps = deps;
    this.installClickOutsideListener();
  }

  hasDependencies(): boolean {
    return this.deps !== null;
  }

  /**
   * Public dispatch entry point for tooling and test code. Routes
   * through the same wired ActionDependencies and dispatch closure
   * that real keyboard input uses (see callers of
   * {@link buildActionDependencies}), so any handler reached here is
   * exercising the production path. Returns whatever the handler
   * returns (sync ActionResult or Promise); callers may await both
   * shapes. Returns `null` if the coordinator's dependencies haven't
   * been wired yet.
   */
  dispatchAction(
    action: ActionType,
    payload?: unknown,
  ):
    | import('@mog-sdk/contracts/actions').ActionResult
    | Promise<import('@mog-sdk/contracts/actions').ActionResult>
    | null {
    if (!this.deps?.dispatch) return null;
    const actionDeps = this.buildActionDependencies();
    if (!actionDeps) return null;
    return this.deps.dispatch(action, actionDeps, payload) as
      | import('@mog-sdk/contracts/actions').ActionResult
      | Promise<import('@mog-sdk/contracts/actions').ActionResult>;
  }

  /**
   * Tear down listeners installed by {@link setDependencies}. Tests and
   * shutdown flows call this so the click-outside listener doesn't leak
   * across coordinator instances. Idempotent.
   */
  dispose(): void {
    if (this.clickOutsideListener) {
      // `globalThis.document` may be absent in non-DOM jest environments;
      // guard so dispose is callable without DOM.
      if (typeof document !== 'undefined') {
        document.removeEventListener('click', this.clickOutsideListener, true);
      }
      this.clickOutsideListener = null;
    }
    // Clear any in-flight chord-disambig deadline so a stray timer
    // doesn't fire against a torn-down coordinator.
    this.clearChordDisambigTimer();
    // Drop subscribers so they don't keep the coordinator alive.
    this.chordListeners.clear();
  }

  /**
   * Install a capture-phase document `click` listener that clears the chord
   * buffer when the user clicks outside the ribbon while a chord is pending.
   *
   * Conservative gating: only fires when {@link chordPending} is non-null,
   * so it's a no-op outside keytip mode. Capture phase ensures the chord
   * is canceled before any popovers/menus react to the click.
   *
   * The mirror in `KeyTipContext.tsx` survives the commit and is
   * removed by; both listeners can coexist because they key off the
   * same logical state and each clears only its own slice.
   */
  private installClickOutsideListener(): void {
    if (this.clickOutsideListener) return;
    if (typeof document === 'undefined') return;
    const handler = (_e: MouseEvent): void => {
      if (this.chordPending !== null) {
        this.cancelChord('click-outside');
      }
    };
    this.clickOutsideListener = handler;
    document.addEventListener('click', handler, true);
  }

  // ===========================================================================
  // CONTEXT DETERMINATION
  // ===========================================================================

  /**
   * Determine current shortcut context from machine states.
   *
   * Check nested states FIRST (more specific) before parent states.
   * This enables mode-specific keyboard handling (Enter Mode vs Edit Mode).
   *
   * The cascade order, top-down, is:
   * 1. editing inside object text
   * 2. formulaEditMode / formulaEnterMode
   * 3. editMode / enterMode, including rich text editing
   * 4. flashFillPreview
   * 5. **keyTipMode** — when a chord is pending and no editing/dialog-like
   * mode is active. Plain object/chart selection does not block Excel
   * ribbon keytips.
   * 6. objectSelected
   * 7. grid (default).
   *
   */
  private getCurrentContext(): ShortcutContext {
    if (!this.deps) return this.chordPending !== null ? 'keyTipMode' : 'grid';

    // Check floating objects first (includes charts - single owner principle)
    // objectInteractionActor owns selection for ALL floating objects including charts
    if (this.deps.hasObjectSelection?.()) {
      if (this.deps.isEditingObjectText?.()) {
        return 'editing';
      }
    }

    // Check editor state - Use isEditMode context to determine Enter/Edit Mode
    const editorState = this.deps.editorActor.getSnapshot();
    const isEditMode = editorState.context.isEditMode;

    // Formula editing - check mode first for more specific context
    if (editorState.matches('formulaEditing')) {
      // Check isEditMode to distinguish enterMode vs editMode
      return isEditMode ? 'formulaEditMode' : 'formulaEnterMode';
    }

    // Regular editing - check mode first for more specific context
    if (editorState.matches('editing')) {
      // Check isEditMode to distinguish enterMode vs editMode
      return isEditMode ? 'editMode' : 'enterMode';
    }

    if (editorState.matches('richTextEditing')) {
      return isEditMode ? 'editMode' : 'enterMode';
    }

    // Flash Fill preview specializes 'grid' when no edit is active. Three
    // exact-context shortcuts (Enter/Tab/Escape) override grid bindings via
    // two-pass matcher resolution; everything else falls through 'grid'
    // hierarchy so navigation, copy, etc. still work while the popup is up.
    if (this.deps.isFlashFillPreviewActive?.()) {
      return 'flashFillPreview';
    }

    // Chord-in-flight specialization: every keytip-targeted shortcut
    // declares `keyTipMode` in its `contexts` array (e.g., the chord
    // follow-on for `Alt+H,L → OPEN_CF_MENU`). The leading-key bucket
    // (`grid`) is responsible for opening the chord; this branch keeps
    // the chord follow-on context active while continuation inputs flow.
    if (this.chordPending !== null) {
      return 'keyTipMode';
    }

    if (this.deps.hasObjectSelection?.()) {
      return 'objectSelected';
    }

    return 'grid';
  }

  /**
   * Detect whether a cascade winner above `keyTipMode` is active and, if so,
   * cancel the in-flight chord. Called at every transition point (top of
   * `handleKeyboardEvent`, before dispatching plain shortcuts that would
   * change focus, etc.) so the chord's life-cycle is documented in the
   * coordinator's transition code rather than implicitly via cascade
   * ordering.
   *
   * Excel parity: opening a dialog, starting cell-edit, editing object text,
   * or showing flash-fill preview during keytip mode cancels keytips. Plain
   * object/chart selection keeps keytips active so contextual ribbon chords
   * like Alt+J,C can target Chart Design.
   */
  private preemptChordIfNeeded(): void {
    if (this.chordPending === null) return;
    if (!this.deps) return;

    if (this.deps.hasObjectSelection?.() && this.deps.isEditingObjectText?.()) {
      this.cancelChord('preempted-by-object-text-edit');
      return;
    }
    const editorState = this.deps.editorActor.getSnapshot();
    if (editorState.matches('formulaEditing') || editorState.matches('editing')) {
      this.cancelChord('preempted-by-edit-mode');
      return;
    }
    if (this.deps.isFlashFillPreviewActive?.()) {
      this.cancelChord('preempted-by-flash-fill');
      return;
    }
  }

  // ===========================================================================
  // CHORD BUFFER MANAGEMENT
  // ===========================================================================

  /**
   * Clear the chord buffer. Idempotent. Reason is informational (logged for
   * tests / observability hooks added by later tasks).
   */
  private cancelChord(_reason: string): void {
    if (this.chordPending === null) return;
    this.chordPending = null;
    this.clearChordDisambigTimer();
    this.notifyChordChange();
  }

  /**
   * Clear the chord-disambig deadline timer if active. Idempotent.
   * Called whenever the chord-pending buffer transitions
   * (advance, complete, cancel) so a stale timer never fires against a
   * cleared buffer.
   */
  private clearChordDisambigTimer(): void {
    if (this.chordDisambigTimer !== null) {
      clearTimeout(this.chordDisambigTimer);
      this.chordDisambigTimer = null;
    }
  }

  /**
   * Arm the chord-disambig deadline. Cleared on any chord-buffer
   * mutation; on fire, commits the single-key default if the buffer is
   * still in its post-leader state (no follow-on advanced any chord).
   *
   * Skipped when `setTimeout` is unavailable (non-DOM jest environments
   * use the deterministic-clock seam in tests; production always has
   * setTimeout).
   */
  private armChordDisambigTimer(): void {
    this.clearChordDisambigTimer();
    if (typeof setTimeout === 'undefined') return;
    this.chordDisambigTimer = setTimeout(() => {
      this.chordDisambigTimer = null;
      this.commitDisambiguationDefault('disambig-timeout');
    }, CHORD_DISAMBIG_MS);
  }

  /**
   * Commit the buffered default on the disambiguation deadline.
   *
   * There are two legitimate defaults:
   * - a single-key `Alt+letter` default in the post-leader buffer; this is
   * valid only before any chord has advanced;
   * - a completed chord prefix that was deferred because longer keytips were
   * still possible, e.g. `Alt+H,S` while `Alt+H,S,O` is still live.
   *
   * Caller-tag `_reason` is informational; future T-tasks may surface it
   * via the chord snapshot for the keytip overlay.
   */
  private commitDisambiguationDefault(_reason: string): void {
    if (this.chordPending === null) return;
    const def = this.matcher.getDefaultMatch(this.chordPending.shortcuts);
    if (!def) {
      // No default to commit. Preserve advanced chord buffers so keytips
      // remain usable after a pause; clear only a stuck post-leader buffer.
      const advanced = this.chordPending.shortcuts.some((p) => p.cursor > 0);
      if (!advanced) {
        this.cancelChord('disambig-no-default');
      }
      return;
    }
    const sequenceLength = def.sequence?.length ?? 0;
    const isCompletedPrefixDefault =
      sequenceLength > 0 &&
      this.chordPending.shortcuts.some(
        (entry) => entry.shortcut.id === def.id && entry.cursor >= sequenceLength,
      );
    if (!isCompletedPrefixDefault) {
      // If any chord entry advanced past cursor 0, the user already
      // committed to a chord path, so a single-key default must not fire.
      const advanced = this.chordPending.shortcuts.some((p) => p.cursor > 0);
      if (advanced) return;
    }
    this.cancelChord('disambig-commit-default');
    this.dispatchShortcut(def);
  }

  /**
   * Notify all chord-state subscribers that the chord buffer mutated.
   *
   * Called whenever {@link chordPending} is set, advanced, or cleared.
   * Invalidates {@link chordSnapshotCache} so the next
   * {@link getChordSnapshot} read produces a fresh object reference,
   * which React's `useSyncExternalStore` requires to detect change.
   * Errors thrown by listeners do not propagate — a buggy subscriber
   * must not jam the chord state machine.
   */
  private notifyChordChange(): void {
    this.chordSnapshotCache = null;
    for (const listener of this.chordListeners) {
      try {
        listener();
      } catch {
        // Subscriber errors are isolated; the coordinator's chord
        // state must remain consistent regardless of subscriber bugs.
      }
    }
  }

  /**
   * Subscribe to chord-buffer mutations. Returns an unsubscribe function.
   *
   * The KeyTip overlay layer wires this up via
   * `useSyncExternalStore` so it can re-render when the coordinator's
   * chord state changes (Alt-tap entry, chord advance, cancel,
   * pre-emption). The hook lives in
   * `apps/spreadsheet/src/systems/input/keyboard/use-chord-mode-snapshot.ts`.
   */
  subscribeChord(listener: () => void): () => void {
    this.chordListeners.add(listener);
    return () => {
      this.chordListeners.delete(listener);
    };
  }

  /**
   * Read-only snapshot of the chord state. Public API for the KeyTip
   * overlay and for tests asserting state
   * machine transitions.
   *
   * The returned object is cached between mutations so React's
   * `useSyncExternalStore` snapshot-equality check holds across renders
   * with no chord change. {@link notifyChordChange} clears the cache.
   */
  getChordSnapshot(): ChordSnapshot {
    if (this.chordSnapshotCache !== null) {
      return this.chordSnapshotCache;
    }
    if (this.chordPending === null) {
      this.chordSnapshotCache = { active: false, depth: 0, candidateCount: 0 };
      return this.chordSnapshotCache;
    }
    const candidateCount = this.chordPending.shortcuts.length;
    let maxCursor = 0;
    for (const entry of this.chordPending.shortcuts) {
      if (entry.cursor > maxCursor) maxCursor = entry.cursor;
    }
    // depth counts bindings consumed. matchChordStart returns chord
    // candidates with cursor=0 (leader matched, sequence[0] still
    // un-consumed); matchChordContinuation advances cursor by 1 per
    // follow-on. So consumed-bindings = maxCursor + 1 once the buffer
    // is non-empty, and 0 for the post Alt-tap empty buffer.
    this.chordSnapshotCache = {
      active: true,
      depth: candidateCount > 0 ? maxCursor + 1 : 0,
      candidateCount,
    };
    return this.chordSnapshotCache;
  }

  /**
   * Test-only seam: forces the cascade-preemption check. Production callers
   * use {@link handleKeyboardEvent}, which runs the same check on every
   * input. Tests call this directly to assert "opening a dialog clears the
   * chord" without dispatching a fake keystroke.
   */
  preemptChordForCascadeChange(): void {
    this.preemptChordIfNeeded();
  }

  /**
   * Whether a chord is currently in flight. Prefer {@link getChordSnapshot}
   * for richer state; this is a 1-bit accessor for hot paths.
   */
  isChordPending(): boolean {
    return this.chordPending !== null;
  }

  /**
   * Drive the Alt-tap detector for one keydown event.
   *
   * Returns `true` if the keydown was an alt-tap arming event AND no
   * further chord/normal-matcher work should be done for it. Returns
   * `false` to let the rest of `handleKeyboardEvent` proceed.
   *
   * State transitions, in order:
   * - **Alt keydown, no other modifier already held, no other key pressed**
   * → arm the detector. The keydown is NOT forwarded to the matcher
   * (a bare Alt-down is never a shortcut leader; Excel parity).
   * - **Alt keydown WITH another modifier already held (Ctrl+Alt, Shift+Alt)**
   * → discard armedAt. Forward to matcher (e.g., Ctrl+Alt+V).
   * - **Any non-Alt keydown** → mark `hadInterveningKeydown = true`.
   * This causes the next Alt-up to be a no-op (Alt+Tab, Alt+letter).
   *
   * The companion keyup branch in `handleKeyUp` reads this state and
   * promotes a clean tap into `'keyTipMode'`.
   */
  private handleAltTapDetectorKeyDown(input: KeyboardInput): void {
    const isAltKey = input.physicalKey === 'AltLeft' || input.physicalKey === 'AltRight';

    if (isAltKey) {
      // A clean Alt arming requires no other modifier already held.
      // Ctrl/Shift/Meta in the modifier state means the user already
      // held something else; this isn't a bare Alt tap — discard.
      if (input.modifiers.ctrl || input.modifiers.meta || input.modifiers.shift) {
        this.altTap = { armedAt: null, hadInterveningKeydown: false };
        return;
      }
      // Don't re-arm on Alt key repeats. Hold-and-eventually-release is
      // not a tap; users hold Alt while typing follow-ons.
      if (this.altTap.armedAt !== null) {
        return;
      }
      this.altTap = { armedAt: this.now(), hadInterveningKeydown: false };
      return;
    }

    // Any non-Alt keydown counts as intervening if Alt was previously armed.
    if (this.altTap.armedAt !== null) {
      this.altTap = { armedAt: this.altTap.armedAt, hadInterveningKeydown: true };
    }
  }

  /**
   * Time source. Indirected through a method so tests can override `now`
   * by subclassing. Not currently used by tests but cheap to keep.
   */
  protected now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /**
   * Try to enter `'keyTipMode'` on a clean Alt tap. Called from
   * {@link handleKeyUp}. Returns `true` if the tap was promoted.
   *
   * A clean tap requires:
   * - The detector is currently armed (`armedAt` is non-null).
   * - No keydown intervened between the Alt-down and this Alt-up.
   * - Elapsed wall-clock time ≤ {@link ALT_TAP_MAX_MS}.
   * - No editing/dialog-like cascade context is active (object text editing,
   * cell editing, flashFillPreview). Plain object/chart selection is allowed
   * because Excel keytips remain available while contextual objects are
   * selected.
   *
   * On success, set `chordPending` to an empty buffer (no leader keystroke
   * yet — the user hasn't typed `KeyH`/`KeyN`/etc.). The subsequent
   * keystroke runs through the normal `matchChordStart` path and either
   * advances the chord (typed letter has a chord shortcut) or clears it
   * (typed letter has no chord — Excel-parity exit on stray key).
   */
  private tryPromoteAltTap(): boolean {
    if (this.altTap.armedAt === null) return false;
    if (this.altTap.hadInterveningKeydown) {
      this.altTap = { armedAt: null, hadInterveningKeydown: false };
      return false;
    }
    const elapsed = this.now() - this.altTap.armedAt;
    if (elapsed > ALT_TAP_MAX_MS) {
      this.altTap = { armedAt: null, hadInterveningKeydown: false };
      return false;
    }
    // Cascade gate: a more-specific mode forbids entering keytip mode.
    if (this.deps) {
      if (this.deps.hasObjectSelection?.() && this.deps.isEditingObjectText?.()) {
        this.altTap = { armedAt: null, hadInterveningKeydown: false };
        return false;
      }
      const editorState = this.deps.editorActor.getSnapshot();
      if (editorState.matches('formulaEditing') || editorState.matches('editing')) {
        this.altTap = { armedAt: null, hadInterveningKeydown: false };
        return false;
      }
      if (this.deps.isFlashFillPreviewActive?.()) {
        this.altTap = { armedAt: null, hadInterveningKeydown: false };
        return false;
      }
    }
    this.altTap = { armedAt: null, hadInterveningKeydown: false };
    // Empty buffer: the leading Alt+letter (Alt+H, Alt+N, ...) hasn't
    // been typed yet. The next keydown enters via `matchChordStart`.
    // `altHeldEntry: false` — Alt-tap origin, so a subsequent Alt-up is
    // benign (the user is now typing follow-ons without Alt held).
    this.chordPending = { shortcuts: [], enteredAt: this.now(), altHeldEntry: false };
    this.notifyChordChange();
    return true;
  }

  // ===========================================================================
  // MAIN EVENT HANDLER
  // ===========================================================================

  handleKeyboardEvent(e: KeyboardEvent): KeyboardHandleResult {
    // =========================================================================
    // IME Composition Guard - Two-Layer Defense (MUST BE FIRST)
    // =========================================================================
    if ((e.isComposing || e.keyCode === 229) && e.key !== 'Escape') {
      return { handled: false, reason: 'ime_composing' };
    }

    if (isEditableChromeKeyboardTarget(keyboardEventTargetElement(e))) {
      return { handled: false, reason: 'not_found' };
    }

    // Layer 2: Check editor machine state (defensive fallback)
    // Cross-machine access via injected dependency (coordinator pattern)
    // This catches edge cases where browser events might be missed
    if (this.deps?.editorActor.getSnapshot().matches('imeComposing') && e.key !== 'Escape') {
      return { handled: false, reason: 'ime_composing' };
    }

    if (shouldDeferNavigationKeyToEditableTarget(e)) {
      return { handled: false, reason: 'not_found' };
    }

    // =========================================================================
    // Cascade preemption — if a higher-priority context became active since
    // the last input (dialog opened, cell-edit started, flash fill preview
    // showed up), the chord buffer is invalidated. Run the check on every
    // input so the chord life-cycle is documented in transition code.
    // =========================================================================
    this.preemptChordIfNeeded();

    // Normalize the raw KeyboardEvent via the kernel processor BEFORE the
    // alt-tap detector, so the detector sees a `KeyboardInput` (the same
    // shape the matcher sees). The processor is cheap; we re-use `input`
    // for chord routing and the normal matcher below.
    const input = this.processor.process(e);

    // =========================================================================
    // Alt-tap detector: track Alt down/up. Bare Alt-down is never a
    // shortcut leader — return early so the matcher doesn't see it.
    // =========================================================================
    this.handleAltTapDetectorKeyDown(input);
    // Bare modifier keydowns (Shift/Ctrl/Alt/Meta + CapsLock) are register
    // transitions, not shortcut events — the next non-modifier keystroke
    // carries the modifier state in `input.modifiers`. Skip them so they don't:
    // - fire bare Alt as a leader (Excel parity: Alt completes on tap-up).
    // - kill an in-flight chord buffer (e.g. Alt+H armed, then Shift+4 —
    // the Shift keydown must not noMatch the Alt+H,Shift+4 chord).
    // The Alt-tap detector above still observes them so a Shift between
    // Alt-down and Alt-up correctly invalidates the tap (line 904-906 in
    // `handleAltTapDetectorKeyDown` flips `hadInterveningKeydown`).
    // NumLock/ScrollLock are NOT filtered: see physical-keys.ts comment on
    // RegisterTransitionKeyCode (production view.toggle-scroll-lock binding).
    if (isRegisterTransitionKey(input.physicalKey)) {
      return { handled: false, reason: 'not_found' };
    }

    // =========================================================================
    // ESC during pending chord — clear and let the normal Escape shortcut
    // (CANCEL_EDIT) fall through. This keeps Escape's existing behavior
    // (close menus, cancel edits) intact while also clearing the chord.
    // =========================================================================
    if (this.chordPending !== null && input.physicalKey === 'Escape') {
      this.cancelChord('escape');
      // Don't return — let the normal matcher run so any Escape shortcut
      // (e.g. CANCEL_EDIT) still fires. The buffer is empty now, so the
      // matcher sees a plain Escape.
    }

    // =========================================================================
    // Selection-mode pre-handler
    // =========================================================================
    // When End or Extend mode is active, certain keys map to a different
    // canonical action. End mode treats Arrow as Ctrl+Arrow and Home as
    // Ctrl+End; Extend mode treats Arrow as Shift+Arrow. Additive mode does
    // NOT route here — the machine interprets MOUSE_DOWN / KEY_ARROW under
    // additive directly. Action-name routing is a coordinator concern;
    // mutation strategy is a machine concern.
    const selectionModeResult = this.dispatchSelectionModeAction(e.code, e.shiftKey);
    if (selectionModeResult) {
      return selectionModeResult;
    }

    const currentContext = this.getCurrentContext();

    // =========================================================================
    // Chord routing. Two stages:
    // (a) If chord buffer has pending shortcuts, drive
    // `matchChordContinuation`. Match → dispatch + clear. Pending →
    // update buffer. NoMatch → clear buffer and fall through to the
    // normal matcher (Excel parity: stray key after half-typed chord
    // still fires its own shortcut).
    // (b) If chord buffer is empty AND we're in `'keyTipMode'` (post
    // Alt-tap) OR the input has Alt held, drive `matchChordStart`.
    // Pending → buffer the chord, return handled. Matched → fall
    // through to dispatch (existing matcher still drives this).
    // NoMatch → fall through to the normal matcher.
    // =========================================================================
    const chordRoutingResult = this.routeThroughChordBuffer(input, currentContext);
    if (chordRoutingResult !== null) {
      return chordRoutingResult;
    }

    // Recompute context after chord routing in case the chord buffer was
    // cleared by `noMatch` and we need to fall through with the original
    // context (chordPending is now null, so getCurrentContext returns the
    // base context, e.g. 'grid').
    const fallthroughContext = this.getCurrentContext();

    const { shortcut, hadCandidates, blockedByRepeat } = this.matcher.matchWithReason(
      input,
      fallthroughContext,
    );

    if (!shortcut) {
      // Cross-sheet formula character forwarding: when in formulaEnterMode and a
      // printable character has no matching shortcut, the inline cell editor is not
      // visible (it's on another sheet). Forward the character through the
      // INSERT_CHAR action so it routes through the normal dispatch pipeline.
      if (
        fallthroughContext === 'formulaEnterMode' &&
        input.character.length === 1 &&
        !input.modifiers.ctrl &&
        !input.modifiers.meta &&
        !input.modifiers.alt
      ) {
        const focused = document.activeElement;
        const isInputFocused =
          focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
        if (!isInputFocused && this.deps?.dispatch) {
          const actionDeps = this.buildActionDependencies();
          if (actionDeps) {
            const result = this.deps.dispatch('INSERT_CHAR', actionDeps, { char: input.character });
            return {
              handled: getHandledSync(
                result as
                  | import('@mog-sdk/contracts/actions').ActionResult
                  | Promise<import('@mog-sdk/contracts/actions').ActionResult>,
              ),
              action: 'INSERT_CHAR',
            };
          }
        }
      }

      if (!hadCandidates) {
        return { handled: false, reason: 'not_found' };
      }
      if (blockedByRepeat) {
        return { handled: false, reason: 'not_found' };
      }
      return { handled: false, reason: 'wrong_context' };
    }

    if (shortcut.browserConflict?.policy === 'defer') {
      return { handled: false, reason: 'browser_defer' };
    }

    // Read-only mode: block mutating shortcuts via allowlist
    if (this.deps?.readOnly && !READ_ONLY_ALLOWED_ACTIONS.has(shortcut.action)) {
      return { handled: true, action: shortcut.action, reason: 'wrong_context' };
    }

    // Build ActionDependencies and dispatch
    const actionDeps = this.buildActionDependencies();
    if (!actionDeps) {
      return { handled: false, reason: 'not_found' };
    }

    if (!this.deps?.dispatch) {
      return { handled: false, reason: 'not_found' };
    }

    // forward `shortcut.actionArg` as the
    // dispatcher payload so chord shortcuts (e.g. SWITCH_RIBBON_TAB with
    // `actionArg: { tabId: 'home' }`) carry their typed argument through.
    const result = this.deps.dispatch(shortcut.action, actionDeps, shortcut.actionArg);

    return {
      handled: getHandledSync(
        result as
          | import('@mog-sdk/contracts/actions').ActionResult
          | Promise<import('@mog-sdk/contracts/actions').ActionResult>,
      ),
      action: shortcut.action,
    };
  }

  /**
   * Drive the chord buffer for this input. Returns a result if the input
   * was fully handled by the chord layer (chord pended or chord matched),
   * or `null` to fall through to the normal matcher.
   *
   * Three branches, in order:
   *
   * (a) **Mid-chord (`chordPending.shortcuts.length > 0`)** —
   * call {@link ShortcutMatcher.matchChordContinuation}.
   * - `'matched'`: dispatch the chord shortcut, clear buffer, return handled.
   * - `'pending'`: store advanced buffer, return handled.
   * - `'noMatch'`: clear buffer, fall through (Excel parity — stray
   * key after half-typed chord still fires its own shortcut).
   *
   * (b) **Post Alt-tap (`chordPending.shortcuts.length === 0`)** —
   * the user just released Alt; expect a leading-key keydown.
   * Call {@link ShortcutMatcher.matchChordStart}.
   * - `'pending'`: store buffer, return handled.
   * - `'matched'`: a plain shortcut (non-chord) matched; fall
   * through so the normal dispatch path runs. Clear the chord
   * buffer first so we don't double-dispatch.
   * - `'noMatch'`: clear buffer, fall through.
   *
   * (c) **No chord buffer** — fall through; the normal matcher handles
   * this input. Chord shortcuts that the user enters via Alt-held
   * (e.g., `Alt+H` typed without an Alt-tap pre-amble) are routed
   * through `matchChordStart` here too — but the empty-buffer
   * path handles that uniformly when the buffer is post-Alt-tap.
   * For Alt-held-then-letter, the normal matcher will route via
   * `matchWithReason` as before; chord shortcuts whose leading
   * binding's modifier is `alt` AND whose `contexts` includes
   * `'grid'` are still findable in the grid bucket.
   */
  private routeThroughChordBuffer(
    input: KeyboardInput,
    context: ShortcutContext,
  ): KeyboardHandleResult | null {
    if (this.chordPending !== null) {
      // Mid-chord (case a)
      if (this.chordPending.shortcuts.length > 0) {
        const result: ChordMatchResult<KeyboardShortcut> = this.matcher.matchChordContinuation(
          input,
          this.chordPending.shortcuts,
        );
        if (result.kind === 'matched') {
          this.cancelChord('chord-matched');
          return this.dispatchShortcut(result.shortcut);
        }
        if (result.kind === 'pending') {
          const activePending = this.dispatchAndConsumeCompletedChordPrefixes(
            this.chordPending.shortcuts,
            result.pending,
          );
          if (activePending.some((entry) => this.isCompletedChordPrefix(entry))) {
            this.armChordDisambigTimer();
          } else {
            // Advanced without a deferred default — no deadline applies.
            this.clearChordDisambigTimer();
          }
          this.chordPending = {
            shortcuts: activePending,
            enteredAt: this.chordPending.enteredAt,
            altHeldEntry: this.chordPending.altHeldEntry,
          };
          this.notifyChordChange();
          return { handled: true, action: 'CHORD_PENDING' };
        }
        // noMatch — commit any buffered default before falling through.
        // Single-key defaults are naturally pruned from the buffer by
        // matchChordContinuation when a follow-on advances a chord
        // candidate, so they only survive here when nothing advanced.
        // Completed prefix chords that are safe to fire immediately were
        // already consumed. Deferred completed prefixes remain in the buffer
        // so they can commit here if the longer chord later fails.
        const buffer = this.chordPending.shortcuts;
        const defaultMatch = this.matcher.getDefaultMatch(buffer);
        this.cancelChord('continuation-no-match');
        if (defaultMatch) {
          this.dispatchShortcut(defaultMatch);
        }
        return null;
      }

      // Post Alt-tap (case b) — empty buffer awaiting a leader.
      //
      // Excel's KeyTip semantics: after a clean Alt tap, the user is no
      // longer physically holding Alt, but the next keystroke is still
      // interpreted against Alt-prefixed bindings ("Path A": tap Alt,
      // see hints, press `H` bare to switch to Home). The matcher's
      // modifier check is strict (`modifiersMatch` requires exact
      // equality), so we synthesize `alt: true` into the chord-leader
      // input here — the keyTipMode context is, by construction, the
      // virtual continuation of an Alt-held state. "Path B" (Alt
      // physically held while pressing the leader) sets `alt: true`
      // already; the synthesis is idempotent in that case.
      //
      // This synthesis is scoped to chord-start matching: the
      // fall-through normal matcher at the call site still sees the
      // raw input, so non-chord plain shortcuts (e.g. arrow navigation
      // after a stray Alt tap) keep their original modifier semantics.
      const leaderInput: KeyboardInput = input.modifiers.alt
        ? input
        : { ...input, modifiers: { ...input.modifiers, alt: true } };
      const result: ChordMatchResult<KeyboardShortcut> = this.matcher.matchChordStart(
        leaderInput,
        context,
      );
      if (result.kind === 'pending') {
        // Path A (Alt-tap then bare leader): dispatch any single-key default
        // immediately so the ribbon tab switches right away, while keeping
        // chord-only candidates in the buffer for follow-on keytips.
        // Excel parity: bare W after Alt-tap switches to View AND keeps View
        // keytips visible for further navigation (e.g. bare F → freeze panes).
        const defaultMatch = this.matcher.getDefaultMatch(result.pending);
        if (defaultMatch) {
          this.dispatchShortcut(defaultMatch);
        }
        const chordOnly = result.pending.filter(
          (p) => p.shortcut.sequence && p.shortcut.sequence.length > 0,
        );
        if (chordOnly.length > 0) {
          this.chordPending = {
            shortcuts: chordOnly,
            enteredAt: this.now(),
            altHeldEntry: false,
          };
          this.notifyChordChange();
          return { handled: true, action: 'CHORD_PENDING' };
        }
        // No chord follow-ons remain; clear the keytip buffer.
        this.cancelChord('path-a-no-chord-follow-ons');
        return { handled: true };
      }
      if (result.kind === 'matched') {
        // A non-chord shortcut matched the leading key; clear the empty
        // chord buffer and dispatch the matched shortcut directly. We
        // can't fall through to the normal matcher because that path
        // re-runs against the *raw* input (no synthesized Alt) and
        // would miss the same Alt-prefixed binding that just matched
        // here.
        this.cancelChord('plain-match-from-keytip');
        return this.dispatchShortcut(result.shortcut);
      }
      // noMatch — clear buffer and fall through.
      this.cancelChord('start-no-match');
      return null;
    }

    // Case c (Bug 1 fix) — Alt-held leader without a prior Alt-tap. Without
    // this branch, `Alt+A` (which has both a single-key shortcut and chord
    // shortcuts starting with `Alt+A,...`) commits immediately to the
    // single-key shortcut, never giving chord follow-ons a chance.
    //
    // We enter chord-pending mode iff `matchChordStart` returns `'pending'`
    // (meaning at least one chord candidate exists). The single-key
    // shortcut, if any, is embedded in the pending buffer as the default
    // and committed on Alt-up (via `tryCommitAltHeldDefault`) or after
    // CHORD_DISAMBIG_MS, whichever comes first.
    if (input.modifiers.alt && !input.modifiers.ctrl && !input.modifiers.meta) {
      const result: ChordMatchResult<KeyboardShortcut> = this.matcher.matchChordStart(
        input,
        context,
      );
      if (result.kind === 'pending') {
        this.chordPending = {
          shortcuts: result.pending,
          enteredAt: this.now(),
          altHeldEntry: true,
        };
        this.armChordDisambigTimer();
        this.notifyChordChange();
        return { handled: true, action: 'CHORD_PENDING' };
      }
      // 'matched' or 'noMatch' → fall through to the normal matcher.
    }

    return null;
  }

  private dispatchAndConsumeCompletedChordPrefixes(
    previous: readonly PendingShortcut<KeyboardShortcut>[],
    next: readonly PendingShortcut<KeyboardShortcut>[],
  ): readonly PendingShortcut<KeyboardShortcut>[] {
    const alreadyCompleted = new Set(
      previous
        .filter((entry) => this.isCompletedChordPrefix(entry))
        .map((entry) => entry.shortcut.id),
    );
    const active: PendingShortcut<KeyboardShortcut>[] = [];

    for (const entry of next) {
      if (!this.isCompletedChordPrefix(entry)) {
        active.push(entry);
        continue;
      }

      if (!this.shouldDispatchCompletedChordPrefixImmediately(entry)) {
        active.push(entry);
        continue;
      }

      if (!alreadyCompleted.has(entry.shortcut.id)) {
        this.dispatchShortcut(entry.shortcut);
        alreadyCompleted.add(entry.shortcut.id);
      }
    }

    return active;
  }

  private isCompletedChordPrefix(entry: PendingShortcut<KeyboardShortcut>): boolean {
    const sequenceLength = entry.shortcut.sequence?.length ?? 0;
    return sequenceLength > 0 && entry.cursor >= sequenceLength;
  }

  private shouldDispatchCompletedChordPrefixImmediately(
    entry: PendingShortcut<KeyboardShortcut>,
  ): boolean {
    return entry.shortcut.action === 'SWITCH_RIBBON_TAB';
  }

  /**
   * Commit the embedded single-key default for an Alt-held chord-pending
   * buffer when Alt is released. Bug 1 fix: a user who typed `Alt+A` and
   * released Alt (no follow-on) wants the Data ribbon tab — Excel parity.
   *
   * Returns `true` if a default was committed.
   */
  private tryCommitAltHeldDefault(): boolean {
    if (this.chordPending === null) return false;
    if (!this.chordPending.altHeldEntry) return false;
    // If any chord entry advanced past cursor 0, the user typed a chord
    // follow-on too; don't fire the default. The chord either completed
    // already (buffer cleared) or is mid-sequence (let it continue).
    const advanced = this.chordPending.shortcuts.some((p) => p.cursor > 0);
    if (advanced) return false;
    const def = this.matcher.getDefaultMatch(this.chordPending.shortcuts);
    if (!def) {
      // No default to commit (chord-only leader released without follow-on).
      // Clear the buffer per Excel parity — incomplete chord on Alt-release dies.
      this.cancelChord('alt-up-no-default');
      return false;
    }
    this.cancelChord('alt-up-commit-default');
    this.dispatchShortcut(def);
    return true;
  }

  /**
   * Dispatch a single shortcut and return the keyboard-handle result.
   * Mirrors the dispatch tail of {@link handleKeyboardEvent} for the
   * non-chord path; extracted so the chord path stays tight.
   */
  private dispatchShortcut(shortcut: KeyboardShortcut): KeyboardHandleResult {
    if (shortcut.browserConflict?.policy === 'defer') {
      return { handled: false, reason: 'browser_defer' };
    }
    if (this.deps?.readOnly && !READ_ONLY_ALLOWED_ACTIONS.has(shortcut.action)) {
      return { handled: true, action: shortcut.action, reason: 'wrong_context' };
    }
    const actionDeps = this.buildActionDependencies();
    if (!actionDeps) return { handled: false, reason: 'not_found' };
    if (!this.deps?.dispatch) return { handled: false, reason: 'not_found' };
    // forward `actionArg` as dispatcher payload (chord shortcut path).
    const result = this.deps.dispatch(shortcut.action, actionDeps, shortcut.actionArg);
    return {
      handled: getHandledSync(
        result as
          | import('@mog-sdk/contracts/actions').ActionResult
          | Promise<import('@mog-sdk/contracts/actions').ActionResult>,
      ),
      action: shortcut.action,
    };
  }

  // ===========================================================================
  // F8 EXTEND MODE HANDLING
  // ===========================================================================

  // ===========================================================================
  // SELECTION MODE ROUTING
  // ===========================================================================

  /**
   * Resolve the canonical action name when a selection mode (End / Extend)
   * is active. Returns null when no mode is active or the key isn't an
   * arrow / Home under End-mode.
   *
   * Reads `ctx.modes` directly off the selection actor — the source of
   * truth lives in the machine. End and Extend keep coordinator-side
   * routing because they genuinely change *which action* fires (different
   * motion type / treating arrows as if shift held). Additive doesn't
   * change the action — it changes the mutation strategy applied to the
   * existing range list, and the machine's KEY_ARROW / MOUSE_DOWN guards
   * read `ctx.modes.additive` directly.
   *
   */
  private resolveSelectionAction(keyCode: string, hasShift: boolean): string | null {
    const ctx = this.deps?.selectionActor?.getSnapshot()?.context as
      | { modes?: { end?: boolean; extend?: boolean; additive?: boolean } }
      | undefined;
    const modes = ctx?.modes;
    if (!modes) return null;

    // End mode wins (auto-deactivates after navigation; the machine handles
    // the deact via SET_SELECTION's mode-clearing on non-`'user'` source —
    // edge handlers replace the selection wholesale).
    if (modes.end) {
      const dir = arrowKeyToDirection(keyCode);
      if (dir) {
        return hasShift ? `EXTEND_TO_EDGE_${dir}` : `MOVE_TO_EDGE_${dir}`;
      }
      // End + Home: jump to last used cell (Excel parity — same as Ctrl+End).
      if (keyCode === 'Home') {
        return 'MOVE_TO_LAST_USED_CELL';
      }
      return null;
    }

    // Extend mode (F8): arrows behave as if Shift were held. Sticky until Esc.
    if (modes.extend) {
      const dir = arrowKeyToDirection(keyCode);
      if (dir) {
        return `EXTEND_SELECTION_${dir}`;
      }
      return null;
    }

    // Additive and default modes use the same action names — additive
    // semantics are realized inside the machine.
    // Returning null lets the normal shortcut matcher run.
    return null;
  }

  /**
   * Drive the selection-mode pre-handler. If a mode-aware action resolves,
   * dispatch it via the normal action pipeline and return a result. End-mode
   * exits via the machine's own SET_SELECTION mode-clear on the next
   * non-`'user'` source — the EXTEND_TO_EDGE_* / MOVE_TO_EDGE_* handlers
   * call `setSelection(...)` which clears modes.
   *
   * Only fires in grid context — editing context owns its own keyboard
   * mapping and the mode flags shouldn't apply there.
   */
  private dispatchSelectionModeAction(
    keyCode: string,
    hasShift: boolean,
  ): KeyboardHandleResult | null {
    if (this.getCurrentContext() !== 'grid') return null;

    const action = this.resolveSelectionAction(keyCode, hasShift);
    if (!action) return null;

    const actionDeps = this.buildActionDependencies();
    if (!actionDeps) return null;
    if (!this.deps?.dispatch) return null;

    const result = this.deps.dispatch(action as ActionType, actionDeps);

    // End mode auto-deactivates after navigation; Extend mode is sticky
    // (user must press Esc, handled via EXIT_SELECTION_MODES → exitAllModes).
    // The dispatched action's own setSelection (e.g. MOVE_TO_EDGE_DOWN
    // calling commands.selection.setSelection) flows through the SET_SELECTION
    // event with source !== 'user', which clears modes via the source-aware
    // assign in selection-actions. So End deactivates implicitly.
    const ctx = this.deps?.selectionActor?.getSnapshot()?.context as
      | { modes?: { end?: boolean } }
      | undefined;
    if (ctx?.modes?.end) {
      // The action might be sync-no-op (action handler returns notHandled).
      // Belt-and-suspenders: explicitly clear end-mode after the dispatch so
      // the next arrow key returns to default routing even if the action
      // didn't issue a SET_SELECTION.
      this.deps.selectionActor.send({ type: 'SET_MODE', mode: 'end', value: false });
    }

    return {
      handled: getHandledSync(
        result as
          | import('@mog-sdk/contracts/actions').ActionResult
          | Promise<import('@mog-sdk/contracts/actions').ActionResult>,
      ),
      action,
    };
  }

  // ===========================================================================
  // ACTION DEPENDENCIES
  // ===========================================================================

  private buildActionDependencies(): ActionDependencies | null {
    if (!this.deps) return null;

    // uiStore is required for ActionDependencies
    if (!this.deps.uiStore) return null;

    // Create Actor Access Layer for type-safe accessors and commands (injected)
    const { accessors, commands } = this.deps.createAccessLayer({
      selectionActor: this.deps.selectionActor,
      editorActor: this.deps.editorActor,
      clipboardActor: this.deps.clipboardActor,
      chartActor: this.deps.chartActor,
      objectActor: this.deps.objectInteractionActor,
      commentActor: this.deps.commentActor,
      findReplaceActor: this.deps.findReplaceActor,
      rendererActor: this.deps.rendererActor,
    });

    return {
      workbook: this.deps.workbook,
      accessors,
      commands,
      getActiveSheetId: () => toSheetId(this.deps!.getActiveSheetId()),
      platform: this.deps.platform,
      shellService: this.deps.shellService,
      featureGates: this.deps.featureGates,
      hostCommands: this.deps.hostCommands,
      onUIAction: this.deps.onUIAction,
      hasObjectSelection: this.deps.hasObjectSelection,
      isEditingObjectText: this.deps.isEditingObjectText,
      getSelection: () => this.deps?.selectionActor.getSnapshot(),
      uiStore: this.deps.uiStore!,
      coordinator: this.deps.getCoordinator?.(),
      dispatchContextMenu: (clientX?: number, clientY?: number) => {
        const coord = this.deps?.getCoordinator?.() as
          | { input?: { dispatchContextMenu?: (clientX?: number, clientY?: number) => boolean } }
          | undefined;
        return coord?.input?.dispatchContextMenu?.(clientX, clientY) ?? false;
      },
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  getContext(): ShortcutContext {
    return this.getCurrentContext();
  }

  /**
   * Check if a shortcut is available in the current context.
   *
   * @param bindingString - Serialized binding (e.g., "ctrl+KeyS" or "ctrl+key:b")
   * @returns True if there's an enabled shortcut for this binding
   */
  isShortcutAvailable(bindingString: string): boolean {
    return this.getShortcutsForKey(bindingString).length > 0;
  }

  /**
   * Get all shortcuts registered in the matcher.
   * Used by tests to verify lookup table contents.
   *
   * @param bindingString - Serialized binding key (used to filter by physical code)
   * @returns Array of shortcuts matching this binding
   */
  getShortcutsForKey(bindingString: string): KeyboardShortcut[] {
    // Delegate to matcher: get all shortcuts and filter by binding
    const filtered = this.matcher.getAllShortcuts().filter((s) => {
      if (!s.enabled) return false;
      const binding = resolveBinding(s.bindings, this.platform);
      // Check code-based match
      if (binding.code === bindingString) return true;
      // Check with modifiers
      const modifiers = [...binding.modifiers].sort();
      if (modifiers.length === 0) return binding.code === bindingString;
      const serialized = [...modifiers, binding.code].join('+');
      return serialized === bindingString;
    });
    // Sort by priority (highest first) to match original bucket ordering
    filtered.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return filtered;
  }

  // ===========================================================================
  // KEYUP HANDLING
  // ===========================================================================

  /**
   * Handle keyup events.
   *
   * Currently handles:
   * - Ctrl keyup shortly after paste: shows paste options menu
   *
   * Keyboard Shortcuts
   *
   * @returns true if the event was handled and should preventDefault
   */
  handleKeyUp(e: KeyboardEvent): boolean {
    // Alt-tap promotion: a clean Alt-up within ALT_TAP_MAX_MS of the
    // matching Alt-down enters keytip mode. Bubble this branch first so
    // an Alt key release doesn't fall through to the Ctrl/Meta paste-options
    // logic below.
    if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
      const promoted = this.tryPromoteAltTap();
      if (promoted) {
        return true;
      }
      // Bug 1 fix: Alt-up while an Alt-held chord-pending buffer is live
      // commits the embedded single-key default. The user typed `Alt+A`
      // and released Alt without following up — Excel switches the Data
      // tab. Without this, the buffer would survive until CHORD_DISAMBIG_MS
      // fires, which is past the test scenario's `settle` window.
      const committed = this.tryCommitAltHeldDefault();
      if (committed) {
        return true;
      }
      // Even when neither path fired (Alt held with intervening keydown
      // and no committable default), the keyup itself isn't a
      // coordinator concern. Return false so React's default behavior
      // runs.
      return false;
    }

    // Only handle Ctrl or Meta key release (Meta is Cmd on Mac)
    if (e.key !== 'Control' && e.key !== 'Meta') {
      return false;
    }

    // Check if we should show paste options menu
    const uiStore = this.deps?.uiStore;
    if (!uiStore) {
      return false;
    }

    const state = uiStore.getState();
    if (state.shouldShowPasteOptionsOnCtrlUp()) {
      // Open the paste options menu
      state.openPasteOptionsMenu();
      return true;
    }

    return false;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createKeyboardCoordinator(platform: Platform): KeyboardCoordinator {
  return new KeyboardCoordinator(platform);
}
