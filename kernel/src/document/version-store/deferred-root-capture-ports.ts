import type { VersionSemanticStateReaderPort } from './semantic-state-reader';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';

export function deferVersionRootCapturePorts(input: {
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly waitForReadiness: () => Promise<void>;
}): {
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
} {
  return {
    snapshotRootByteSyncPort: {
      async encodeDiff(remoteStateVector) {
        await input.waitForReadiness();
        return input.snapshotRootByteSyncPort.encodeDiff(remoteStateVector);
      },
    },
    semanticStateReader: {
      async readCurrentSemanticState() {
        await input.waitForReadiness();
        return input.semanticStateReader.readCurrentSemanticState();
      },
      diffSemanticStates: (before, after) =>
        input.semanticStateReader.diffSemanticStates(before, after),
    },
  };
}
