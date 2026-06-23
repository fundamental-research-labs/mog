import { registerSelectorCursorScenarios } from './version-diff-selector-cursor-scenarios';
import { registerSelectorPageScenarios } from './version-diff-selector-page-scenarios';
import { registerSelectorRefScenarios } from './version-diff-selector-ref-scenarios';
import { registerSelectorRedactionScenarios } from './version-diff-selector-redaction-scenarios';

describe('WorkbookVersion diff ref selectors', () => {
  registerSelectorRefScenarios();
  registerSelectorCursorScenarios();
  registerSelectorRedactionScenarios();
  registerSelectorPageScenarios();
});
