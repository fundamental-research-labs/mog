import type {
  FormulaAIService,
  MogSpreadsheetAppProps,
  MogSpreadsheetFeaturePolicy,
  SpreadsheetFeatureGateCapabilities,
  SpreadsheetFeatureGateCapability,
  SpreadsheetRuntimeOptions,
  SpreadsheetVersionControlFeatureGateCapability,
} from '../src/public-types';

const versionGate: SpreadsheetVersionControlFeatureGateCapability = 'versionControl.merge';
const builtInGate: SpreadsheetFeatureGateCapability = versionGate;
const customGate: SpreadsheetFeatureGateCapability = 'host.custom-capability';

const typedFeaturePolicy = {
  capabilities: {
    formulaAI: true,
    versionControl: false,
    versionControlMerge: false,
    'versionControl.merge': false,
    [customGate]: true,
  },
} satisfies MogSpreadsheetFeaturePolicy;

const typedCapabilities: SpreadsheetFeatureGateCapabilities = typedFeaturePolicy.capabilities;
const appFeaturePolicy: NonNullable<MogSpreadsheetAppProps['featurePolicy']> = typedFeaturePolicy;
const legacyCapabilities: Record<string, boolean> = { [builtInGate]: false, custom: true };
const legacyCompatiblePolicy: MogSpreadsheetFeaturePolicy = { capabilities: legacyCapabilities };
const formulaAI: FormulaAIService = {
  explainFormula(request) {
    request.formula satisfies string;
    return { explanation: 'This formula adds the selected values.' };
  },
};
const runtimeOptions = {
  services: { formulaAI },
} satisfies SpreadsheetRuntimeOptions;

void typedCapabilities;
void appFeaturePolicy;
void legacyCompatiblePolicy;
void runtimeOptions;

// @ts-expect-error Version-control gates expose only the supported public gate keys.
const unsupportedVersionGate: SpreadsheetVersionControlFeatureGateCapability =
  'versionControl.branch';
void unsupportedVersionGate;
