import type { DocumentContext } from '../../../../context';
import type {
  MaybeVersionRuntimeContext,
  VersionSurfaceOperationFeatureGates,
} from './version-surface-status-derivation-types';
import { isRecord, readBoolean } from './version-surface-status-derivation-utils';

export function getVersionSurfaceOperationFeatureGates(
  ctx: DocumentContext,
): VersionSurfaceOperationFeatureGates {
  const runtime = ctx as MaybeVersionRuntimeContext;
  let checkout: boolean | undefined;
  let revert: boolean | undefined;
  for (const candidate of [runtime.featureGates, runtime.hostFeatureGates, runtime.gates]) {
    checkout ??= readOperationFeatureGate(candidate, 'checkout');
    revert ??= readOperationFeatureGate(candidate, 'revert');
  }
  return {
    checkoutEnabled: checkout ?? true,
    checkoutDiscovered: checkout !== undefined,
    revertEnabled: revert ?? true,
    revertDiscovered: revert !== undefined,
  };
}

function readOperationFeatureGate(
  value: unknown,
  operation: 'checkout' | 'revert',
): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const pascal = operation[0].toUpperCase() + operation.slice(1);
  const keys = [`versionControl${pascal}`, `versionControl.${operation}`];
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  const capabilityGate = readBoolean(capabilities, keys);
  if (capabilityGate !== undefined) return capabilityGate;
  const directGate = readBoolean(value, keys);
  if (directGate !== undefined) return directGate;
  const versionControl = isRecord(value.versionControl) ? value.versionControl : null;
  const nestedVersionGate = readBoolean(versionControl, [operation, `${operation}Enabled`]);
  if (nestedVersionGate !== undefined) return nestedVersionGate;
  const operationGate = isRecord(value[operation]) ? value[operation] : null;
  const nestedOperationGate = readBoolean(operationGate, ['enabled']);
  if (nestedOperationGate !== undefined) return nestedOperationGate;
  const disabled = readBoolean(value, [`versionControl${pascal}Disabled`]);
  return disabled === undefined ? undefined : !disabled;
}
