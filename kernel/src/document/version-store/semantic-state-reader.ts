import type { GeneratedBridgeMethods } from '../../bridges/compute/compute-bridge.gen';
import type {
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

export function createComputeBridgeSemanticStateReader(
  bridge: ComputeSemanticBridge,
): VersionSemanticStateReaderPort {
  return {
    readCurrentSemanticState: () => bridge.semanticWorkbookStateEnvelope(),
    diffSemanticStates: (before, after) => bridge.diffSemanticWorkbookStates(before, after),
  };
}
