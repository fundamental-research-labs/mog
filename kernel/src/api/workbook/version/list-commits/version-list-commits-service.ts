import type {
  VersionPageToken,
  VersionRefSelector,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { isRecord } from './version-list-commits-utils';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedListCommitsOptions = {
  readonly ref?: VersionRefSelector;
  readonly from?: WorkbookCommitId;
  readonly pageSize?: number;
  readonly pageToken?: VersionPageToken;
};

export type AttachedVersionListCommitsService = {
  listCommits?: (options?: AttachedListCommitsOptions) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export function getAttachedListCommitsService(
  ctx: DocumentContext,
): AttachedVersionListCommitsService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.graphStore,
    services.graphService,
    services.graph,
    services.readService,
    services.headService,
    services,
  ]) {
    const readService = toListCommitsService(candidate);
    if (readService) return readService;
  }

  return null;
}

function toListCommitsService(value: unknown): AttachedVersionListCommitsService | null {
  const listCommits = bindMethod(value, 'listCommits');
  return listCommits ? { listCommits: (options) => listCommits(options) } : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
