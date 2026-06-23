import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';
import type { VersionDomainCapabilityKey } from '@mog-sdk/contracts/versioning';

export type PublicGateOperation =
  | 'commit'
  | 'diff'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'review'
  | 'reviewAccess'
  | 'export'
  | 'import'
  | 'revert'
  | 'undo'
  | 'redo';

export const PUBLIC_GATE_CAPABILITY_CASES = [
  { operation: 'commit', capabilityKeys: ['capture', 'persistence'] },
  { operation: 'diff', capabilityKeys: ['diff'] },
  { operation: 'checkout', capabilityKeys: ['checkout'] },
  { operation: 'merge', capabilityKeys: ['merge'] },
  { operation: 'applyMerge', capabilityKeys: ['merge', 'persistence'] },
  { operation: 'review', capabilityKeys: ['reviewAccess'] },
  { operation: 'reviewAccess', capabilityKeys: ['reviewAccess'] },
  { operation: 'export', capabilityKeys: ['export'] },
  { operation: 'import', capabilityKeys: ['import'] },
  { operation: 'revert', capabilityKeys: ['replay', 'persistence'] },
  { operation: 'undo', capabilityKeys: ['replay'] },
  { operation: 'redo', capabilityKeys: ['replay'] },
] as const satisfies readonly {
  readonly operation: PublicGateOperation;
  readonly capabilityKeys: readonly VersionDomainCapabilityKey[];
}[];

export const PUBLIC_PARTIAL_SUPPORT_SUPPORTED_OPERATIONS = [
  'commit',
  'checkout',
  'merge',
  'applyMerge',
  'export',
  'revert',
  'undo',
  'redo',
] as const;

export const PUBLIC_PARTIAL_SUPPORT_BLOCKED_OPERATIONS = [
  { operation: 'diff', capabilityKey: 'diff' },
  { operation: 'review', capabilityKey: 'reviewAccess' },
  { operation: 'reviewAccess', capabilityKey: 'reviewAccess' },
  { operation: 'import', capabilityKey: 'import' },
] as const satisfies readonly {
  readonly operation: 'diff' | 'review' | 'reviewAccess' | 'import';
  readonly capabilityKey: VersionDomainCapabilityKey;
}[];

export function capabilityStateBlocks(
  diagnostics: readonly VersionStoreDiagnostic[],
): readonly VersionStoreDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.issueCode === 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID' &&
      diagnostic.payload.diagnosticCode === 'capability-state-blocked',
  );
}
