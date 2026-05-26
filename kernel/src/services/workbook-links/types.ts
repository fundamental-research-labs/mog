import type { AccessPrincipal } from '@mog-sdk/contracts/security';

export type WorkbookId = string;
export type WorkbookSessionId = string;
export type DocumentId = string;
export type LinkId = string;
export type ActorId = string;

export type WorkbookLinkSourceKind = 'mog-workbook' | 'excel-workbook' | 'dde-link' | 'ole-link';

export type PersistedLinkTarget =
  | { readonly kind: 'document-ref'; readonly documentId: DocumentId }
  | { readonly kind: 'open-session'; readonly sessionId: WorkbookSessionId }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'excel-external-path'; readonly target: string }
  | { readonly kind: 'opaque-host-ref'; readonly provider: string; readonly ref: string };

export interface ImportedExternalLinkIdentity {
  readonly excelOrdinal: number;
  readonly workbookRelId: string;
  readonly partName: string;
  readonly externalBookRid?: string;
  readonly target?: string;
  readonly targetMode?: 'External' | 'Internal';
}

export interface AuthorizedMaterializedCacheMetadata {
  readonly cachedValuesVersion?: string;
  readonly materializedAt?: string;
  readonly policyVersion?: string;
}

export interface PersistedWorkbookLinkRecord {
  readonly linkId: LinkId;
  readonly expectedWorkbookId: WorkbookId | null;
  readonly target: PersistedLinkTarget;
  readonly displayName: string;
  readonly sourceKind: WorkbookLinkSourceKind;
  readonly importedExcelIdentity?: ImportedExternalLinkIdentity;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export type LinkStatus =
  | 'unresolved'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'denied'
  | 'broken'
  | 'ambiguous';

export type LinkStatusReason =
  | 'wrongWorkbookId'
  | 'missingTarget'
  | 'unsupportedLinkKind'
  | 'permissionDenied'
  | 'sourceUnavailable';

export interface RuntimeLinkStatus {
  readonly linkId: LinkId;
  readonly requestingDocumentId: DocumentId;
  readonly requestingSessionId: WorkbookSessionId;
  readonly actor: ActorId;
  readonly principal: AccessPrincipal;
  readonly sourceSessionId?: WorkbookSessionId;
  readonly sourceWorkbookId?: WorkbookId;
  readonly status: LinkStatus;
  readonly statusReason?: LinkStatusReason;
  readonly lastKnownSourceVersion?: string;
  readonly lastResolvedAt?: string;
  readonly cachedValuesVersion?: string;
}

export interface LinkStatusView {
  readonly linkId: LinkId;
  readonly status: LinkStatus;
  readonly statusReason?: LinkStatusReason;
  readonly lastResolvedAt?: string;
  readonly cachedValuesVersion?: string;
  readonly canRefresh: boolean;
  readonly retryable: boolean;
  readonly displayMessage: string;
}

export type UsageKind =
  | 'cellFormula'
  | 'definedName'
  | 'conditionalFormat'
  | 'dataValidation'
  | 'tableFormula'
  | 'chartExFormula'
  | 'nativeMogFormula'
  | 'diagnosticOnly';

export type LocateTarget =
  | { readonly kind: 'cell'; readonly sheetId: string; readonly address: string }
  | { readonly kind: 'range'; readonly sheetId: string; readonly range: string }
  | {
      readonly kind: 'table';
      readonly sheetId: string;
      readonly tableId: string;
      readonly range?: string;
    }
  | { readonly kind: 'sheet-object'; readonly sheetId: string; readonly objectId: string }
  | { readonly kind: 'name-manager'; readonly name: string }
  | {
      readonly kind: 'disabled';
      readonly reason: 'hiddenSheet' | 'veryHiddenSheet' | 'protectedSheet' | 'filteredOut';
    }
  | { readonly kind: 'deleted'; readonly reason: string }
  | { readonly kind: 'unsupported'; readonly reason: string };

export interface WorkbookLinkView {
  readonly linkId: LinkId;
  readonly displayName: string;
  readonly sourceKind: WorkbookLinkSourceKind;
  readonly targetDisplay: string;
  readonly canCopySource: boolean;
  readonly canRefresh: boolean;
  readonly status: LinkStatusView;
  readonly usageCount: number;
  readonly lastResolvedAt?: string;
  readonly hasEverResolved: boolean;
}

export interface WorkbookExternalLinkUsageView {
  readonly linkId: LinkId;
  readonly usageId: string;
  readonly usageKind: UsageKind;
  readonly sheetId?: string;
  readonly sheetName?: string;
  readonly address?: string;
  readonly objectId?: string;
  readonly expressionPreview?: string;
  readonly targetDisplay?: string;
  readonly locate: LocateTarget;
}

export interface WorkbookExternalPackageArtifactView {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly partName: string;
  readonly diagnostic: string;
  readonly tombstoned: boolean;
}

export type CopyWorkbookLinkSourceResult =
  | { readonly type: 'copied'; readonly linkId: LinkId; readonly copiedText: string }
  | {
      readonly type: 'denied';
      readonly linkId: LinkId;
      readonly deniedReason: 'permissionDenied' | 'redacted' | 'unsupportedLinkKind';
    };

export interface DisposableWatchHandle {
  dispose(): void;
}

export interface WorkbookLinkResolveRequest {
  readonly linkId: LinkId;
  readonly requestingDocumentId: DocumentId;
  readonly requestingSessionId: WorkbookSessionId;
  readonly actor: ActorId;
  readonly principal: AccessPrincipal;
  readonly target: PersistedLinkTarget;
  readonly expectedWorkbookId: WorkbookId | null;
}

export interface ResolvedWorkbookLink {
  readonly linkId: LinkId;
  readonly status: LinkStatus;
  readonly statusReason?: LinkStatusReason;
  readonly sourceSessionId?: WorkbookSessionId;
  readonly sourceDocumentRef?: PersistedLinkTarget;
  readonly sourceWorkbookId?: WorkbookId;
  readonly sourceVersion?: string;
  readonly authorization: 'read' | 'redacted' | 'denied';
  readonly watch?: DisposableWatchHandle;
}

export interface WorkbookLinkResolver {
  resolve(
    request: WorkbookLinkResolveRequest,
  ): Promise<ResolvedWorkbookLink> | ResolvedWorkbookLink;
}

export interface CreateWorkbookLinkInput {
  readonly linkId?: LinkId;
  readonly expectedWorkbookId?: WorkbookId | null;
  readonly target: PersistedLinkTarget;
  readonly displayName: string;
  readonly sourceKind: WorkbookLinkSourceKind;
  readonly importedExcelIdentity?: ImportedExternalLinkIdentity;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export interface UpdateWorkbookLinkInput {
  readonly expectedWorkbookId?: WorkbookId | null;
  readonly target?: PersistedLinkTarget;
  readonly displayName?: string;
  readonly sourceKind?: WorkbookLinkSourceKind;
  readonly importedExcelIdentity?: ImportedExternalLinkIdentity;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export interface WorkbookLinkStatusScope {
  readonly requestingDocumentId: DocumentId;
  readonly requestingSessionId: WorkbookSessionId;
  readonly actor: ActorId;
  readonly principal: AccessPrincipal;
}

export interface WorkbookLinksAPI {
  list(): readonly WorkbookLinkView[];
  get(linkId: LinkId): WorkbookLinkView | null;
  create(input: CreateWorkbookLinkInput): WorkbookLinkView;
  add(input: CreateWorkbookLinkInput): WorkbookLinkView;
  update(linkId: LinkId, input: UpdateWorkbookLinkInput): WorkbookLinkView;
  retarget(linkId: LinkId, input: UpdateWorkbookLinkInput): WorkbookLinkView;
  delete(linkId: LinkId): boolean;
  break(linkId: LinkId, options: { readonly mode: 'delete-record-only' }): boolean;
  getStatus(linkId: LinkId, scope?: Partial<WorkbookLinkStatusScope>): LinkStatusView;
  refresh(linkId: LinkId, scope: WorkbookLinkStatusScope): Promise<LinkStatusView>;
  refreshAll(
    scope: WorkbookLinkStatusScope,
    options?: { readonly concurrency?: number },
  ): Promise<readonly LinkStatusView[]>;
  watchStatus(
    linkId: LinkId,
    scope: WorkbookLinkStatusScope,
    handler: (status: LinkStatusView) => void,
  ): () => void;
  getUsages(linkId: LinkId): Promise<readonly WorkbookExternalLinkUsageView[]>;
  copySource(linkId: LinkId, scope: WorkbookLinkStatusScope): Promise<CopyWorkbookLinkSourceResult>;
  listPackageDiagnostics(): Promise<readonly WorkbookExternalPackageArtifactView[]>;
}
