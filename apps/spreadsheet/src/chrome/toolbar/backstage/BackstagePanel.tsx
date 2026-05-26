/**
 * File menu panel component
 *
 * Base panel component for file menu content areas.
 * Provides consistent layout and styling for all panels.
 */

import React from 'react';

export interface BackstagePanelProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function BackstagePanel({ title, description, children }: BackstagePanelProps) {
  return (
    <div data-testid="file-menu-panel" className="flex-1 overflow-auto p-8 bg-ss-surface">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-subtitle font-semibold text-text mb-2">{title}</h1>
        {description && <p className="text-body text-ss-text-secondary mb-6">{description}</p>}
        <div className="space-y-6">{children}</div>
      </div>
    </div>
  );
}
