/**
 * OpenPanel Component
 *
 * Open existing files and show recent files.
 *
 * Issue #115: the "Browse Files" button dispatches `BROWSE_FILES`, which on
 * web spawns an `<input type="file">` and on desktop hands off to the host
 * via `onUIAction`. Recents are sourced from the shell's `openFileIds` and
 * each click dispatches `OPEN_RECENT_FILE`.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { useShellStore } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function OpenPanel() {
  const deps = useActionDependencies();
  const openFileIds = useShellStore((s) => s.openFileIds);
  const files = useShellStore((s) => s.files);
  const activeFileId = useShellStore((s) => s.activeFileId);

  const handleBrowse = useCallback(() => dispatch('BROWSE_FILES', deps), [deps]);
  const handleOpenRecent = useCallback(
    (fileId: string) => dispatch('OPEN_RECENT_FILE', deps, { fileId }),
    [deps],
  );

  const recentInactive = openFileIds.filter((id) => id !== activeFileId);

  return (
    <BackstagePanel title="Open" description="Open an existing spreadsheet">
      <div className="space-y-4">
        <Button
          variant="primary"
          size="md"
          data-testid="file-menu-item-browse-action"
          onClick={handleBrowse}
        >
          Browse Files
        </Button>
        <div className="mt-6">
          <h3 className="text-body font-medium text-text mb-3">Recent Files</h3>
          {recentInactive.length === 0 ? (
            <p className="text-body text-ss-text-secondary">No recent files</p>
          ) : (
            <div className="space-y-2">
              {recentInactive.map((fileId) => {
                const file = files[fileId];
                const label = file?.displayName ?? fileId;
                return (
                  <Button
                    key={fileId}
                    variant="secondary"
                    size="md"
                    className="w-full justify-start"
                    data-testid={`file-menu-recent-item-${fileId}`}
                    onClick={() => handleOpenRecent(fileId)}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </BackstagePanel>
  );
}
