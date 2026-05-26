/**
 * Keyboard shortcut infrastructure contracts.
 *
 * These types are action-agnostic and owned by `@mog-sdk/kernel/keyboard`.
 * Application action unions and payload maps live with the application.
 */

import type { ModifierKey, PhysicalKeyCode } from '../physical-keys';

export interface PhysicalKeyBinding {
  readonly code: PhysicalKeyCode;
  readonly modifiers: readonly ModifierKey[];
}

export interface PlatformKeyBindings {
  readonly default: PhysicalKeyBinding;
  readonly macos?: PhysicalKeyBinding;
  readonly windows?: PhysicalKeyBinding;
  readonly linux?: PhysicalKeyBinding;
}

export type ShortcutPriority = 'critical' | 'high' | 'medium' | 'low';

export type BrowserConflictPolicy = 'override' | 'defer' | 'none';

export interface BrowserConflict {
  readonly conflictsWith?: string;
  readonly policy: BrowserConflictPolicy;
  readonly workaround?: string;
}

export type ChordFollowOn =
  | PhysicalKeyCode
  | { readonly code: PhysicalKeyCode; readonly shift: true };

export type ShortcutContextBase = string;
export type ShortcutCategoryBase = string;
export type ShortcutContext = ShortcutContextBase;
export type ShortcutCategory = ShortcutCategoryBase;
export type MuscleMemoryLevel = 'essential' | 'common' | 'occasional' | 'rare';

export interface KeyboardShortcutBase<
  TAction extends string = string,
  TContext extends string = ShortcutContextBase,
  TCategory extends string = ShortcutCategoryBase,
> {
  readonly id: string;
  readonly bindings: PlatformKeyBindings;
  readonly description: string;
  readonly action: TAction;
  readonly enabled: boolean;
  readonly priority: ShortcutPriority;
  readonly category: TCategory;
  readonly contexts: readonly TContext[];
  readonly matchBy?: 'code' | 'key';
  readonly expectedCharacter?: string;
  readonly allowRepeat?: boolean;
  readonly sequence?: readonly ChordFollowOn[];
  readonly browserConflict?: BrowserConflict;
  readonly muscleMemory?: MuscleMemoryLevel;
  readonly global?: boolean;
  readonly notes?: string;
}

export type KeyboardShortcut<
  TAction extends string = string,
  TContext extends string = ShortcutContextBase,
  TCategory extends string = ShortcutCategoryBase,
> = KeyboardShortcutBase<TAction, TContext, TCategory>;

export interface ShortcutMatchResult<
  TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase,
> {
  readonly shortcut: TShortcut | null;
  readonly preventDefault: boolean;
}

export type ShortcutHandler<TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase> = (
  shortcut: TShortcut,
) => boolean;

export type ShortcutRegistry<TShortcut extends KeyboardShortcutBase = KeyboardShortcutBase> =
  ReadonlyMap<string, TShortcut>;

/**
 * Priority order for shortcut matching.
 * Lower number = higher priority (matched first).
 */
export const PRIORITY_ORDER: Record<ShortcutPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

/**
 * Get the numeric priority value for sorting.
 *
 * @param priority - The priority level
 * @returns Numeric value (lower = higher priority)
 */
export function getPriorityValue(priority: ShortcutPriority): number {
  return PRIORITY_ORDER[priority];
}
