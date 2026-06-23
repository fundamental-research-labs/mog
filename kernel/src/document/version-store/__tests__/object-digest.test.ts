import { registerCanonicalizeVersionDependenciesTests } from './object-digest-dependency-scenarios';
import { registerObjectDigestGrammarTests } from './object-digest-object-grammar-scenarios';
import { registerWorkbookCommitIdGrammarTests } from './object-digest-workbook-commit-id-scenarios';

describe('version object digest grammar', () => {
  registerObjectDigestGrammarTests();
});

describe('workbook commit id grammar', () => {
  registerWorkbookCommitIdGrammarTests();
});

describe('canonicalizeVersionDependencies', () => {
  registerCanonicalizeVersionDependenciesTests();
});
