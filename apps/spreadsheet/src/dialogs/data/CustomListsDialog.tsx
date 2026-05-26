/**
 * Custom Lists Dialog
 *
 * Provides a UI for managing custom fill lists like:
 * - High, Medium, Low
 * - North, South, East, West
 * - Custom user-defined sequences
 *
 * Users can:
 * - View all available custom lists (built-in and user-defined)
 * - Add new custom lists
 * - Edit existing user-defined lists
 * - Delete user-defined lists
 *
 * Custom lists are stored per workbook and synced via Yjs for collaboration.
 *
 */

import { useCallback, useEffect, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore, useWorkbook } from '../../internal-api';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Label,
  Textarea,
} from '@mog/shell';
import type { CustomList } from '@mog-sdk/contracts/fill';
// =============================================================================
// Types
// =============================================================================

interface ListEditorState {
  name: string;
  values: string;
}

// =============================================================================
// Component
// =============================================================================

export function CustomListsDialog() {
  // Action dependencies for dispatch
  const deps = useActionDependencies();
  const wb = useWorkbook();

  // UI Store state
  const customListsDialog = useUIStore((s) => s.customListsDialog);
  const selectCustomList = useUIStore((s) => s.selectCustomList);
  const startAddingCustomList = useUIStore((s) => s.startAddingCustomList);
  const startEditingCustomList = useUIStore((s) => s.startEditingCustomList);
  const cancelEditingCustomList = useUIStore((s) => s.cancelEditingCustomList);

  const { isOpen, selectedListId, editMode } = customListsDialog;

  // Local editor state
  const [editorState, setEditorState] = useState<ListEditorState>({
    name: '',
    values: '',
  });

  const [allLists, setAllLists] = useState<readonly CustomList[]>([]);

  const reloadLists = useCallback(async () => {
    const lists = await wb.getCustomLists();
    setAllLists(lists);
    return lists;
  }, [wb]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void wb.getCustomLists().then((lists) => {
      if (!cancelled) {
        setAllLists(lists);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wb, isOpen]);

  // Get the selected list
  const selectedList = (() => {
    if (!selectedListId) return null;
    return allLists.find((list: CustomList) => list.id === selectedListId) || null;
  })();

  // Reset editor state when switching modes or selecting a list
  useEffect(() => {
    if (editMode === 'add') {
      setEditorState({ name: '', values: '' });
    } else if (editMode === 'edit' && selectedList) {
      setEditorState({
        name: selectedList.name,
        values: selectedList.values.join('\n'),
      });
    } else if (editMode === 'view' && selectedList) {
      setEditorState({
        name: selectedList.name,
        values: selectedList.values.join('\n'),
      });
    }
  }, [editMode, selectedList]);

  // Handle list selection
  const handleSelectList = useCallback(
    (listId: string) => {
      if (editMode !== 'view') {
        // Confirm discarding changes
        if (editorState.name || editorState.values !== (selectedList?.values.join('\n') || '')) {
          // For simplicity, just cancel and select
          cancelEditingCustomList();
        }
      }
      selectCustomList(listId);
    },
    [editMode, editorState, selectedList, selectCustomList, cancelEditingCustomList],
  );

  // Handle add button
  const handleAdd = useCallback(() => {
    startAddingCustomList();
  }, [startAddingCustomList]);

  // Handle edit button
  const handleEdit = useCallback(() => {
    if (selectedList && !selectedList.isBuiltIn) {
      startEditingCustomList();
    }
  }, [selectedList, startEditingCustomList]);

  // Handle delete button
  const handleDelete = useCallback(() => {
    if (selectedList && !selectedList.isBuiltIn) {
      void Promise.resolve(dispatch('DELETE_CUSTOM_LIST', deps, { id: selectedList.id })).then(() =>
        reloadLists(),
      );
    }
  }, [selectedList, deps, reloadLists]);

  // Handle save (for add or edit)
  const handleSave = useCallback(() => {
    const values = editorState.values
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (values.length === 0) {
      return; // Don't save empty lists
    }

    if (editMode === 'add') {
      const name = editorState.name.trim() || `Custom List ${Date.now()}`;
      void Promise.resolve(dispatch('ADD_CUSTOM_LIST', deps, { name, values })).then(() =>
        reloadLists(),
      );
    } else if (editMode === 'edit' && selectedListId) {
      void Promise.resolve(dispatch('EDIT_CUSTOM_LIST', deps, { id: selectedListId, values })).then(
        () => reloadLists(),
      );
    }
  }, [editMode, editorState, selectedListId, deps, reloadLists]);

  // Handle cancel editing
  const handleCancelEdit = useCallback(() => {
    cancelEditingCustomList();
  }, [cancelEditingCustomList]);

  // Handle close dialog
  const handleClose = useCallback(() => {
    dispatch('CLOSE_CUSTOM_LISTS_DIALOG', deps);
  }, [deps]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editMode !== 'view') {
          handleCancelEdit();
        } else {
          handleClose();
        }
      }
    },
    [editMode, handleCancelEdit, handleClose],
  );

  // Don't render if not open
  if (!isOpen) return null;

  const isEditing = editMode === 'edit' || editMode === 'add';
  const canEdit = selectedList && !selectedList.isBuiltIn;
  const canDelete = selectedList && !selectedList.isBuiltIn;

  return (
    <Dialog
      onEnterKeyDown={handleClose}
      open={isOpen}
      onClose={handleClose}
      dialogId="custom-lists-dialog"
      width={600}
    >
      <DialogHeader onClose={handleClose}>Custom Lists</DialogHeader>

      <DialogBody>
        <div onKeyDown={handleKeyDown} className="flex gap-4">
          {/* List of custom lists */}
          <div className="w-1/2 space-y-2">
            <Label>Custom Lists:</Label>
            <div className="h-64 overflow-y-auto border border-ss-border rounded">
              {allLists.map((list) => (
                <div
                  key={list.id}
                  className={`px-3 py-2 cursor-pointer hover:bg-ss-surface-tertiary ${
                    selectedListId === list.id ? 'bg-ss-primary-light' : ''
                  }`}
                  onClick={() => handleSelectList(list.id)}
                >
                  <div className="font-medium">
                    {list.name}
                    {list.isBuiltIn && (
                      <span className="ml-2 text-caption text-ss-text-secondary">(Built-in)</span>
                    )}
                  </div>
                  <div className="text-body-sm text-ss-text truncate">{list.values.join(', ')}</div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={handleAdd} disabled={isEditing}>
                Add
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleEdit}
                disabled={isEditing || !canEdit}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDelete}
                disabled={isEditing || !canDelete}
              >
                Delete
              </Button>
            </div>
          </div>

          {/* List entries editor */}
          <div className="w-1/2 space-y-2">
            {editMode === 'add' && (
              <div className="space-y-1">
                <Label htmlFor="list-name">List Name:</Label>
                <Input
                  id="list-name"
                  type="text"
                  value={editorState.name}
                  onChange={(e) => setEditorState((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter list name"
                  size="sm"
                />
              </div>
            )}

            <Label htmlFor="list-entries">
              {isEditing ? 'List entries (one per line):' : 'List entries:'}
            </Label>
            <Textarea
              id="list-entries"
              value={editorState.values}
              onChange={(values) => setEditorState((prev) => ({ ...prev, values }))}
              placeholder={isEditing ? 'Enter values, one per line' : ''}
              rows={10}
              readOnly={!isEditing}
              className={`w-full ${!isEditing ? 'bg-ss-surface-secondary' : ''}`}
            />

            {isEditing && (
              <div className="flex gap-2 justify-end">
                <Button variant="secondary" size="sm" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSave}
                  disabled={!editorState.values.trim()}
                >
                  {editMode === 'add' ? 'Add List' : 'Save'}
                </Button>
              </div>
            )}

            {!isEditing && selectedList && (
              <div className="text-body-sm text-ss-text">
                {selectedList.isBuiltIn ? (
                  <p>Built-in lists cannot be edited or deleted.</p>
                ) : (
                  <p>Select Edit to modify this list.</p>
                )}
              </div>
            )}

            {!selectedList && editMode === 'view' && (
              <div className="text-body-sm text-ss-text">
                <p>Select a list from the left to view its entries.</p>
                <p>Click Add to create a new custom list.</p>
              </div>
            )}
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="primary" onClick={handleClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
