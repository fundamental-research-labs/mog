import {
  expectCapturedCoreCommit,
  expectDateAndTimeValueWriteCapture,
  expectDirectCellEditCapture,
  expectDirectCellEditLifecycleDrainsAfterSuccessfulFinalize,
} from './semantic-mutation-capture-core-assertions';
import {
  recordDateAndTimeValueWriteScenario,
  recordDirectCellEditScenario,
} from './semantic-mutation-capture-core-scenarios';
import { createCoreMutationCaptureContext } from './semantic-mutation-capture-core-setup';

describe('semantic mutation capture', () => {
  it('captures only direct cell edits and drains after successful commit finalization', async () => {
    const context = createCoreMutationCaptureContext();
    recordDirectCellEditScenario(context.capture);

    const first = await expectCapturedCoreCommit(context);
    expectDirectCellEditCapture(first);
    await expectDirectCellEditLifecycleDrainsAfterSuccessfulFinalize(context, first);
  });

  it('captures direct date and time value writes', async () => {
    const context = createCoreMutationCaptureContext();
    recordDateAndTimeValueWriteScenario(context.capture);

    expectDateAndTimeValueWriteCapture(await expectCapturedCoreCommit(context));
  });
});
