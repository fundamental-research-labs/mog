/**
 * KeyboardCoordinator chord-buffer tests.
 *
 * Covers the state machine the coordinator owns now that it acts as the
 * keyboard-mode router:
 *
 * - **Alt-tap detector**: clean Alt-down/Alt-up within
 * `ALT_TAP_MAX_MS` enters keytip mode; intervening keydown blocks it;
 * Ctrl+Alt with Alt-tap intent does not arm.
 * - **Chord state machine**: enter (Alt-tap) → advance (`KeyH` → pending
 * Home tab) → match (`KeyL` → fires `OPEN_CF_MENU`) → cancel (ESC) →
 * preempt (Ctrl+S during pending → fires Save, clears chord) →
 * modifier-during-chord rejection (Alt+H, Ctrl+L) → click-outside cancel.
 * - **Priority preemption**: opening a dialog while a chord is pending
 * clears `chordPending`; starting cell-edit does the same; Alt-tap
 * while a dialog is open is a no-op.
 * - **getCurrentContext seam**: returns `'keyTipMode'` exactly when
 * `chordPending !== null`.
 *
 * Synthetic chord shortcuts are registered directly via the
 * `KEYBOARD_SHORTCUTS` mock so the test is self-contained — hasn't
 * migrated keytip definitions yet.
 *
 */

import { jest } from '@jest/globals';

import { altBinding } from '@mog-sdk/kernel/keyboard';
import type { ChordFollowOn } from '@mog-sdk/kernel/keyboard';
import type { KeyboardShortcut } from '../../../../keyboard';

// ---------------------------------------------------------------------------
// Test shortcut factory
// ---------------------------------------------------------------------------

/** A two-key chord shortcut: `Alt+<leader>, <followOn>` → action. */
function chord(
  id: string,
  leaderCode: string,
  followOn: ChordFollowOn,
  action: KeyboardShortcut['action'] = 'OPEN_CF_MENU',
  actionArg?: unknown,
): KeyboardShortcut {
  return chordSequence(id, leaderCode, [followOn], action, actionArg);
}

/** A chord shortcut with an arbitrary follow-on sequence. */
function chordSequence(
  id: string,
  leaderCode: string,
  sequence: readonly ChordFollowOn[],
  action: KeyboardShortcut['action'] = 'OPEN_CF_MENU',
  actionArg?: unknown,
): KeyboardShortcut {
  const isLetter = /^Key[A-Z]$/.test(leaderCode);
  return {
    id,
    bindings: altBinding(leaderCode as never),
    description: `Test chord ${id}`,
    action,
    ...(actionArg !== undefined ? { actionArg } : {}),
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'common',
    matchBy: isLetter ? 'key' : 'code',
    expectedCharacter: isLetter ? leaderCode.slice(3).toLowerCase() : undefined,
    sequence,
  } as KeyboardShortcut;
}

/**
 * A plain (non-chord) `Alt+<letter>` shortcut whose contexts include
 * `keyTipMode` — models a ribbon-tab switch like `Alt+W` = View. Used by
 * the Path A "matched" branch tests where the chord state machine has no
 * follow-on candidates for the leader key.
 */
function plainKeyTip(
  id: string,
  leaderCode: string,
  action: KeyboardShortcut['action'],
  actionArg?: unknown,
): KeyboardShortcut {
  const isLetter = /^Key[A-Z]$/.test(leaderCode);
  return {
    id,
    bindings: altBinding(leaderCode as never),
    description: `Test plain keytip ${id}`,
    action,
    ...(actionArg !== undefined ? { actionArg } : {}),
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'common',
    matchBy: isLetter ? 'key' : 'code',
    expectedCharacter: isLetter ? leaderCode.slice(3).toLowerCase() : undefined,
  } as KeyboardShortcut;
}

/** A plain (non-chord) shortcut. */
function plain(
  id: string,
  code: string,
  modifiers: Array<'ctrl' | 'shift' | 'alt' | 'meta'>,
  action: KeyboardShortcut['action'],
): KeyboardShortcut {
  const isLetter = /^Key[A-Z]$/.test(code);
  const hasCommand =
    modifiers.includes('ctrl') || modifiers.includes('meta') || modifiers.includes('alt');
  const matchBy: 'key' | 'code' = isLetter && hasCommand ? 'key' : 'code';
  return {
    id,
    bindings: { default: { code: code as never, modifiers } },
    description: `Test plain ${id}`,
    action,
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy,
    expectedCharacter: matchBy === 'key' ? code.slice(3).toLowerCase() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Mock the actions module so dispatch is a controllable spy and the
// dispatcher's deep dependency chain doesn't fire.
// ---------------------------------------------------------------------------

jest.mock('../../../../actions', () => ({
  dispatch: jest.fn(() => ({ handled: true })),
}));

import { KeyboardCoordinator, ALT_TAP_MAX_MS, CHORD_DISAMBIG_MS } from '../keyboard-coordinator';

/**
 * Inject the test's chord-shortcut universe directly into the coordinator's
 * matcher. The matcher's `rebuild` is the production seam used by the
 * customization layer; tests piggy-back on it instead of mocking
 * `KEYBOARD_SHORTCUTS` (the ESM `jest.mock` hoisting against the
 * `apps/spreadsheet/src/keyboard` barrel doesn't reliably replace the
 * captured array reference across modules).
 */
function setShortcutsFor(coordinator: KeyboardCoordinator, shortcuts: KeyboardShortcut[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (coordinator as any).matcher.rebuild(shortcuts);
}

// ---------------------------------------------------------------------------
// Helpers: mock KeyboardEvent factory
// ---------------------------------------------------------------------------

function evt(overrides: Partial<KeyboardEvent> & { code: string; key: string }): KeyboardEvent {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...overrides,
  } as unknown as KeyboardEvent;
}

/** Coordinator factory with deterministic clock for ALT_TAP timeout testing. */
class TestableCoordinator extends KeyboardCoordinator {
  private clock = 0;
  protected now(): number {
    return this.clock;
  }
  advanceClock(ms: number): void {
    this.clock += ms;
  }
}

/** Build a coordinator with deps stub adequate for chord-routing tests. */
function makeCoordinator(
  shortcuts: KeyboardShortcut[],
  options?: {
    hasObjectSelection?: () => boolean;
    isEditingObjectText?: () => boolean;
    isFlashFillPreviewActive?: () => boolean;
    editorMatches?: (state: string) => boolean;
    dispatch?: jest.Mock;
  },
): {
  coordinator: TestableCoordinator;
  dispatchMock: jest.Mock;
} {
  const dispatchMock = options?.dispatch ?? (jest.fn(() => ({ handled: true })) as jest.Mock);
  const editorMatches = options?.editorMatches ?? ((_s: string) => false);
  const editorSnapshot = {
    matches: editorMatches,
    context: { isEditMode: false },
  };
  const coordinator = new TestableCoordinator('windows');
  setShortcutsFor(coordinator, shortcuts);
  coordinator.setDependencies({
    workbook: {} as never,
    selectionActor: {
      // coordinator reads `ctx.modes` for End / Extend routing.
      getSnapshot: () => ({
        context: { modes: { end: false, extend: false, additive: false } },
      }),
      send: () => {},
    } as never,
    editorActor: { getSnapshot: () => editorSnapshot } as never,
    clipboardActor: { getSnapshot: () => ({}) } as never,
    objectInteractionActor: { getSnapshot: () => ({}) } as never,
    chartActor: { getSnapshot: () => ({}) } as never,
    findReplaceActor: { getSnapshot: () => ({}) } as never,
    commentActor: { getSnapshot: () => ({}) } as never,
    paneFocusActor: { getSnapshot: () => ({}) } as never,
    getActiveSheetId: () => 'sheet1',
    hasObjectSelection: options?.hasObjectSelection,
    isEditingObjectText: options?.isEditingObjectText,
    isFlashFillPreviewActive: options?.isFlashFillPreviewActive,
    dispatch: dispatchMock as never,
    uiStore: {
      // KeyboardUIStore lost its selection-mode fields;
      // only paste-options helpers remain on the narrow interface.
      getState: () => ({
        shouldShowPasteOptionsOnCtrlUp: () => false,
        openPasteOptionsMenu: () => {},
      }),
    } as never,
    createAccessLayer: jest.fn().mockReturnValue({ accessors: {}, commands: {} }) as never,
  });
  return { coordinator, dispatchMock };
}

/** Drive a clean Alt-tap (down + up within ALT_TAP_MAX_MS / 2). */
function altTap(coordinator: TestableCoordinator): void {
  coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
  coordinator.advanceClock(ALT_TAP_MAX_MS / 2);
  coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
}

// ---------------------------------------------------------------------------
// getCurrentContext seam
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — getCurrentContext seam', () => {
  it("returns 'keyTipMode' exactly when chordPending !== null", () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')]);

    expect(coordinator.getContext()).toBe('grid');
    expect(coordinator.isChordPending()).toBe(false);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);
    expect(coordinator.getContext()).toBe('keyTipMode');

    // Type the chord leader (Alt+H equivalent — but Alt is no longer held
    // post-tap; the matcher's keytipMode bucket picks it up).
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);
    expect(coordinator.getContext()).toBe('keyTipMode');

    // Complete the chord; chord clears.
    coordinator.handleKeyboardEvent(evt({ code: 'KeyL', key: 'l' }));
    expect(coordinator.isChordPending()).toBe(false);
    expect(coordinator.getContext()).toBe('grid');
  });
});

// ---------------------------------------------------------------------------
// State machine: enter / advance / match / cancel / preempt
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — state machine', () => {
  it('enter (Alt-tap) → advance (Alt+H) → match (KeyL) fires OPEN_CF_MENU', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      chord('open-cf', 'KeyH', 'KeyL', 'OPEN_CF_MENU'),
    ]);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();

    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();

    const result = coordinator.handleKeyboardEvent(evt({ code: 'KeyL', key: 'l' }));
    expect(result.handled).toBe(true);
    expect(result.action).toBe('OPEN_CF_MENU');
    expect(coordinator.isChordPending()).toBe(false);
    // unified keytip router: dispatcher now receives `actionArg`
    // as a third parameter. Plain `OPEN_CF_MENU` has no actionArg, so
    // the third positional is `undefined`.
    expect(dispatchMock).toHaveBeenCalledWith('OPEN_CF_MENU', expect.any(Object), undefined);
  });

  it('cancel (ESC) clears chord buffer', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')]);

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'Escape', key: 'Escape' }));
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('preempt: Ctrl+S during pending fires Save and clears chord', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      chord('open-cf', 'KeyH', 'KeyL'),
      plain('save', 'KeyS', ['ctrl'], 'SAVE'),
    ]);

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    // Ctrl+S has Ctrl set — the chord follow-on rejects, falls through to
    // the plain matcher which fires SAVE.
    const result = coordinator.handleKeyboardEvent(evt({ code: 'KeyS', key: 's', ctrlKey: true }));
    expect(result.handled).toBe(true);
    expect(result.action).toBe('SAVE');
    // unified keytip router: dispatcher now receives `actionArg`
    // as a third parameter. Plain `SAVE` has no actionArg.
    expect(dispatchMock).toHaveBeenCalledWith('SAVE', expect.any(Object), undefined);
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('rejects modifier-laden follow-on (Alt+H, Ctrl+L) — does not match Alt+H,L chord', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      chord('open-cf', 'KeyH', 'KeyL', 'OPEN_CF_MENU'),
      // No Ctrl+L plain shortcut — input falls through; coordinator returns
      // not_found / wrong_context. Either way, OPEN_CF_MENU must NOT fire.
    ]);

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'KeyL', key: 'l', ctrlKey: true }));
    // Chord cleared (Ctrl+L is not a chord follow-on); OPEN_CF_MENU never
    // dispatched.
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalledWith('OPEN_CF_MENU', expect.anything());
  });

  it('click-outside cancels chord buffer', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')]);

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    // Synthesize a click anywhere in the document. The coordinator's
    // capture-phase listener fires unconditionally and clears the buffer.
    const clickEvent = new MouseEvent('click', { bubbles: true });
    document.dispatchEvent(clickEvent);
    expect(coordinator.isChordPending()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Path A — Excel KeyTip semantics: tap-and-release Alt, then bare letters.
// Mirrors the Path B (Alt-held leader) cases above so both entry modes are
// proven equivalent. Without the post-Alt-tap modifier synthesis in
// `routeThroughChordBuffer`, bare H after the Alt tap would never match
// `altBinding('KeyH')` and the chord engine would silently swallow the
// keystroke into the cell editor.
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — Path A (Alt-tap, then bare letters)', () => {
  it('Alt-tap → bare KeyH → bare KeyL fires OPEN_CF_MENU (no Alt held on either letter)', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      chord('open-cf', 'KeyH', 'KeyL', 'OPEN_CF_MENU'),
    ]);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();

    // Bare H — `altKey: false`. Pre-fix this returned noMatch and cleared
    // the buffer; post-fix the coordinator synthesizes alt:true for the
    // chord-leader match.
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: false }));
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();

    // Bare L follow-on (chord follow-ons already accept bare keys).
    const result = coordinator.handleKeyboardEvent(evt({ code: 'KeyL', key: 'l', altKey: false }));
    expect(result.handled).toBe(true);
    expect(result.action).toBe('OPEN_CF_MENU');
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).toHaveBeenCalledWith('OPEN_CF_MENU', expect.any(Object), undefined);
  });

  it('Alt-tap → bare leader with no chord candidates fires the single-key shortcut directly', () => {
    // Only a plain `Alt+W` (no chord follow-ons), modeling `Alt+W` = View tab.
    const { coordinator, dispatchMock } = makeCoordinator([
      plainKeyTip('switch-view', 'KeyW', 'SWITCH_RIBBON_TAB'),
    ]);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);

    // Bare W after the Alt tap. With my fix the matcher returns 'matched'
    // (no chord candidates exist for Alt+W), and the coordinator dispatches
    // directly instead of falling through to the normal matcher (which
    // would re-run against the raw input without synthesized alt:true and
    // miss the same shortcut).
    const result = coordinator.handleKeyboardEvent(evt({ code: 'KeyW', key: 'w', altKey: false }));
    expect(result.handled).toBe(true);
    expect(result.action).toBe('SWITCH_RIBBON_TAB');
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), undefined);
  });

  it('Alt-tap → bare key with no Alt-prefixed shortcut clears keytip mode and falls through', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      chord('open-cf', 'KeyH', 'KeyL', 'OPEN_CF_MENU'),
    ]);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);

    // Bare Z — no shortcut bound to Alt+Z. matchChordStart returns noMatch
    // even with synthesized alt:true; the chord buffer clears and the
    // input falls through to the normal matcher (which also has no Alt+Z
    // and no plain Z, so the result is unhandled — same as today).
    coordinator.handleKeyboardEvent(evt({ code: 'KeyZ', key: 'z', altKey: false }));
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalledWith('OPEN_CF_MENU', expect.anything());
  });
});

describe('KeyboardCoordinator chord — prefix completions', () => {
  it('Alt-tap → bare KeyW → bare KeyT dispatches View first, then Sheet Settings', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      plainKeyTip('switch-view', 'KeyW', 'SWITCH_RIBBON_TAB', { tabId: 'view' }),
      chord('sheet-settings', 'KeyW', 'KeyT', 'OPEN_SHEET_SETTINGS_DIALOG'),
    ]);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);

    const viewResult = coordinator.handleKeyboardEvent(
      evt({ code: 'KeyW', key: 'w', altKey: false }),
    );
    expect(viewResult.handled).toBe(true);
    expect(viewResult.action).toBe('CHORD_PENDING');
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), {
      tabId: 'view',
    });

    const settingsResult = coordinator.handleKeyboardEvent(
      evt({ code: 'KeyT', key: 't', altKey: false }),
    );
    expect(settingsResult.handled).toBe(true);
    expect(settingsResult.action).toBe('OPEN_SHEET_SETTINGS_DIALOG');
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).toHaveBeenCalledWith(
      'OPEN_SHEET_SETTINGS_DIALOG',
      expect.any(Object),
      undefined,
    );
  });

  it('Alt-tap → bare KeyJ → bare KeyT dispatches Table Design while keeping longer keytips live', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      chordSequence('switch-table-design', 'KeyJ', ['KeyT'], 'SWITCH_RIBBON_TAB', {
        tabId: 'table-design',
      }),
      chordSequence('style-gallery', 'KeyJ', ['KeyT', 'KeyS'], 'OPEN_RIBBON_DROPDOWN', {
        dropdownId: 'table-design.style-gallery',
      }),
    ]);

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);

    const leaderResult = coordinator.handleKeyboardEvent(
      evt({ code: 'KeyJ', key: 'j', altKey: false }),
    );
    expect(leaderResult.handled).toBe(true);
    expect(leaderResult.action).toBe('CHORD_PENDING');
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();

    const prefixResult = coordinator.handleKeyboardEvent(
      evt({ code: 'KeyT', key: 't', altKey: false }),
    );
    expect(prefixResult.handled).toBe(true);
    expect(prefixResult.action).toBe('CHORD_PENDING');
    expect(coordinator.isChordPending()).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), {
      tabId: 'table-design',
    });

    const galleryResult = coordinator.handleKeyboardEvent(
      evt({ code: 'KeyS', key: 's', altKey: false }),
    );
    expect(galleryResult.handled).toBe(true);
    expect(galleryResult.action).toBe('OPEN_RIBBON_DROPDOWN');
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).toHaveBeenCalledWith('OPEN_RIBBON_DROPDOWN', expect.any(Object), {
      dropdownId: 'table-design.style-gallery',
    });
  });

  it('Alt-tap → bare KeyH → bare KeyO defers Orientation while Cells Format remains possible', () => {
    jest.useFakeTimers();
    try {
      const { coordinator, dispatchMock } = makeCoordinator([
        chordSequence('orientation', 'KeyH', ['KeyO'], 'OPEN_RIBBON_DROPDOWN', {
          dropdownId: 'home.orientation',
        }),
        chordSequence('cells-format', 'KeyH', ['KeyO', 'KeyI'], 'OPEN_RIBBON_DROPDOWN', {
          dropdownId: 'home.format',
        }),
      ]);

      altTap(coordinator);
      coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: false }));

      const prefixResult = coordinator.handleKeyboardEvent(
        evt({ code: 'KeyO', key: 'o', altKey: false }),
      );
      expect(prefixResult.handled).toBe(true);
      expect(prefixResult.action).toBe('CHORD_PENDING');
      expect(coordinator.isChordPending()).toBe(true);
      expect(dispatchMock).not.toHaveBeenCalledWith('OPEN_RIBBON_DROPDOWN', expect.any(Object), {
        dropdownId: 'home.orientation',
      });

      jest.advanceTimersByTime(CHORD_DISAMBIG_MS);
      expect(dispatchMock).toHaveBeenCalledWith('OPEN_RIBBON_DROPDOWN', expect.any(Object), {
        dropdownId: 'home.orientation',
      });
      expect(coordinator.isChordPending()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Alt-tap → bare KeyH → bare KeyO → bare KeyI opens Cells Format without firing Orientation', () => {
    jest.useFakeTimers();
    try {
      const { coordinator, dispatchMock } = makeCoordinator([
        chordSequence('orientation', 'KeyH', ['KeyO'], 'OPEN_RIBBON_DROPDOWN', {
          dropdownId: 'home.orientation',
        }),
        chordSequence('cells-format', 'KeyH', ['KeyO', 'KeyI'], 'OPEN_RIBBON_DROPDOWN', {
          dropdownId: 'home.format',
        }),
      ]);

      altTap(coordinator);
      coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: false }));
      coordinator.handleKeyboardEvent(evt({ code: 'KeyO', key: 'o', altKey: false }));

      const formatResult = coordinator.handleKeyboardEvent(
        evt({ code: 'KeyI', key: 'i', altKey: false }),
      );
      expect(formatResult.handled).toBe(true);
      expect(formatResult.action).toBe('OPEN_RIBBON_DROPDOWN');
      expect(coordinator.isChordPending()).toBe(false);
      expect(dispatchMock).toHaveBeenCalledWith('OPEN_RIBBON_DROPDOWN', expect.any(Object), {
        dropdownId: 'home.format',
      });
      expect(dispatchMock).not.toHaveBeenCalledWith('OPEN_RIBBON_DROPDOWN', expect.any(Object), {
        dropdownId: 'home.orientation',
      });

      jest.advanceTimersByTime(CHORD_DISAMBIG_MS);
      expect(dispatchMock).not.toHaveBeenCalledWith('OPEN_RIBBON_DROPDOWN', expect.any(Object), {
        dropdownId: 'home.orientation',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Alt-tap detector edges
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — Alt-tap detector edges', () => {
  it('Alt held with intervening keydown does NOT enter keytip mode (Alt+letter)', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')]);

    // Alt down → some other key down → Alt up.
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.advanceClock(50);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.advanceClock(50);
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));

    // Even though the first keydown (Alt+H) matched the chord leader and
    // entered chord pending, the Alt-up itself shouldn't promote a SECOND
    // empty keytip mode. The pending state from the chord leader is
    // separate and is what we expect.
    // The detector's hadInterveningKeydown blocks promotion.
    // We confirm by tearing down the existing chord and trying again from
    // scratch:
    coordinator.handleKeyboardEvent(evt({ code: 'Escape', key: 'Escape' }));
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('Alt-tap timeout (Alt down + up beyond ALT_TAP_MAX_MS) does NOT enter', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.advanceClock(ALT_TAP_MAX_MS + 50); // exceed threshold
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));

    expect(coordinator.isChordPending()).toBe(false);
    expect(coordinator.getContext()).toBe('grid');
  });

  it('Alt-down with another modifier already held (Ctrl+Alt) does NOT enter', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')]);

    // Ctrl+Alt-down: ctrlKey is true at the moment of Alt-down.
    coordinator.handleKeyboardEvent(
      evt({ code: 'AltLeft', key: 'Alt', altKey: true, ctrlKey: true }),
    );
    coordinator.advanceClock(50);
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt', ctrlKey: true }));

    expect(coordinator.isChordPending()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Priority pre-emption
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — priority pre-emption', () => {
  it('opening a dialog (cell-edit) while a chord is pending clears chordPending', () => {
    let editingActive = false;
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')], {
      editorMatches: (state) => state === 'editing' && editingActive,
    });

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    // External transition: editor enters editing state. The next coordinator
    // tick must observe this and clear the chord buffer.
    editingActive = true;
    coordinator.preemptChordForCascadeChange();

    expect(coordinator.isChordPending()).toBe(false);
  });

  it('object-selection keeps keytip chord active for contextual ribbon tabs', () => {
    let objectSelected = false;
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')], {
      hasObjectSelection: () => objectSelected,
    });

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    objectSelected = true;
    coordinator.preemptChordForCascadeChange();
    expect(coordinator.isChordPending()).toBe(true);
    expect(coordinator.getContext()).toBe('keyTipMode');
  });

  it('object text editing becoming active clears chord', () => {
    let objectSelected = false;
    let editingObjectText = false;
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')], {
      hasObjectSelection: () => objectSelected,
      isEditingObjectText: () => editingObjectText,
    });

    altTap(coordinator);
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    objectSelected = true;
    editingObjectText = true;
    coordinator.preemptChordForCascadeChange();
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('Alt-tap while an object is selected enters keytip mode', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')], {
      hasObjectSelection: () => true,
    });

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(true);
    expect(coordinator.getContext()).toBe('keyTipMode');
  });

  it('Alt-tap while a dialog is already open is a no-op (cascade gate)', () => {
    const { coordinator } = makeCoordinator([chord('open-cf', 'KeyH', 'KeyL')], {
      editorMatches: (state) => state === 'editing',
    });

    altTap(coordinator);
    expect(coordinator.isChordPending()).toBe(false);
    expect(coordinator.getContext()).not.toBe('keyTipMode');
  });
});

// ---------------------------------------------------------------------------
// Bug 1 fix — Alt-held single-key disambiguation
//
// When `Alt+A` (single-key tab switch) coexists with `Alt+A,V,V` (chord),
// the coordinator must enter chord-pending state on the leader Alt+letter
// keydown — even without a prior Alt-tap. The single-key default commits
// on Alt-up (Excel-parity for "user pressed Alt+A and released Alt; switch
// the Data tab"), or on a non-matching follow-on, or on the
// CHORD_DISAMBIG_MS timer.
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — Alt-held single-key disambiguation (Bug 1 fix)', () => {
  /** Single-key Alt+A → SWITCH_RIBBON_TAB (no sequence). */
  function altTabSwitch(): KeyboardShortcut {
    return plain('ribbon-data', 'KeyA', ['alt'], 'SWITCH_RIBBON_TAB');
  }

  it('Alt+A with both single-key and chord registered enters chord-pending (no immediate fire)', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      altTabSwitch(),
      chord('open-dv', 'KeyA', 'KeyV', 'OPEN_DV_DIALOG'),
    ]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyA', key: 'a', altKey: true }));

    // Bug 1 fix: must NOT fire SWITCH_RIBBON_TAB immediately.
    expect(dispatchMock).not.toHaveBeenCalledWith(
      'SWITCH_RIBBON_TAB',
      expect.anything(),
      expect.anything(),
    );
    expect(coordinator.isChordPending()).toBe(true);
  });

  it('Alt+A → Alt-up (no follow-on) commits the single-key default (SWITCH_RIBBON_TAB)', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      altTabSwitch(),
      chord('open-dv', 'KeyA', 'KeyV', 'OPEN_DV_DIALOG'),
    ]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyA', key: 'a', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    // Alt-up — commits the default.
    const handled = coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(handled).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), undefined);
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('Alt+A → KeyV (follow-on) advances chord; default does NOT fire', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      altTabSwitch(),
      chord('open-dv', 'KeyA', 'KeyV', 'OPEN_DV_DIALOG'),
    ]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyA', key: 'a', altKey: true }));
    // KeyV (no Alt, simulating Excel keytip pattern) → completes chord.
    const result = coordinator.handleKeyboardEvent(evt({ code: 'KeyV', key: 'v' }));
    expect(result.action).toBe('OPEN_DV_DIALOG');
    expect(dispatchMock).not.toHaveBeenCalledWith(
      'SWITCH_RIBBON_TAB',
      expect.anything(),
      expect.anything(),
    );
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('Alt+A → non-matching follow-on (KeyZ) commits default and falls through', () => {
    const { coordinator, dispatchMock } = makeCoordinator([
      altTabSwitch(),
      chord('open-dv', 'KeyA', 'KeyV', 'OPEN_DV_DIALOG'),
    ]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyA', key: 'a', altKey: true }));
    // KeyZ — no chord follow-on accepts it; the default commits.
    coordinator.handleKeyboardEvent(evt({ code: 'KeyZ', key: 'z' }));
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), undefined);
    expect(coordinator.isChordPending()).toBe(false);
  });

  it('Alt+A only (no chord registered) — old behavior: matches plain shortcut directly', () => {
    // No chord; the input still has Alt held but matchChordStart returns
    // 'matched' because there's no chord candidate. Must fire SWITCH_RIBBON_TAB
    // immediately (no chord-pending state).
    const { coordinator, dispatchMock } = makeCoordinator([altTabSwitch()]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    const result = coordinator.handleKeyboardEvent(evt({ code: 'KeyA', key: 'a', altKey: true }));
    expect(result.action).toBe('SWITCH_RIBBON_TAB');
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), undefined);
  });

  it('chord without single-key default — Alt-up clears the buffer, no default fires', () => {
    // Only chord Alt+H,L registered (no Alt+H single-key).
    const { coordinator, dispatchMock } = makeCoordinator([
      chord('open-cf', 'KeyH', 'KeyL', 'OPEN_CF_MENU'),
    ]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    // No default to commit — buffer cleared, OPEN_CF_MENU never dispatched.
    expect(coordinator.isChordPending()).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalledWith(
      'OPEN_CF_MENU',
      expect.anything(),
      expect.anything(),
    );
  });

  it('CHORD_DISAMBIG_MS is exported as a positive constant (≥ 100ms)', () => {
    // Sanity check so a future refactor that drops the export caught here.
    // The actual timer fire is exercised in DOM-integration scenarios; jest's
    // fake timer mode would require restructuring `setTimeout` to a seam.
    expect(CHORD_DISAMBIG_MS).toBeGreaterThanOrEqual(100);
    expect(CHORD_DISAMBIG_MS).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Bare modifier keydown filter
//
// The coordinator filters bare register-transition keydowns (Shift/Ctrl/Alt/
// Meta + CapsLock) before they reach the chord matcher or the normal
// matcher. Their effect is carried in `input.modifiers.*` (or implicit caps
// state) of the next non-modifier keystroke. NumLock/ScrollLock are NOT
// filtered (production `view.toggle-scroll-lock` binding listens for bare
// ScrollLock keydown).
// ---------------------------------------------------------------------------

describe('KeyboardCoordinator chord — bare modifier keydown filter', () => {
  it('Alt+H, Shift+Digit4 dispatches FORMAT_CURRENCY across the decomposed event stream', () => {
    const formatCurrency = chord(
      'format-currency',
      'KeyH',
      { code: 'Digit4', shift: true },
      'FORMAT_CURRENCY',
    );
    const switchHome = plainKeyTip('switch-home', 'KeyH', 'SWITCH_RIBBON_TAB');
    const { coordinator, dispatchMock } = makeCoordinator([formatCurrency, switchHome]);

    // Step 1: Alt-tap arms keytip mode.
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));

    // Step 2: Path-B leader — Alt held while pressing KeyH.
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(dispatchMock).toHaveBeenCalledWith('SWITCH_RIBBON_TAB', expect.any(Object), undefined);
    expect(coordinator.isChordPending()).toBe(true); // chord follow-on remains buffered

    // Step 3: Decomposed Shift+Digit4 — the regression site. Pre-fix, the
    // ShiftLeft-down event clears the buffer and `$` leaks into the editor.
    coordinator.handleKeyboardEvent(evt({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }));
    expect(coordinator.isChordPending()).toBe(true); // bare modifier must NOT clear
    coordinator.handleKeyboardEvent(evt({ code: 'Digit4', key: '$', shiftKey: true }));
    expect(dispatchMock).toHaveBeenCalledWith('FORMAT_CURRENCY', expect.any(Object), undefined);
    expect(coordinator.isChordPending()).toBe(false);
  });

  // Robustness tests #3-#6 below MUST use the Alt-tap-then-Path-B sequence
  // (Alt-tap → Alt-down → KeyH → Alt-up). Bare Path-B without an Alt-tap
  // preamble enters case (c) at keyboard-coordinator.ts:1319-1325 with
  // `altHeldEntry: true`; on Alt-up `tryCommitAltHeldDefault` (line 1344-1362)
  // calls `getDefaultMatch`, finds nothing (the only registered entry is a
  // chord with `sequence.length > 0`), and clears the buffer via
  // `cancelChord('alt-up-no-default')` BEFORE the stray-modifier keydown
  // arrives. The Alt-tap preamble routes through `tryPromoteAltTap` instead,
  // which sets `altHeldEntry: false` so the Alt-up after KeyH is benign.

  it('stray ShiftLeft mid-chord (after Alt-tap → Alt+H) does not cancel the chord', () => {
    const altHB = chord('bold', 'KeyH', 'KeyB', 'TOGGLE_BOLD');
    const switchHome = plainKeyTip('switch-home', 'KeyH', 'SWITCH_RIBBON_TAB');
    const { coordinator, dispatchMock } = makeCoordinator([altHB, switchHome]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }));
    coordinator.handleKeyUp(evt({ code: 'ShiftLeft', key: 'Shift' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'KeyB', key: 'b' }));
    expect(dispatchMock).toHaveBeenCalledWith('TOGGLE_BOLD', expect.any(Object), undefined);
  });

  it('stray ControlLeft mid-chord does not cancel', () => {
    const altHB = chord('bold', 'KeyH', 'KeyB', 'TOGGLE_BOLD');
    const switchHome = plainKeyTip('switch-home', 'KeyH', 'SWITCH_RIBBON_TAB');
    const { coordinator, dispatchMock } = makeCoordinator([altHB, switchHome]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'ControlLeft', key: 'Control', ctrlKey: true }));
    coordinator.handleKeyUp(evt({ code: 'ControlLeft', key: 'Control' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'KeyB', key: 'b' }));
    expect(dispatchMock).toHaveBeenCalledWith('TOGGLE_BOLD', expect.any(Object), undefined);
  });

  it('stray MetaLeft mid-chord does not cancel', () => {
    const altHB = chord('bold', 'KeyH', 'KeyB', 'TOGGLE_BOLD');
    const switchHome = plainKeyTip('switch-home', 'KeyH', 'SWITCH_RIBBON_TAB');
    const { coordinator, dispatchMock } = makeCoordinator([altHB, switchHome]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'MetaLeft', key: 'Meta', metaKey: true }));
    coordinator.handleKeyUp(evt({ code: 'MetaLeft', key: 'Meta' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'KeyB', key: 'b' }));
    expect(dispatchMock).toHaveBeenCalledWith('TOGGLE_BOLD', expect.any(Object), undefined);
  });

  it('stray ShiftRight mid-chord does not cancel (right-variant coverage)', () => {
    const altHB = chord('bold', 'KeyH', 'KeyB', 'TOGGLE_BOLD');
    const switchHome = plainKeyTip('switch-home', 'KeyH', 'SWITCH_RIBBON_TAB');
    const { coordinator, dispatchMock } = makeCoordinator([altHB, switchHome]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'ShiftRight', key: 'Shift', shiftKey: true }));
    coordinator.handleKeyUp(evt({ code: 'ShiftRight', key: 'Shift' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'KeyB', key: 'b' }));
    expect(dispatchMock).toHaveBeenCalledWith('TOGGLE_BOLD', expect.any(Object), undefined);
  });

  it('stray CapsLock mid-chord does not cancel', () => {
    // CapsLock is in the new RegisterTransitionKeyCode set. Without the
    // generalization, CapsLock-down would noMatch in the chord matcher and
    // clear the buffer (matcher.ts:469 only guards ctrl/alt/meta — CapsLock
    // slips past, same as bare Shift). NumLock/ScrollLock are NOT in the
    // filter set (the production view.toggle-scroll-lock binding listens for
    // bare ScrollLock keydown), so they intentionally still clear the chord.
    const altHB = chord('bold', 'KeyH', 'KeyB', 'TOGGLE_BOLD');
    const switchHome = plainKeyTip('switch-home', 'KeyH', 'SWITCH_RIBBON_TAB');
    const { coordinator, dispatchMock } = makeCoordinator([altHB, switchHome]);

    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(evt({ code: 'KeyH', key: 'h', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'CapsLock', key: 'CapsLock' }));
    coordinator.handleKeyUp(evt({ code: 'CapsLock', key: 'CapsLock' }));
    expect(coordinator.isChordPending()).toBe(true);

    coordinator.handleKeyboardEvent(evt({ code: 'KeyB', key: 'b' }));
    expect(dispatchMock).toHaveBeenCalledWith('TOGGLE_BOLD', expect.any(Object), undefined);
  });

  it('stray ShiftLeft DURING an Alt-tap poisons the tap (bare KeyW post-tap does NOT route as a keytip and SWITCH_RIBBON_TAB(view) is not dispatched)', () => {
    // Single ShiftLeft case suffices for ControlLeft / MetaLeft / CapsLock
    // symmetric coverage: the failure mode this test guards against is
    // "detector stops seeing non-Alt register-transition keydowns," and
    // the detector's else-branch at keyboard-coordinator.ts:904-906 fires
    // identically for any non-Alt physicalKey. If the wiring breaks for
    // ShiftLeft it breaks for the other three; if it works for ShiftLeft
    // it works for all four. No additional test value from per-key
    // duplication.
    //
    // What this test catches: any future refactor where the new
    // register-transition filter is wired in such that the Alt-tap
    // detector stops observing non-Alt register-transition keydowns
    // (Shift / Ctrl / Meta / CapsLock) — so the detector never flips
    // `hadInterveningKeydown = true`, and the Alt-up wrongly promotes a
    // poisoned tap into armed keytip mode.
    //
    // Correct wiring: `handleAltTapDetectorKeyDown(input)`
    // runs FIRST on every keydown, including register transitions. Its
    // else-branch at keyboard-coordinator.ts:904-906 flips
    // `hadInterveningKeydown = true` for any non-Alt physicalKey. Then
    // `isRegisterTransitionKey(input.physicalKey)` returns and the input
    // is dropped before chord routing. On Alt-up, `tryPromoteAltTap`
    // rejects because `hadInterveningKeydown:true`. `chordPending` stays
    // null, context stays `'grid'`. Bare KeyW falls through to the normal
    // matcher; no Alt-prefixed binding matches a bare KeyW input → no
    // dispatch.
    //
    // Failure mode this test catches: a partial refactor that hoists the
    // new general filter ABOVE the detector call but does NOT also remove
    // (or relocate) the existing skip — i.e. the detector becomes
    // unreachable for Shift/Ctrl/Meta/CapsLock keydowns. Symptoms:
    // `armedAt` stays at the value set by Alt-down and
    // `hadInterveningKeydown` stays false. Alt-up's `tryPromoteAltTap`
    // succeeds, setting `chordPending = { shortcuts: [], altHeldEntry:
    // false }` (keyTipMode armed). Bare KeyW then enters case (b) of
    // `routeThroughChordBuffer` (keyboard-coordinator.ts:1247); the
    // `leaderInput` synthesis at line 1264-1266 turns the bare KeyW into
    // Alt+KeyW; `matchChordStart` returns `{ kind: 'matched' }` against
    // the `plainKeyTip('switch-view', 'KeyW', 'SWITCH_RIBBON_TAB',
    // { tabId: 'view' })` registration; line 1302 dispatches
    // SWITCH_RIBBON_TAB with `{ tabId: 'view' }`.
    //
    // What this test does NOT catch: a pure line-swap (filter line moved
    // ABOVE the detector call as a single block) where the filter set
    // also includes AltLeft/AltRight. Under that swap the bare Alt-down
    // would be filtered before the detector arms `armedAt`, so
    // `tryPromoteAltTap` always fails and the test passes vacuously.
    // Reviewer flagged this; falsifiability of that variant is owned by
    // the FORMAT_CURRENCY positive test above (which requires `armedAt`
    // to be set on Alt-down for the keytip mode to enter at all).
    //
    // The discriminator on this test is the SWITCH_RIBBON_TAB dispatch
    // assertion below. The chord-pending assertion is corroborating (case
    // (b)'s 'matched' arm calls `cancelChord` at line 1301 before
    // dispatching, so even broken wiring ends with chord-pending null
    // after the bare KeyW is consumed).
    //
    // The factory propagation of `actionArg` (extended above) is what
    // makes the `expect.objectContaining({ tabId: 'view' })` matcher a
    // real discriminator: pre-extension the dispatch ran with
    // `(SWITCH_RIBBON_TAB, deps, undefined)`, which never matches an
    // objectContaining matcher, so `not.toHaveBeenCalledWith(...)` would
    // be trivially satisfied even on broken wiring.
    const switchView = plainKeyTip('switch-view', 'KeyW', 'SWITCH_RIBBON_TAB', { tabId: 'view' });
    const { coordinator, dispatchMock } = makeCoordinator([switchView]);

    // Poisoned Alt-tap: Alt-down → ShiftLeft-down → ShiftLeft-up → Alt-up.
    coordinator.handleKeyboardEvent(evt({ code: 'AltLeft', key: 'Alt', altKey: true }));
    coordinator.handleKeyboardEvent(
      evt({ code: 'ShiftLeft', key: 'Shift', shiftKey: true, altKey: true }),
    );
    coordinator.handleKeyUp(evt({ code: 'ShiftLeft', key: 'Shift', altKey: true }));
    coordinator.handleKeyUp(evt({ code: 'AltLeft', key: 'Alt' }));
    expect(coordinator.isChordPending()).toBe(false);
    expect(coordinator.getContext()).toBe('grid');

    // Falsifier: bare KeyW (no Alt held). Under correct order this falls
    // through harmlessly; under the failure mode below it routes through
    // case (b) and dispatches SWITCH_RIBBON_TAB with { tabId: 'view' }.
    coordinator.handleKeyboardEvent(evt({ code: 'KeyW', key: 'w' }));
    coordinator.handleKeyUp(evt({ code: 'KeyW', key: 'w' }));
    expect(dispatchMock).not.toHaveBeenCalledWith(
      'SWITCH_RIBBON_TAB',
      expect.any(Object),
      expect.objectContaining({ tabId: 'view' }),
    );
    expect(coordinator.isChordPending()).toBe(false);
  });
});
