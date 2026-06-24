import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommitId } from '../object-digest';
import type { RefName } from './ref-name';
import { diagnostic } from './ref-store-diagnostics';
import { parseCanonicalRefName } from './ref-store-ref-names';
import {
  RefStoreValidationError,
  cloneLiveRefRecord,
  cloneTombstoneRefRecord,
  copyAuthor,
  freezeLiveRefRecord,
  freezeProviderEpoch,
  freezeRefVersion,
} from './ref-store-revisions';
import {
  normalizeLiveRefRecordTimestamps,
  normalizeRfc3339Milliseconds,
  normalizeTombstoneRefRecordTimestamp,
} from './ref-store-timestamps';
import type {
  InMemoryRefStoreOptions,
  LiveRefRecord,
  ProviderEpoch,
  RefRecord,
  RefVersion,
} from './ref-store-types';

export interface InMemoryRefStoreState {
  readonly records: Map<string, RefRecord>;
  readonly versionDocumentId: string;
  readonly nowFn: () => Date | string;
  nextGeneratedId: number;
  // In-memory summary-row equivalent; durable backends need equivalent CAS before enabling delete.
  liveRefCount: number;
}

export function createInMemoryRefStoreState(
  options: InMemoryRefStoreOptions,
): InMemoryRefStoreState {
  const state: InMemoryRefStoreState = {
    records: new Map<string, RefRecord>(),
    versionDocumentId: options.versionDocumentId,
    nowFn: options.now ?? (() => new Date()),
    nextGeneratedId: 0,
    liveRefCount: 0,
  };

  if (options.snapshot) {
    hydrateInMemoryRefStoreSnapshot(state, options.snapshot.records);
    state.liveRefCount = [...state.records.values()].filter(
      (record) => record.state === 'live',
    ).length;
    state.nextGeneratedId = options.snapshot.nextGeneratedId;
  }

  return state;
}

export function createLiveMemoryRef(
  state: InMemoryRefStoreState,
  input: {
    readonly name: RefName;
    readonly targetCommitId: WorkbookCommitId;
    readonly baseCommitId?: WorkbookCommitId;
    readonly protected: boolean;
    readonly author: VersionAuthor;
    readonly providerEpoch?: ProviderEpoch;
    readonly refVersion?: RefVersion;
  },
): LiveRefRecord {
  const now = currentMemoryRefStoreTime(state);
  return freezeLiveRefRecord({
    state: 'live',
    schemaVersion: 1,
    versionDocumentId: state.versionDocumentId,
    name: input.name,
    kind: 'branch',
    targetCommitId: input.targetCommitId,
    baseCommitId: input.baseCommitId,
    providerRefId: generateMemoryRefId(state, 'provider-ref'),
    providerEpoch: input.providerEpoch ?? freezeProviderEpoch({ kind: 'counter', value: '0' }),
    refIncarnationId: generateMemoryRefId(state, 'ref-incarnation'),
    protected: input.protected,
    createdAt: now,
    createdBy: copyAuthor(input.author),
    updatedAt: now,
    updatedBy: copyAuthor(input.author),
    refVersion: input.refVersion ?? freezeRefVersion({ kind: 'counter', value: '0' }),
  });
}

export function currentMemoryRefStoreTime(state: InMemoryRefStoreState): string {
  return normalizeRfc3339Milliseconds(state.nowFn(), 'now');
}

function hydrateInMemoryRefStoreSnapshot(
  state: InMemoryRefStoreState,
  records: readonly RefRecord[],
): void {
  for (const record of records) {
    const parsedName = parseCanonicalRefName(record.name);
    if (!parsedName.ok) {
      throw new RefStoreValidationError(
        'invalidRefName',
        'Invalid ref name in snapshot.',
        parsedName.diagnostics,
      );
    }
    if (record.versionDocumentId !== state.versionDocumentId) {
      throw new RefStoreValidationError('invalidRefName', 'Ref snapshot document mismatch.', [
        diagnostic('invalidRefName', 'Ref snapshot document mismatch.'),
      ]);
    }
    const normalizedRecord =
      record.state === 'live'
        ? normalizeLiveRefRecordTimestamps({ ...record, name: parsedName.name })
        : normalizeTombstoneRefRecordTimestamp({ ...record, name: parsedName.name });
    state.records.set(
      parsedName.name,
      normalizedRecord.state === 'live'
        ? cloneLiveRefRecord(normalizedRecord)
        : cloneTombstoneRefRecord(normalizedRecord),
    );
  }
}

function generateMemoryRefId(state: InMemoryRefStoreState, prefix: string): string {
  state.nextGeneratedId += 1;
  return `${prefix}:${state.versionDocumentId}:${state.nextGeneratedId}`;
}
