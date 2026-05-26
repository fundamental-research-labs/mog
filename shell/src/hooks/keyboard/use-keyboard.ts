/**
 * useKeyboard - React hook for unified keyboard handling.
 *
 * This hook integrates the KeyboardEventProcessor and ShortcutMatcher to provide
 * a complete keyboard handling solution for React components.
 *
 * KEY DESIGN PRINCIPLES:
 * 1. Single Source of Truth: All keyboard handling flows through this hook
 * 2. Physical Keys: Uses e.code for shortcuts (layout-independent)
 * 3. Character Keys: Uses e.key for text input (what user intended to type)
 * 4. Platform Aware: Automatically handles Mac/Windows/Linux differences
 * 5. IME Safe: Never fires shortcuts during IME composition
 *
 * @example
 * ```tsx
 * function SpreadsheetGrid() {
 *   const context = useKeyboardContext({ isEditing, isFormulaBarFocused, ... });
 *
 *   const { handleKeyDown } = useKeyboard({
 *     context,
 *     onShortcut: (shortcut, input) => {
 *       dispatch(shortcut.action);
 *     },
 *     onCharacter: (char, input) => {
 *       if (context === 'grid') {
 *         startEditing(char);
 *       }
 *     }
 *   });
 *
 *   useEffect(() => {
 *     document.addEventListener('keydown', handleKeyDown);
 *     return () => document.removeEventListener('keydown', handleKeyDown);
 *   }, [handleKeyDown]);
 *
 *   return <canvas />;
 * }
 * ```
 *
 * @module shell/hooks/keyboard/use-keyboard
 */

import { useCallback, useMemo, useRef } from 'react';

import type {
  ClassifiedInput,
  KeyboardInput,
  KeyboardShortcutBase,
  Platform,
  ShortcutContextHierarchy,
} from '@mog-sdk/kernel/keyboard';

import { usePlatformIdentity } from '../../context/platform-identity-context';

import { KeyboardEventProcessor, ShortcutMatcher } from '@mog-sdk/kernel/keyboard';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the useKeyboard hook.
 */
export interface UseKeyboardOptions<
  TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase,
  TContext extends string = string,
> {
  /**
   * Current context for shortcut matching.
   *
   * The context determines which shortcuts are active. For example,
   * in 'grid' context, navigation shortcuts work, but in 'editing'
   * context, those same keys type characters.
   */
  context: TContext;

  /**
   * Shortcuts array to use for matching.
   *
   * This should be the KEYBOARD_SHORTCUTS from your shortcut definitions,
   * optionally with user customizations applied.
   *
   * If not provided, defaults to an empty array (no shortcuts will match).
   */
  shortcuts?: readonly TShortcut[];

  /**
   * Callback when a shortcut matches.
   *
   * This is called when a keyboard input matches a registered shortcut
   * in the current context. The handler should dispatch the appropriate
   * action and call input.originalEvent.preventDefault() if the event
   * should not bubble.
   *
   * @param shortcut - The matched shortcut definition
   * @param input - The normalized keyboard input
   */
  onShortcut?: (shortcut: TShortcut, input: KeyboardInput) => void;

  /**
   * Callback for character input (printable characters without command modifiers).
   *
   * This is the "type-to-edit" entry point. When the user presses a key
   * that produces a printable character (and no Ctrl/Cmd/Alt modifiers),
   * this callback receives the character.
   *
   * NOTE: This uses input.character (from e.key), NOT input.physicalKey.
   * This ensures correct behavior for international keyboards and Shift.
   *
   * @param char - The character that was typed
   * @param input - The normalized keyboard input
   */
  onCharacter?: (char: string, input: KeyboardInput) => void;

  /**
   * Callback for navigation keys (arrows, Home, End, Page Up/Down).
   *
   * These keys don't have command modifiers but aren't characters either.
   * Use this for cursor movement in grid mode.
   *
   * @param input - The normalized keyboard input
   */
  onNavigation?: (input: KeyboardInput) => void;

  /**
   * Callback for action keys (Enter, Escape, Tab, Backspace, Delete, F-keys).
   *
   * These are special keys that have context-dependent behavior.
   * In 'grid' context, Enter might start editing. In 'editing' context,
   * Enter might commit the edit.
   *
   * @param input - The normalized keyboard input
   */
  onAction?: (input: KeyboardInput) => void;

  /**
   * Whether keyboard handling is enabled.
   *
   * When false, handleKeyDown does nothing. Use this to temporarily
   * disable keyboard handling (e.g., when a modal is open).
   *
   * @default true
   */
  enabled?: boolean;

  /**
   * Platform override for testing.
   *
   * If not provided, the platform is auto-detected from navigator.
   */
  platform?: Platform;

  /**
   * Context hierarchy for shortcut activation.
   *
   * The spreadsheet app passes the default spreadsheet hierarchy through the
   * matcher. Other apps can supply their own hierarchy without shell knowing
   * the concrete context union.
   */
  contextHierarchy?: ShortcutContextHierarchy<TContext>;
}

/**
 * Return type for the useKeyboard hook.
 */
export interface UseKeyboardReturn<
  TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase,
  TContext extends string = string,
> {
  /**
   * Process a raw KeyboardEvent into normalized input.
   *
   * Use this for advanced scenarios where you need to inspect
   * the normalized input without triggering callbacks.
   */
  process: (event: KeyboardEvent) => KeyboardInput;

  /**
   * Classify the input type.
   *
   * Returns 'shortcut', 'character', 'navigation', 'action', etc.
   */
  classify: (input: KeyboardInput) => ClassifiedInput;

  /**
   * Match input to a shortcut in the current context.
   *
   * Returns the matched shortcut or null if no match.
   */
  matchShortcut: (input: KeyboardInput) => TShortcut | null;

  /**
   * Main keyboard event handler.
   *
   * This processes the event, classifies it, matches shortcuts,
   * and routes to the appropriate callback. Attach this to your
   * container's keydown listener.
   *
   * For React: Use as onKeyDown={(e) => handleKeyDown(e.nativeEvent)}
   * For DOM: Use as document.addEventListener('keydown', handleKeyDown)
   */
  handleKeyDown: (event: KeyboardEvent) => void;

  /**
   * The current platform.
   */
  platform: Platform;

  /**
   * Get all shortcuts active in the current context.
   *
   * Useful for displaying available shortcuts in UI.
   */
  getActiveShortcuts: () => TShortcut[];
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for unified keyboard handling.
 *
 * This hook provides a complete keyboard handling solution that:
 * - Normalizes raw DOM events into platform-agnostic input
 * - Classifies input types (shortcut, character, navigation, etc.)
 * - Matches shortcuts against a registry with context awareness
 * - Routes events to appropriate callbacks
 * - Handles IME composition correctly
 *
 * @param options - Configuration options
 * @returns Keyboard handling utilities and callbacks
 */
export function useKeyboard<
  TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase,
  TContext extends string = string,
>(options: UseKeyboardOptions<TShortcut, TContext>): UseKeyboardReturn<TShortcut, TContext> {
  const {
    context,
    shortcuts = [],
    onShortcut,
    onCharacter,
    onNavigation,
    onAction,
    enabled = true,
    platform: platformOverride,
    contextHierarchy,
  } = options;

  // Derive keyboard Platform from PlatformIdentity (no navigator sniffing)
  const identity = usePlatformIdentity();
  const identityPlatform: Platform =
    identity.os === 'macos' ? 'macos' : identity.os === 'linux' ? 'linux' : 'windows';

  // ============================================================================
  // Lazy Singleton: KeyboardEventProcessor
  // ============================================================================

  // Processor is stateless except for platform detection, so we can share it.
  // Using a ref to avoid recreating on every render.
  const processorRef = useRef<KeyboardEventProcessor | null>(null);

  const getProcessor = useCallback((): KeyboardEventProcessor => {
    if (!processorRef.current) {
      const platform = platformOverride ?? identityPlatform;
      processorRef.current = new KeyboardEventProcessor(platform);
    }
    return processorRef.current;
  }, [platformOverride, identityPlatform]);

  // ============================================================================
  // ShortcutMatcher: Rebuild when shortcuts or platform changes
  // ============================================================================

  const matcher = useMemo(() => {
    const processor = getProcessor();
    return new ShortcutMatcher<TShortcut, TContext>(shortcuts, processor.platform, {
      contextHierarchy,
    });
  }, [shortcuts, getProcessor, contextHierarchy]);

  // ============================================================================
  // Core Functions
  // ============================================================================

  const process = useCallback(
    (event: KeyboardEvent): KeyboardInput => {
      return getProcessor().process(event);
    },
    [getProcessor],
  );

  const classify = useCallback(
    (input: KeyboardInput): ClassifiedInput => {
      return getProcessor().classify(input);
    },
    [getProcessor],
  );

  const matchShortcut = useCallback(
    (input: KeyboardInput): TShortcut | null => {
      return matcher.match(input, context);
    },
    [matcher, context],
  );

  // ============================================================================
  // Main Event Handler
  // ============================================================================

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      // Early exit if disabled
      if (!enabled) {
        return;
      }

      // Process the event
      const input = process(event);
      const classified = classify(input);

      // ========================================================================
      // IME Composition: Never handle during composition
      // ========================================================================

      if (classified.type === 'composition') {
        // Let the IME handle it
        return;
      }

      // ========================================================================
      // Modifier-only keys: Usually ignored
      // ========================================================================

      if (classified.type === 'modifier-only') {
        // Pressing Shift/Ctrl/Alt/Meta alone - nothing to do
        return;
      }

      // ========================================================================
      // Shortcut type: Try to match a shortcut first
      // ========================================================================

      if (classified.type === 'shortcut') {
        const shortcut = matchShortcut(input);

        if (shortcut) {
          // Check browser conflict policy
          if (shortcut.browserConflict?.policy === 'defer') {
            // Let browser handle it
            return;
          }

          // Call the shortcut handler
          if (onShortcut) {
            onShortcut(shortcut, input);
            // Note: Handler is responsible for calling preventDefault
          }
          return;
        }

        // No shortcut matched - fall through to check other types
        // This allows Ctrl+Key combinations that aren't shortcuts to bubble
      }

      // ========================================================================
      // Navigation: Arrow keys, Home, End, Page Up/Down
      // ========================================================================

      if (classified.type === 'navigation') {
        if (onNavigation) {
          onNavigation(input);
        }
        return;
      }

      // ========================================================================
      // Action: Enter, Escape, Tab, Backspace, Delete, F-keys
      // ========================================================================

      if (classified.type === 'action') {
        if (onAction) {
          onAction(input);
        }
        return;
      }

      // ========================================================================
      // Character: Printable characters for type-to-edit
      // ========================================================================

      if (classified.type === 'character' && classified.isPrintable) {
        if (onCharacter) {
          // Pass the character (e.key), not the physical key
          onCharacter(input.character, input);
        }
        return;
      }

      // ========================================================================
      // Unknown: Let it bubble
      // ========================================================================

      // Unknown input types are not handled - let them bubble
    },
    [enabled, process, classify, matchShortcut, onShortcut, onCharacter, onNavigation, onAction],
  );

  // ============================================================================
  // Utility: Get active shortcuts
  // ============================================================================

  const getActiveShortcuts = useCallback((): TShortcut[] => {
    return matcher.getShortcutsForContext(context);
  }, [matcher, context]);

  // ============================================================================
  // Return Value
  // ============================================================================

  return useMemo(
    () => ({
      process,
      classify,
      matchShortcut,
      handleKeyDown,
      platform: getProcessor().platform,
      getActiveShortcuts,
    }),
    [process, classify, matchShortcut, handleKeyDown, getProcessor, getActiveShortcuts],
  );
}
