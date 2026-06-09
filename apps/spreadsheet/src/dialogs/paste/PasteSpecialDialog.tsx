/**
 * Paste Special Dialog
 *
 * A dialog that allows users to select paste options including:
 * - What to paste (all, values, formulas, formats, comments, validation)
 * - Operations (none, add, subtract, multiply, divide)
 * - Additional options (skip blanks, transpose)
 *
 * Matches Excel's Paste Special dialog layout for familiarity.
 * Supports keyboard shortcuts (Alt+underlined letter) for accessibility.
 *
 * UX refinements for Excel parity.
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Label,
  RadioGroup,
  usePlatformInfo,
} from '@mog/shell';
import type { PasteSpecialOptions } from '../../systems/shared/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Paste type options matching Excel's Paste Special dialog.
 * Extended from basic options to match Excel parity.
 */
type PasteType =
  | 'all'
  | 'formulas'
  | 'values'
  | 'formats'
  | 'comments'
  | 'validation'
  | 'allUsingSourceTheme'
  | 'allExceptBorders'
  | 'columnWidths'
  | 'formulasAndNumberFormats'
  | 'valuesAndNumberFormats';

type PasteOperation = 'none' | 'add' | 'subtract' | 'multiply' | 'divide';

// =============================================================================
// Component
// =============================================================================

interface PasteSpecialDialogProps {
  /** Called when paste is confirmed with the selected options */
  onPaste: (options: PasteSpecialOptions) => void;
}

// Paste buttons are always enabled - unifiedPaste handles empty clipboard gracefully (Excel behavior)
export function PasteSpecialDialog({ onPaste }: PasteSpecialDialogProps) {
  const isOpen = useUIStore((s) => s.pasteSpecialDialogOpen);
  const closeDialog = useUIStore((s) => s.closePasteSpecialDialog);
  const { isMacOS } = usePlatformInfo();
  const shortcutLabel = useCallback(
    (label: string, shortcut: string) => (isMacOS ? label : `${label} (${shortcut})`),
    [isMacOS],
  );

  // Local state for form values
  const [pasteType, setPasteType] = useState<PasteType>('all');
  const [operation, setOperation] = useState<PasteOperation>('none');
  const [skipBlanks, setSkipBlanks] = useState(false);
  const [transpose, setTranspose] = useState(false);

  // Ref for backup focus on dialog open — onOpenAutoFocus handles primary focus,
  // formRef is a safety net for cases where the callback fires before content renders.
  const formRef = useRef<HTMLDivElement>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setPasteType('all');
      setOperation('none');
      setSkipBlanks(false);
      setTranspose(false);
      setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>('button[role="radio"]')?.focus();
      }, 0);
    }
  }, [isOpen]);

  // Override Radix's default auto-focus (which targets the Close button in the header).
  // Focus the first paste-type radio instead — it sits inside the onKeyDown div, so
  // keyboard shortcuts (plain letters like 'v') bubble up correctly to the handler.
  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault();
    // Radix RadioGroup renders button[role="radio"], not native <input> elements.
    // Focus the first paste-type radio so keyboard shortcuts bubble to the onKeyDown handler.
    const firstRadio = document.querySelector<HTMLElement>('[role="radiogroup"] [role="radio"]');
    firstRadio?.focus();
  }, []);

  // Handle OK button click
  const handleOk = useCallback(() => {
    const pasteAll =
      pasteType === 'all' ||
      pasteType === 'allUsingSourceTheme' ||
      pasteType === 'allExceptBorders';

    // Build options based on paste type selection
    // Extended to handle all Excel paste types
    const options: PasteSpecialOptions = {
      // Basic paste type flags
      values: !pasteAll && (pasteType === 'values' || pasteType === 'valuesAndNumberFormats'),
      formulas: !pasteAll && (pasteType === 'formulas' || pasteType === 'formulasAndNumberFormats'),
      formats:
        !pasteAll &&
        (pasteType === 'formats' ||
          pasteType === 'formulasAndNumberFormats' ||
          pasteType === 'valuesAndNumberFormats'),
      // Data Validation - Paste validation rules
      validation:
        pasteType === 'validation' ||
        pasteType === 'all' ||
        pasteType === 'allUsingSourceTheme' ||
        pasteType === 'allExceptBorders',
      // Operation
      operation: operation,
      // Checkboxes
      skipBlanks: skipBlanks,
      transpose: transpose,
      // Note: comments, columnWidths are not yet implemented
      // They are UI-complete but backend needs corresponding paste logic
    };

    onPaste(options);
    closeDialog();
  }, [pasteType, operation, skipBlanks, transpose, onPaste, closeDialog]);

  // Handle Paste Link button click
  const handlePasteLink = useCallback(() => {
    const options: PasteSpecialOptions = {
      pasteLink: true,
      transpose: transpose, // Allow transpose with Paste Link
    };

    onPaste(options);
    closeDialog();
  }, [transpose, onPaste, closeDialog]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Handle keyboard shortcuts (letter for quick selection)
  // Excel Paste Special dialog accepts plain letters without Alt:
  // A = All, F = Formulas, V = Values, T = Formats, C = Comments
  // N = None (op), D = Add, S = Subtract, M = Multiply, I = Divide
  // B = Skip Blanks, E = Transpose, L = Paste Link
  // Alt+letter variants are also accepted for compatibility.
  // Enter-to-submit is handled by Dialog's onEnterKeyDown prop.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Plain-letter OR Alt+letter keyboard shortcuts (Excel Paste Special parity)
      // No Ctrl/Meta guard needed — dialog has no text inputs.
      if (!e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        switch (key) {
          // Paste type shortcuts
          case 'a':
            setPasteType('all');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'f':
            setPasteType('formulas');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'v':
            setPasteType('values');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 't':
            setPasteType('formats');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'c':
            setPasteType('comments');
            e.preventDefault();
            e.stopPropagation();
            break;
          // Operation shortcuts
          case 'n':
            setOperation('none');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'd':
            setOperation('add');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 's':
            setOperation('subtract');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'm':
            setOperation('multiply');
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'i':
            setOperation('divide');
            e.preventDefault();
            e.stopPropagation();
            break;
          // Checkbox shortcuts
          case 'b':
            setSkipBlanks((prev) => !prev);
            e.preventDefault();
            e.stopPropagation();
            break;
          case 'e':
            setTranspose((prev) => !prev);
            e.preventDefault();
            e.stopPropagation();
            break;
          // Paste Link shortcut
          case 'l':
            handlePasteLink();
            e.preventDefault();
            e.stopPropagation();
            break;
        }
      }
    },
    [handlePasteLink],
  );

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={handleCancel}
      dialogId="paste-special-dialog"
      width={400}
      dataAttributes={{ 'data-testid': 'overlay-paste-special' }}
      onOpenAutoFocus={handleOpenAutoFocus}
      onEnterKeyDown={handleOk}
    >
      <DialogHeader onClose={handleCancel}>Paste Special</DialogHeader>

      <DialogBody>
        <div ref={formRef} onKeyDown={handleKeyDown}>
          <div className="flex gap-10">
            {/* Paste Type Column - Extended to match Excel */}
            <div className="flex-1">
              <Label className="font-semibold mb-3">Paste</Label>
              <RadioGroup
                name="pasteType"
                value={pasteType}
                onChange={(val) => setPasteType(val as PasteType)}
                options={[
                  { value: 'all', label: shortcutLabel('All', 'Alt+A') },
                  { value: 'formulas', label: shortcutLabel('Formulas', 'Alt+F') },
                  { value: 'values', label: shortcutLabel('Values', 'Alt+V') },
                  { value: 'formats', label: shortcutLabel('Formats', 'Alt+T') },
                  { value: 'comments', label: shortcutLabel('Comments', 'Alt+C') },
                  { value: 'validation', label: 'Validation' },
                  { value: 'allExceptBorders', label: 'All except borders' },
                  { value: 'columnWidths', label: 'Column widths' },
                  { value: 'formulasAndNumberFormats', label: 'Formulas & number formats' },
                  { value: 'valuesAndNumberFormats', label: 'Values & number formats' },
                ]}
                size="sm"
              />
            </div>

            {/* Operation Column */}
            <div className="flex-1">
              <Label className="font-semibold mb-3">Operation</Label>
              <RadioGroup
                name="operation"
                value={operation}
                onChange={(val) => setOperation(val as PasteOperation)}
                options={[
                  { value: 'none', label: shortcutLabel('None', 'Alt+N') },
                  { value: 'add', label: shortcutLabel('Add', 'Alt+D') },
                  { value: 'subtract', label: shortcutLabel('Subtract', 'Alt+S') },
                  { value: 'multiply', label: shortcutLabel('Multiply', 'Alt+M') },
                  { value: 'divide', label: shortcutLabel('Divide', 'Alt+I') },
                ]}
                size="sm"
              />
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-ss-surface-tertiary my-4" />

          {/* Checkboxes with keyboard shortcuts */}
          <div className="flex flex-col gap-3">
            <Checkbox
              checked={skipBlanks}
              onChange={(checked) => setSkipBlanks(checked)}
              label={shortcutLabel('Skip blanks', 'Alt+B')}
            />
            <Checkbox
              checked={transpose}
              onChange={(checked) => setTranspose(checked)}
              label={shortcutLabel('Transpose', 'Alt+E')}
            />
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handlePasteLink}>
          {shortcutLabel('Paste Link', 'Alt+L')}
        </Button>
        <div className="flex-1" /> {/* Spacer to push Cancel/OK to the right */}
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
