/**
 * Manifest validator — validates an AppManifest against the canonical schema.
 */

import type { AppKind, AppManifest, RuntimeHostMode } from './types';

const VALID_APP_KINDS: AppKind[] = [
  'document-app',
  'dataset-app',
  'workspace-app',
  'utility-app',
  'background-app',
];
const VALID_RUNTIME_HOST_MODES: RuntimeHostMode[] = [
  'same-realm-first-party',
  'iframe-sandbox',
  'worker-sandbox',
  'server-side',
  'remote-bridge',
  'disabled',
];

export interface ValidationError {
  field: string;
  message: string;
}

export function validateManifest(manifest: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required string fields
  const requiredStrings: [string, string][] = [
    ['id', 'id'],
    ['name', 'name'],
    ['version', 'version'],
    ['description', 'description'],
    ['author', 'author'],
    ['icon', 'icon'],
  ];

  for (const [field, label] of requiredStrings) {
    if (typeof manifest[field] !== 'string' || (manifest[field] as string).length === 0) {
      errors.push({ field, message: `${label} is required and must be a non-empty string` });
    }
  }

  // kind
  if (!VALID_APP_KINDS.includes(manifest.kind as AppKind)) {
    errors.push({
      field: 'kind',
      message: `kind must be one of: ${VALID_APP_KINDS.join(', ')}`,
    });
  }

  // runtimeHost
  if (!VALID_RUNTIME_HOST_MODES.includes(manifest.runtimeHost as RuntimeHostMode)) {
    errors.push({
      field: 'runtimeHost',
      message: `runtimeHost must be one of: ${VALID_RUNTIME_HOST_MODES.join(', ')}`,
    });
  }

  // entry
  if (!manifest.entry || typeof manifest.entry !== 'object') {
    errors.push({ field: 'entry', message: 'entry is required and must be an object' });
  } else {
    const entry = manifest.entry as Record<string, unknown>;
    if (typeof entry.module !== 'string') {
      errors.push({ field: 'entry.module', message: 'entry.module is required' });
    }
    if (typeof entry.export !== 'string') {
      errors.push({ field: 'entry.export', message: 'entry.export is required' });
    }
  }

  // compatibility
  if (!Array.isArray(manifest.compatibility)) {
    errors.push({ field: 'compatibility', message: 'compatibility must be an array' });
  }

  // capabilities
  if (!Array.isArray(manifest.capabilities)) {
    errors.push({ field: 'capabilities', message: 'capabilities must be an array' });
  }

  // routes
  if (!Array.isArray(manifest.routes)) {
    errors.push({ field: 'routes', message: 'routes must be an array' });
  }

  // contributions — check for duplicate IDs
  if (!Array.isArray(manifest.contributions)) {
    errors.push({ field: 'contributions', message: 'contributions must be an array' });
  } else {
    const seenIds = new Set<string>();
    for (const c of manifest.contributions as Array<Record<string, unknown>>) {
      const id = c.id as string;
      if (seenIds.has(id)) {
        errors.push({
          field: 'contributions',
          message: `Duplicate contribution ID: ${id}`,
        });
      }
      seenIds.add(id);
    }
  }

  // lifecycle
  if (!manifest.lifecycle || typeof manifest.lifecycle !== 'object') {
    errors.push({ field: 'lifecycle', message: 'lifecycle is required and must be an object' });
  }

  return errors;
}
