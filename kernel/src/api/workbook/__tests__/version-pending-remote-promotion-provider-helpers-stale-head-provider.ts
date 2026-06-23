import type {
  VersionGraphNamespace,
  VersionGraphStore,
  createInMemoryVersionStoreProvider,
} from '../../../document/version-store/provider';
import { VERSION_AUTHOR } from './version-pending-remote-promotion-provider-helpers-constants';
import { expectReadHeadSuccess } from './version-pending-remote-promotion-provider-helpers-expectations';
import { objectRecord } from './version-pending-remote-promotion-provider-helpers-graph-fixtures';

type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export function providerWithStaleHeadCommit(
  provider: InMemoryProvider,
  namespace: VersionGraphNamespace,
) {
  return new Proxy(provider, {
    get(target, property) {
      if (property === 'openGraph') {
        return async (...args: Parameters<InMemoryProvider['openGraph']>) =>
          graphWithStaleHeadCommit(await target.openGraph(...args), namespace);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as InMemoryProvider;
}

function graphWithStaleHeadCommit(graph: VersionGraphStore, namespace: VersionGraphNamespace) {
  let advanced = false;
  return new Proxy(graph, {
    get(target, property) {
      if (property === 'commit') {
        return async (input: Parameters<VersionGraphStore['commit']>[0]) => {
          if (!advanced) {
            advanced = true;
            await advanceHeadForStalePromotion(target, namespace);
          }
          return target.commit(input);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as VersionGraphStore;
}

async function advanceHeadForStalePromotion(
  graph: VersionGraphStore,
  namespace: VersionGraphNamespace,
) {
  const head = await expectReadHeadSuccess(graph);
  await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'stale-head',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      label: 'stale-head',
      changes: [],
    }),
    author: VERSION_AUTHOR,
    createdAt: '2026-06-21T00:00:09.000Z',
    completenessDiagnostics: [],
    expectedHeadCommitId: head.commitId,
    expectedTargetRefVersion: head.revision,
    parentCommitIds: [head.commitId],
  });
}
