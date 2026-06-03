/**
 * Equation Editor Dialog
 *
 * A dialog for inserting and editing mathematical equations.
 * Supports LaTeX input with live preview and template gallery.
 *
 * Features:
 * - LaTeX text input (with syntax highlighting via textarea)
 * - Live KaTeX preview with debouncing
 * - Template gallery for common equations
 * - Edit mode for existing equations
 *
 * CRITICAL: Uses dispatch() for all data-affecting actions (render isolation pattern).
 * Local UI state (latex input, category selection, preview errors) uses direct UIStore calls
 * as these are purely transient display state that doesn't persist or affect data.
 *
 * Note: MathLive integration is planned for future enhancement.
 * Current implementation uses plain textarea for LaTeX input.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 1, 2, 17)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import type { Tab } from '@mog/shell';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Tabs,
  Textarea,
} from '@mog/shell';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import type { EquationTemplate, EquationTemplateCategory } from '../../ui-store';
import { EquationPreview } from './EquationPreview';
import { EquationTemplateGallery } from './EquationTemplateGallery';
// =============================================================================
// Types
// =============================================================================

/**
 * Props for EquationEditorDialog.
 *
 * This interface is intentionally empty because the dialog is self-contained:
 * - Dialog open/close state comes from UIStore.equationDialog.isOpen
 * - Editing equation ID comes from UIStore.equationDialog.editingEquationId
 * - Target cell position comes from UIStore.equationDialog.targetRow/targetCol
 * - Transient UI state (latex input, category, preview errors) uses UIStore
 * - Data-affecting actions are dispatched via the Unified Action System
 *
 * This pattern matches other self-contained dialogs like FormatCellsDialog,
 * where the dialog manages its own lifecycle through centralized state stores
 * rather than receiving callbacks or state via props.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EquationEditorDialogProps {}

// =============================================================================
// Constants
// =============================================================================

const TABS: Tab[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'templates', label: 'Templates' },
];

// =============================================================================
// Component
// =============================================================================

/**
 * Equation Editor Dialog for inserting/editing LaTeX equations.
 *
 * The dialog uses UIStore for transient UI state:
 * - equationDialog.isOpen: controls visibility
 * - equationDialog.latex: current LaTeX input (transient)
 * - equationDialog.editingEquationId: non-null when editing existing equation
 * - equationDialog.targetRow/targetCol: target cell for insertion
 * - equationDialog.selectedCategory: template gallery category (transient)
 * - equationDialog.recentTemplates: recently used template IDs (transient)
 *
 * Data-affecting operations use dispatch():
 * - CLOSE_EQUATION_DIALOG: Close the dialog
 * - UPDATE_EQUATION: Save/insert equation (handles both insert and edit modes)
 */
export function EquationEditorDialog(_props: EquationEditorDialogProps) {
  // ===========================================================================
  // Action Dependencies
  // ===========================================================================

  const deps = useActionDependencies();

  // ===========================================================================
  // Store State (transient UI state - direct UIStore access is acceptable)
  // ===========================================================================

  const equationDialog = useUIStore((s) => s.equationDialog);
  // Direct UIStore calls for transient UI state (typing, category selection, previews)
  const setLatex = useUIStore((s) => s.setEquationLatex);
  const setCategory = useUIStore((s) => s.setEquationCategory);
  const applyTemplate = useUIStore((s) => s.applyEquationTemplate);
  const addRecentTemplate = useUIStore((s) => s.addRecentEquationTemplate);
  const setPreviewError = useUIStore((s) => s.setEquationPreviewError);

  const {
    isOpen,
    latex,
    editingEquationId,
    targetRow,
    targetCol,
    selectedCategory,
    recentTemplates,
    previewError,
  } = equationDialog;

  // ===========================================================================
  // Local State
  // ===========================================================================

  const [activeTab, setActiveTab] = useState<string>('editor');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cell reference for display
  const cellRef = `${colToLetter(targetCol)}${targetRow + 1}`;
  const isEditMode = editingEquationId !== null;

  // ===========================================================================
  // Effects
  // ===========================================================================

  // Reset tab to editor when dialog opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('editor');
    }
  }, [isOpen]);

  // ===========================================================================
  // Handlers
  // ===========================================================================

  // Transient UI state handlers (direct UIStore calls)
  const handleLatexChange = useCallback(
    (value: string) => {
      setLatex(value);
    },
    [setLatex],
  );

  const handleCategoryChange = useCallback(
    (category: EquationTemplateCategory) => {
      setCategory(category);
    },
    [setCategory],
  );

  const handleTemplateSelect = useCallback(
    (template: EquationTemplate) => {
      applyTemplate(template);
      addRecentTemplate(template.id);
      // Switch to editor tab to show the inserted template
      setActiveTab('editor');
      // Focus textarea
      setTimeout(() => {
        textareaRef.current?.focus();
        // Select all text so user can easily replace
        textareaRef.current?.select();
      }, 100);
    },
    [applyTemplate, addRecentTemplate],
  );

  const handlePreviewError = useCallback(
    (error: string | null) => {
      setPreviewError(error);
    },
    [setPreviewError],
  );

  // Data-affecting handlers (use dispatch())
  const handleOk = useCallback(() => {
    if (!latex || latex.trim().length === 0) {
      return;
    }

    if (previewError) {
      // Don't allow saving invalid equations
      return;
    }

    // Use dispatch() for data-affecting operation (Unified Action System)
    // UPDATE_EQUATION handles both insert (objectId: null) and edit modes
    dispatch('UPDATE_EQUATION', deps, {
      objectId: editingEquationId,
      latex: latex.trim(),
    });
    // Note: UPDATE_EQUATION handler closes the dialog automatically
  }, [latex, previewError, editingEquationId, deps]);

  // Handle dialog close - use dispatch() for consistency
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_EQUATION_DIALOG', deps);
  }, [deps]);

  // Handle Enter to insert (with Ctrl/Cmd modifier)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleOk();
      }
    },
    [handleOk],
  );

  // ===========================================================================
  // Render
  // ===========================================================================

  if (!isOpen) return null;

  const canSave = latex.trim().length > 0 && !previewError;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleCancel}
      dialogId="equation-editor-dialog"
      width={600}
      initialFocusRef={textareaRef}
    >
      <DialogHeader onClose={handleCancel}>
        {isEditMode ? 'Edit Equation' : 'Insert Equation'}
      </DialogHeader>

      <DialogBody>
        <div onKeyDown={handleKeyDown}>
          {/* Cell info */}
          <div className="text-body-sm text-ss-text-secondary mb-4 p-2 bg-ss-surface-secondary rounded">
            Target cell: <strong>{cellRef}</strong>
          </div>

          {/* Tabs for Editor / Templates */}
          <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className="mb-4" />

          {/* Editor Tab Content */}
          {activeTab === 'editor' && (
            <div className="space-y-4">
              {/* LaTeX Input */}
              <FormField
                label="LaTeX Equation"
                helpText="Enter LaTeX math notation (e.g., \frac{1}{2}, \sqrt{x}, \sum_{i=1}^{n})"
                htmlFor="equation-latex-input"
              >
                <Textarea
                  ref={textareaRef}
                  id="equation-latex-input"
                  value={latex}
                  onChange={handleLatexChange}
                  placeholder="\\frac{a}{b}"
                  rows={3}
                  className="font-mono text-body-sm"
                  error={!!previewError}
                />
              </FormField>

              {/* Live Preview */}
              <FormField label="Preview">
                <EquationPreview latex={latex} debounceMs={150} onError={handlePreviewError} />
              </FormField>

              {/* Quick Help */}
              <div className="text-body-xs text-ss-text-tertiary">
                <strong>Quick reference:</strong>{' '}
                <code className="bg-ss-surface-secondary px-1 rounded">\frac{'{a}{b}'}</code>{' '}
                fraction, <code className="bg-ss-surface-secondary px-1 rounded">\sqrt{'{x}'}</code>{' '}
                square root, <code className="bg-ss-surface-secondary px-1 rounded">x^{'{n}'}</code>{' '}
                power, <code className="bg-ss-surface-secondary px-1 rounded">x_{'{i}'}</code>{' '}
                subscript
              </div>
            </div>
          )}

          {/* Templates Tab Content */}
          {activeTab === 'templates' && (
            <EquationTemplateGallery
              selectedCategory={selectedCategory}
              recentTemplateIds={recentTemplates}
              onCategoryChange={handleCategoryChange}
              onTemplateSelect={handleTemplateSelect}
            />
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleOk}
          disabled={!canSave}
          title={
            !canSave
              ? previewError
                ? 'Fix equation errors first'
                : 'Enter an equation'
              : undefined
          }
        >
          {isEditMode ? 'Update' : 'Insert'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
