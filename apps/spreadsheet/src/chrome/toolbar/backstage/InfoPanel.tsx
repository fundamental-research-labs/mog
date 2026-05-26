/**
 * InfoPanel Component
 *
 * Shows document information, properties, and permissions.
 */

import { BackstagePanel } from './BackstagePanel';

export function InfoPanel() {
  return (
    <BackstagePanel title="Info" description="Document properties and information">
      <div className="space-y-4">
        <div className="bg-ss-surface-secondary p-4 rounded border border-ss-border">
          <h3 className="text-body font-medium text-text mb-2">Document Properties</h3>
          <div className="space-y-2 text-body">
            <div className="flex justify-between">
              <span className="text-ss-text-secondary">File name:</span>
              <span className="text-text">Untitled Spreadsheet</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ss-text-secondary">Size:</span>
              <span className="text-text">—</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ss-text-secondary">Created:</span>
              <span className="text-text">{new Date().toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ss-text-secondary">Modified:</span>
              <span className="text-text">{new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>
    </BackstagePanel>
  );
}
