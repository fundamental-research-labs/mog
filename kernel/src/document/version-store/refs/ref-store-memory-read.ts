import type { RefName } from './ref-name';
import { failure } from './ref-store-diagnostics';
import { compareLiveRefs, compareTombstoneRefs } from './ref-store-ordering';
import { matchesRefNamePrefix, parseCanonicalRefPrefix } from './ref-store-ref-names';
import { cloneLiveRefRecord, cloneTombstoneRefRecord } from './ref-store-revisions';
import { refTombstoned } from './ref-store-tombstones';
import type {
  GetRefOptions,
  GetRefResult,
  GetRefWithTombstoneOptions,
  GetRefWithTombstoneResult,
  ListRefsInput,
  ListRefsResult,
  LiveRefRecord,
  TombstoneRefRecord,
} from './ref-store-types';
import { parseRefNameForResult } from './ref-store-validation';
import type { InMemoryRefStoreState } from './ref-store-memory-state';

export function getMemoryRef(
  state: InMemoryRefStoreState,
  name: RefName | string,
  options: GetRefOptions | GetRefWithTombstoneOptions = {},
): GetRefResult | GetRefWithTombstoneResult {
  const parsedName = parseRefNameForResult(name);
  if (!parsedName.ok) return parsedName.result;

  const record = state.records.get(parsedName.name);
  if (record === undefined) {
    if (options.includeTombstone === true) {
      return { ok: true, includeTombstone: true, ref: null, diagnostics: [] };
    }
    return { ok: true, ref: null, diagnostics: [] };
  }
  if (record.state === 'tombstone') {
    if (options.includeTombstone === true) {
      return {
        ok: true,
        includeTombstone: true,
        ref: cloneTombstoneRefRecord(record),
        diagnostics: [],
      };
    }
    return refTombstoned(record);
  }
  if (options.includeTombstone === true) {
    return {
      ok: true,
      includeTombstone: true,
      ref: cloneLiveRefRecord(record),
      diagnostics: [],
    };
  }
  return { ok: true, ref: cloneLiveRefRecord(record), diagnostics: [] };
}

export function listMemoryRefs(
  state: InMemoryRefStoreState,
  input: ListRefsInput = {},
): ListRefsResult {
  const parsedPrefix =
    input.prefix === undefined ? undefined : parseCanonicalRefPrefix(String(input.prefix));
  if (parsedPrefix?.ok === false) {
    const diagnostics = parsedPrefix.diagnostics;
    return failure('invalidRefPrefix', 'Invalid ref prefix.', diagnostics);
  }
  const prefix = parsedPrefix?.prefix;

  const liveRefs = [...state.records.values()]
    .filter((record): record is LiveRefRecord => record.state === 'live')
    .filter((record) => matchesRefNamePrefix(record.name, prefix))
    .sort(compareLiveRefs)
    .map(cloneLiveRefRecord);

  if (input.includeTombstones !== true) {
    return {
      ok: true,
      includeTombstones: false,
      refs: liveRefs,
      diagnostics: [],
    };
  }

  const tombstones = [...state.records.values()]
    .filter((record): record is TombstoneRefRecord => record.state === 'tombstone')
    .filter((record) => matchesRefNamePrefix(record.name, prefix))
    .sort(compareTombstoneRefs)
    .map(cloneTombstoneRefRecord);

  return {
    ok: true,
    includeTombstones: true,
    refs: [...liveRefs, ...tombstones],
    diagnostics: [],
  };
}
