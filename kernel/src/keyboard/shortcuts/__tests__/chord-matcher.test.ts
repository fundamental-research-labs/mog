/**
 * Chord Matcher Tests (Excel Alt+H,L style sequences)
 *
 * Covers the two-stage chord matcher introduced for the unified
 * keyboard-mode router (T2 of the keyboard-mode router
 * unified-keyboard-mode-router.md). The matcher is stateless; the
 * coordinator (T3) owns the chord buffer.
 *
 * Cases asserted here:
 *  1. Simple chord match (`Alt+H` → pending; `KeyL` → matched).
 *  2. Ambiguous prefix (`Alt+H` matches both `Alt+H,L` and `Alt+H,A,L`;
 *     remains pending after `Alt+H`, only commits when one path completes).
 *  3. Modifier-shortcut preempts a pending chord (Ctrl+S during pending).
 *  4. ESC cancellation is a coordinator concern; the matcher itself
 *     does not interpret Escape — assert the boundary.
 *  5. Follow-on with Shift permitted (`Alt+H,Shift+Digit4` matches
 *     `{ code: 'Digit4', shift: true }`).
 *  6. Follow-on with disallowed modifiers rejected (Alt+H,Ctrl+L /
 *     Alt+H,Alt+L / Alt+H,Meta+L cancel and fall through).
 */

import {
  ShortcutMatcher,
  type ChordFollowOn,
  type ChordMatchResult,
  type KeyboardInput,
  type KeyboardShortcut,
  type ModifierState,
  type PendingShortcut,
  type Platform,
  type ShortcutContext,
} from '../matcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInput(
  physicalKey: string,
  modifiers: Partial<ModifierState> = {},
  options: {
    isComposing?: boolean;
    isRepeat?: boolean;
    platform?: Platform;
    character?: string;
  } = {},
): KeyboardInput {
  const defaultModifiers: ModifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  // For letter keys (KeyA-KeyZ), extract the character (a-z).
  const defaultCharacter = /^Key[A-Z]$/.test(physicalKey)
    ? physicalKey.slice(3).toLowerCase()
    : /^Digit[0-9]$/.test(physicalKey)
      ? physicalKey.slice(5)
      : physicalKey;

  return {
    physicalKey: physicalKey as KeyboardInput['physicalKey'],
    character: options.character ?? defaultCharacter,
    modifiers: { ...defaultModifiers, ...modifiers },
    isComposing: options.isComposing ?? false,
    isRepeat: options.isRepeat ?? false,
    platform: options.platform ?? 'windows',
    timestamp: Date.now(),
    originalEvent: {} as KeyboardEvent,
  };
}

function altLeader(
  id: string,
  leaderCode: string,
  sequence: readonly ChordFollowOn[],
  contexts: ShortcutContext[] = ['grid', 'keyTipMode'],
  action: KeyboardShortcut['action'] = 'OPEN_CF_MENU',
): KeyboardShortcut {
  // Alt+letter → matchBy: 'key' is the inferred default; mirror it explicitly
  // so the matcher's character-bucket lookup hits this shortcut.
  const isLetter = /^Key[A-Z]$/.test(leaderCode);
  return {
    id,
    bindings: {
      default: {
        code: leaderCode as KeyboardShortcut['bindings']['default']['code'],
        modifiers: ['alt'],
      },
    },
    description: `Test chord ${id}`,
    action,
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts,
    muscleMemory: 'common',
    matchBy: isLetter ? 'key' : 'code',
    expectedCharacter: isLetter ? leaderCode.slice(3).toLowerCase() : undefined,
    sequence,
  };
}

function plainShortcut(
  id: string,
  code: string,
  modifiers: Array<'ctrl' | 'shift' | 'alt' | 'meta'>,
  action: KeyboardShortcut['action'],
  contexts: ShortcutContext[] = ['grid'],
): KeyboardShortcut {
  const isLetter = /^Key[A-Z]$/.test(code);
  const hasCommand =
    modifiers.includes('ctrl') || modifiers.includes('meta') || modifiers.includes('alt');
  const matchBy: 'key' | 'code' = isLetter && hasCommand ? 'key' : 'code';
  return {
    id,
    bindings: {
      default: { code: code as KeyboardShortcut['bindings']['default']['code'], modifiers },
    },
    description: `Test plain ${id}`,
    action,
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts,
    muscleMemory: 'common',
    matchBy,
    expectedCharacter: matchBy === 'key' ? code.slice(3).toLowerCase() : undefined,
  };
}

// Type narrowers for ChordMatchResult.
function expectPending(result: ChordMatchResult): readonly PendingShortcut[] {
  if (result.kind !== 'pending') {
    throw new Error(`expected 'pending', got '${result.kind}'`);
  }
  return result.pending;
}

function expectMatched(result: ChordMatchResult): KeyboardShortcut {
  if (result.kind !== 'matched') {
    throw new Error(`expected 'matched', got '${result.kind}'`);
  }
  return result.shortcut;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Chord matcher (Alt+H,L style sequences)', () => {
  describe('Case 1 — simple chord match', () => {
    it('Alt+H buffers as pending; KeyL completes the chord', () => {
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const matcher = new ShortcutMatcher([altHL], 'windows');

      // Alt+H → pending (chord candidate gathered, no action fires yet).
      const start = matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid');
      const pending = expectPending(start);
      expect(pending).toHaveLength(1);
      expect(pending[0].shortcut.id).toBe('open-cf');
      expect(pending[0].cursor).toBe(0);

      // KeyL with no modifiers → matched.
      const cont = matcher.matchChordContinuation(createInput('KeyL'), pending);
      expect(expectMatched(cont).id).toBe('open-cf');
    });

    it('returns noMatch when no chord candidate exists for the leading key', () => {
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const matcher = new ShortcutMatcher([altHL], 'windows');

      const start = matcher.matchChordStart(createInput('KeyZ', { alt: true }), 'grid');
      expect(start.kind).toBe('noMatch');
    });
  });

  describe('Case 2 — ambiguous prefix', () => {
    it('Alt+H stays pending with both candidates; only the matching path commits', () => {
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const altHAL = altLeader(
        'align-left',
        'KeyH',
        ['KeyA', 'KeyL'],
        ['grid', 'keyTipMode'],
        'SET_HORIZONTAL_ALIGN',
      );
      const matcher = new ShortcutMatcher([altHL, altHAL], 'windows');

      // Alt+H → both shortcuts pending.
      const start = matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid');
      const pending0 = expectPending(start);
      expect(pending0.map((p) => p.shortcut.id).sort()).toEqual(['align-left', 'open-cf']);
      expect(pending0.every((p) => p.cursor === 0)).toBe(true);

      // KeyL after Alt+H → 'open-cf' completes; 'align-left' (next is KeyA) drops.
      const direct = matcher.matchChordContinuation(createInput('KeyL'), pending0);
      expect(expectMatched(direct).id).toBe('open-cf');

      // Alternate path: KeyA after Alt+H → 'align-left' advances; 'open-cf' drops.
      const advance = matcher.matchChordContinuation(createInput('KeyA'), pending0);
      const pending1 = expectPending(advance);
      expect(pending1).toHaveLength(1);
      expect(pending1[0].shortcut.id).toBe('align-left');
      expect(pending1[0].cursor).toBe(1);

      // Then KeyL completes 'align-left'.
      const final = matcher.matchChordContinuation(createInput('KeyL'), pending1);
      expect(expectMatched(final).id).toBe('align-left');
    });
  });

  describe('Case 3 — modifier shortcut preempts pending chord', () => {
    it('Ctrl+S while a chord is pending matches the plain shortcut', () => {
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const ctrlS = plainShortcut('save', 'KeyS', ['ctrl'], 'SAVE', ['grid']);
      const matcher = new ShortcutMatcher([altHL, ctrlS], 'windows');

      // Buffer a chord.
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );
      expect(pending).toHaveLength(1);

      // Ctrl+S has Ctrl set — chord follow-on rejects it (any command modifier
      // cancels). The coordinator (T3) is responsible for then re-running
      // Ctrl+S through the plain matcher; assert that path resolves to 'save'.
      const cont = matcher.matchChordContinuation(createInput('KeyS', { ctrl: true }), pending);
      expect(cont.kind).toBe('noMatch');

      // Re-running through plain match() resolves Ctrl+S.
      const plain = matcher.match(createInput('KeyS', { ctrl: true }), 'grid');
      expect(plain?.id).toBe('save');
    });
  });

  describe('Case 4 — ESC cancellation is the coordinator’s concern', () => {
    it('Escape during pending returns noMatch; the matcher does not buffer state', () => {
      // The matcher has no notion of ESC. From its perspective, Escape is
      // "an input with no chord-friendly mapping" — ChordContinuation rejects
      // it because Escape doesn't match any pending follow-on. The
      // coordinator interprets noMatch + Escape as "clear the buffer" per
      // T3's exit conditions; the matcher itself is stateless.
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const matcher = new ShortcutMatcher([altHL], 'windows');

      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );

      const cont = matcher.matchChordContinuation(createInput('Escape'), pending);
      expect(cont.kind).toBe('noMatch');
    });

    it('matchChordContinuation never mutates the input pending buffer', () => {
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const altHAL = altLeader(
        'align-left',
        'KeyH',
        ['KeyA', 'KeyL'],
        ['grid', 'keyTipMode'],
        'SET_HORIZONTAL_ALIGN',
      );
      const matcher = new ShortcutMatcher([altHL, altHAL], 'windows');

      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );
      const before = pending.map((p) => ({ id: p.shortcut.id, cursor: p.cursor }));

      // Drive several inputs through; pending must not be mutated.
      matcher.matchChordContinuation(createInput('KeyA'), pending);
      matcher.matchChordContinuation(createInput('KeyL'), pending);
      matcher.matchChordContinuation(createInput('Escape'), pending);

      const after = pending.map((p) => ({ id: p.shortcut.id, cursor: p.cursor }));
      expect(after).toEqual(before);
    });
  });

  describe('Case 5 — Shift permitted on follow-on', () => {
    it('Alt+H,Shift+Digit4 (= Alt+H,$) matches { code: Digit4, shift: true }', () => {
      const altHCurrency = altLeader(
        'format-currency',
        'KeyH',
        [{ code: 'Digit4', shift: true }],
        ['grid', 'keyTipMode'],
        'FORMAT_CURRENCY',
      );
      const matcher = new ShortcutMatcher([altHCurrency], 'windows');

      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );

      // Shift+Digit4 (no Ctrl/Alt/Meta) — accepted.
      const cont = matcher.matchChordContinuation(createInput('Digit4', { shift: true }), pending);
      expect(expectMatched(cont).id).toBe('format-currency');
    });

    it('rejects Digit4 without Shift when the follow-on requires shift', () => {
      const altHCurrency = altLeader('format-currency', 'KeyH', [{ code: 'Digit4', shift: true }]);
      const matcher = new ShortcutMatcher([altHCurrency], 'windows');

      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );

      // Digit4 without Shift — does not match a Shift-required follow-on.
      const cont = matcher.matchChordContinuation(createInput('Digit4'), pending);
      expect(cont.kind).toBe('noMatch');
    });

    it('rejects Shift+KeyL when the follow-on is a bare PhysicalKeyCode', () => {
      // Bare follow-ons (`'KeyL'`) require no modifiers — Shift is NOT
      // permitted unless the entry explicitly opts in via `{ shift: true }`.
      const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
      const matcher = new ShortcutMatcher([altHL], 'windows');

      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );

      const cont = matcher.matchChordContinuation(createInput('KeyL', { shift: true }), pending);
      expect(cont.kind).toBe('noMatch');
    });
  });

  describe('Case 6 — disallowed modifiers on follow-on cancel the chord', () => {
    const altHL = altLeader('open-cf', 'KeyH', ['KeyL']);
    const matcher = new ShortcutMatcher([altHL], 'windows');

    function pending(): readonly PendingShortcut[] {
      return expectPending(matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'));
    }

    it('Alt+H,Ctrl+L cancels (Ctrl never permitted on follow-on)', () => {
      const cont = matcher.matchChordContinuation(createInput('KeyL', { ctrl: true }), pending());
      expect(cont.kind).toBe('noMatch');
    });

    it('Alt+H,Alt+L cancels (Alt never permitted on follow-on)', () => {
      const cont = matcher.matchChordContinuation(createInput('KeyL', { alt: true }), pending());
      expect(cont.kind).toBe('noMatch');
    });

    it('Alt+H,Meta+L cancels (Meta never permitted on follow-on)', () => {
      const cont = matcher.matchChordContinuation(createInput('KeyL', { meta: true }), pending());
      expect(cont.kind).toBe('noMatch');
    });
  });

  // -------------------------------------------------------------------------
  // Case 7 — single-key default disambiguation (Bug 1 fix)
  //
  // When a single-key Alt+letter shortcut coexists with a chord shortcut
  // sharing the same leading key, `matchChordStart` MUST return `'pending'`
  // and embed the single-key shortcut as a default in the pending buffer.
  // The chord-pending state owner (coordinator) is then responsible for
  // committing the default on disambiguation (timeout / non-matching
  // follow-on / Alt-up).
  // -------------------------------------------------------------------------
  describe('Case 7 — single-key default mixed with chord candidates', () => {
    function buildMatcher(): {
      matcher: ShortcutMatcher;
      ribbonAlt: KeyboardShortcut;
      chord: KeyboardShortcut;
    } {
      // Single-key Alt+A → SWITCH_RIBBON_TAB (no `sequence`).
      const ribbonAlt = plainShortcut('ribbon-data', 'KeyA', ['alt'], 'SWITCH_RIBBON_TAB', [
        'grid',
        'keyTipMode',
      ]);
      // Chord Alt+A,V,V → some validation action.
      const chord = altLeader(
        'data-validation',
        'KeyA',
        ['KeyV', 'KeyV'],
        ['grid', 'keyTipMode'],
        'OPEN_DV_DIALOG',
      );
      const matcher = new ShortcutMatcher([ribbonAlt, chord], 'windows');
      return { matcher, ribbonAlt, chord };
    }

    it('Alt+A returns pending with BOTH the chord candidate and the single-key default', () => {
      const { matcher } = buildMatcher();
      const start = matcher.matchChordStart(createInput('KeyA', { alt: true }), 'grid');
      const pending = expectPending(start);
      const ids = pending.map((p) => p.shortcut.id).sort();
      expect(ids).toEqual(['data-validation', 'ribbon-data']);
      // Both at cursor 0; single-key entry has no sequence, chord has length 2.
      const defaultEntry = pending.find((p) => p.shortcut.id === 'ribbon-data');
      expect(defaultEntry?.shortcut.sequence ?? []).toHaveLength(0);
      const chordEntry = pending.find((p) => p.shortcut.id === 'data-validation');
      expect(chordEntry?.shortcut.sequence?.length ?? 0).toBe(2);
    });

    it('getDefaultMatch returns the single-key default from the pending buffer', () => {
      const { matcher, ribbonAlt } = buildMatcher();
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyA', { alt: true }), 'grid'),
      );
      const def = matcher.getDefaultMatch(pending);
      expect(def?.id).toBe(ribbonAlt.id);
    });

    it('chord follow-on (KeyV) advances chord; default entry stays at cursor 0', () => {
      const { matcher } = buildMatcher();
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyA', { alt: true }), 'grid'),
      );
      const cont = matcher.matchChordContinuation(createInput('KeyV'), pending);
      const advanced = expectPending(cont);
      // The chord advanced; the single-key default is dropped on advancement
      // (it had no follow-on to match — `sequence?.[0]` is undefined).
      expect(advanced.map((p) => p.shortcut.id)).toEqual(['data-validation']);
      expect(advanced[0].cursor).toBe(1);
    });

    it('non-matching follow-on (KeyZ) returns noMatch — coordinator commits default', () => {
      const { matcher } = buildMatcher();
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyA', { alt: true }), 'grid'),
      );
      const cont = matcher.matchChordContinuation(createInput('KeyZ'), pending);
      expect(cont.kind).toBe('noMatch');
      // Default match still resolvable from the pending buffer pre-noMatch.
      expect(matcher.getDefaultMatch(pending)?.id).toBe('ribbon-data');
    });

    it('returns matched immediately when only a single-key shortcut exists (no chord)', () => {
      // Same Alt+A, but no chord registered. Path 3 (matched) fires.
      const ribbonAlt = plainShortcut('ribbon-data', 'KeyA', ['alt'], 'SWITCH_RIBBON_TAB', [
        'grid',
        'keyTipMode',
      ]);
      const matcher = new ShortcutMatcher([ribbonAlt], 'windows');
      const start = matcher.matchChordStart(createInput('KeyA', { alt: true }), 'grid');
      expect(expectMatched(start).id).toBe('ribbon-data');
    });

    it('returns pending without single-key default when no Alt+letter single-key exists', () => {
      // Only chord Alt+H,L registered; Alt+H pending must NOT have a default.
      const chord = altLeader('open-cf', 'KeyH', ['KeyL']);
      const matcher = new ShortcutMatcher([chord], 'windows');
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );
      expect(pending).toHaveLength(1);
      expect(matcher.getDefaultMatch(pending)).toBeNull();
    });
  });

  describe('matchChordContinuation — defensive register-transition guard', () => {
    it('preserves pending buffer on bare register-transition input (defensive guard)', () => {
      const chord = altLeader('test-chord', 'KeyH', ['KeyB']);
      const matcher = new ShortcutMatcher([chord], 'windows');
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );

      const cont = matcher.matchChordContinuation(
        createInput('ShiftLeft', { shift: true }),
        pending,
      );

      expect(cont.kind).toBe('pending');
    });

    it('preserves pending buffer on bare CapsLock input (register-transition, no shift held)', () => {
      const chord = altLeader('test-chord', 'KeyH', ['KeyB']);
      const matcher = new ShortcutMatcher([chord], 'windows');
      const pending = expectPending(
        matcher.matchChordStart(createInput('KeyH', { alt: true }), 'grid'),
      );

      const cont = matcher.matchChordContinuation(createInput('CapsLock'), pending);

      expect(cont.kind).toBe('pending');
    });
  });
});
