import type { DocumentContext } from '../../../../context';
import type { DomainSupportManifestValidationOptions } from '../../../../document/version-store/domain-support-manifest-validator';
import {
  bindMethod,
  isRecord,
  type AttachedDomainSupportManifestGate,
  type MaybeDomainSupportManifestContext,
  type MaybePromise,
} from './version-domain-support-gate-types';

export function getAttachedDomainSupportManifestGate(
  ctx: DocumentContext,
): AttachedDomainSupportManifestGate | null {
  const runtime = ctx as MaybeDomainSupportManifestContext;
  for (const candidate of [runtime.versioning, runtime.versionStore, runtime.version, ctx]) {
    const gate = gateFromRecord(candidate);
    if (gate) return gate;
  }
  return null;
}

function gateFromRecord(value: unknown): AttachedDomainSupportManifestGate | null {
  if (!isRecord(value)) return null;

  const hasManifestSource = Object.prototype.hasOwnProperty.call(value, 'domainSupportManifest');
  const readManifest =
    bindManifestReader(value, 'readDomainSupportManifest') ??
    bindManifestReader(value, 'getDomainSupportManifest');
  const required = value.requireDomainSupportManifest === true;

  if (!hasManifestSource && !readManifest && !required) return null;

  return {
    hasManifestSource,
    manifest: value.domainSupportManifest,
    ...(readManifest ? { readManifest } : {}),
    ...(isRecord(value.domainSupportManifestOptions)
      ? { options: value.domainSupportManifestOptions as DomainSupportManifestValidationOptions }
      : {}),
  };
}

function bindManifestReader(
  value: Readonly<Record<string, unknown>>,
  name: string,
): (() => MaybePromise<unknown>) | null {
  const method = bindMethod(value, name);
  return method ? () => method() : null;
}
