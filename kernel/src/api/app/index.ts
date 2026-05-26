/**
 * App Kernel API Implementation
 *
 * @stability internal
 * @internal
 *
 * Monorepo-only — the app kernel API is the bridge between embedded apps
 * (Kanban, Gallery, etc.) and the kernel. Not intended for external SDK
 * consumers. Use the high-level Workbook/Worksheet API instead.
 *
 * This module provides the implementation of IAppKernelAPI, which is the
 * stable interface between apps and the kernel.
 *
 * Architecture:
 * - AppKernelAPI wraps internal kernel APIs
 * - Translates between app-level types (RecordId, AppTableId) and kernel types (RowId, ColId)
 * - Provides dual access pattern (by name and by ID)
 *
 * The capability-gated module provides versions of these APIs that enforce
 * capability-based permissions. Apps receive ONLY interfaces for granted
 * capabilities.
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { DocumentHandle, DocumentHandleInternal } from '../document/document-factory';
import { createAppKernelAPI } from './app-kernel-api';

// Standard (ungated) API
export { AppKernelAPI, createAppKernelAPI } from './app-kernel-api';
export type { AppKernelAPIOptions } from './app-kernel-api';

export function createAppKernelAPIFromHandle(
  handle: DocumentHandle,
  workbook: Workbook,
): IAppKernelAPI {
  const maybeInternal = handle as Partial<DocumentHandleInternal>;
  if (!maybeInternal.context) {
    throw new Error(
      'createAppKernelAPIFromHandle: expected a trusted kernel DocumentHandle with internal context',
    );
  }
  return createAppKernelAPI({ ctx: maybeInternal.context, workbook });
}

// Bindings API
export { AppBindingsAPIImpl, createAppBindingsAPI } from './bindings-api';

// Capability-gated API
export {
  createCapabilityGatedApi,
  createCapabilityIntrospection,
  createScopedAPIContext,
  createScopedClipboardAPI,
  createScopedColumnsAPI,
  createScopedConnectionsAPI,
  createScopedEventsAPI,
  createScopedNetworkAPI,
  createScopedRecordsAPI,
  createScopedRelationsAPI,
  createScopedTablesAPI,
  createScopedUndoAPI,
  createUngatedAdapter,
} from './capability-gated';

export type {
  BatchOperation,
  BatchValidationResult,
  CapabilityGatedAPIOptions,
  CreateCapabilityGatedAPIOptions,
  ScopedAPIContext,
} from './capability-gated';
