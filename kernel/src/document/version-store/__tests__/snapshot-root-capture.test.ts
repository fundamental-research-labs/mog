import { registerSnapshotRootCaptureObjectRecordScenarios } from './snapshot-root-capture-object-record-scenarios';
import { registerSnapshotRootCapturePayloadScenarios } from './snapshot-root-capture-payload-scenarios';

describe('snapshot root capture payloads', () => {
  registerSnapshotRootCapturePayloadScenarios();
});

describe('snapshot root capture object records', () => {
  registerSnapshotRootCaptureObjectRecordScenarios();
});
