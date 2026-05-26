/**
 * useSelectedTextEffect Hooks
 *
 * Provides access to the currently selected TextEffect object for UI components.
 * Includes both a standard hook and a debounced version for display purposes.
 *
 * ⚠️ RENDER ISOLATION (Architecture Checklist Section 15)
 *
 * The Format Tab subscribes to selection state which can change frequently
 * during drag operations. To prevent unnecessary re-renders:
 *
 * ❌ AVOID - Reactive subscription in toolbar
 * const selectedTextEffect = useSelectedTextEffect(); // Re-renders on every selection change
 *
 * ✅ PREFER - On-demand read in action handlers
 * const handleUpdateFill = () => {
 * const deps = useActionDependencies;
 * // Read selection only when action is invoked
 * dispatch('UPDATE_TEXT_EFFECT_FILL', deps, { fill: newFill });
 * // Handler reads current selection via deps.accessors
 * };
 *
 * For display purposes (showing current format), use debounced selection:
 * const selectedTextEffect = useSelectedTextEffectDebounced(); // Only updates after selection settles
 *
 * UI Components - Hook for Selected TextEffect
 *
 * @module hooks/useSelectedTextEffect
 */

import { useEffect, useState } from 'react';

import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';

import { useFloatingObject } from './use-floating-object';
import { useObjectInteraction } from './use-object-interaction';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A TextBox object that has TextEffect styling applied.
 * This is a narrowed type of TextBoxObject where textEffects is guaranteed to exist.
 */
export type TextEffectTextBox = TextBoxObject & {
  textEffects: NonNullable<TextBoxObject['textEffects']>;
};

// =============================================================================
// STANDARD HOOK
// =============================================================================

/**
 * Hook to get the currently selected TextEffect object.
 *
 * Returns the selected floating object if:
 * - Exactly one object is selected
 * - The object is a textbox
 * - The textbox has textEffects configuration
 *
 * ⚠️ PERFORMANCE WARNING: This hook subscribes to selection state which can
 * change frequently during drag operations. For Format Tab components that
 * display current formatting, use `useSelectedTextEffectDebounced()` instead.
 * For action handlers, read selection on-demand via `deps.accessors`.
 *
 * @returns The selected TextEffect object, or null if no TextEffect is selected
 *
 * @example
 * ```tsx
 * // Use in components that need immediate selection feedback
 * function TextEffectSelectionIndicator() {
 * const selectedTextEffect = useSelectedTextEffect;
 * if (!selectedTextEffect) return null;
 * return <span>TextEffect selected: {selectedTextEffect.content}</span>;
 * }
 * ```
 */
export function useSelectedTextEffect(): TextEffectTextBox | null {
  const { selectedIds } = useObjectInteraction();
  const obj = useFloatingObject(selectedIds.length === 1 ? selectedIds[0] : '');

  // Must be a textbox with textEffects
  if (!obj || obj.type !== 'textbox') return null;
  if (!obj.textEffects) return null;
  return { ...obj, textEffects: obj.textEffects };
}

// =============================================================================
// DEBOUNCED HOOK
// =============================================================================

/**
 * Debounce delay for selection updates.
 * 100-150ms prevents re-renders during drag while still feeling responsive.
 */
const DEFAULT_DEBOUNCE_DELAY_MS = 100;

/**
 * Debounced version of useSelectedTextEffect for display purposes.
 *
 * Only updates after selection settles (prevents re-renders during drag).
 * Use this in Format Tab components that display current formatting values.
 *
 * For action handlers, still read current selection on-demand via
 * `deps.accessors.getSelectedTextEffect()` to ensure you get the latest value.
 *
 * @param delay - Debounce delay in milliseconds (default: 100ms)
 * @returns The selected TextEffect object (debounced), or null if no TextEffect is selected
 *
 * @example
 * ```tsx
 * // ✅ Use in Format Tab for display
 * function TextEffectFormatTab() {
 * const selectedTextEffect = useSelectedTextEffectDebounced;
 *
 * if (!selectedTextEffect) return null;
 *
 * // Display current format values (debounced, won't flicker during drag)
 * const currentFontSize = selectedTextEffect.text?.format?.fontSize ?? 36;
 *
 * return (
 * <div>
 * <FontSizeDisplay value={currentFontSize} />
 * <Button onClick={ => handleUpdateFill}>Change Fill</Button>
 * </div>
 * );
 * }
 *
 * // In handlers, read current selection on-demand
 * function handleUpdateFill() {
 * const current = deps.accessors.getSelectedTextEffect;
 * if (!current) return;
 * dispatch('UPDATE_TEXT_EFFECT_FILL', deps, { ... });
 * }
 * ```
 */
export function useSelectedTextEffectDebounced(
  delay: number = DEFAULT_DEBOUNCE_DELAY_MS,
): TextEffectTextBox | null {
  const selectedTextEffect = useSelectedTextEffect();
  const [debouncedValue, setDebouncedValue] = useState<TextEffectTextBox | null>(
    selectedTextEffect,
  );

  useEffect(() => {
    // Set up the timeout to update debounced value
    const timeoutId = setTimeout(() => {
      setDebouncedValue(selectedTextEffect);
    }, delay);

    // Clear timeout if value changes or component unmounts
    return () => {
      clearTimeout(timeoutId);
    };
  }, [selectedTextEffect, delay]);

  return debouncedValue;
}
