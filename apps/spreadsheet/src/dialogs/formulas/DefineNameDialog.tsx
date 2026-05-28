/**
 * Define Name Dialog
 *
 *
 * Dialog for creating and editing named ranges. Follows Excel's "New Name" dialog:
 * - Name: The name identifier (validated for Excel naming rules)
 * - Scope: Workbook (global) or specific sheet
 * - Comment: Optional description
 * - Refers to: The A1-style reference (converted to IdentityFormula for storage)
 *
 * Architecture:
 * - Dialog state managed by Zustand slice (named-ranges-dialog.ts)
 * - CRUD operations through Workbook API (wb.addNamedRange/wb.updateNamedRange)
 * - Validation uses contracts validateName() function
 * - RefersTo input converted to IdentityFormula at commit time via API
 *
 * @see contracts/src/named-ranges.ts
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CollapsibleRangeInput,
  MinimizableDialog,
  useActiveSheetId,
  useSelectionRanges,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  Textarea,
} from '@mog/shell';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { NameValidationResult } from '@mog-sdk/contracts/named-ranges';
import { validateName } from '@mog/spreadsheet-utils/data/named-ranges';
import { formatSelectionRefersTo } from './refers-to-format';

// =============================================================================
// Types
// =============================================================================

interface ScopeOption {
  value: string;
  label: string;
}

// =============================================================================
// Component
// =============================================================================

export function DefineNameDialog() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  // PERFORMANCE: Use granular hook - only subscribe to ranges, not full selection
  const ranges = useSelectionRanges();

  // UI Store state
  const { parentDialogId, ...dialogState } = useUIStore((s) => s.defineNameDialog);
  const closeDialog = useUIStore((s) => s.closeDefineNameDialog);
  const notifyNameManagerNamesChanged = useUIStore((s) => s.notifyNameManagerNamesChanged);

  // Form state
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>('workbook');
  const [comment, setComment] = useState('');
  const [refersTo, setRefersTo] = useState('');
  const [validation, setValidation] = useState<NameValidationResult>({ valid: true });

  // Load existing name keys from Workbook API (async)
  const [existingNameKeys, setExistingNameKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function loadNameKeys() {
      try {
        const names = await wb.names.list();
        if (!cancelled) {
          setExistingNameKeys(
            new Set(names.map((n) => `${n.name.toUpperCase()}:${n.scope ?? ''}`)),
          );
        }
      } catch (err) {
        console.error('Failed to load named ranges for validation:', err);
      }
    }
    if (dialogState.isOpen) {
      loadNameKeys();
    }
    return () => {
      cancelled = true;
    };
  }, [wb, dialogState.isOpen]);

  // Build scope options: Workbook + all sheets (sync via Workbook API)
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([
    { value: 'workbook', label: 'Workbook' },
  ]);

  useEffect(() => {
    if (!dialogState.isOpen) return;
    let cancelled = false;
    async function loadScopeOptions() {
      try {
        const sheetNames = wb.sheetNames;
        if (cancelled) return;
        const options: ScopeOption[] = [{ value: 'workbook', label: 'Workbook' }];
        for (const sheetName of sheetNames) {
          const ws = await wb.getSheet(sheetName);
          options.push({ value: ws.getSheetId(), label: sheetName });
        }
        setScopeOptions(options);
      } catch (err) {
        console.error('Failed to load sheets for scope options:', err);
      }
    }
    loadScopeOptions();
    return () => {
      cancelled = true;
    };
  }, [wb, dialogState.isOpen]);

  // Initialize form when dialog opens
  // Load existing name data from Workbook API (async) for edit mode
  useEffect(() => {
    let cancelled = false;
    if (dialogState.isOpen) {
      if (dialogState.mode === 'edit' && dialogState.editingNameId) {
        // Load existing name data from Workbook API
        const editingId = dialogState.editingNameId;
        wb.names
          .list()
          .then((names) => {
            if (cancelled) return;
            const existingName = names.find(
              (n) =>
                n.name === editingId &&
                (dialogState.editingNameScope == null || n.scope === dialogState.editingNameScope),
            );
            if (existingName) {
              setName(existingName.name);
              const scopeOption =
                existingName.scope == null
                  ? undefined
                  : scopeOptions.find((option) => option.label === existingName.scope);
              setScope(scopeOption?.value ?? 'workbook');
              setComment(existingName.comment ?? '');
              // NamedRangeInfo.reference is already A1-style
              setRefersTo(existingName.reference ?? '');
            }
          })
          .catch((err) => {
            console.error('Failed to load name for editing:', err);
          });
      } else {
        // Create mode - use initial values or current selection
        setName(dialogState.initialName || '');
        setScope(dialogState.initialScope ?? 'workbook');
        setComment('');

        // Default refersTo to current selection
        if (dialogState.initialRefersTo) {
          setRefersTo(dialogState.initialRefersTo);
        } else {
          // Build A1 reference from current selection.
          const sel = ranges[0];
          if (sel) {
            void (async () => {
              const ws = wb.getSheetById(activeSheetId);
              let sheetName = ws.name;
              try {
                sheetName = await ws.getName();
              } catch {
                sheetName = sheetName || 'Sheet1';
              }
              if (!cancelled) {
                setRefersTo(formatSelectionRefersTo(sheetName, sel));
              }
            })();
          } else {
            setRefersTo('');
          }
        }
      }
      setValidation({ valid: true });
    }
    return () => {
      cancelled = true;
    };
  }, [
    dialogState.isOpen,
    dialogState.mode,
    dialogState.editingNameId,
    dialogState.editingNameScope,
    dialogState.initialName,
    dialogState.initialRefersTo,
    dialogState.initialScope,
    wb,
    ranges,
    activeSheetId,
    scopeOptions,
  ]);

  // Validate name as user types
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setName(newName);

      // Validate the name
      const scopeId = scope === 'workbook' ? undefined : toSheetId(scope);
      const result = validateName(newName, existingNameKeys, scopeId);
      setValidation(result);
    },
    [scope, existingNameKeys],
  );

  // Handle scope change
  const handleScopeChange = useCallback(
    (newScope: string) => {
      setScope(newScope);

      // Re-validate with new scope
      const scopeId = newScope === 'workbook' ? undefined : toSheetId(newScope);
      const result = validateName(name, existingNameKeys, scopeId);
      setValidation(result);
    },
    [name, existingNameKeys],
  );

  // Handle save via Workbook API
  const handleSave = useCallback(async () => {
    if (!validation.valid) return;

    try {
      if (dialogState.mode === 'edit' && dialogState.editingNameId) {
        // Update existing name via Workbook API
        await wb.names.update(
          dialogState.editingNameId,
          {
            name,
            reference: refersTo,
            comment: comment || undefined,
          },
          dialogState.editingNameScope ?? undefined,
        );
      } else {
        // Create new name via Workbook API
        // Ensure reference starts with = for proper conversion
        const ref = refersTo.startsWith('=') ? refersTo.slice(1) : refersTo;
        const scopeName =
          scope === 'workbook'
            ? undefined
            : scopeOptions.find((option) => option.value === scope)?.label;
        await wb.names.add(name, ref, comment || undefined, scopeName);
      }

      if (parentDialogId === 'name-manager-dialog') {
        notifyNameManagerNamesChanged();
      }
      closeDialog();
    } catch (error) {
      // Show validation error - use 'invalid_characters' as a generic error type
      setValidation({
        valid: false,
        error: 'invalid_characters',
        message: error instanceof Error ? error.message : 'Failed to save name',
      });
    }
  }, [
    validation.valid,
    dialogState.mode,
    dialogState.editingNameId,
    dialogState.editingNameScope,
    name,
    refersTo,
    comment,
    scope,
    scopeOptions,
    parentDialogId,
    wb,
    closeDialog,
    notifyNameManagerNamesChanged,
  ]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Check if form is valid
  const canSave = validation.valid && name.trim() !== '' && refersTo.trim() !== '';

  return (
    <MinimizableDialog
      onEnterKeyDown={handleSave}
      open={dialogState.isOpen}
      onClose={handleCancel}
      dialogId="define-name-dialog"
      parentDialogId={parentDialogId ?? undefined}
      title={dialogState.mode === 'edit' ? 'Edit Name' : 'New Name'}
      width="md"
    >
      {/* Stable test-id marker for app-eval scenarios polling "is the dialog mounted". */}
      <div data-testid="define-name-dialog" hidden />
      <DialogHeader onClose={handleCancel}>
        {dialogState.mode === 'edit' ? 'Edit Name' : 'New Name'}
      </DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Name Field */}
          <FormField
            label="Name:"
            required
            error={!validation.valid ? validation.message : undefined}
          >
            <Input
              value={name}
              onChange={handleNameChange}
              placeholder="Enter name..."
              autoFocus
              aria-invalid={!validation.valid}
              data-testid="define-name-input"
            />
          </FormField>

          {/* Scope Field */}
          <FormField label="Scope:">
            <Select
              options={scopeOptions}
              value={scope}
              onChange={handleScopeChange}
              disabled={dialogState.mode === 'edit'}
              data-testid="define-name-scope"
            />
            {dialogState.mode === 'edit' && (
              <p className="text-caption text-ss-text-tertiary mt-1">
                Scope cannot be changed after creation
              </p>
            )}
          </FormField>

          {/* Comment Field */}
          <FormField label="Comment:">
            <Textarea
              value={comment}
              onChange={setComment}
              placeholder="Optional description..."
              rows={2}
              data-testid="define-name-comment"
            />
          </FormField>

          {/* Refers To Field */}
          <FormField label="Refers to:" required>
            <CollapsibleRangeInput
              value={refersTo}
              onChange={setRefersTo}
              dialogId="define-name-dialog"
              inputId="refers-to"
              placeholder="=Sheet1!$A$1:$B$10"
              label="Refers to"
              className="font-ss-mono"
              data-testid="define-name-refers-to"
            />
            <p className="text-caption text-ss-text-tertiary mt-1">
              Enter a cell or range reference (e.g., =Sheet1!$A$1:$B$10)
            </p>
          </FormField>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel} data-testid="define-name-cancel">
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="define-name-ok"
        >
          OK
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts DefineNameDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function DefineNameDialogWrapper() {
  const isOpen = useUIStore((s) => s.defineNameDialog.isOpen);
  if (!isOpen) return null;
  return <DefineNameDialog />;
}
