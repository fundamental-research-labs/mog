/**
 * Keyboard Shortcuts Dialog
 *
 * A dialog for viewing and customizing keyboard shortcuts.
 * Has two modes:
 * 1. View mode - Browse all shortcuts grouped by category, with search
 * 2. Edit mode - Customize a specific shortcut's key binding
 *
 * Features:
 * - Search/filter shortcuts by name or key
 * - Group shortcuts by category (navigation, editing, formatting, etc.)
 * - Switch between keyboard profiles
 * - Customize individual shortcut bindings
 * - Detect and warn about conflicts
 * - Reset individual shortcuts or entire profiles
 * - Import/export profiles as JSON
 *
 * @see contracts/src/keyboard/customization.ts
 * @see apps/spreadsheet/src/state/keyboard-settings-store.ts
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  KeyboardShortcut,
  PhysicalKeyBinding,
  Platform,
  ShortcutCategory,
} from '@mog-sdk/contracts/keyboard';
import { resolveBinding } from '@mog-sdk/kernel/keyboard';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  usePlatformInfo,
} from '@mog/shell';
import { KeyRecorder } from '../../components/keyboard/KeyRecorder';
import { useKeyboardSettingsStore } from '../../infra/state/keyboard-settings-store';
import type { ConflictResult } from '../../keyboard';
import { KEYBOARD_SHORTCUTS, toDisplayString } from '../../keyboard';
import { useKeyboardShortcutsDialogStore } from './keyboard-shortcuts-dialog-store';

export { useKeyboardShortcutsDialogStore } from './keyboard-shortcuts-dialog-store';

// =============================================================================
// Types
// =============================================================================

type DialogMode = 'view' | 'edit';

interface ShortcutRowProps {
  shortcut: KeyboardShortcut;
  platform: Platform;
  isCustomized: boolean;
  isDisabled: boolean;
  onEdit: (shortcut: KeyboardShortcut) => void;
}

// =============================================================================
// Constants
// =============================================================================

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  selection: 'Selection',
  editing: 'Editing',
  formatting: 'Formatting',
  clipboard: 'Clipboard',
  formula: 'Formulas',
  comments: 'Comments',
  data: 'Data',
  view: 'View',
  file: 'File',
  workbook: 'Workbook',
  object: 'Objects',
  accessibility: 'Accessibility',
};

const CATEGORY_ORDER: ShortcutCategory[] = [
  'navigation',
  'selection',
  'editing',
  'clipboard',
  'formatting',
  'formula',
  'data',
  'view',
  'workbook',
  'file',
  'comments',
  'object',
  'accessibility',
];

// =============================================================================
// Shortcut Row Component
// =============================================================================

function ShortcutRow({ shortcut, platform, isCustomized, isDisabled, onEdit }: ShortcutRowProps) {
  const binding = resolveBinding(shortcut.bindings, platform);
  const displayString = toDisplayString(binding, platform);

  return (
    <div
      className={[
        'flex items-center justify-between px-3 py-2',
        'border-b border-ss-border-light last:border-b-0',
        'hover:bg-ss-surface-hover cursor-pointer',
        'transition-colors duration-ss-fast',
        isDisabled ? 'opacity-50' : '',
      ].join(' ')}
      onClick={() => onEdit(shortcut)}
    >
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className={`text-body truncate ${isDisabled ? 'line-through' : ''}`}>
          {shortcut.description}
        </span>
        {isCustomized && <span className="text-caption text-ss-primary">Customized</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`font-mono text-body-sm ${isDisabled ? 'text-ss-text-disabled' : 'text-ss-text-secondary'}`}
        >
          {displayString}
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// Category Section Component
// =============================================================================

interface CategorySectionProps {
  category: ShortcutCategory;
  shortcuts: KeyboardShortcut[];
  platform: Platform;
  customizedIds: Set<string>;
  disabledIds: Set<string>;
  onEditShortcut: (shortcut: KeyboardShortcut) => void;
}

function CategorySection({
  category,
  shortcuts,
  platform,
  customizedIds,
  disabledIds,
  onEditShortcut,
}: CategorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border border-ss-border rounded mb-3 last:mb-0">
      {/* Category Header */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 bg-ss-surface-secondary hover:bg-ss-surface-hover cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="font-medium text-body">{CATEGORY_LABELS[category]}</span>
        <span className="text-caption text-ss-text-secondary">{shortcuts.length} shortcuts</span>
      </button>

      {/* Shortcuts List */}
      {isExpanded && (
        <div>
          {shortcuts.map((shortcut) => (
            <ShortcutRow
              key={shortcut.id}
              shortcut={shortcut}
              platform={platform}
              isCustomized={customizedIds.has(shortcut.id)}
              isDisabled={disabledIds.has(shortcut.id)}
              onEdit={onEditShortcut}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Edit Shortcut Panel Component
// =============================================================================

interface EditShortcutPanelProps {
  shortcut: KeyboardShortcut;
  platform: Platform;
  onSave: (binding: PhysicalKeyBinding) => void;
  onReset: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onCancel: () => void;
  isDisabled: boolean;
  checkConflict: (binding: PhysicalKeyBinding) => ConflictResult;
}

function EditShortcutPanel({
  shortcut,
  platform,
  onSave,
  onReset,
  onDisable,
  onEnable,
  onCancel,
  isDisabled,
  checkConflict,
}: EditShortcutPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [newBinding, setNewBinding] = useState<PhysicalKeyBinding | null>(null);
  const [conflict, setConflict] = useState<ConflictResult | null>(null);

  const currentBinding = resolveBinding(shortcut.bindings, platform);

  const handleStartRecording = useCallback(() => {
    setIsRecording(true);
    setNewBinding(null);
    setConflict(null);
  }, []);

  const handleCapture = useCallback(
    (binding: PhysicalKeyBinding) => {
      setIsRecording(false);
      setNewBinding(binding);

      // Check for conflicts
      const conflictResult = checkConflict(binding);
      setConflict(conflictResult);
    },
    [checkConflict],
  );

  const handleCancelRecording = useCallback(() => {
    setIsRecording(false);
    setNewBinding(null);
    setConflict(null);
  }, []);

  const handleSave = useCallback(() => {
    if (newBinding) {
      onSave(newBinding);
    }
  }, [newBinding, onSave]);

  return (
    <div className="flex flex-col gap-4">
      {/* Shortcut Info */}
      <div>
        <h3 className="text-subtitle font-semibold mb-1">{shortcut.description}</h3>
        <p className="text-caption text-ss-text-secondary">
          Category: {CATEGORY_LABELS[shortcut.category]}
        </p>
      </div>

      {/* Current Binding */}
      <div className="flex flex-col gap-2">
        <label className="text-body-sm font-medium">Current Binding</label>
        <div className="flex items-center gap-3">
          <span className="font-mono text-body bg-ss-surface-secondary px-3 py-2 rounded">
            {isDisabled ? 'Disabled' : toDisplayString(currentBinding, platform)}
          </span>
          {!isRecording && !newBinding && (
            <Button variant="secondary" size="sm" onClick={handleStartRecording}>
              Change
            </Button>
          )}
        </div>
      </div>

      {/* Key Recorder */}
      {isRecording && (
        <div className="flex flex-col gap-2">
          <label className="text-body-sm font-medium">Press New Key Combination</label>
          <KeyRecorder
            onCapture={handleCapture}
            onCancel={handleCancelRecording}
            currentBinding={currentBinding}
            platform={platform}
          />
        </div>
      )}

      {/* New Binding Preview */}
      {newBinding && !isRecording && (
        <div className="flex flex-col gap-2">
          <label className="text-body-sm font-medium">New Binding</label>
          <div className="flex items-center gap-3">
            <span className="font-mono text-body bg-ss-success/10 text-ss-success px-3 py-2 rounded">
              {toDisplayString(newBinding, platform)}
            </span>
            <Button variant="ghost" size="sm" onClick={handleStartRecording}>
              Try Again
            </Button>
          </div>
        </div>
      )}

      {/* Conflict Warning */}
      {conflict?.hasConflict && conflict.conflictingShortcut && (
        <div className="bg-ss-warning/10 border border-ss-warning/30 rounded p-3">
          <div className="flex items-start gap-2">
            <span className="text-ss-warning text-body-lg">!</span>
            <div className="flex flex-col gap-1">
              <span className="text-body font-medium text-ss-warning">Conflict Detected</span>
              <span className="text-body-sm text-ss-text-secondary">
                This combination is already used by &quot;{conflict.conflictingShortcut.description}
                &quot;. Saving will override that shortcut.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-ss-border-light">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset to Default
          </Button>
          {isDisabled ? (
            <Button variant="ghost" size="sm" onClick={onEnable}>
              Enable
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onDisable}>
              Disable
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {newBinding && (
            <Button variant="primary" size="sm" onClick={handleSave}>
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Dialog Component
// =============================================================================

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const { isMacOS, isLinux } = usePlatformInfo();
  const platform = useMemo<Platform>(
    () => (isMacOS ? 'macos' : isLinux ? 'linux' : 'windows'),
    [isMacOS, isLinux],
  );

  // Store state and actions
  const activeProfileId = useKeyboardSettingsStore((s) => s.activeProfileId);
  const profiles = useKeyboardSettingsStore((s) => s.profiles);
  const getActiveProfile = useKeyboardSettingsStore((s) => s.getActiveProfile);
  const getActiveShortcutsArray = useKeyboardSettingsStore((s) => s.getActiveShortcutsArray);
  const setActiveProfile = useKeyboardSettingsStore((s) => s.setActiveProfile);
  const setBinding = useKeyboardSettingsStore((s) => s.setBinding);
  const resetBinding = useKeyboardSettingsStore((s) => s.resetBinding);
  const disableShortcut = useKeyboardSettingsStore((s) => s.disableShortcut);
  const enableShortcut = useKeyboardSettingsStore((s) => s.enableShortcut);
  const createNewProfile = useKeyboardSettingsStore((s) => s.createNewProfile);
  const deleteProfile = useKeyboardSettingsStore((s) => s.deleteProfile);
  const exportProfileAsJson = useKeyboardSettingsStore((s) => s.exportProfileAsJson);
  const importProfileFromJson = useKeyboardSettingsStore((s) => s.importProfileFromJson);
  const checkConflict = useKeyboardSettingsStore((s) => s.checkConflict);

  // Local state
  const [mode, setMode] = useState<DialogMode>('view');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingShortcut, setEditingShortcut] = useState<KeyboardShortcut | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMode('view');
      setSearchQuery('');
      setEditingShortcut(null);
    }
  }, [open]);

  // Get customization info from active profile
  const activeProfile = getActiveProfile();
  const customizedIds = useMemo(() => {
    return new Set(activeProfile.customBindings.keys());
  }, [activeProfile]);

  const disabledIds = useMemo(() => {
    const disabled = new Set<string>();
    for (const [id, custom] of activeProfile.customBindings) {
      if (custom.disabled) {
        disabled.add(id);
      }
    }
    return disabled;
  }, [activeProfile]);

  // Get active shortcuts (with customizations applied)
  const activeShortcuts = getActiveShortcutsArray();

  // Filter shortcuts based on search
  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) {
      return activeShortcuts;
    }

    const query = searchQuery.toLowerCase();
    return activeShortcuts.filter((s) => {
      // Search in description
      if (s.description.toLowerCase().includes(query)) return true;

      // Search in key binding display
      const binding = resolveBinding(s.bindings, platform);
      const displayString = toDisplayString(binding, platform).toLowerCase();
      if (displayString.includes(query)) return true;

      // Search in category
      if (s.category.toLowerCase().includes(query)) return true;

      return false;
    });
  }, [activeShortcuts, searchQuery, platform]);

  // Group shortcuts by category
  const groupedShortcuts = useMemo(() => {
    const groups = new Map<ShortcutCategory, KeyboardShortcut[]>();

    for (const shortcut of filteredShortcuts) {
      const existing = groups.get(shortcut.category) || [];
      existing.push(shortcut);
      groups.set(shortcut.category, existing);
    }

    // Sort by category order
    const sorted: Array<{ category: ShortcutCategory; shortcuts: KeyboardShortcut[] }> = [];
    for (const category of CATEGORY_ORDER) {
      const shortcuts = groups.get(category);
      if (shortcuts && shortcuts.length > 0) {
        sorted.push({ category, shortcuts });
      }
    }

    return sorted;
  }, [filteredShortcuts]);

  // Handlers
  const handleEditShortcut = useCallback((shortcut: KeyboardShortcut) => {
    setEditingShortcut(shortcut);
    setMode('edit');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingShortcut(null);
    setMode('view');
  }, []);

  const handleSaveBinding = useCallback(
    (binding: PhysicalKeyBinding) => {
      if (editingShortcut) {
        setBinding(editingShortcut.id, binding, platform);
        setEditingShortcut(null);
        setMode('view');
      }
    },
    [editingShortcut, setBinding, platform],
  );

  const handleResetBinding = useCallback(() => {
    if (editingShortcut) {
      resetBinding(editingShortcut.id);
      setEditingShortcut(null);
      setMode('view');
    }
  }, [editingShortcut, resetBinding]);

  const handleDisableShortcut = useCallback(() => {
    if (editingShortcut) {
      disableShortcut(editingShortcut.id);
      setEditingShortcut(null);
      setMode('view');
    }
  }, [editingShortcut, disableShortcut]);

  const handleEnableShortcut = useCallback(() => {
    if (editingShortcut) {
      enableShortcut(editingShortcut.id);
      setEditingShortcut(null);
      setMode('view');
    }
  }, [editingShortcut, enableShortcut]);

  const handleProfileChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setActiveProfile(e.target.value);
    },
    [setActiveProfile],
  );

  const handleCreateProfile = useCallback(() => {
    const name = prompt('Enter profile name:');
    if (name?.trim()) {
      createNewProfile(name.trim());
    }
  }, [createNewProfile]);

  const handleDeleteProfile = useCallback(() => {
    if (activeProfileId === 'default') {
      alert('Cannot delete the default profile.');
      return;
    }
    if (confirm('Are you sure you want to delete this profile?')) {
      deleteProfile(activeProfileId);
    }
  }, [activeProfileId, deleteProfile]);

  const handleExportProfile = useCallback(() => {
    const json = exportProfileAsJson(activeProfileId);
    if (json) {
      // Create download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `keyboard-profile-${profiles[activeProfileId]?.name || 'export'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [activeProfileId, exportProfileAsJson, profiles]);

  const handleImportProfile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        const result = importProfileFromJson(text);
        if (!result.success) {
          alert(`Import failed: ${result.error}`);
        }
      }
    };
    input.click();
  }, [importProfileFromJson]);

  const handleCheckConflict = useCallback(
    (binding: PhysicalKeyBinding) => {
      return checkConflict(binding, editingShortcut?.id, platform);
    },
    [checkConflict, editingShortcut?.id, platform],
  );

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} dialogId="keyboard-shortcuts-dialog" width="lg">
      <DialogHeader onClose={onClose}>
        {mode === 'view' ? 'Keyboard Shortcuts' : 'Edit Shortcut'}
      </DialogHeader>

      <DialogBody noPadding={mode === 'view'}>
        {mode === 'view' ? (
          <div className="flex flex-col h-[500px]">
            {/* Toolbar */}
            <div className="px-4 py-3 border-b border-ss-border flex items-center gap-3 shrink-0">
              {/* Search */}
              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="Search shortcuts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  size="sm"
                />
              </div>

              {/* Profile Selector */}
              <div className="flex items-center gap-2">
                <label className="text-body-sm text-ss-text-secondary">Profile:</label>
                <select
                  className="border border-ss-border rounded px-2 py-1 text-body-sm bg-ss-surface"
                  value={activeProfileId}
                  onChange={handleProfileChange}
                >
                  {Object.values(profiles).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Profile Actions */}
            <div className="px-4 py-2 border-b border-ss-border-light flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={handleCreateProfile}>
                New Profile
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteProfile}
                disabled={activeProfileId === 'default'}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportProfile}>
                Export
              </Button>
              <Button variant="ghost" size="sm" onClick={handleImportProfile}>
                Import
              </Button>
            </div>

            {/* Shortcuts List */}
            <div className="flex-1 overflow-y-auto p-4">
              {groupedShortcuts.length === 0 ? (
                <div className="text-center text-ss-text-secondary py-8">
                  No shortcuts found matching &quot;{searchQuery}&quot;
                </div>
              ) : (
                groupedShortcuts.map(({ category, shortcuts }) => (
                  <CategorySection
                    key={category}
                    category={category}
                    shortcuts={shortcuts}
                    platform={platform}
                    customizedIds={customizedIds}
                    disabledIds={disabledIds}
                    onEditShortcut={handleEditShortcut}
                  />
                ))
              )}
            </div>
          </div>
        ) : editingShortcut ? (
          <div className="p-4">
            <EditShortcutPanel
              shortcut={editingShortcut}
              platform={platform}
              onSave={handleSaveBinding}
              onReset={handleResetBinding}
              onDisable={handleDisableShortcut}
              onEnable={handleEnableShortcut}
              onCancel={handleCancelEdit}
              isDisabled={disabledIds.has(editingShortcut.id)}
              checkConflict={handleCheckConflict}
            />
          </div>
        ) : null}
      </DialogBody>

      {mode === 'view' && (
        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <span className="text-caption text-ss-text-secondary">
              {filteredShortcuts.length} of {KEYBOARD_SHORTCUTS.length} shortcuts
            </span>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      )}
    </Dialog>
  );
}

// =============================================================================
// Self-Subscribing Wrapper
// =============================================================================

/**
 * Self-subscribing wrapper for KeyboardShortcutsDialog.
 * This component subscribes to its own open state, following the pattern
 * used by other dialogs in the DialogLayer.
 */
export function KeyboardShortcutsDialogWrapper() {
  const isOpen = useKeyboardShortcutsDialogStore((s) => s.isOpen);
  const close = useKeyboardShortcutsDialogStore((s) => s.close);

  return <KeyboardShortcutsDialog open={isOpen} onClose={close} />;
}
