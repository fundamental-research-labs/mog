/**
 * AppSetupDialog - Initial setup dialog for app data binding
 *
 * Shows when an app is launched for the first time without existing bindings.
 * Offers two options:
 * - "Start fresh" - Creates new tables for the app
 * - "Use existing data" - Connect to tables the user already has
 *
 */

import type { AppManifest } from '@mog-sdk/contracts/apps';

import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../components/ui/radix/Dialog';
import { RadioGroup } from '../components/ui/radix/RadioGroup';

// =============================================================================
// Types
// =============================================================================

export type SetupMode = 'fresh' | 'existing';

export interface AppSetupDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** The app manifest with managed tables info */
  manifest: AppManifest;
  /** Called when user selects "Start fresh" */
  onStartFresh: () => void;
  /** Called when user selects "Use existing data" */
  onUseExisting: () => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * AppSetupDialog - First-time setup dialog for apps.
 *
 * Presents two options:
 * 1. Start fresh - Create new tables managed by the app
 * 2. Use existing data - Bind to user's existing tables
 *
 * @example
 * ```tsx
 * <AppSetupDialog
 *   open={showSetup}
 *   onClose={() => setShowSetup(false)}
 *   manifest={crmManifest}
 *   onStartFresh={handleFreshStart}
 *   onUseExisting={handleExistingData}
 * />
 * ```
 */
export function AppSetupDialog({
  open,
  onClose,
  manifest,
  onStartFresh,
  onUseExisting,
}: AppSetupDialogProps) {
  const [selectedMode, setSelectedMode] = useState<SetupMode>('fresh');

  const handleContinue = () => {
    if (selectedMode === 'fresh') {
      onStartFresh();
    } else {
      onUseExisting();
    }
  };

  const managedTablesCount = manifest.managedTables?.length ?? 0;
  const tableNames = manifest.managedTables?.map((t) => t.name).join(', ') ?? '';

  return (
    <Dialog open={open} onClose={onClose} width="md">
      <DialogHeader onClose={onClose}>Set up {manifest.name}</DialogHeader>
      <DialogBody>
        <div className="space-y-5">
          <p className="text-body text-ss-text-secondary">
            How would you like to start using {manifest.name}?
          </p>

          <RadioGroup
            name="setup-mode"
            value={selectedMode}
            onChange={(value) => setSelectedMode(value as SetupMode)}
            options={[
              {
                value: 'fresh',
                label: 'Start fresh',
                description:
                  managedTablesCount > 0
                    ? `Create new tables for ${manifest.name}: ${tableNames}`
                    : `Create new tables for ${manifest.name}`,
              },
              {
                value: 'existing',
                label: 'Use existing data',
                description: 'Connect to tables you already have in this workbook',
              },
            ]}
          />

          {selectedMode === 'existing' && managedTablesCount > 0 && (
            <div className="p-3 bg-ss-surface-secondary rounded-ss-md border border-ss-border-light">
              <p className="text-caption text-ss-text-secondary">
                You will need to map your existing tables to the following app concepts:
              </p>
              <ul className="mt-2 space-y-1">
                {manifest.managedTables?.map((table) => (
                  <li
                    key={table.name}
                    className="text-caption text-ss-text-tertiary flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-ss-primary" />
                    {table.name} ({table.columns.length} columns)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleContinue}>
          Continue
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
