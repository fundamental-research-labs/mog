/**
 * Spreadsheet App Manifest
 *
 * The default app - provides the classic spreadsheet grid experience.
 * This is the "Excel view" of the data.
 *
 * This app is special: it's the DEFAULT app that users see when opening
 * a spreadsheet. It wraps the existing Grid view and sheet tabs from
 * the Shell, making the app feel "invisible" - users just see their
 * spreadsheet, not an "app".
 *
 * Capabilities:
 * - Full spreadsheet access (cells, sheets, formulas, formatting)
 * - Checkpoint management for version control
 * - Basic services (clipboard, notifications, undo)
 * - Optional: connections for importing external data
 * - Optional: filesystem for import/export
 *
 */

import type { AppManifestWithCapabilities } from '@mog-sdk/contracts/capabilities';

const manifest: AppManifestWithCapabilities = {
  id: 'spreadsheet',
  name: 'Spreadsheet',
  version: '1.0.0',
  description: 'Classic spreadsheet grid with formulas, formatting, and more',
  firstParty: true,

  capabilities: {
    // Required for core spreadsheet functionality
    required: [
      'spreadsheet:full', // Full cell, sheet, formula, formatting access
      'services:basic', // Clipboard write, notifications, undo read
      'checkpoints:create', // Create version checkpoints
      'checkpoints:restore', // Restore to previous checkpoints
    ],

    // Optional capabilities for enhanced features
    optional: [
      {
        capability: 'connections:read',
        reason: 'Import data from external databases',
      },
      {
        capability: 'filesystem:read',
        reason: 'Import files from local filesystem',
      },
      {
        capability: 'filesystem:write',
        reason: 'Export spreadsheet data to files',
      },
    ],
  },

  // No managed tables - this app works with any table
  // No views - uses built-in Grid view from Shell
};

export default manifest;
