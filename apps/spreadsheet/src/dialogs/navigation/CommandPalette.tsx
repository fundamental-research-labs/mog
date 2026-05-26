/**
 * Command Palette Component
 *
 * VSCode-style command palette for executing spreadsheet actions.
 * Opens with Ctrl+Shift+P (Cmd+Shift+P on Mac).
 *
 * Features:
 * - Fuzzy search across all registered commands
 * - Keyboard navigation (arrow keys, Enter, Escape)
 * - Displays command category and keyboard shortcut
 * - Groups results by category
 *
 * Uses FocusTrap with layerType='commandPalette' for proper keyboard isolation.
 *
 * @see Stream-H-FORMULA-BAR-COMMAND-PALETTE.md
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '../../internal-api';

import type { Command } from '@mog-sdk/contracts/commands';
import { commandRegistry } from '../../actions/commands';
import { FocusTrap } from '../../components/focus';
// =============================================================================
// Component
// =============================================================================

interface CommandPaletteProps {
  /** Additional class name */
  className?: string;
}

export function CommandPalette({ className }: CommandPaletteProps) {
  const isOpen = useUIStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Search commands
  const results = useMemo(() => {
    return commandRegistry.search(query, { limit: 50 });
  }, [query]);

  // Group results by category for display
  const groupedResults = useMemo(() => {
    const groups: Array<{
      category: string;
      commands: Array<{ command: Command; globalIndex: number }>;
    }> = [];
    let currentCategory = '';
    let globalIndex = 0;

    for (const command of results) {
      if (command.category !== currentCategory) {
        currentCategory = command.category;
        groups.push({ category: currentCategory, commands: [] });
      }
      groups[groups.length - 1].commands.push({ command, globalIndex });
      globalIndex++;
    }

    return groups;
  }, [results]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedItemRef.current && resultsRef.current) {
      const item = selectedItemRef.current;
      const container = resultsRef.current;
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.offsetHeight;

      if (itemTop < containerTop) {
        container.scrollTop = itemTop - 8;
      } else if (itemBottom > containerBottom) {
        container.scrollTop = itemBottom - container.offsetHeight + 8;
      }
    }
  }, [selectedIndex]);

  // Execute command and close
  const executeCommand = useCallback(
    async (command: Command) => {
      closeCommandPalette();
      await commandRegistry.execute(command.id);
    },
    [closeCommandPalette],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            executeCommand(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          closeCommandPalette();
          break;
        case 'Tab':
          // Prevent focus from leaving the palette
          e.preventDefault();
          break;
      }
    },
    [results, selectedIndex, executeCommand, closeCommandPalette],
  );

  // Handle item click
  const handleItemClick = useCallback(
    (command: Command) => {
      executeCommand(command);
    },
    [executeCommand],
  );

  // Handle overlay click (close when clicking outside)
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeCommandPalette();
      }
    },
    [closeCommandPalette],
  );

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-ss-tooltip flex justify-center bg-ss-overlay pt-20 ${className ?? ''}`}
      onClick={handleOverlayClick}
    >
      <FocusTrap
        dialogId="command-palette"
        layerType="commandPalette"
        onClose={closeCommandPalette}
        initialFocusRef={inputRef}
        isPortal
        className="flex h-fit max-h-[420px] w-[560px] max-w-[90vw] flex-col overflow-hidden rounded-ss-lg bg-ss-surface shadow-ss-xl animate-in fade-in duration-ss-fast"
        aria-label="Command Palette"
      >
        {/* Search Input */}
        <div className="flex items-center gap-2 border-b border-ss-border px-4 py-3">
          <span className="shrink-0 text-body-lg text-ss-text-secondary" aria-hidden="true">
            &#128269;
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 border-none bg-transparent text-body outline-none placeholder:text-ss-text-tertiary"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-controls="command-palette-results"
          />
        </div>

        {/* Results */}
        <div
          id="command-palette-results"
          ref={resultsRef}
          className="flex-1 overflow-auto py-1"
          role="listbox"
          aria-label="Command results"
        >
          {groupedResults.map((group) => (
            <div key={group.category}>
              {/* Category header (only show if multiple categories or query is empty) */}
              {(groupedResults.length > 1 || !query) && (
                <div className="px-4 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-ss-text-secondary">
                  {group.category}
                </div>
              )}
              {group.commands.map(({ command, globalIndex }) => {
                const isSelected = globalIndex === selectedIndex;
                return (
                  <div
                    key={command.id}
                    ref={isSelected ? selectedItemRef : undefined}
                    className={`flex cursor-pointer items-center justify-between px-4 py-2 transition-colors duration-ss-fast ${
                      isSelected ? 'bg-ss-primary-light' : 'hover:bg-ss-surface-secondary'
                    }`}
                    onClick={() => handleItemClick(command)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="truncate text-body-lg text-text">{command.label}</span>
                    </div>
                    {command.shortcut && (
                      <span className="ml-3 shrink-0 rounded bg-ss-surface-tertiary px-1.5 py-0.5 font-ss-mono text-body-sm text-ss-text-secondary">
                        {command.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {results.length === 0 && (
            <div className="p-6 text-center text-body-lg text-ss-text-secondary">
              {query ? 'No commands found' : 'No commands registered'}
            </div>
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between border-t border-ss-border px-4 py-2 text-body-sm text-ss-text-secondary">
          <div className="flex items-center gap-3">
            <span>
              <span className="rounded bg-ss-surface-tertiary px-1 py-0.5 font-ss-mono text-caption">
                ↑↓
              </span>{' '}
              Navigate
            </span>
            <span>
              <span className="rounded bg-ss-surface-tertiary px-1 py-0.5 font-ss-mono text-caption">
                ↵
              </span>{' '}
              Execute
            </span>
            <span>
              <span className="rounded bg-ss-surface-tertiary px-1 py-0.5 font-ss-mono text-caption">
                Esc
              </span>{' '}
              Close
            </span>
          </div>
          <span>{results.length} commands</span>
        </div>
      </FocusTrap>
    </div>
  );
}
