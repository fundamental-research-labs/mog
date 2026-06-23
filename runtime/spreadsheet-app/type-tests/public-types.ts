import type {
  MogSpreadsheetAppProps,
  MogSpreadsheetFeaturePolicy,
  SpreadsheetFeatureGateCapabilities,
  SpreadsheetFeatureGateCapability,
  SpreadsheetVersionControlFeatureGateCapability,
} from '../src/public-types';

const versionGate: SpreadsheetVersionControlFeatureGateCapability = 'versionControl.merge';
const builtInGate: SpreadsheetFeatureGateCapability = versionGate;
const customGate: SpreadsheetFeatureGateCapability = 'host.custom-capability';

const typedFeaturePolicy = {
  capabilities: {
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

void typedCapabilities;
void appFeaturePolicy;
void legacyCompatiblePolicy;

// @ts-expect-error Version-control gates expose only the supported public gate keys.
const unsupportedVersionGate: SpreadsheetVersionControlFeatureGateCapability =
  'versionControl.branch';
void unsupportedVersionGate;
