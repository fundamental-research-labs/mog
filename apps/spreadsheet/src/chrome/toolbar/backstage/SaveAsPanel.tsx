/**
 * SaveAsPanel Component
 *
 * Save with a new name or location.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function SaveAsPanel() {
  const deps = useActionDependencies();

  const handleSaveAs = useCallback(() => {
    dispatch('EXPORT_FILE', deps);
  }, [deps]);

  return (
    <BackstagePanel title="Save As" description="Save a copy with a new name or location">
      <div className="space-y-4">
        <Button
          variant="primary"
          size="md"
          data-testid="file-menu-item-save-as-action"
          onClick={handleSaveAs}
        >
          Save As...
        </Button>
        <p className="text-body text-ss-text-secondary mt-4">
          Choose a new name and location for your spreadsheet
        </p>
      </div>
    </BackstagePanel>
  );
}
