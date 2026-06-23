import { registerSemanticMutationCaptureFilterAndSortReceiptTests } from './semantic-mutation-capture-receipts-filter-sort-scenarios';
import { registerSemanticMutationCaptureIdentityReceiptTests } from './semantic-mutation-capture-receipts-identity-scenarios';
import { registerSemanticMutationCaptureMetadataReceiptTests } from './semantic-mutation-capture-receipts-metadata-scenarios';
import { registerSemanticMutationCaptureObjectReceiptTests } from './semantic-mutation-capture-receipts-object-scenarios';
import { registerSemanticMutationCaptureStructureReceiptTests } from './semantic-mutation-capture-receipts-structure-scenarios';

describe('semantic mutation capture domain receipts', () => {
  registerSemanticMutationCaptureFilterAndSortReceiptTests();
  registerSemanticMutationCaptureIdentityReceiptTests();
  registerSemanticMutationCaptureStructureReceiptTests();
  registerSemanticMutationCaptureMetadataReceiptTests();
  registerSemanticMutationCaptureObjectReceiptTests();
});
