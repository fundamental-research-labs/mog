/**
 * BrowseFilesPanel Component
 *
 * The "Browse Files" leaf — surfaces the OS file chooser via the
 * `BROWSE_FILES` action. On desktop the host intercepts via `onUIAction`; on
 * web the action handler creates a transient `<input type="file">` and feeds
 * the chosen file through the shell's documentManager.
 *
 * Issue #115: every leaf must produce an observable side effect, never a
 * silent no-op.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function BrowseFilesPanel() {
  const deps = useActionDependencies();
  const handleBrowse = useCallback(() => dispatch('BROWSE_FILES', deps), [deps]);

  return (
    <BackstagePanel title="Browse Files" description="Open a spreadsheet from your computer">
      <div className="space-y-4">
        <Button
          variant="primary"
          size="md"
          data-testid="file-menu-item-browse-action"
          onClick={handleBrowse}
        >
          Choose File…
        </Button>
        <p className="text-body text-ss-text-secondary mt-4">
          Supports .xlsx, .xls, and .csv files
        </p>
      </div>
    </BackstagePanel>
  );
}
