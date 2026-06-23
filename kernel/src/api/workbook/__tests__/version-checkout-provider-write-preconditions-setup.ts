import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  createVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from '../../../document/version-store/provider-write-activity';
import {
  DOCUMENT_SCOPE,
  createWorkbook,
  expectInitializeSuccess,
  initializeInput,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
} from './version-checkout-test-utils';

type HeldProviderWriteActivity = {
  readonly providerWriteActivityTracker: VersionProviderWriteActivityTracker;
  readonly release: () => void;
  readonly done: Promise<void>;
};

type ProviderWritePreconditionProvider = Awaited<
  ReturnType<typeof createInitializedProviderWritePreconditionProvider>
>;

export function createProviderWritePreconditionWorkbook(
  provider: ProviderWritePreconditionProvider,
  options: {
    readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
  } = {},
) {
  return createWorkbook({
    versioning: {
      provider,
      ...options,
    },
  });
}

export async function createWorkbookWithPendingRemoteSegment(graphId: string) {
  const provider = await createInitializedProviderWritePreconditionProvider(graphId);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const graph = await provider.openGraph(namespace);
  const store = await provider.openPendingRemoteSegmentStore(namespace);
  const fixture = await pendingSegmentFixture(namespace);
  await persistAndReservePendingSegment(graph, store, fixture);

  return createWorkbook({ versioning: { provider } });
}

export function startHeldRemoteSyncApplyActivity(): HeldProviderWriteActivity {
  const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = providerWriteActivityTracker.trackRemoteSyncApply(async () => hold);

  return {
    providerWriteActivityTracker,
    release,
    done,
  };
}

export async function startHeldPendingRemotePromotionActivity(): Promise<HeldProviderWriteActivity> {
  const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
  let release!: () => void;
  let markStarted!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const done = providerWriteActivityTracker.runExclusivePendingRemotePromotion(async () => {
    markStarted();
    await hold;
  });
  await started;

  return {
    providerWriteActivityTracker,
    release,
    done,
  };
}

export async function createInitializedProviderWritePreconditionProvider(graphId: string) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, 'root'));
  expectInitializeSuccess(initialized);
  return provider;
}
