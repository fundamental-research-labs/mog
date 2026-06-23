import type { GeneratedBridgeMethods } from '../../bridges/compute/compute-bridge.gen';
import type {
  SemanticChange,
  SemanticObjectKind,
  SemanticWorkbookDiff,
  SemanticWorkbookState,
  SemanticWorkbookStateEnvelope,
} from '../../bridges/compute/compute-types.gen';

export type VersionSemanticStateReaderPort = {
  readCurrentSemanticState(): Promise<SemanticWorkbookStateEnvelope>;
  diffSemanticStates(
    before: SemanticWorkbookState,
    after: SemanticWorkbookState,
  ): Promise<SemanticWorkbookDiff>;
};

type ComputeSemanticBridge = Pick<
  GeneratedBridgeMethods,
  'semanticWorkbookStateEnvelope' | 'diffSemanticWorkbookStates'
>;

export type VersionSemanticObjectRecordEvidence = {
  readonly objectId: string;
  readonly objectKind: SemanticObjectKind;
  readonly domainId: string;
  readonly record: unknown;
};

export type VersionSemanticChangeWithRecordEvidence = SemanticChange & {
  readonly beforeRecord?: VersionSemanticObjectRecordEvidence;
  readonly afterRecord?: VersionSemanticObjectRecordEvidence;
};

export type VersionSemanticWorkbookDiffWithRecordEvidence = Omit<
  SemanticWorkbookDiff,
  'changes'
> & {
  readonly changes: VersionSemanticChangeWithRecordEvidence[];
};

export function createComputeBridgeSemanticStateReader(
  bridge: ComputeSemanticBridge,
): VersionSemanticStateReaderPort {
  return {
    readCurrentSemanticState: () => bridge.semanticWorkbookStateEnvelope(),
    diffSemanticStates: async (before, after) =>
      withSemanticRecordEvidence(
        before,
        after,
        await bridge.diffSemanticWorkbookStates(before, after),
      ),
  };
}

function withSemanticRecordEvidence(
  before: SemanticWorkbookState,
  after: SemanticWorkbookState,
  diff: SemanticWorkbookDiff,
): VersionSemanticWorkbookDiffWithRecordEvidence {
  return {
    ...diff,
    changes: diff.changes.map((change) => ({
      ...change,
      ...recordEvidence('beforeRecord', before, change),
      ...recordEvidence('afterRecord', after, change),
    })),
  };
}

function recordEvidence(
  key: 'beforeRecord' | 'afterRecord',
  state: SemanticWorkbookState,
  change: SemanticChange,
): Partial<Pick<VersionSemanticChangeWithRecordEvidence, typeof key>> {
  const record = semanticObjectRecord(state, change);
  return record ? { [key]: record } : {};
}

function semanticObjectRecord(
  state: SemanticWorkbookState,
  change: SemanticChange,
): VersionSemanticObjectRecordEvidence | undefined {
  const record = semanticObjectRecordValue(state, change);
  return record === undefined
    ? undefined
    : {
        objectId: change.objectId,
        objectKind: change.objectKind,
        domainId: change.domainId,
        record,
      };
}

function semanticObjectRecordValue(state: SemanticWorkbookState, change: SemanticChange): unknown {
  if (change.domainId === 'cells.formulas' && change.objectKind === 'cell-formula') {
    const cell = semanticCellRecord(state, stripObjectPrefix(change.objectId, 'formula:'));
    return cell?.formula;
  }
  if (change.domainId === 'cells.values' && change.objectKind === 'cell') {
    return semanticCellRecord(state, change.objectId);
  }
  if (change.domainId === 'cells.values' && change.objectKind === 'cell-value') {
    return semanticCellRecord(state, stripObjectPrefix(change.objectId, 'value:'))?.value;
  }
  return undefined;
}

function semanticCellRecord(state: SemanticWorkbookState, cellObjectId: string) {
  for (const sheet of Object.values(state.sheets)) {
    const cell = sheet.cells[cellObjectId];
    if (cell) return cell;
  }
  return undefined;
}

function stripObjectPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
