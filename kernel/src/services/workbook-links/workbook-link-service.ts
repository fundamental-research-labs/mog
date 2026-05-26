import type {
  CreateWorkbookLinkInput,
  DisposableWatchHandle,
  LinkId,
  LinkStatusView,
  PersistedWorkbookLinkRecord,
  PersistedLinkTarget,
  RuntimeLinkStatus,
  UpdateWorkbookLinkInput,
  WorkbookExternalLinkUsageView,
  WorkbookExternalPackageArtifactView,
  WorkbookLinkView,
  WorkbookLinkResolver,
  WorkbookLinksAPI,
  WorkbookLinkStatusScope,
  CopyWorkbookLinkSourceResult,
} from './types';

const DEFAULT_SCOPE: WorkbookLinkStatusScope = {
  requestingDocumentId: 'unknown-document',
  requestingSessionId: 'unknown-session',
  actor: 'trusted-host',
  principal: { tags: ['host:trusted'] },
};

function createLinkId(): LinkId {
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function principalKey(principal: { readonly tags: readonly string[] }): string {
  return [...principal.tags].sort().join('\u001f');
}

function scopeKey(scope: WorkbookLinkStatusScope): string {
  return [
    scope.requestingDocumentId,
    scope.requestingSessionId,
    scope.actor,
    principalKey(scope.principal),
  ].join('\u001e');
}

function toStatusView(status: RuntimeLinkStatus): LinkStatusView {
  return {
    linkId: status.linkId,
    status: status.status,
    statusReason: status.statusReason,
    lastResolvedAt: status.lastResolvedAt,
    cachedValuesVersion: status.cachedValuesVersion,
    canRefresh: status.statusReason !== 'unsupportedLinkKind',
    retryable:
      status.status === 'unresolved' || status.status === 'stale' || status.status === 'ambiguous',
    displayMessage: statusMessage(status.status, status.statusReason),
  };
}

function statusMessage(
  status: RuntimeLinkStatus['status'],
  reason?: RuntimeLinkStatus['statusReason'],
): string {
  if (reason === 'permissionDenied') return 'Permission denied';
  if (reason === 'unsupportedLinkKind') return 'Unsupported link kind';
  if (reason === 'wrongWorkbookId') return 'Wrong workbook';
  if (reason === 'missingTarget') return 'Missing target';
  if (reason === 'sourceUnavailable') return 'Source unavailable';
  if (status === 'loading') return 'Checking';
  if (status === 'ready') return 'Ready';
  if (status === 'stale') return 'Stale';
  if (status === 'broken') return 'Broken';
  if (status === 'ambiguous') return 'Ambiguous';
  return 'Not checked';
}

function unresolvedStatus(linkId: LinkId, scope: WorkbookLinkStatusScope): RuntimeLinkStatus {
  return {
    linkId,
    requestingDocumentId: scope.requestingDocumentId,
    requestingSessionId: scope.requestingSessionId,
    actor: scope.actor,
    principal: scope.principal,
    status: 'unresolved',
  };
}

function idsMatch(expected: string | null, actual: string | undefined): boolean {
  return expected === null || expected === actual;
}

function hasTrustedCopyScope(scope: WorkbookLinkStatusScope): boolean {
  return scope.principal.tags.some(
    (tag: string) => tag === 'host:trusted' || tag === 'kernel:trusted',
  );
}

function isUnsupported(record: PersistedWorkbookLinkRecord): boolean {
  return record.sourceKind === 'dde-link' || record.sourceKind === 'ole-link';
}

function canRefresh(record: PersistedWorkbookLinkRecord): boolean {
  return !isUnsupported(record);
}

function redactDisplayName(value: string): string {
  return value.trim() || 'Restricted';
}

function targetDisplay(target: PersistedLinkTarget, displayName: string, denied = false): string {
  if (denied) return redactDisplayName(displayName);
  switch (target.kind) {
    case 'path':
    case 'excel-external-path':
      return basename(target.kind === 'path' ? target.path : target.target);
    case 'url':
      return redactUrl(target.url);
    case 'opaque-host-ref':
      return 'Opaque external source';
    case 'document-ref':
      return 'Mog workbook';
    case 'open-session':
      return 'Open workbook session';
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'External workbook';
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const file = url.pathname.split('/').filter(Boolean).pop();
    return `${url.protocol}//${url.host}${file ? `/.../${file}` : ''}`;
  } catch {
    return 'External URL';
  }
}

export interface WorkbookLinkServiceOptions {
  readonly resolver?: WorkbookLinkResolver;
  readonly now?: () => string;
}

export class ExternalLinkWatchRegistry {
  private readonly watches = new Map<string, DisposableWatchHandle>();

  replace(key: string, watch: DisposableWatchHandle | undefined): void {
    this.delete(key);
    if (watch) this.watches.set(key, watch);
  }

  delete(key: string): void {
    const watch = this.watches.get(key);
    if (!watch) return;
    this.watches.delete(key);
    watch.dispose();
  }

  dispose(): void {
    for (const key of [...this.watches.keys()]) {
      this.delete(key);
    }
  }

  get size(): number {
    return this.watches.size;
  }
}

export class WorkbookLinkService implements WorkbookLinksAPI {
  private readonly records = new Map<LinkId, PersistedWorkbookLinkRecord>();
  private readonly statuses = new Map<string, RuntimeLinkStatus>();
  private readonly listeners = new Map<string, Set<(status: LinkStatusView) => void>>();
  private readonly usages = new Map<LinkId, WorkbookExternalLinkUsageView[]>();
  private readonly packageDiagnostics: WorkbookExternalPackageArtifactView[] = [];
  readonly watches = new ExternalLinkWatchRegistry();

  constructor(private readonly options: WorkbookLinkServiceOptions = {}) {}

  listRecords(): readonly PersistedWorkbookLinkRecord[] {
    return [...this.records.values()];
  }

  getRecord(linkId: LinkId): PersistedWorkbookLinkRecord | null {
    return this.records.get(linkId) ?? null;
  }

  list(): readonly WorkbookLinkView[] {
    return [...this.records.values()].map((record) => this.toView(record));
  }

  get(linkId: LinkId): WorkbookLinkView | null {
    const record = this.records.get(linkId);
    return record ? this.toView(record) : null;
  }

  create(input: CreateWorkbookLinkInput): WorkbookLinkView {
    const linkId = input.linkId ?? createLinkId();
    if (this.records.has(linkId)) {
      throw new Error(`Workbook link "${linkId}" already exists`);
    }
    const record: PersistedWorkbookLinkRecord = {
      linkId,
      expectedWorkbookId: input.expectedWorkbookId ?? null,
      target: input.target,
      displayName: input.displayName,
      sourceKind: input.sourceKind,
      importedExcelIdentity: input.importedExcelIdentity,
      materializedCacheMetadata: input.materializedCacheMetadata,
    };
    this.records.set(linkId, record);
    return this.toView(record);
  }

  add(input: CreateWorkbookLinkInput): WorkbookLinkView {
    return this.create(input);
  }

  update(linkId: LinkId, input: UpdateWorkbookLinkInput): WorkbookLinkView {
    const current = this.records.get(linkId);
    if (!current) throw new Error(`Workbook link "${linkId}" does not exist`);
    if (current.sourceKind !== 'mog-workbook') {
      const forbidden = input.target ?? input.sourceKind ?? input.importedExcelIdentity;
      if (forbidden !== undefined) {
        throw new Error(`Imported workbook link "${linkId}" can only update displayName`);
      }
    }
    const next: PersistedWorkbookLinkRecord = {
      ...current,
      expectedWorkbookId: input.expectedWorkbookId ?? current.expectedWorkbookId,
      target: input.target ?? current.target,
      displayName: input.displayName ?? current.displayName,
      sourceKind: input.sourceKind ?? current.sourceKind,
      importedExcelIdentity: input.importedExcelIdentity ?? current.importedExcelIdentity,
      materializedCacheMetadata:
        input.materializedCacheMetadata ?? current.materializedCacheMetadata,
    };
    this.records.set(linkId, next);
    this.invalidate(linkId);
    return this.toView(next);
  }

  retarget(linkId: LinkId, input: UpdateWorkbookLinkInput): WorkbookLinkView {
    return this.update(linkId, input);
  }

  delete(linkId: LinkId): boolean {
    const deleted = this.records.delete(linkId);
    this.invalidate(linkId);
    return deleted;
  }

  break(linkId: LinkId, options: { readonly mode: 'delete-record-only' }): boolean {
    if (options.mode !== 'delete-record-only') {
      throw new Error('Workbook link break only supports delete-record-only in this release');
    }
    return this.delete(linkId);
  }

  getStatus(linkId: LinkId, scope: Partial<WorkbookLinkStatusScope> = {}): LinkStatusView {
    const fullScope = { ...DEFAULT_SCOPE, ...scope };
    const status =
      this.statuses.get(this.statusKey(linkId, fullScope)) ?? unresolvedStatus(linkId, fullScope);
    return toStatusView(status);
  }

  async refresh(linkId: LinkId, scope: WorkbookLinkStatusScope): Promise<LinkStatusView> {
    const record = this.records.get(linkId);
    if (!record) {
      const broken: RuntimeLinkStatus = {
        ...unresolvedStatus(linkId, scope),
        status: 'broken',
        statusReason: 'missingTarget',
        lastResolvedAt: this.now(),
      };
      this.setStatus(broken);
      return toStatusView(broken);
    }
    if (isUnsupported(record)) {
      const unsupported: RuntimeLinkStatus = {
        ...unresolvedStatus(linkId, scope),
        status: 'unresolved',
        statusReason: 'unsupportedLinkKind',
        lastResolvedAt: this.now(),
      };
      this.setStatus(unsupported);
      return toStatusView(unsupported);
    }

    const loading: RuntimeLinkStatus = {
      ...unresolvedStatus(linkId, scope),
      status: 'loading',
      lastResolvedAt: this.now(),
    };
    this.setStatus(loading);

    const resolved = this.options.resolver
      ? await this.options.resolver.resolve({
          linkId,
          requestingDocumentId: scope.requestingDocumentId,
          requestingSessionId: scope.requestingSessionId,
          actor: scope.actor,
          principal: scope.principal,
          target: record.target,
          expectedWorkbookId: record.expectedWorkbookId,
        })
      : {
          linkId,
          status: 'unresolved' as const,
          statusReason: 'missingTarget' as const,
          authorization: 'denied' as const,
        };

    const mismatchedWorkbook =
      resolved.authorization !== 'denied' &&
      !idsMatch(record.expectedWorkbookId, resolved.sourceWorkbookId);

    const status: RuntimeLinkStatus = {
      linkId,
      requestingDocumentId: scope.requestingDocumentId,
      requestingSessionId: scope.requestingSessionId,
      actor: scope.actor,
      principal: scope.principal,
      sourceSessionId: resolved.sourceSessionId,
      sourceWorkbookId: resolved.sourceWorkbookId,
      status:
        resolved.authorization === 'denied'
          ? 'denied'
          : mismatchedWorkbook
            ? 'broken'
            : resolved.status,
      statusReason:
        resolved.authorization === 'denied'
          ? 'permissionDenied'
          : mismatchedWorkbook
            ? 'wrongWorkbookId'
            : resolved.statusReason,
      lastKnownSourceVersion: resolved.sourceVersion,
      lastResolvedAt: this.now(),
      cachedValuesVersion: record.materializedCacheMetadata?.cachedValuesVersion,
    };
    const key = this.statusKey(linkId, scope);
    this.watches.replace(key, resolved.watch);
    this.setStatus(status);
    return toStatusView(status);
  }

  async refreshAll(
    scope: WorkbookLinkStatusScope,
    options: { readonly concurrency?: number } = {},
  ): Promise<readonly LinkStatusView[]> {
    const records = [...this.records.values()];
    const concurrency = Math.max(1, options.concurrency ?? 4);
    const results = new Array<LinkStatusView>(records.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < records.length) {
        const index = cursor++;
        results[index] = await this.refresh(records[index].linkId, scope);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, worker));
    return results;
  }

  getRuntimeStatus(linkId: LinkId, scope: WorkbookLinkStatusScope): RuntimeLinkStatus | null {
    return this.statuses.get(this.statusKey(linkId, scope)) ?? null;
  }

  watchStatus(
    linkId: LinkId,
    scope: WorkbookLinkStatusScope,
    handler: (status: LinkStatusView) => void,
  ): () => void {
    const key = this.statusKey(linkId, scope);
    const set = this.listeners.get(key) ?? new Set<(status: LinkStatusView) => void>();
    set.add(handler);
    this.listeners.set(key, set);
    handler(this.getStatus(linkId, scope));
    return () => {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  dispose(): void {
    this.records.clear();
    this.statuses.clear();
    this.listeners.clear();
    this.watches.dispose();
  }

  async getUsages(linkId: LinkId): Promise<readonly WorkbookExternalLinkUsageView[]> {
    return this.usages.get(linkId) ?? [];
  }

  async copySource(
    linkId: LinkId,
    scope: WorkbookLinkStatusScope,
  ): Promise<CopyWorkbookLinkSourceResult> {
    const record = this.records.get(linkId);
    if (!record) return { type: 'denied', linkId, deniedReason: 'permissionDenied' };
    if (isUnsupported(record))
      return { type: 'denied', linkId, deniedReason: 'unsupportedLinkKind' };
    if (!hasTrustedCopyScope(scope)) {
      return {
        type: 'denied',
        linkId,
        deniedReason: record.target.kind === 'url' ? 'redacted' : 'permissionDenied',
      };
    }
    return { type: 'copied', linkId, copiedText: rawTargetText(record.target) };
  }

  async listPackageDiagnostics(): Promise<readonly WorkbookExternalPackageArtifactView[]> {
    return this.packageDiagnostics;
  }

  private invalidate(linkId: LinkId): void {
    const keys = [...new Set([...this.statuses.keys(), ...this.listeners.keys()])].filter((key) =>
      key.startsWith(`${linkId}\u001d`),
    );
    for (const key of keys) {
      if (key.startsWith(`${linkId}\u001d`)) this.statuses.delete(key);
      this.listeners.delete(key);
      this.watches.delete(key);
    }
  }

  private setStatus(status: RuntimeLinkStatus): void {
    const key = this.statusKey(status.linkId, status);
    this.statuses.set(key, status);
    const view = toStatusView(status);
    for (const listener of this.listeners.get(key) ?? []) {
      listener(view);
    }
  }

  private statusKey(linkId: LinkId, scope: WorkbookLinkStatusScope): string {
    return `${linkId}\u001d${scopeKey(scope)}`;
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private toView(record: PersistedWorkbookLinkRecord): WorkbookLinkView {
    const status = this.getStatus(record.linkId);
    const denied = status.status === 'denied';
    return {
      linkId: record.linkId,
      displayName: redactDisplayName(record.displayName),
      sourceKind: record.sourceKind,
      targetDisplay: isUnsupported(record)
        ? record.sourceKind === 'dde-link'
          ? 'Unsupported DDE link'
          : 'Unsupported OLE link'
        : targetDisplay(record.target, record.displayName, denied),
      canCopySource: !isUnsupported(record),
      canRefresh: canRefresh(record),
      status,
      usageCount: this.usages.get(record.linkId)?.length ?? 0,
      lastResolvedAt: status.lastResolvedAt,
      hasEverResolved: status.lastResolvedAt !== undefined,
    };
  }
}

function rawTargetText(target: PersistedLinkTarget): string {
  switch (target.kind) {
    case 'path':
      return target.path;
    case 'url':
      return target.url;
    case 'excel-external-path':
      return target.target;
    case 'document-ref':
      return target.documentId;
    case 'open-session':
      return target.sessionId;
    case 'opaque-host-ref':
      return `${target.provider}:${target.ref}`;
  }
}

export function createWorkbookLinkService(
  options?: WorkbookLinkServiceOptions,
): WorkbookLinkService {
  return new WorkbookLinkService(options);
}
