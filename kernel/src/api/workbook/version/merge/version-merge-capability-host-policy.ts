import type { VersionCapability } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  VERSION_CAPABILITY_KEYS,
  VERSION_MERGE_BROAD_CAPABILITY_ALIASES,
  VERSION_MERGE_NARROW_CAPABILITY_ALIASES,
} from './version-merge-capability-constants';
import { operationAliasCapability } from './version-merge-capability-operations';
import type {
  HostCapabilityDecision,
  HostCapabilityDecisions,
  MaybeVersionRuntimeContext,
} from './version-merge-capability-types';
import { isRecord } from './version-merge-capability-utils';

export function getVersionHostCapabilityDecisions(ctx: DocumentContext): HostCapabilityDecisions {
  const runtime = ctx as MaybeVersionRuntimeContext;
  for (const candidate of [
    runtime.policy,
    runtime.policySnapshot,
    runtime.versionPolicy,
    runtime.hostCapabilityPolicy,
    runtime.hostPolicy,
  ]) {
    const decisions = readHostCapabilityDecisions(candidate);
    if (decisions) return decisions;
  }
  return {};
}

function readHostCapabilityDecisions(value: unknown): HostCapabilityDecisions | null {
  const decisions: HostCapabilityDecisions = {};
  let discovered = false;

  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.decisions)
      ? value.decisions
      : null;
  for (const entry of source ?? []) {
    if (!isRecord(entry)) continue;
    const decision = toHostCapabilityStateDecision(entry);
    if (!decision) continue;

    const capabilities = hostCapabilityEntryCapabilities(entry);
    if (capabilities.length === 0) continue;
    discovered = true;
    for (const capability of capabilities) {
      decisions[capability] = decision;
    }
  }

  if (isRecord(value)) {
    const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
    for (const [capabilityAlias, state] of Object.entries(capabilities ?? {})) {
      const decision = toHostCapabilityStateDecision(state);
      if (!decision) continue;

      const stateCapabilities = capabilitiesForHostAlias(capabilityAlias);
      if (stateCapabilities.length === 0) continue;
      discovered = true;
      for (const capability of stateCapabilities) {
        decisions[capability] = decision;
      }
    }
  }

  return discovered ? decisions : null;
}

function toVersionCapability(value: unknown): VersionCapability | null {
  return typeof value === 'string' && (VERSION_CAPABILITY_KEYS as readonly string[]).includes(value)
    ? (value as VersionCapability)
    : null;
}

function hostCapabilityEntryCapabilities(
  entry: Readonly<Record<string, unknown>>,
): readonly VersionCapability[] {
  const capabilities = new Set<VersionCapability>();
  for (const key of ['capability', 'publicCapability', 'requiredCapability', 'hostCapability']) {
    addHostCapabilityAliases(entry[key], capabilities);
  }
  addHostCapabilityAliases(entry.deniedCapabilities, capabilities);
  for (const key of ['operation', 'method', 'endpoint', 'operationId']) {
    addOperationCapabilityAlias(entry[key], capabilities);
  }
  return [...capabilities];
}

function addHostCapabilityAliases(value: unknown, output: Set<VersionCapability>): void {
  if (Array.isArray(value)) {
    for (const item of value) addHostCapabilityAliases(item, output);
    return;
  }
  if (isRecord(value)) {
    addHostCapabilityAliases(value.capability, output);
    return;
  }
  for (const capability of capabilitiesForHostAlias(value)) {
    output.add(capability);
  }
}

function addOperationCapabilityAlias(value: unknown, output: Set<VersionCapability>): void {
  if (Array.isArray(value)) {
    for (const item of value) addOperationCapabilityAlias(item, output);
    return;
  }
  if (typeof value !== 'string') return;

  const capability = operationAliasCapability(value);
  if (capability) output.add(capability);
}

function capabilitiesForHostAlias(value: unknown): readonly VersionCapability[] {
  const exact = toVersionCapability(value);
  if (exact) return [exact];
  if (typeof value !== 'string') return [];

  if (VERSION_MERGE_BROAD_CAPABILITY_ALIASES.has(value)) {
    return ['version:mergePreview', 'version:mergeApply'];
  }
  const narrowCapability = VERSION_MERGE_NARROW_CAPABILITY_ALIASES[value];
  if (narrowCapability) return [narrowCapability];
  const operationCapability = operationAliasCapability(value);
  if (operationCapability) return [operationCapability];
  return [];
}

function toHostCapabilityStateDecision(value: unknown): HostCapabilityDecision | null {
  const direct = toHostCapabilityDecision(value);
  if (direct) return direct;
  if (typeof value === 'boolean') return value ? 'allowed' : 'denied';
  if (!isRecord(value)) return null;

  const decision =
    toHostCapabilityDecision(value.decision) ?? toHostCapabilityDecision(value.status);
  if (decision) return decision;
  if (typeof value.enabled !== 'boolean') return null;
  if (value.enabled) return 'allowed';
  return value.retryable === true ? 'approval-required' : 'denied';
}

function toHostCapabilityDecision(value: unknown): HostCapabilityDecision | null {
  return value === 'allowed' || value === 'denied' || value === 'approval-required' ? value : null;
}
