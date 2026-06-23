import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { ShellBootstrapResult } from '@mog/shell/bootstrap';

import type {
  HostCommandOwner,
  MogSpreadsheetAppProps,
  SpreadsheetAppStatus,
  SpreadsheetCommandRequest,
  SpreadsheetWorkbookSession,
} from './public-types';
import type {
  RegisteredSpreadsheetAppBridge,
  SpreadsheetAppCapabilityRegistry,
} from './runtime-types';

export const SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER: unique symbol = Symbol.for(
  '@mog-sdk/spreadsheet-app.runtimeAttachmentController',
) as never;

export type SpreadsheetAttachmentCommandRequest = {
  readonly command: SpreadsheetCommandRequest['command'];
  readonly format?: 'xlsx' | 'csv' | 'pdf' | 'json';
  readonly source?: string;
};

export type SpreadsheetAttachmentCommandResult =
  | { readonly status: 'handled'; readonly result?: unknown }
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'not-handled' };

export type SpreadsheetRuntimeDocumentVersioningDiagnostic = {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type SpreadsheetRuntimeDocumentVersioningProviderSelection = {
  readonly kind: 'indexeddb';
  readonly requireDurablePersistence: true;
};

export type SpreadsheetRuntimeDocumentVersioningReadiness =
  | {
      readonly status: 'selected' | 'ready';
      readonly providerSelection: SpreadsheetRuntimeDocumentVersioningProviderSelection;
      readonly diagnostics: readonly SpreadsheetRuntimeDocumentVersioningDiagnostic[];
      readonly statusRevision?: string;
    }
  | {
      readonly status: 'skipped';
      readonly providerSelection: null;
      readonly reason: 'local-persistence-skipped';
      readonly diagnostics: readonly SpreadsheetRuntimeDocumentVersioningDiagnostic[];
      readonly statusRevision?: string;
    }
  | {
      readonly status: 'failed';
      readonly providerSelection: SpreadsheetRuntimeDocumentVersioningProviderSelection | null;
      readonly diagnostics: readonly SpreadsheetRuntimeDocumentVersioningDiagnostic[];
      readonly error: {
        readonly message: string;
        readonly name?: string;
      };
      readonly statusRevision?: string;
    };

export interface SpreadsheetAttachmentHostCommands {
  getOwner(command: SpreadsheetCommandRequest['command']): HostCommandOwner;
  request(
    request: SpreadsheetAttachmentCommandRequest,
  ): Promise<SpreadsheetAttachmentCommandResult> | SpreadsheetAttachmentCommandResult;
}

export interface SpreadsheetRuntimeAttachmentEnvironment {
  readonly attachmentId: string;
  readonly workbookId: string;
  readonly workbook: SpreadsheetWorkbookSession;
  readonly documentId: string;
  readonly documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness;
  readonly shell: ShellBootstrapResult;
  readonly appKernel: IAppKernelAPI;
  readonly capabilityRegistry: SpreadsheetAppCapabilityRegistry;
  readonly hostCommands?: SpreadsheetAttachmentHostCommands;
  getStatus?(): SpreadsheetAppStatus;
  registerAppBridge(bridge: RegisteredSpreadsheetAppBridge): () => void;
  detach(): Promise<void>;
}

export interface SpreadsheetRuntimeAttachRequest {
  readonly attachmentId: string;
  readonly workbook: SpreadsheetWorkbookSession;
  readonly props: Pick<
    MogSpreadsheetAppProps,
    'workspace' | 'chrome' | 'commands' | 'featurePolicy' | 'editModel' | 'portals' | 'slots'
  >;
}

export interface SpreadsheetRuntimeAttachmentController {
  attach(
    request: SpreadsheetRuntimeAttachRequest,
  ): Promise<SpreadsheetRuntimeAttachmentEnvironment>;
}

export type SpreadsheetRuntimeWithAttachmentController = {
  readonly [SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER]?: SpreadsheetRuntimeAttachmentController;
};
