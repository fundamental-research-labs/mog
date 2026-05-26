/**
 * NewPanel Component
 *
 * Create a new blank workbook or from templates.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function NewPanel() {
  const deps = useActionDependencies();

  const handleNewWorkbook = useCallback(() => {
    dispatch('CLOSE_BACKSTAGE', deps);
    dispatch('NEW_WORKBOOK', deps);
  }, [deps]);

  return (
    <BackstagePanel title="New" description="Create a new spreadsheet">
      <div className="space-y-4">
        <Button
          variant="primary"
          size="md"
          data-testid="file-menu-item-new-action"
          onClick={handleNewWorkbook}
        >
          Blank Workbook
        </Button>
        <p className="text-body text-ss-text-secondary mt-4">Template gallery coming soon</p>
      </div>
    </BackstagePanel>
  );
}
