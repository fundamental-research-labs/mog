/**
 * Missing Fonts Dialog
 *
 * Dialog shown after XLSX import when fonts used in the file are not
 * available on the user's system. Lists the missing fonts and shows
 * which fallback fonts will be used as substitutes.
 *
 */

import { useCallback, useState } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Switch } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

/**
 * MissingFontsDialog - Warning dialog for missing fonts on XLSX import.
 *
 * Shows when importing an XLSX file that uses fonts not available on the
 * system. Lists each missing font with its substitute, and allows user
 * to suppress future warnings.
 */
export function MissingFontsDialog() {
  // Local state for "Don't show again" checkbox
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.missingFontsDialog.isOpen);
  const missingFonts = useUIStore((s) => s.missingFontsDialog.missingFonts);
  const closeMissingFontsDialog = useUIStore((s) => s.closeMissingFontsDialog);

  // Handle OK button - close dialog
  const handleOk = useCallback(() => {
    closeMissingFontsDialog(dontShowAgain);
    setDontShowAgain(false); // Reset for next time
  }, [closeMissingFontsDialog, dontShowAgain]);

  // Handle dialog close (X button or escape)
  const handleClose = useCallback(() => {
    closeMissingFontsDialog(dontShowAgain);
    setDontShowAgain(false);
  }, [closeMissingFontsDialog, dontShowAgain]);

  return (
    <Dialog open={isOpen} onClose={handleClose} dialogId="missing-fonts-dialog" width="md">
      <DialogHeader onClose={handleClose}>Missing Fonts</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0 mb-3">
          The following fonts used in this file are not available on your system. Text will be
          displayed using substitute fonts.
        </p>

        {/* Missing fonts table */}
        <div className="border border-ss-border rounded overflow-hidden mb-4">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="bg-ss-surface-hover">
                <th className="text-left px-3 py-2 font-medium text-text border-b border-ss-border">
                  Missing Font
                </th>
                <th className="text-left px-3 py-2 font-medium text-text border-b border-ss-border">
                  Substitute
                </th>
              </tr>
            </thead>
            <tbody>
              {missingFonts.map(
                (fontInfo: { originalFont: string; substituteFont: string }, index: number) => (
                  <tr
                    key={fontInfo.originalFont}
                    className={index % 2 === 1 ? 'bg-ss-surface-hover/50' : ''}
                  >
                    <td className="px-3 py-2 text-text">
                      <span className="font-medium">{fontInfo.originalFont}</span>
                    </td>
                    <td className="px-3 py-2 text-ss-text-secondary">
                      <span style={{ fontFamily: fontInfo.substituteFont }}>
                        {fontInfo.substituteFont}
                      </span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        {/* Font count summary */}
        <p className="text-body-sm text-ss-text-tertiary m-0 mb-3">
          {missingFonts.length === 1
            ? '1 font is missing.'
            : `${missingFonts.length} fonts are missing.`}
        </p>

        {/* Don't show again checkbox */}
        <Switch
          checked={dontShowAgain}
          onChange={(checked) => setDontShowAgain(checked)}
          label="Don't show this warning again"
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
