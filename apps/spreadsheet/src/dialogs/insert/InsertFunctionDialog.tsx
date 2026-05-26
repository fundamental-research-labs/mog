/**
 * Insert Function Dialog
 *
 * A dialog that allows users to browse, search, and insert Excel functions
 * into the formula bar. Shows function categories, descriptions, and syntax.
 *
 * Features:
 * - MRU (Most Recently Used) category showing last 10 functions used
 * - Function categories from registry
 * - Search across name and description
 *
 * Uses FocusTrap for proper keyboard event isolation.
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dispatch, useUIStore } from '../../internal-api';

import { globalRegistry } from '@mog/spreadsheet-utils/function-registry';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Select } from '@mog/shell';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';

// =============================================================================
// Types
// =============================================================================

interface FunctionInfo {
  name: string;
  category: string;
  description: string;
  minArgs?: number;
  maxArgs?: number;
}

// =============================================================================
// Component
// =============================================================================

interface InsertFunctionDialogProps {
  /** Called when a function is inserted */
  onInsert?: (functionName: string) => void;
}

// MRU Category constant
const MRU_CATEGORY = 'Recently Used';

export function InsertFunctionDialog({ onInsert }: InsertFunctionDialogProps) {
  const deps = useActionDependencies();
  const isOpen = useUIStore(
    (s: { insertFunctionDialogOpen: boolean }) => s.insertFunctionDialogOpen,
  );

  // MRU functions state (14.4: MRU category)
  const mruFunctions = useUIStore((s: { mruFunctions: string[] }) => s.mruFunctions);
  const trackMRUFunction = useUIStore(
    (s: { trackMRUFunction: (name: string) => void }) => s.trackMRUFunction,
  );
  const loadMRUFromStorage = useUIStore(
    (s: { loadMRUFromStorage: () => void }) => s.loadMRUFromStorage,
  );

  const [searchQuery, setSearchQuery] = useState('');
  // Default to MRU category if there are MRU functions
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedFunction, setSelectedFunction] = useState<FunctionInfo | null>(null);

  // Ref for initial focus (search input)
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load MRU from storage on mount
  useEffect(() => {
    loadMRUFromStorage();
  }, [loadMRUFromStorage]);

  // Set default category to MRU if we have MRU functions, on dialog open
  useEffect(() => {
    if (isOpen && mruFunctions.length > 0 && selectedCategory === 'All') {
      setSelectedCategory(MRU_CATEGORY);
    }
  }, [isOpen, mruFunctions.length, selectedCategory]);

  // Get all functions from the registry
  const allFunctions = useMemo((): FunctionInfo[] => {
    const names = globalRegistry.getAllNames();
    const functions: FunctionInfo[] = [];
    for (const name of names) {
      const meta = globalRegistry.getMetadata(name);
      if (meta) {
        functions.push({
          name: meta.name,
          category: meta.category,
          description: meta.description,
          minArgs: meta.minArgs,
          maxArgs: meta.maxArgs,
        });
      }
    }
    return functions.sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // Get unique categories for Select options
  // MRU category shown first if there are MRU functions
  const categoryOptions = useMemo(() => {
    const cats = new Set(allFunctions.map((f) => f.category));
    const options = [
      { value: 'All', label: 'All Categories' },
      ...Array.from(cats)
        .sort()
        .map((cat) => ({ value: cat, label: cat })),
    ];

    // Add MRU category at the front (after "All") if there are MRU functions
    if (mruFunctions.length > 0) {
      options.splice(1, 0, { value: MRU_CATEGORY, label: MRU_CATEGORY });
    }

    return options;
  }, [allFunctions, mruFunctions.length]);

  // Filter functions based on search and category
  // MRU category shows functions from mruFunctions list
  const filteredFunctions = useMemo(() => {
    let result = allFunctions;

    // Filter by category
    if (selectedCategory === MRU_CATEGORY) {
      // For MRU category, filter to only MRU functions and preserve MRU order
      const mruFiltered = mruFunctions
        .map((name) => allFunctions.find((f) => f.name === name))
        .filter((f): f is FunctionInfo => f !== undefined);
      result = mruFiltered;
    } else if (selectedCategory !== 'All') {
      result = result.filter((f) => f.category === selectedCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (f) => f.name.toLowerCase().includes(query) || f.description.toLowerCase().includes(query),
      );
    }

    return result;
  }, [allFunctions, selectedCategory, searchQuery, mruFunctions]);

  // Generate function syntax preview
  const getSyntax = useCallback((func: FunctionInfo): string => {
    const { name, minArgs, maxArgs } = func;

    if (minArgs === undefined && maxArgs === undefined) {
      return `${name}()`;
    }

    const args: string[] = [];
    const min = minArgs ?? 0;
    const max = maxArgs ?? min;

    for (let i = 0; i < Math.min(max, 5); i++) {
      if (i < min) {
        args.push(`arg${i + 1}`);
      } else {
        args.push(`[arg${i + 1}]`);
      }
    }

    if (max > 5) {
      args.push('...');
    }

    return `${name}(${args.join(', ')})`;
  }, []);

  // Handle insert
  const handleInsert = useCallback(() => {
    if (!selectedFunction) return;

    // Track MRU function
    trackMRUFunction(selectedFunction.name);

    // Call the onInsert callback with the function name
    if (onInsert) {
      onInsert(selectedFunction.name);
    }

    // Close the dialog via unified action system
    dispatch('CLOSE_INSERT_FUNCTION_DIALOG', deps);

    // Reset state
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedFunction(null);
  }, [selectedFunction, onInsert, deps, trackMRUFunction]);

  // Handle close via unified action system
  const handleClose = useCallback(() => {
    dispatch('CLOSE_INSERT_FUNCTION_DIALOG', deps);
    setSearchQuery('');
    setSelectedCategory('All');
    setSelectedFunction(null);
  }, [deps]);

  // Handle function click
  const handleFunctionClick = useCallback((func: FunctionInfo) => {
    setSelectedFunction(func);
  }, []);

  // Handle double-click to insert
  const handleFunctionDoubleClick = useCallback(
    (func: FunctionInfo) => {
      setSelectedFunction(func);

      // Track MRU function
      trackMRUFunction(func.name);

      if (onInsert) {
        onInsert(func.name);
      }
      // Close via unified action system
      dispatch('CLOSE_INSERT_FUNCTION_DIALOG', deps);
      setSearchQuery('');
      setSelectedCategory('All');
      setSelectedFunction(null);
    },
    [onInsert, deps, trackMRUFunction],
  );

  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleInsert}
      open={isOpen}
      onClose={handleClose}
      dialogId="insert-function-dialog"
      width={600}
    >
      <DialogHeader onClose={handleClose}>Insert Function</DialogHeader>

      <DialogBody className="!p-0 flex flex-col overflow-hidden max-h-[60vh]">
        {/* Search and category filter */}
        <div className="flex gap-3 p-4 border-b border-ss-border">
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search functions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
            autoFocus
          />
          <Select
            options={categoryOptions}
            value={selectedCategory}
            onChange={(value) => setSelectedCategory(value)}
            className="min-w-[150px]"
          />
        </div>

        {/* Count */}
        <div className="px-5 py-2 text-caption text-ss-text-secondary">
          {filteredFunctions.length} function{filteredFunctions.length !== 1 ? 's' : ''} found
        </div>

        {/* Function list */}
        <div className="flex-1 overflow-auto px-5">
          {filteredFunctions.length === 0 ? (
            <div className="py-10 text-center text-ss-text-secondary">
              No functions found matching your search.
            </div>
          ) : (
            filteredFunctions.map((func) => (
              <div
                key={func.name}
                className={`py-3 border-b border-ss-border-light cursor-pointer transition-colors ${
                  selectedFunction?.name === func.name
                    ? 'bg-ss-primary-lighter'
                    : 'hover:bg-ss-surface-hover'
                }`}
                onClick={() => handleFunctionClick(func)}
                onDoubleClick={() => handleFunctionDoubleClick(func)}
              >
                <div className="text-body font-semibold text-ss-primary mb-1">{func.name}</div>
                <div className="text-hint text-ss-text-secondary mb-1">{func.category}</div>
                <div className="text-body-sm text-text leading-relaxed">{func.description}</div>
              </div>
            ))
          )}
        </div>

        {/* Syntax preview */}
        {selectedFunction && (
          <div className="p-4 bg-ss-surface-secondary border-t border-ss-border">
            <div className="text-caption text-ss-text-secondary mb-1">Syntax:</div>
            <div className="font-ss-mono text-body text-text bg-ss-surface px-3 py-2 rounded border border-ss-border">
              {getSyntax(selectedFunction)}
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleInsert} disabled={!selectedFunction}>
          Insert
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
