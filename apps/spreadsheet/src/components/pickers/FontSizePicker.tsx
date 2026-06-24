/**
 * FontSizePicker Component
 *
 * Editable font size combo box combining dropdown (preset sizes) with
 * text input (custom sizes). Supports validation, keyboard navigation,
 * and decimal sizes.
 *
 * Features:
 * - Preset sizes in dropdown (8-72 from FONT_SIZES)
 * - Custom size input with validation (1-409, decimals allowed)
 * - Keyboard: Arrow keys increment/decrement, Enter applies, Escape cancels
 * - Error state for invalid input
 * - Compact mode for toolbar
 *
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import {
  FONT_SIZE_WARNING_THRESHOLD,
  FONT_SIZES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '../../chrome/toolbar/primitives/ToolbarStyles';

interface FontSizePickerProps {
  /** Current font size */
  value: number;
  /** Callback when size changes */
  onChange: (size: number) => void;
  /** Called after Enter/Escape to return focus to the grid */
  onDismiss?: () => void;
  /** Compact mode for reduced width */
  isCompact?: boolean;
  /** Icon-only mode (not yet implemented) */
  isIconOnly?: boolean;
}

/**
 * FontSizePicker - Editable combo box for font size selection.
 *
 * Combines dropdown preset sizes with text input for custom values.
 * Validates range (1-409) and supports decimal sizes.
 */
export function FontSizePicker({
  value,
  onChange,
  onDismiss,
  isCompact = false,
  isIconOnly = false,
}: FontSizePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Explicit editing state: separate from display value
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const skipBlurRef = useRef(false);

  // Check if current size is below warning threshold
  const isSmallFont = value < FONT_SIZE_WARNING_THRESHOLD;

  // Display: prop value when not editing, local editValue when editing
  const displayValue = isEditing ? editValue : String(value);

  /**
   * Validate and apply font size.
   */
  const applySize = useCallback(
    (sizeStr: string) => {
      const size = parseFloat(sizeStr);

      // Validate
      if (isNaN(size) || size < MIN_FONT_SIZE || size > MAX_FONT_SIZE) {
        setError(true);
        setAnnouncement(
          `Invalid font size. Please enter a number between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}`,
        );
        return;
      }

      setError(false);
      // Include warning in announcement if size is very small
      if (size < FONT_SIZE_WARNING_THRESHOLD) {
        setAnnouncement(
          `Font size set to ${size}. Warning: text smaller than ${FONT_SIZE_WARNING_THRESHOLD} point may be difficult to read.`,
        );
      } else {
        setAnnouncement(`Font size set to ${size}`);
      }
      onChange(size);
      setIsOpen(false);
    },
    [onChange],
  );

  /**
   * Start editing: capture current value into editValue.
   */
  const handleFocus = useCallback(() => {
    setIsEditing(true);
    setEditValue(String(value));
    setIsOpen(true);
  }, [value]);

  /**
   * Handle input change - entering edit mode if not already.
   * Clears the dropdown's focused preset so Enter applies the typed
   * value rather than re-selecting the previously highlighted preset
   * (the open-on-focus useEffect pre-highlights the current value).
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isEditing) {
        setIsEditing(true);
      }
      setEditValue(e.target.value);
      setError(false);
      setFocusedIndex(-1);
    },
    [isEditing],
  );

  /**
   * Handle input blur - commit value only if we were editing and value changed.
   */
  const handleInputBlur = useCallback(() => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }

    if (!isEditing) {
      return;
    }

    if (editValue.trim() === '') {
      // Reset to current value if empty
      setIsEditing(false);
      setError(false);
      return;
    }

    const parsed = parseFloat(editValue);
    // Only dispatch if valid and different from current value
    if (!isNaN(parsed) && parsed >= MIN_FONT_SIZE && parsed <= MAX_FONT_SIZE) {
      if (parsed !== value) {
        applySize(editValue);
      }
    } else {
      // Invalid - show error but don't dispatch
      setError(true);
      setAnnouncement(
        `Invalid font size. Please enter a number between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}`,
      );
    }
    setIsEditing(false);
  }, [isEditing, editValue, value, applySize]);

  /**
   * Handle preset selection from dropdown.
   * Dispatch directly - no blur() call which would cause stale closure bug.
   */
  const handlePresetClick = useCallback(
    (size: number) => {
      setAnnouncement(`Font size set to ${size}`);
      onChange(size);
      setIsEditing(false);
      setIsOpen(false);
      setFocusedIndex(-1);
      setError(false);
      skipBlurRef.current = true;
      inputRef.current?.blur();
      onDismiss?.();
    },
    [onChange, onDismiss],
  );

  /**
   * Handle keyboard navigation.
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLDivElement>) => {
      // If dropdown is open, handle list navigation
      if (
        isOpen &&
        (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')
      ) {
        e.preventDefault();

        if (e.key === 'ArrowDown') {
          setFocusedIndex((prev) => Math.min(prev + 1, FONT_SIZES.length - 1));
        } else if (e.key === 'ArrowUp') {
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Home') {
          setFocusedIndex(0);
        } else if (e.key === 'End') {
          setFocusedIndex(FONT_SIZES.length - 1);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (isOpen && focusedIndex >= 0) {
          handlePresetClick(FONT_SIZES[focusedIndex]);
        } else if (isEditing) {
          applySize(editValue);
          setIsEditing(false);
          skipBlurRef.current = true;
          inputRef.current?.blur();
          onDismiss?.();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsEditing(false);
        setError(false);
        skipBlurRef.current = true;
        inputRef.current?.blur();
        setIsOpen(false);
        onDismiss?.();
      } else if (e.key === 'ArrowUp' && !isOpen) {
        e.preventDefault();
        // Increment from current value (prop), not editValue
        const newSize = Math.min(value + 1, MAX_FONT_SIZE);
        onChange(newSize); // Dispatch directly
      } else if (e.key === 'ArrowDown' && !isOpen) {
        e.preventDefault();
        // Decrement from current value (prop), not editValue
        const newSize = Math.max(value - 1, MIN_FONT_SIZE);
        onChange(newSize); // Dispatch directly
      }
    },
    [
      editValue,
      value,
      applySize,
      onChange,
      onDismiss,
      isOpen,
      isEditing,
      focusedIndex,
      handlePresetClick,
    ],
  );

  /**
   * Scroll focused item into view
   */
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll('[role="option"]');
      const focusedItem = items[focusedIndex] as HTMLElement | undefined;
      if (focusedItem && typeof focusedItem.scrollIntoView === 'function') {
        focusedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [isOpen, focusedIndex]);

  /**
   * Reset focused index when dropdown opens
   */
  useEffect(() => {
    if (isOpen) {
      // Find index of current value in FONT_SIZES
      const currentIndex = FONT_SIZES.indexOf(value);
      setFocusedIndex(currentIndex >= 0 ? currentIndex : -1);
    }
  }, [isOpen, value]);

  // NOTE: Click-outside handling for the dropdown is now managed by the parent Popover/RibbonDropdownPanel
  // when this picker is used in a dropdown context. For standalone usage, the input's onBlur handles closing.

  // Icon-only mode not yet implemented
  if (isIconOnly) {
    return null;
  }

  return (
    <div className="relative inline-flex">
      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Input with dropdown indicator */}
      <input
        ref={inputRef}
        type="text"
        data-testid="ribbon-dropdown-font-size"
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        className={`
 ${isCompact ? 'w-10' : 'w-12'} h-7 px-1
 border border-transparent rounded
 bg-transparent text-ss-text-secondary text-ribbon text-center
 cursor-pointer outline-none
 transition-colors duration-ss-fast
 hover:bg-ss-surface-hover
 ${
   error
     ? 'border-ss-error ring-1 ring-ss-error/20'
   : isSmallFont
       ? 'border-ss-warning ring-1 ring-ss-warning/20 bg-ss-warning-bg'
   : isOpen
        ? 'bg-ss-primary-light text-ss-primary'
        : ''
 }
 `}
        title={
          error
            ? `Invalid size. Enter a number between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`
            : isSmallFont
              ? `Warning: Font size ${value}pt may be difficult to read. Sizes below ${FONT_SIZE_WARNING_THRESHOLD}pt are very small.`
              : 'Font size'
        }
        aria-label="Font size"
        aria-invalid={error}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="font-size-list"
        aria-activedescendant={
          isOpen && focusedIndex >= 0 ? `font-size-${FONT_SIZES[focusedIndex]}` : undefined
        }
      />

      {/* Dropdown panel with preset sizes */}
      {isOpen && (
        <div
          ref={dropdownRef}
          id="font-size-list"
          data-testid="ribbon-dropdown-menu-font-size"
          className="absolute top-full left-0 mt-1 z-ss-popover bg-ss-surface border border-ss-border rounded shadow-ss-lg max-h-60 overflow-y-auto"
          role="listbox"
          aria-label="Font size presets"
          onKeyDown={handleKeyDown}
        >
          {FONT_SIZES.map((size, index) => {
            const isSelected = size === value;
            const isFocused = index === focusedIndex;

            return (
              <button
                key={size}
                id={`font-size-${size}`}
                data-value={String(size)}
                type="button"
                onClick={() => handlePresetClick(size)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`
 w-full px-3 py-1.5 text-left text-ribbon
 outline-none transition-colors duration-ss-fast
 ${isSelected ? 'bg-ss-primary/10 text-ss-primary' : isFocused ? 'bg-ss-primary-light outline outline-2 outline-primary -outline-offset-2' : 'hover:bg-ss-surface-hover text-ss-text-secondary'}
 `}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
              >
                {size}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
