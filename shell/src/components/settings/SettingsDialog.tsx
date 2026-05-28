/**
 * SettingsDialog - Multi-tab settings panel for Spreadsheet OS
 *
 * Provides a unified settings interface with tabs for:
 * - General: Application behavior and preferences
 * - Appearance: Theme, font size, display options
 * - Connections: Database and API connections management
 * - About: Version info, credits, and links
 *
 */

import React, { useState } from 'react';

import { Dialog, DialogBody, DialogHeader } from '../ui/radix/Dialog';
import { TabPanel, Tabs } from '../ui/radix/Tabs';

// =============================================================================
// Types
// =============================================================================

export type SettingsAppearanceMode = 'light' | 'dark' | 'system';

export interface SettingsDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** Current app appearance mode. */
  appearanceMode?: SettingsAppearanceMode;
  /** Called when the user changes the app appearance mode. */
  onAppearanceModeChange?: (mode: SettingsAppearanceMode) => void;
}

const ABOUT_LINK_TARGET = '_blank';
const ABOUT_LINK_REL = 'noopener noreferrer';
const ABOUT_LINKS = [
  {
    label: 'Documentation',
    href: 'https://github.com/fundamental-research-labs/mog/tree/main/docs',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    ),
  },
  {
    label: 'GitHub Repository',
    href: 'https://github.com/fundamental-research-labs/mog',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
  },
  {
    label: 'Report an Issue',
    href: 'https://github.com/fundamental-research-labs/mog/issues/new',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
] as const;

// =============================================================================
// Tab Content Components
// =============================================================================

/**
 * GeneralSettings - Application behavior and preferences
 */
function GeneralSettings(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-body font-medium text-text mb-3">File Handling</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Auto-save documents every 5 minutes</span>
          </label>
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Open recent documents on startup</span>
          </label>
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" />
            <span>Create backup before overwriting files</span>
          </label>
        </div>
      </section>

      <section>
        <h3 className="text-body font-medium text-text mb-3">Editing</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Show formula suggestions</span>
          </label>
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Enable auto-complete for cell values</span>
          </label>
        </div>
      </section>
    </div>
  );
}

/**
 * AppearanceSettings - Theme, font size, display options
 */
function AppearanceSettings({
  appearanceMode = 'light',
  onAppearanceModeChange,
}: {
  appearanceMode?: SettingsAppearanceMode;
  onAppearanceModeChange?: (mode: SettingsAppearanceMode) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-body font-medium text-text mb-3">Theme</h3>
        <div className="flex gap-3">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-2 px-4 py-2 border border-ss-border rounded-ss-md cursor-pointer hover:bg-ss-surface-hover transition-colors"
            >
              <input
                type="radio"
                name="theme"
                value={mode}
                className="accent-ss-primary"
                checked={appearanceMode === mode}
                onChange={() => onAppearanceModeChange?.(mode)}
              />
              <span className="text-body-sm">
                {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System'}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-body font-medium text-text mb-3">Font Size</h3>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="10"
            max="18"
            defaultValue="13"
            className="flex-1 accent-ss-primary"
          />
          <span className="text-body-sm text-ss-text-secondary w-12 text-right">13px</span>
        </div>
      </section>

      <section>
        <h3 className="text-body font-medium text-text mb-3">Display</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Show gridlines</span>
          </label>
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Show row and column headers</span>
          </label>
          <label className="flex items-center gap-3 text-body-sm text-ss-text-secondary cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-ss-primary" defaultChecked />
            <span>Show formula bar</span>
          </label>
        </div>
      </section>
    </div>
  );
}

/**
 * AboutSettings - Version info, credits, and links
 */
function AboutSettings(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <section className="text-center py-4">
        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
        </div>
        <h2 className="text-title font-semibold text-text mb-1">Spreadsheet OS</h2>
        <p className="text-body-sm text-ss-text-secondary">Version 0.1.0</p>
      </section>

      <section>
        <h3 className="text-body font-medium text-text mb-3">About</h3>
        <p className="text-body-sm text-ss-text-secondary leading-relaxed">
          A data operating system built on spreadsheet primitives. The spreadsheet is the universal
          data substrate — every app is just structured data + views + event handlers.
        </p>
      </section>

      <section>
        <h3 className="text-body font-medium text-text mb-3">Links</h3>
        <div className="space-y-2">
          {ABOUT_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={ABOUT_LINK_TARGET}
              rel={ABOUT_LINK_REL}
              className="flex items-center gap-2 text-body-sm text-ss-primary hover:underline"
            >
              {link.icon}
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section className="pt-4 border-t border-ss-border">
        <p className="text-caption text-ss-text-tertiary text-center">
          Built with TypeScript, React, Yjs, and Tauri
        </p>
      </section>
    </div>
  );
}

// =============================================================================
// Settings Tabs Configuration
// =============================================================================

const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' },
];

// =============================================================================
// Main Component
// =============================================================================

/**
 * SettingsDialog - Multi-tab settings panel
 *
 * @example
 * ```tsx
 * const [settingsOpen, setSettingsOpen] = useState(false);
 *
 * <SettingsDialog
 *   open={settingsOpen}
 *   onClose={() => setSettingsOpen(false)}
 * />
 * ```
 */
export function SettingsDialog({
  open,
  onClose,
  appearanceMode,
  onAppearanceModeChange,
}: SettingsDialogProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <Dialog open={open} onClose={onClose} width="lg">
      <DialogHeader onClose={onClose}>Settings</DialogHeader>
      <DialogBody noPadding>
        <div className="flex flex-col h-[480px]">
          <Tabs
            tabs={SETTINGS_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            className="px-5"
          >
            <div className="p-5 overflow-auto flex-1">
              <TabPanel tabId="general">
                <GeneralSettings />
              </TabPanel>
              <TabPanel tabId="appearance">
                <AppearanceSettings
                  appearanceMode={appearanceMode}
                  onAppearanceModeChange={onAppearanceModeChange}
                />
              </TabPanel>
              <TabPanel tabId="about">
                <AboutSettings />
              </TabPanel>
            </div>
          </Tabs>
        </div>
      </DialogBody>
    </Dialog>
  );
}
