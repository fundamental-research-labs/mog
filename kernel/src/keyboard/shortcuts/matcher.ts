/**
 * ShortcutMatcher - matches KeyboardInput to registered shortcuts.
 *
 * This module provides O(1) lookup for keyboard shortcuts by indexing
 * shortcuts by their physical key code AND by character key (for matchBy: 'key').
 * It supports:
 * - Dual-index lookup (byCode for physical keys, byKey for character-based matching)
 * - Platform-specific binding resolution (Mac/Windows/Linux)
 * - Exact modifier matching (no partial matches)
 * - Context-aware matching with hierarchy
 * - Priority-based conflict resolution
 * - IME composition blocking
 * - Key repeat handling
 *
 * @module kernel/keyboard/shortcuts/matcher
 */

import type {
  BrowserConflict,
  ChordFollowOn,
  KeyboardInput,
  KeyboardShortcut,
  KeyboardShortcutBase,
  ModifierKey,
  ModifierState,
  MuscleMemoryLevel,
  PhysicalKeyBinding,
  PhysicalKeyCode,
  Platform,
  PlatformKeyBindings,
  ShortcutCategory,
  ShortcutCategoryBase,
  ShortcutContext,
  ShortcutContextBase,
  ShortcutPriority,
} from '../primitives/index';

import {
  PRIORITY_ORDER,
  isPhysicalKeyCode,
  isRegisterTransitionKey,
  resolveBinding,
} from '../primitives/index';

// Re-export types so existing consumers (including tests) can import from this module.
export type {
  BrowserConflict,
  ChordFollowOn,
  KeyboardInput,
  KeyboardShortcut,
  KeyboardShortcutBase,
  ModifierKey,
  ModifierState,
  MuscleMemoryLevel,
  PhysicalKeyBinding,
  PhysicalKeyCode,
  Platform,
  PlatformKeyBindings,
  ShortcutCategory,
  ShortcutCategoryBase,
  ShortcutContext,
  ShortcutContextBase,
  ShortcutPriority,
};

// =============================================================================
// Chord matching (Excel Alt+H,L style sequences)
// =============================================================================

/**
 * A chord shortcut in flight.
 *
 * The matcher returns these inside a {@link ChordMatchResult.kind} === `'pending'`
 * result; the coordinator owns the chord buffer (this matcher is stateless).
 *
 * - `shortcut`: the candidate shortcut whose `sequence` is being walked.
 * - `cursor`: the index of the next follow-on entry to be matched. When
 *   `cursor === shortcut.sequence!.length` the chord has just completed and
 *   the result is returned as `'matched'` instead of `'pending'`.
 */
export interface PendingShortcut<TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase> {
  readonly shortcut: TShortcut;
  readonly cursor: number;
}

/**
 * Result of a chord-matching step.
 *
 * - `'matched'`: the input completed a shortcut. Coordinator dispatches the
 *   action and clears its chord buffer.
 * - `'pending'`: the input either started or advanced one or more chord
 *   shortcuts. Coordinator stores `pending` as the new chord buffer and
 *   waits for the next input.
 * - `'noMatch'`: nothing matched. On a leading-key step this is the same
 *   as the existing matcher returning `null`. On a continuation step the
 *   coordinator should clear its chord buffer; the input has already
 *   missed every pending candidate, so the coordinator may then re-route
 *   it through the normal matcher (Excel parity: a stray key after a
 *   half-typed chord still fires its own shortcut if it has one).
 */
export type ChordMatchResult<TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase> =
  | { readonly kind: 'matched'; readonly shortcut: TShortcut }
  | { readonly kind: 'pending'; readonly pending: readonly PendingShortcut<TShortcut>[] }
  | { readonly kind: 'noMatch' };

export type ShortcutContextHierarchy<TContext extends string = string> = ReadonlyMap<
  TContext,
  readonly TContext[]
>;

export interface ShortcutMatcherOptions<TContext extends string = string> {
  readonly contextHierarchy?: ShortcutContextHierarchy<TContext>;
}

type ShortcutContextOf<TShortcut extends KeyboardShortcutBase> =
  TShortcut extends KeyboardShortcutBase<string, infer TContext, string> ? TContext : string;

export const SPREADSHEET_SHORTCUT_CONTEXT_HIERARCHY: ShortcutContextHierarchy<string> = new Map([
  ['editing', ['enterMode', 'editMode', 'formulaEnterMode', 'formulaEditMode']],
  ['formulaEditing', ['formulaEnterMode', 'formulaEditMode']],
  ['grid', ['flashFillPreview']],
  ['view', ['kanban', 'kanbanEditing', 'gallery', 'calendar', 'timeline']],
  ['kanban', ['kanbanEditing']],
]);

/**
 * ShortcutMatcher - matches KeyboardInput to registered shortcuts.
 *
 * Features:
 * - O(1) lookup by physical key code (indexed)
 * - Exact modifier matching
 * - Context-aware matching with hierarchy support
 * - Platform-specific binding resolution
 * - Priority-based conflict resolution
 *
 * @example
 * ```typescript
 * const matcher = new ShortcutMatcher(shortcuts, 'macos');
 *
 * // Match a keyboard input
 * const shortcut = matcher.match(input, 'grid');
 * if (shortcut) {
 *   dispatch({ type: shortcut.action });
 * }
 *
 * // Get all shortcuts for a context
 * const gridShortcuts = matcher.getShortcutsForContext('grid');
 *
 * // Check for conflicts
 * const conflict = matcher.wouldConflict(newBinding, 'grid', 'my-shortcut');
 * ```
 */
/**
 * Detailed result from matchWithReason(), providing the matched shortcut
 * plus the reason for non-match (for debugging and coordinator return values).
 */
export interface ShortcutMatchDetailedResult<
  TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase,
> {
  shortcut: TShortcut | null;
  /** Whether any candidates existed for this key combo (in either index) */
  hadCandidates: boolean;
  /** Whether any candidate was filtered out by allowRepeat (not by context) */
  blockedByRepeat: boolean;
}

export class ShortcutMatcher<
  TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase,
  TContext extends string = ShortcutContextOf<TShortcut>,
> {
  /**
   * Shortcuts indexed by physical key code for O(1) lookup (matchBy: 'code').
   * Each key maps to an array of shortcuts (sorted by priority, highest first).
   */
  private byCode: Map<PhysicalKeyCode, TShortcut[]> = new Map();

  /**
   * Shortcuts indexed by character + modifiers for O(1) lookup (matchBy: 'key').
   * Key format: sorted modifiers joined with '+', then '+key:' + character.
   * Example: 'ctrl+key:b' for Ctrl+B, 'ctrl+shift+key:f' for Ctrl+Shift+F.
   */
  private byKey: Map<string, TShortcut[]> = new Map();

  /** Current platform for binding resolution */
  private platform: Platform;

  /** All registered shortcuts */
  private shortcuts: TShortcut[] = [];

  private readonly contextHierarchy: ReadonlyMap<string, readonly string[]>;

  /**
   * Create a new ShortcutMatcher.
   *
   * @param shortcuts - Array of keyboard shortcuts to index
   * @param platform - Current platform ('macos', 'windows', or 'linux')
   */
  constructor(
    shortcuts: readonly TShortcut[],
    platform: Platform,
    options: ShortcutMatcherOptions<TContext> = {},
  ) {
    this.platform = platform;
    this.shortcuts = [...shortcuts];
    this.contextHierarchy = options.contextHierarchy
      ? new Map<string, readonly string[]>(options.contextHierarchy)
      : SPREADSHEET_SHORTCUT_CONTEXT_HIERARCHY;
    this.buildIndex(shortcuts);
  }

  /**
   * Build the lookup indexes from shortcuts array.
   * Shortcuts with matchBy: 'key' are indexed by character + modifiers in byKey.
   * All other shortcuts are indexed by physical key code in byCode.
   * Both maps are sorted by priority (highest first).
   */
  private buildIndex(shortcuts: readonly TShortcut[]): void {
    this.byCode.clear();
    this.byKey.clear();

    for (const shortcut of shortcuts) {
      // Skip disabled shortcuts
      if (!shortcut.enabled) continue;

      const binding = this.getBindingForPlatform(shortcut.bindings);

      if (shortcut.matchBy === 'key' && shortcut.expectedCharacter) {
        // Index by character + modifiers in the byKey map
        const key = this.serializeByKey(
          [...binding.modifiers].sort() as ModifierKey[],
          shortcut.expectedCharacter.toLowerCase(),
        );
        const existing = this.byKey.get(key) ?? [];
        existing.push(shortcut);
        this.byKey.set(key, existing);
      } else {
        // Index by physical key code in the byCode map (default / matchBy: 'code')
        const existing = this.byCode.get(binding.code) ?? [];
        existing.push(shortcut);
        this.byCode.set(binding.code, existing);
      }
    }

    // Sort each bucket by priority (highest first) for conflict resolution
    // PRIORITY_ORDER uses lower number = higher priority, so ascending sort puts highest priority first
    const sortByPriority = (a: TShortcut, b: TShortcut) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];

    this.byCode.forEach((bucket) => {
      bucket.sort(sortByPriority);
    });

    this.byKey.forEach((bucket) => {
      bucket.sort(sortByPriority);
    });
  }

  /**
   * Get the appropriate binding for the current platform.
   *
   * Uses resolveBinding from primitives, which handles:
   * - Platform-specific overrides (mac, windows, linux)
   * - Automatic Ctrl→Meta conversion on Mac when no explicit mac binding exists
   *
   * @param bindings - Platform-specific bindings
   * @returns The resolved binding for the current platform
   */
  private getBindingForPlatform(bindings: PlatformKeyBindings): PhysicalKeyBinding {
    return resolveBinding(bindings, this.platform);
  }

  /**
   * Match a keyboard input to a registered shortcut.
   *
   * Algorithm:
   * 1. If input.isComposing -> return null (never match during IME)
   * 2. Try character-based match first (byKey) using input.character + modifiers
   * 3. Fall back to code-based match (byCode) using input.physicalKey
   * 4. For each candidate (sorted by priority):
   *    - Check if key repeat is allowed (if input.isRepeat)
   *    - Check context matches (with hierarchy)
   *    - Check modifiers match exactly
   * 5. Return first match (highest priority) or null
   *
   * @param input - Normalized keyboard input
   * @param context - Current shortcut context
   * @returns The matching shortcut, or null if no match
   */
  match(input: KeyboardInput, context: TContext): TShortcut | null {
    // Rule 1: Never match during IME composition
    if (input.isComposing) {
      return null;
    }

    // 1. Try character-based match first (matchBy: 'key')
    if (input.character) {
      const charKey = this.serializeByKey(
        this.getActiveModifiers(input.modifiers),
        input.character.toLowerCase(),
      );
      const keyMatch = this.findInBucket(this.byKey.get(charKey), input, context);
      if (keyMatch) return keyMatch;
    }

    // 2. Fall back to code-based match (matchBy: 'code')
    const candidates = isPhysicalKeyCode(input.physicalKey)
      ? this.byCode.get(input.physicalKey)
      : undefined;
    return this.findInBucket(candidates, input, context);
  }

  /**
   * Match with detailed reason information.
   *
   * Like match(), but returns additional metadata about WHY no match was found:
   * - hadCandidates: whether any shortcuts exist for this key combo
   * - blockedByRepeat: whether a candidate was filtered by allowRepeat
   *
   * This enables callers to distinguish between:
   * - 'not_found' (no candidates at all)
   * - 'not_found' (candidates exist but all blocked by repeat)
   * - 'wrong_context' (candidates exist, not blocked by repeat, but wrong context)
   *
   * @param input - Normalized keyboard input
   * @param context - Current shortcut context
   * @returns Detailed match result
   */
  matchWithReason(input: KeyboardInput, context: TContext): ShortcutMatchDetailedResult<TShortcut> {
    // Never match during IME composition
    if (input.isComposing) {
      return { shortcut: null, hadCandidates: false, blockedByRepeat: false };
    }

    let hadCandidates = false;
    let blockedByRepeat = false;

    // 1. Try character-based match first (matchBy: 'key')
    if (input.character) {
      const charKey = this.serializeByKey(
        this.getActiveModifiers(input.modifiers),
        input.character.toLowerCase(),
      );
      const byKeyBucket = this.byKey.get(charKey);
      if (byKeyBucket && byKeyBucket.length > 0) {
        hadCandidates = true;
        const result = this.findInBucketDetailed(byKeyBucket, input, context);
        if (result.shortcut) {
          return { shortcut: result.shortcut, hadCandidates: true, blockedByRepeat: false };
        }
        if (result.blockedByRepeat) blockedByRepeat = true;
      }
    }

    // 2. Fall back to code-based match (matchBy: 'code')
    const codeBucket = isPhysicalKeyCode(input.physicalKey)
      ? this.byCode.get(input.physicalKey)
      : undefined;
    if (codeBucket && codeBucket.length > 0) {
      hadCandidates = true;
      const result = this.findInBucketDetailed(codeBucket, input, context);
      if (result.shortcut) {
        return { shortcut: result.shortcut, hadCandidates: true, blockedByRepeat: false };
      }
      if (result.blockedByRepeat) blockedByRepeat = true;
    }

    return { shortcut: null, hadCandidates, blockedByRepeat };
  }

  // ===========================================================================
  // Chord matching (Excel Alt+H,L style sequences)
  // ===========================================================================
  //
  // Two-stage interface. The matcher itself is stateless: the coordinator
  // (T3) owns the chord buffer and decides when to feed continuation inputs
  // back through `matchChordContinuation`. ESC, focus changes, mode changes,
  // and click-outside cancellation are coordinator concerns — the matcher
  // only reports whether the next input commits, advances, or rejects the
  // pending shortcut(s).

  /**
   * Try to start a new chord, or fall back to a normal single-keystroke match.
   *
   * Algorithm:
   * 1. IME composition / no-candidates → `'noMatch'`.
   * 2. Gather all chord candidates (shortcuts with a non-empty `sequence`)
   *    whose leading binding + modifiers + context match the input.
   *    Also gather any single-key (sequence-less) shortcut that matches —
   *    this becomes the **default** match committed if no chord follow-on
   *    arrives. The pending buffer mixes both kinds; chord entries carry
   *    `cursor: 0`; single-key entries also carry `cursor: 0` and a
   *    `sequence` of `undefined` (the existing `matchChordContinuation`
   *    skips entries whose follow-on is undefined, so they survive
   *    untouched while chord entries advance).
   *    If any chord candidate exists → `'pending'` with the mixed buffer.
   * 3. Otherwise, if a single-key shortcut matches → `'matched'`.
   * 4. Otherwise → `'noMatch'`.
   *
   * Excel-parity: pressing `Alt+A` when both `Alt+A` (single-key tab
   * switch) and `Alt+A,V,V` (chord) exist must NOT fire the single-key
   * shortcut immediately — the user might still type `V,V`. The single-key
   * default fires only on disambiguation (timeout, non-matching follow-on,
   * or Alt-up for Alt-held entry).
   *
   * @param input - Normalized keyboard input.
   * @param context - Current shortcut context.
   * @returns `'matched'` (single-key shortcut fires immediately because no
   *   chord candidate exists), `'pending'` (chord candidate(s) buffered,
   *   possibly with a single-key default mixed in), or `'noMatch'`.
   */
  matchChordStart(input: KeyboardInput, context: TContext): ChordMatchResult<TShortcut> {
    if (input.isComposing) {
      return { kind: 'noMatch' };
    }

    // 1. Gather chord candidates whose leading binding matches.
    const chordCandidates = this.collectChordLeadingMatches(input, context);

    // 2. Run plain single-keystroke matching as a candidate default.
    const singleKeyMatch = this.match(input, context);

    if (chordCandidates.length > 0) {
      // Mix chord candidates and (optional) single-key default into one
      // pending buffer. Chord follow-on advancement skips the single-key
      // default automatically because its `sequence` is undefined.
      const pending: PendingShortcut<TShortcut>[] = chordCandidates.map((shortcut) => ({
        shortcut,
        cursor: 0,
      }));
      if (singleKeyMatch && (!singleKeyMatch.sequence || singleKeyMatch.sequence.length === 0)) {
        // Avoid duplicating an entry already present as a chord candidate.
        const alreadyPresent = pending.some((p) => p.shortcut.id === singleKeyMatch.id);
        if (!alreadyPresent) {
          pending.push({ shortcut: singleKeyMatch, cursor: 0 });
        }
      }
      return { kind: 'pending', pending };
    }

    if (singleKeyMatch) {
      return { kind: 'matched', shortcut: singleKeyMatch };
    }
    return { kind: 'noMatch' };
  }

  /**
   * Inspect a pending buffer and return the single-key default shortcut, if
   * any. A single-key entry has an empty / undefined `sequence`. Used by
   * the coordinator to commit the default on disambiguation
   * (timeout / non-matching follow-on / Alt-up while Alt-held).
   */
  getDefaultMatch(pendingShortcuts: readonly PendingShortcut<TShortcut>[]): TShortcut | null {
    // 1. Single-key defaults (no sequence) — e.g. Alt+A ribbon tab switch.
    for (const entry of pendingShortcuts) {
      if (!entry.shortcut.sequence || entry.shortcut.sequence.length === 0) {
        return entry.shortcut;
      }
    }
    // 2. Completed chord defaults — a shorter chord whose sequence was fully
    //    matched but was deferred because a longer chord sharing the same
    //    prefix was still advancing.
    for (const entry of pendingShortcuts) {
      const total = entry.shortcut.sequence?.length ?? 0;
      if (total > 0 && entry.cursor >= total) {
        return entry.shortcut;
      }
    }
    return null;
  }

  /**
   * Advance an in-flight chord buffer by one input.
   *
   * For each pending shortcut, check whether the next follow-on entry in
   * its `sequence` accepts the input:
   *
   * - **Modifier rule.** Ctrl/Alt/Meta on a follow-on cancels every
   *   candidate (chord follow-ons never carry a command modifier). Shift
   *   is permitted only when the follow-on is `{ code, shift: true }`.
   * - **Code rule.** The follow-on's `code` must equal `input.physicalKey`
   *   exactly. (Follow-on matching is positional, regardless of the
   *   leading shortcut's `matchBy`. Excel's keytips are layout-agnostic
   *   labels on physical keys.)
   *
   * Surviving candidates either complete (`cursor + 1 === sequence.length`,
   * earliest-priority winner returned as `'matched'`) or advance their
   * cursor and remain pending. If no candidate survives, the result is
   * `'noMatch'` and the coordinator should clear its buffer.
   *
   * If at least one candidate completes AND others would still be advancing,
   * completion wins immediately (Excel parity — no lookahead/timeout).
   *
   * @param input - Normalized keyboard input.
   * @param pendingShortcuts - Current chord buffer (priority-sorted by the
   *   coordinator; this matcher preserves that order).
   * @returns `'matched'`, `'pending'`, or `'noMatch'`.
   */
  matchChordContinuation(
    input: KeyboardInput,
    pendingShortcuts: readonly PendingShortcut<TShortcut>[],
  ): ChordMatchResult<TShortcut> {
    if (input.isComposing) {
      // IME composition: stay pending; the coordinator can decide to cancel
      // on a separate signal. Returning `noMatch` would discard a half-typed
      // chord every time the user types CJK, which is not Excel parity.
      return { kind: 'pending', pending: pendingShortcuts };
    }

    // Defensive: register transitions (Shift/Ctrl/Alt/Meta + CapsLock keydowns)
    // are filtered by the coordinator and should never reach this matcher. If
    // the invariant is ever violated, preserve the buffer rather than `noMatch`
    // — `pending` is the safe default *for register-transition inputs*, because
    // they have no semantic intent (the modifier state is carried into the next
    // real keystroke). The coordinator's filter is the contract; this is the
    // layered defense per UX-FIX-PRINCIPLES §3 "fix the family."
    //
    // Asymmetry note: the existing ctrl/alt/meta guard below returns `noMatch`
    // (clears the buffer), and that asymmetry is justified — those inputs have
    // a non-modifier `physicalKey` (e.g. `KeyB` with `ctrl: true`); they ARE
    // real keystrokes that simply don't continue this chord, so cancelling is
    // correct. Bare register-transition keydowns are NOT real keystrokes; they
    // are register transitions whose effect is recorded in the next keystroke's
    // `input.modifiers`. Preserving `pending` is correct for them and only
    // them; do not unify the two guards.
    if (isRegisterTransitionKey(input.physicalKey)) {
      return { kind: 'pending', pending: pendingShortcuts };
    }

    // Reject Ctrl/Alt/Meta on follow-ons. Shift is allowed but only when
    // the follow-on entry explicitly opts in via `{ code, shift: true }`.
    if (input.modifiers.ctrl || input.modifiers.alt || input.modifiers.meta) {
      return { kind: 'noMatch' };
    }

    const advanced: PendingShortcut<TShortcut>[] = [];
    let newCompletion: TShortcut | null = null;
    let hasAdvancing = false;
    for (const entry of pendingShortcuts) {
      const total = entry.shortcut.sequence?.length ?? 0;
      const followOn = entry.shortcut.sequence?.[entry.cursor];
      if (!followOn) {
        // Carry forward entries that completed in a previous round so
        // they remain available as deferred defaults if longer candidates
        // fail on a later follow-on.
        if (total > 0 && entry.cursor >= total) {
          advanced.push(entry);
        }
        continue;
      }
      if (!this.followOnAccepts(followOn, input)) continue;

      const nextCursor = entry.cursor + 1;
      if (nextCursor >= total) {
        if (!newCompletion) newCompletion = entry.shortcut;
        advanced.push({ shortcut: entry.shortcut, cursor: nextCursor });
      } else {
        hasAdvancing = true;
        advanced.push({ shortcut: entry.shortcut, cursor: nextCursor });
      }
    }

    if (advanced.length === 0) {
      return { kind: 'noMatch' };
    }

    if (newCompletion && !hasAdvancing) {
      // Only completions (no candidates still advancing) — fire immediately.
      return { kind: 'matched', shortcut: newCompletion };
    }

    if (hasAdvancing) {
      // At least one candidate still needs more keystrokes. Defer any
      // completion that happened on this input — it stays in the buffer
      // as a default retrievable via `getDefaultMatch` if the longer
      // candidates fail on a subsequent follow-on.
      return { kind: 'pending', pending: advanced };
    }

    // Only carried-forward completed entries survived; the current input
    // didn't match any active follow-on. Return noMatch so the input
    // falls through to the normal matcher. The coordinator dispatches
    // the deferred default from the stored buffer via `getDefaultMatch`.
    return { kind: 'noMatch' };
  }

  /**
   * Gather all shortcuts whose leading binding + modifiers + context match
   * the input AND that carry a non-empty `sequence` field. Reuses the
   * existing per-bucket predicates so context cascade, IME, and key-repeat
   * semantics behave identically to the single-keystroke matcher.
   */
  private collectChordLeadingMatches(input: KeyboardInput, context: TContext): TShortcut[] {
    const seen = new Set<string>();
    const result: TShortcut[] = [];

    const collect = (bucket: TShortcut[] | undefined) => {
      if (!bucket || bucket.length === 0) return;
      // Filter the bucket to only chord candidates, then run findInBucket
      // semantics in a loop to gather every survivor (not just the first).
      // findInBucket short-circuits on the first hit — for chord collection
      // we need every candidate that would have matched, so re-implement the
      // same predicate across the filtered list.
      for (const shortcut of bucket) {
        if (!shortcut.sequence || shortcut.sequence.length === 0) continue;
        if (seen.has(shortcut.id)) continue;

        if (input.isRepeat && !shortcut.allowRepeat) continue;
        if (!this.isContextMatch(shortcut.contexts, context)) continue;

        const binding = this.getBindingForPlatform(shortcut.bindings);
        if (!this.modifiersMatch(input.modifiers, binding.modifiers)) continue;

        result.push(shortcut);
        seen.add(shortcut.id);
      }
    };

    // Character-based bucket first (matchBy: 'key') — Alt+letter chords are
    // typically indexed here because alt+KeyH inferMatchBy returns 'key'.
    if (input.character) {
      const charKey = this.serializeByKey(
        this.getActiveModifiers(input.modifiers),
        input.character.toLowerCase(),
      );
      collect(this.byKey.get(charKey));
    }

    // Code-based bucket (matchBy: 'code').
    collect(isPhysicalKeyCode(input.physicalKey) ? this.byCode.get(input.physicalKey) : undefined);

    return result;
  }

  /**
   * True iff a chord follow-on entry accepts the given input. Shift is the
   * only modifier permitted on a follow-on (the caller has already ruled
   * out Ctrl/Alt/Meta).
   */
  private followOnAccepts(followOn: ChordFollowOn, input: KeyboardInput): boolean {
    if (typeof followOn === 'string') {
      // Bare PhysicalKeyCode — Shift is NOT permitted.
      if (input.modifiers.shift) return false;
      return followOn === input.physicalKey;
    }
    // { code, shift: true } — Shift is REQUIRED.
    if (!input.modifiers.shift) return false;
    return followOn.code === input.physicalKey;
  }

  /**
   * Serialize a character-based key for the byKey index.
   *
   * Format: sorted modifiers joined with '+', then '+key:' + character.
   * If no modifiers, just 'key:' + character.
   *
   * @example 'ctrl+key:b' for Ctrl+B
   * @example 'ctrl+shift+key:f' for Ctrl+Shift+F
   * @example 'key:a' for just 'A' with no modifiers
   */
  private serializeByKey(modifiers: ModifierKey[], character: string): string {
    if (modifiers.length === 0) {
      return `key:${character}`;
    }
    return `${modifiers.join('+')}+key:${character}`;
  }

  /**
   * Extract active modifier keys from a ModifierState, sorted alphabetically.
   */
  private getActiveModifiers(modifierState: ModifierState): ModifierKey[] {
    const active: ModifierKey[] = [];
    if (modifierState.alt) active.push('alt');
    if (modifierState.ctrl) active.push('ctrl');
    if (modifierState.meta) active.push('meta');
    if (modifierState.shift) active.push('shift');
    return active;
  }

  /**
   * Find a matching shortcut in a bucket of candidates.
   * Candidates are already sorted by priority (highest first); JS sort is
   * stable so equal-priority shortcuts retain their registration order.
   * Resolution within a bucket is therefore: priority desc, then registration
   * order. Callers that need a specific shortcut to beat an equal-priority
   * peer should register it earlier.
   *
   * @param candidates - Array of shortcut candidates (or undefined)
   * @param input - The keyboard input to match against
   * @param context - The current shortcut context
   * @returns The first matching shortcut, or null
   */
  private findInBucket(
    candidates: TShortcut[] | undefined,
    input: KeyboardInput,
    context: TContext,
  ): TShortcut | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    for (const shortcut of candidates) {
      // Bug 1 fix: chord shortcuts (`sequence?.length > 0`) are NOT
      // single-key matches. They fire only via `matchChordStart` /
      // `matchChordContinuation`. Without this filter, `findInBucket`
      // would return the first chord shortcut in the bucket as if it
      // were a single keystroke (e.g. `Alt+A,V,V` would fire on the
      // bare `Alt+A` keydown), pre-empting the proper single-key
      // shortcut sharing the same leading binding.
      if (shortcut.sequence && shortcut.sequence.length > 0) {
        continue;
      }

      // Check key repeat allowance
      if (input.isRepeat && !shortcut.allowRepeat) {
        continue;
      }

      // Check context compatibility
      if (!this.isContextMatch(shortcut.contexts, context)) {
        continue;
      }

      // Check modifier exact match
      const binding = this.getBindingForPlatform(shortcut.bindings);
      if (this.modifiersMatch(input.modifiers, binding.modifiers)) {
        return shortcut;
      }
    }

    return null;
  }

  /**
   * Find a matching shortcut in a bucket, tracking why non-matches were skipped.
   * Mirrors `findInBucket` and applies the same chord-filter (Bug 1 fix).
   */
  private findInBucketDetailed(
    candidates: TShortcut[],
    input: KeyboardInput,
    context: TContext,
  ): { shortcut: TShortcut | null; blockedByRepeat: boolean } {
    let blockedByRepeat = false;

    for (const shortcut of candidates) {
      // Bug 1 fix: skip chord shortcuts (see `findInBucket` comment).
      if (shortcut.sequence && shortcut.sequence.length > 0) {
        continue;
      }

      if (input.isRepeat && !shortcut.allowRepeat) {
        blockedByRepeat = true;
        continue;
      }

      if (!this.isContextMatch(shortcut.contexts, context)) {
        continue;
      }

      const binding = this.getBindingForPlatform(shortcut.bindings);
      if (this.modifiersMatch(input.modifiers, binding.modifiers)) {
        return { shortcut, blockedByRepeat: false };
      }
    }

    return { shortcut: null, blockedByRepeat };
  }

  /**
   * Check if input modifiers exactly match required modifiers.
   *
   * IMPORTANT: This is an EXACT match. If the shortcut requires [ctrl, shift],
   * the input must have ctrl=true, shift=true, alt=false, meta=false.
   *
   * @param inputMods - Modifier state from the input
   * @param requiredMods - Modifiers required by the shortcut
   * @returns True if modifiers match exactly
   */
  private modifiersMatch(inputMods: ModifierState, requiredMods: readonly ModifierKey[]): boolean {
    const required = new Set(requiredMods);

    const ctrlRequired = required.has('ctrl');
    const shiftRequired = required.has('shift');
    const altRequired = required.has('alt');
    const metaRequired = required.has('meta');

    return (
      inputMods.ctrl === ctrlRequired &&
      inputMods.shift === shiftRequired &&
      inputMods.alt === altRequired &&
      inputMods.meta === metaRequired
    );
  }

  /**
   * Check if a shortcut's contexts match the current context.
   *
   * Context Hierarchy:
   * - 'any' matches everything
   * - 'global' matches everything
   * - 'editing' matches: enterMode, editMode, formulaEnterMode, formulaEditMode
   * - 'formulaEditing' matches: formulaEnterMode, formulaEditMode
   * - 'grid' matches: flashFillPreview (the preview popup is non-modal — grid
   *   shortcuts like arrows / Cmd+C still apply, but Enter/Tab/Escape are
   *   overridden by exact-match flashFillPreview shortcuts via the two-pass
   *   resolution in findInBucket)
   *
   * @param shortcutContexts - Contexts where the shortcut is active
   * @param currentContext - The current context
   * @returns True if the shortcut should be active in the current context
   */
  private isContextMatch(
    shortcutContexts: TShortcut['contexts'],
    currentContext: TContext,
  ): boolean {
    return shortcutContexts.some((shortcutContext) =>
      this.contextIncludes(shortcutContext, currentContext),
    );
  }

  /**
   * Rebuild the index with new shortcuts.
   * Used for applying user customizations or updating the shortcut registry.
   *
   * @param shortcuts - New array of keyboard shortcuts
   */
  rebuild(shortcuts: readonly TShortcut[]): void {
    this.shortcuts = [...shortcuts];
    this.buildIndex(shortcuts);
  }

  /**
   * Get all shortcuts that are active in a given context.
   * Useful for displaying available shortcuts in UI (help dialogs, tooltips).
   *
   * @param context - The context to filter by
   * @returns Array of shortcuts active in the context (sorted by priority)
   */
  getShortcutsForContext(context: TContext): TShortcut[] {
    const result: TShortcut[] = [];
    const seen = new Set<string>();

    const collectFromMap = <TKey extends string>(map: ReadonlyMap<TKey, TShortcut[]>) => {
      map.forEach((shortcuts) => {
        for (const shortcut of shortcuts) {
          // Avoid duplicates (shortcuts may be indexed multiple times)
          if (seen.has(shortcut.id)) {
            continue;
          }

          if (this.isContextMatch(shortcut.contexts, context)) {
            result.push(shortcut);
            seen.add(shortcut.id);
          }
        }
      });
    };

    // Collect from both indexes
    collectFromMap(this.byCode);
    collectFromMap(this.byKey);

    // Sort by priority (highest first), then by id for stability
    // PRIORITY_ORDER uses lower number = higher priority, so ascending sort puts highest priority first
    result.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.id.localeCompare(b.id);
    });

    return result;
  }

  /**
   * Check if a proposed binding would conflict with existing shortcuts.
   * Used when users are customizing shortcuts to warn about conflicts.
   *
   * @param binding - The proposed binding
   * @param context - The context where the shortcut would be active
   * @param excludeId - Optional shortcut ID to exclude (when editing an existing shortcut)
   * @returns The conflicting shortcut, or null if no conflict
   */
  wouldConflict(
    binding: PhysicalKeyBinding,
    context: TContext,
    excludeId?: string,
  ): TShortcut | null {
    const checkCandidates = (candidates: TShortcut[] | undefined): TShortcut | null => {
      if (!candidates || candidates.length === 0) {
        return null;
      }

      for (const shortcut of candidates) {
        // Skip the shortcut being edited
        if (excludeId && shortcut.id === excludeId) {
          continue;
        }

        // Check if contexts overlap
        if (!this.contextsOverlap(shortcut.contexts, context)) {
          continue;
        }

        // Check if modifiers match
        const existingBinding = this.getBindingForPlatform(shortcut.bindings);
        if (this.bindingsEqual(binding, existingBinding)) {
          return shortcut;
        }
      }

      return null;
    };

    // Check code-based index
    const codeConflict = checkCandidates(this.byCode.get(binding.code));
    if (codeConflict) return codeConflict;

    // Check key-based index (all buckets, since we only have a PhysicalKeyBinding)
    for (const [, bucket] of this.byKey) {
      const keyConflict = checkCandidates(bucket);
      if (keyConflict) return keyConflict;
    }

    return null;
  }

  /**
   * Check if two contexts could potentially conflict.
   * Contexts conflict if a shortcut active in one could also be active in the other.
   */
  private contextsOverlap(shortcutContexts: TShortcut['contexts'], context: TContext): boolean {
    return shortcutContexts.some(
      (shortcutContext) =>
        this.contextIncludes(shortcutContext, context) ||
        this.contextIncludes(context, shortcutContext),
    );
  }

  private contextIncludes(parentContext: string, childContext: string): boolean {
    if (parentContext === 'any' || parentContext === 'global') {
      return true;
    }

    if (parentContext === childContext) {
      return true;
    }

    return this.contextHierarchy.get(parentContext)?.includes(childContext) ?? false;
  }

  /**
   * Check if two bindings are equal (same key code and modifiers).
   */
  private bindingsEqual(a: PhysicalKeyBinding, b: PhysicalKeyBinding): boolean {
    if (a.code !== b.code) return false;

    const aModifiers = [...a.modifiers].sort();
    const bModifiers = [...b.modifiers].sort();

    if (aModifiers.length !== bModifiers.length) return false;

    for (let i = 0; i < aModifiers.length; i++) {
      if (aModifiers[i] !== bModifiers[i]) return false;
    }

    return true;
  }

  /**
   * Get the current platform.
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Get all registered shortcuts.
   */
  getAllShortcuts(): TShortcut[] {
    return [...this.shortcuts];
  }

  /**
   * Get shortcuts by category.
   *
   * @param category - The category to filter by
   * @returns Array of shortcuts in the category
   */
  getShortcutsByCategory(category: TShortcut['category']): TShortcut[] {
    return this.shortcuts.filter((s) => s.category === category && s.enabled);
  }
}
