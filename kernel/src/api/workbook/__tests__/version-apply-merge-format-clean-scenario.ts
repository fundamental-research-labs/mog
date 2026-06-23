import {
  applyCleanSameCellFormatMerge,
  expectCleanSameCellFormatPreview,
  expectMergedCleanSameCellFormatWorkbook,
} from './version-apply-merge-format-clean-assertions';
import { createCleanSameCellFormatFixture } from './version-apply-merge-format-clean-helpers';

export function registerCleanSameCellFormatScenario() {
  it('materializes clean same-cell value and direct-format changes', async () => {
    const fixture = await createCleanSameCellFormatFixture();

    try {
      await expectCleanSameCellFormatPreview(fixture);
      const mergeCommitId = await applyCleanSameCellFormatMerge(fixture);
      await expectMergedCleanSameCellFormatWorkbook(fixture, mergeCommitId);
    } finally {
      await fixture.cleanup();
    }
  });
}
