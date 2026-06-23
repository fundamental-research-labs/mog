import {
  captureInput,
  createTestSemanticMutationCapture,
} from './semantic-mutation-capture-test-helpers';

export function createCoreMutationCaptureContext() {
  const capture = createTestSemanticMutationCapture();

  return {
    capture,
    captureCommit() {
      return capture.captureNormalCommit(captureInput());
    },
  };
}

export type CoreMutationCaptureContext = ReturnType<typeof createCoreMutationCaptureContext>;
export type CoreMutationCapture = CoreMutationCaptureContext['capture'];
