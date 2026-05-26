/**
 * SavePanel Component
 *
 * Save the current file.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function SavePanel() {
  const deps = useActionDependencies();

  const handleSave = useCallback(() => {
    dispatch('SAVE', deps);
  }, [deps]);

  return (
    <BackstagePanel title="Save" description="Save your spreadsheet">
      <div className="space-y-4">
        <Button
          variant="primary"
          size="md"
          data-testid="file-menu-item-save-action"
          onClick={handleSave}
        >
          Save
        </Button>
        <p className="text-body text-ss-text-secondary mt-4">
          Save your changes to the current file
        </p>
      </div>
    </BackstagePanel>
  );
}
