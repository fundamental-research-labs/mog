/**
 * RecentsPanel Component
 *
 * Lists currently-open files (the shell's `openFileIds` is the working set —
 * there is no separate persistent recents store yet). Each row dispatches
 * `OPEN_RECENT_FILE` with the chosen fileId. Issue #115: the leaf is wired,
 * never silent.
 *
 * The first entry is the current document for context; clicking it is still
 * a real handler (the action handler short-circuits to "already active",
 * still returning handled).
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { useShellStore } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function RecentsPanel() {
  const deps = useActionDependencies();
  const openFileIds = useShellStore((s) => s.openFileIds);
  const files = useShellStore((s) => s.files);
  const activeFileId = useShellStore((s) => s.activeFileId);

  const handleOpen = useCallback(
    (fileId: string) => dispatch('OPEN_RECENT_FILE', deps, { fileId }),
    [deps],
  );

  return (
    <BackstagePanel title="Recents" description="Recently opened files">
      <div className="space-y-2" data-testid="recents-list">
        {openFileIds.length === 0 ? (
          <p data-testid="recents-empty-state" className="text-body text-ss-text-secondary">
            No recent files
          </p>
        ) : (
          openFileIds.map((fileId) => {
            const file = files[fileId];
            const label = file?.displayName ?? fileId;
            const isActive = fileId === activeFileId;
            return (
              <Button
                key={fileId}
                variant="secondary"
                size="md"
                className="w-full justify-start"
                data-testid="recents-list-item"
                data-recent-file-id={fileId}
                onClick={() => handleOpen(fileId)}
              >
                {label}
                {isActive ? (
                  <span className="ml-2 text-ss-text-tertiary text-body">(current)</span>
                ) : null}
              </Button>
            );
          })
        )}
      </div>
    </BackstagePanel>
  );
}
