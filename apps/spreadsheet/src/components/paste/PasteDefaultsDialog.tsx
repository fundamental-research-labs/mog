import { useEffect, useState } from 'react';

import {
  LEGACY_PASTE_DEFAULTS_V1,
  writePasteDefaultsPreference,
  type PasteDefaultTypeV1,
  type PasteDefaultsPreferenceV1,
} from '../../infra/state/paste-defaults-store';

interface PasteDefaultsDialogProps {
  open: boolean;
  preference: PasteDefaultsPreferenceV1;
  onClose: () => void;
}

const DEFAULT_TYPES: Array<{ value: PasteDefaultTypeV1; label: string; testId: string }> = [
  { value: 'all', label: 'All', testId: 'paste-default-type-all' },
  { value: 'values', label: 'Values', testId: 'paste-default-type-values' },
  { value: 'formulas', label: 'Formulas', testId: 'paste-default-type-formulas' },
  { value: 'formats', label: 'Formats', testId: 'paste-default-type-formats' },
];

export function PasteDefaultsDialog({ open, preference, onClose }: PasteDefaultsDialogProps) {
  const [draft, setDraft] = useState<PasteDefaultsPreferenceV1>(preference);

  useEffect(() => {
    if (open) setDraft(preference);
  }, [open, preference]);

  if (!open) return null;

  const save = () => {
    writePasteDefaultsPreference({
      version: 1,
      defaultPasteType: draft.defaultPasteType,
      skipBlanks: draft.skipBlanks,
      transpose: draft.transpose,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-ss-modal flex items-center justify-center bg-black/20"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-defaults-title"
        data-testid="paste-defaults-dialog"
        className="w-[320px] rounded border border-ss-border bg-ss-surface p-4 shadow-ss-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="paste-defaults-title" className="text-body font-semibold text-ss-text">
          Set Default Paste
        </h2>

        <fieldset className="mt-3 space-y-2">
          <legend className="text-caption font-medium text-ss-text-secondary">Default paste</legend>
          {DEFAULT_TYPES.map((type) => (
            <label key={type.value} className="flex items-center gap-2 text-body text-ss-text">
              <input
                type="radio"
                name="paste-default-type"
                value={type.value}
                checked={draft.defaultPasteType === type.value}
                data-testid={type.testId}
                onChange={() =>
                  setDraft((current) => ({ ...current, defaultPasteType: type.value }))
                }
              />
              {type.label}
            </label>
          ))}
        </fieldset>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-body text-ss-text">
            <input
              type="checkbox"
              checked={draft.skipBlanks}
              data-testid="paste-default-skip-blanks"
              onChange={(event) =>
                setDraft((current) => ({ ...current, skipBlanks: event.currentTarget.checked }))
              }
            />
            Skip blanks
          </label>
          <label className="flex items-center gap-2 text-body text-ss-text">
            <input
              type="checkbox"
              checked={draft.transpose}
              data-testid="paste-default-transpose"
              onChange={(event) =>
                setDraft((current) => ({ ...current, transpose: event.currentTarget.checked }))
              }
            />
            Transpose
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-ss-border px-3 py-1.5 text-body text-ss-text hover:bg-ss-surface-hover"
            data-testid="paste-default-cancel"
            onClick={() => {
              setDraft(LEGACY_PASTE_DEFAULTS_V1);
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-ss-primary px-3 py-1.5 text-body text-white hover:bg-ss-primary-hover"
            data-testid="paste-default-save"
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
