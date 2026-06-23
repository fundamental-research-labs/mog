import { describeSheetMetadataScenarios } from './semantic-mutation-capture-sheets-metadata-scenarios';
import { describeSheetStructuralScenarios } from './semantic-mutation-capture-sheets-structural-scenarios';

describe('semantic mutation capture sheet receipts', () => {
  describeSheetMetadataScenarios();
  describeSheetStructuralScenarios();
});
