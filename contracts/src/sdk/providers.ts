/**
 * Public SDK provider model.
 *
 * Providers are explicit capabilities passed at document/workbook construction
 * or registered through typed handle methods. They replace ad hoc callbacks
 * and internal bridge parameters.
 *
 * Provider ownership: SDK-owned providers are disposed by the SDK.
 * Host-owned providers are detached but not destroyed.
 */

import type { SheetId } from '../core';

// ---------------------------------------------------------------------------
// Runtime provider (transport/compute packaging)
// ---------------------------------------------------------------------------

export interface MogSdkRuntimeProvider {
  readonly kind: 'browser' | 'headless' | 'tauri';
  readonly userTimezone?: string;
}

// ---------------------------------------------------------------------------
// Storage provider (persistence contract)
// ---------------------------------------------------------------------------

export interface MogSdkStorageProvider {
  readonly name: string;

  attach(doc: MogSdkProviderDoc): Promise<MogSdkProviderAttachResult>;
  appendUpdate(update: Uint8Array): void;
  flush(): Promise<void>;
  checkpoint(doc: MogSdkProviderDoc): Promise<MogSdkProviderCheckpointResult>;
  flushSync(): void;
  detach(): Promise<void>;

  readonly flushFailed: boolean;
  readonly readOnly?: boolean;
}

export interface MogSdkProviderDoc {
  readonly documentId: string;
  encodeStateAsUpdate(): Uint8Array;
  encodeStateVector(): Uint8Array;
}

export interface MogSdkProviderAttachResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly initialUpdate?: Uint8Array;
}

export interface MogSdkProviderCheckpointResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly bytesWritten?: number;
}

// ---------------------------------------------------------------------------
// Workbook state provider (active sheet and host metadata)
// ---------------------------------------------------------------------------

export interface MogSdkWorkbookStateProvider {
  getActiveSheetId(): SheetId | undefined;
  setActiveSheetId(sheetId: SheetId): void;
  getMetadata?(key: string): unknown;
  setMetadata?(key: string, value: unknown): void;
}

// ---------------------------------------------------------------------------
// Security provider (principal, policies, redaction)
// ---------------------------------------------------------------------------

export interface MogSdkSecurityProvider {
  resolvePrincipal(): MogSdkAccessPrincipal;
}

export interface MogSdkAccessPrincipal {
  readonly tags: readonly string[];
}

// ---------------------------------------------------------------------------
// Collaboration document provider (update transport only)
// ---------------------------------------------------------------------------

export interface MogSdkCollaborationProvider {
  readonly url: string;
  readonly participantId: string;
}

// ---------------------------------------------------------------------------
// Provider ownership
// ---------------------------------------------------------------------------

export type MogSdkProviderOwnership = 'sdk' | 'host';
