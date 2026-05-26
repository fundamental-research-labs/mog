/**
 * SharePanel Component
 *
 * Sharing and collaboration options.
 *
 * Share infrastructure (collaboration links, ACL backend) is not yet in place.
 * The button dispatches `SHARE_DOCUMENT`, which surfaces a notification
 * acknowledging the unimplemented backend — the click is wired, never silent.
 * Once the share backend lands, the action handler becomes the only thing
 * that changes.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { BackstagePanel } from './BackstagePanel';

export function SharePanel() {
  const deps = useActionDependencies();
  const handleShare = useCallback(() => dispatch('SHARE_DOCUMENT', deps), [deps]);

  return (
    <BackstagePanel title="Share" description="Share your spreadsheet with others">
      <div className="space-y-4">
        <Button
          variant="primary"
          size="md"
          data-testid="file-menu-item-share-action"
          onClick={handleShare}
        >
          Share
        </Button>
        <p className="text-body text-ss-text-secondary mt-4">
          Sharing requires a connected workspace. Coming soon.
        </p>
      </div>
    </BackstagePanel>
  );
}
