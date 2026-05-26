/**
 * Listbox Primitive
 *
 * Single-select listbox implementing the WAI-ARIA APG pattern with roving
 * tabindex and selection-follows-focus semantics.
 *
 * Behaviour:
 * - The container is `role="listbox"`. Items are `role="option"` with
 *   `aria-selected` reflecting the selected key.
 * - Exactly the currently-selected item carries `tabIndex={0}`; all
 *   others carry `tabIndex={-1}` (roving tabindex). Tab moves focus into
 *   and out of the listbox as a single stop.
 * - Arrow keys (or Home/End) move focus AND change the selection in one
 *   step — `onSelect(newKey)` fires for every keystroke that moves focus.
 *   Enter and Space are accepted as no-ops on the active option for
 *   parity with the APG keyboard map (selection has already followed
 *   focus).
 * - When `autoFocus` is set, the selected option claims DOM focus on
 *   mount. Use this to direct initial focus into a listbox that opens
 *   inside a dialog.
 *
 * Style reference: see `radix/Dialog.tsx` for typing/comment/className
 * composition conventions.
 */

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
} from 'react';

export interface ListboxItem<K extends string> {
  key: K;
  label: ReactNode;
  disabled?: boolean;
}

export interface ListboxItemRenderState {
  isSelected: boolean;
  isFocused: boolean;
  isDisabled: boolean;
}

export interface ListboxProps<K extends string> {
  /** Items to render in source order. */
  items: ReadonlyArray<ListboxItem<K>>;
  /** Currently selected item key. */
  selectedKey: K;
  /**
   * Called when arrow/Home/End/click moves selection to a new key.
   * Selection follows focus, so this fires on every navigation.
   */
  onSelect: (key: K) => void;
  /**
   * Stable id prefix for option elements. Each option gets
   * `id={`${idPrefix}-option-${key}`}`. When omitted, `aria-labelledby`
   * is the only safe linkage; see `aria-activedescendant` consumers.
   */
  idPrefix?: string;
  /** Accessible label for the listbox. */
  'aria-label'?: string;
  /** Id of an element labelling the listbox. */
  'aria-labelledby'?: string;
  /** Listbox orientation; controls which arrow keys navigate. */
  orientation?: 'vertical' | 'horizontal';
  /**
   * Focus the selected option on mount. Use when the listbox is the
   * intended initial focus target inside a newly-opened dialog/popover.
   */
  autoFocus?: boolean;
  /** Container class name (applied to `[role="listbox"]`). */
  className?: string;
  /**
   * Per-item class. A function form receives the item plus its current
   * render state so callers can express selected/focused styling without
   * a separate render prop.
   */
  itemClassName?: string | ((item: ListboxItem<K>, state: ListboxItemRenderState) => string);
  /** Optional ref for the listbox container. */
  containerRef?: Ref<HTMLDivElement>;
}

const arrowKeysByOrientation = {
  vertical: { next: 'ArrowDown', prev: 'ArrowUp' },
  horizontal: { next: 'ArrowRight', prev: 'ArrowLeft' },
} as const;

function resolveItemClassName<K extends string>(
  itemClassName: ListboxProps<K>['itemClassName'],
  item: ListboxItem<K>,
  state: ListboxItemRenderState,
): string {
  if (typeof itemClassName === 'function') return itemClassName(item, state);
  return itemClassName ?? '';
}

function nextEnabledIndex<K extends string>(
  items: ReadonlyArray<ListboxItem<K>>,
  from: number,
  step: 1 | -1,
): number {
  if (items.length === 0) return -1;
  let i = from;
  for (let visited = 0; visited < items.length; visited++) {
    i = (i + step + items.length) % items.length;
    if (!items[i].disabled) return i;
  }
  return from;
}

function firstEnabledIndex<K extends string>(items: ReadonlyArray<ListboxItem<K>>): number {
  return items.findIndex((it) => !it.disabled);
}

function lastEnabledIndex<K extends string>(items: ReadonlyArray<ListboxItem<K>>): number {
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].disabled) return i;
  return -1;
}

const baseItemClasses = 'outline-none cursor-pointer';
const baseListClasses = 'outline-none';

const containerStyle: CSSProperties = { isolation: 'isolate' };

/**
 * Listbox - WAI-ARIA single-select listbox with roving tabindex.
 *
 * @example
 * ```tsx
 * <Listbox
 *   items={categories.map((c) => ({ key: c.id, label: c.label }))}
 *   selectedKey={selectedCategory}
 *   onSelect={setSelectedCategory}
 *   aria-label="Number format categories"
 *   autoFocus
 * />
 * ```
 */
export function Listbox<K extends string>({
  items,
  selectedKey,
  onSelect,
  idPrefix,
  orientation = 'vertical',
  autoFocus = false,
  className = '',
  itemClassName,
  containerRef,
  ...rest
}: ListboxProps<K>): ReactElement {
  const ariaLabel = rest['aria-label'];
  const ariaLabelledBy = rest['aria-labelledby'];
  const itemRefs = useRef(new Map<K, HTMLButtonElement>());
  const selectedIndex = items.findIndex((it) => it.key === selectedKey);
  const { next, prev } = arrowKeysByOrientation[orientation];

  // The roving tabindex anchor: prefer the selected option, fall back
  // to the first enabled option so the listbox is always reachable
  // when `selectedKey` doesn't match any item (e.g. transient state).
  const tabStopIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(items);

  useEffect(() => {
    if (!autoFocus) return;
    const target = items[tabStopIndex];
    if (!target) return;
    itemRefs.current.get(target.key)?.focus();
    // We intentionally only auto-focus on mount; subsequent autoFocus
    // toggles do not re-steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusItem = useCallback((key: K) => {
    itemRefs.current.get(key)?.focus();
  }, []);

  const moveTo = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item || item.disabled) return;
      onSelect(item.key);
      focusItem(item.key);
    },
    [items, onSelect, focusItem],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case next: {
          event.preventDefault();
          const from = selectedIndex >= 0 ? selectedIndex : -1;
          moveTo(nextEnabledIndex(items, from, 1));
          return;
        }
        case prev: {
          event.preventDefault();
          const from = selectedIndex >= 0 ? selectedIndex : items.length;
          moveTo(nextEnabledIndex(items, from, -1));
          return;
        }
        case 'Home': {
          event.preventDefault();
          moveTo(firstEnabledIndex(items));
          return;
        }
        case 'End': {
          event.preventDefault();
          moveTo(lastEnabledIndex(items));
          return;
        }
        case ' ': {
          // Selection follows focus, so Space is a no-op on the active
          // option. preventDefault stops the surrounding container from
          // scrolling. Enter intentionally falls through so an enclosing
          // form/dialog can commit on it (e.g. Format Cells' Enter-closes-
          // and-applies flow).
          event.preventDefault();
          return;
        }
      }
    },
    [items, moveTo, next, prev, selectedIndex],
  );

  return (
    <div
      role="listbox"
      ref={containerRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation={orientation}
      className={`${baseListClasses} ${className}`.trim()}
      style={containerStyle}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const isSelected = item.key === selectedKey;
        const isTabStop = index === tabStopIndex;
        const optionId = idPrefix ? `${idPrefix}-option-${item.key}` : undefined;
        const renderState: ListboxItemRenderState = {
          isSelected,
          // `isFocused` mirrors `isSelected` because selection follows focus.
          // Callers that style focus separately can still apply :focus
          // pseudo-classes to the rendered button.
          isFocused: isSelected,
          isDisabled: !!item.disabled,
        };
        const composedClass =
          `${baseItemClasses} ${resolveItemClassName(itemClassName, item, renderState)}`.trim();
        return (
          <button
            key={item.key}
            ref={(el) => {
              if (el) itemRefs.current.set(item.key, el);
              else itemRefs.current.delete(item.key);
            }}
            id={optionId}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-disabled={item.disabled || undefined}
            tabIndex={isTabStop ? 0 : -1}
            disabled={item.disabled}
            className={composedClass}
            data-listbox-key={item.key}
            data-state={isSelected ? 'selected' : 'unselected'}
            onClick={() => {
              if (item.disabled) return;
              onSelect(item.key);
              focusItem(item.key);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
