/**
 * WorkbookSecurityImpl -- Thin forwarder over the Rust wb_security_* flat
 * bridge methods.
 *
 * All policy/evaluator/attenuation logic lives in Rust
 * (compute-security + compute-core storage). This class only reshapes
 * arguments to match the `WorkbookSecurity` contract and forwards through
 * `ctx.computeBridge`.
 *
 * The bridge is async across the board — the WorkbookSecurity contract
 * is async to match.
 */
import type { WorkbookSecurity } from '@mog-sdk/contracts/api';
import type {
  AccessExplanation,
  AccessLevel,
  AccessPolicy,
  AccessPrincipal,
  AccessTarget,
  PolicyId,
} from '@mog-sdk/contracts/security';

import type { DocumentContext } from '../../context';

/**
 * `applyTemplate(templateId, options)` maps to the Rust tagged-enum
 * `Template` wire format by merging the options dict into a `{ kind, ... }`
 * payload. The variant shapes are owned by compute-security.
 */
function buildTemplatePayload(
  templateId: string,
  options: Record<string, unknown>,
): Record<string, unknown> {
  return { kind: templateId, ...options };
}

export class WorkbookSecurityImpl implements WorkbookSecurity {
  constructor(private readonly ctx: DocumentContext) {}

  addPolicy(policy: Omit<AccessPolicy, 'id'>): Promise<PolicyId> {
    // Rust generates a PolicyId from the incoming AccessPolicy shape, but
    // the serde contract requires the field to be present — we mint one
    // client-side and let the Rust side reuse it verbatim.
    const fullPolicy: AccessPolicy = { id: generatePolicyId(), ...policy };
    return this.ctx.computeBridge.wbSecurityAddPolicy(fullPolicy);
  }

  removePolicy(id: PolicyId): Promise<void> {
    return this.ctx.computeBridge.wbSecurityRemovePolicy(id);
  }

  updatePolicy(id: PolicyId, updates: Partial<Omit<AccessPolicy, 'id'>>): Promise<void> {
    return this.ctx.computeBridge.wbSecurityUpdatePolicy(id, updates);
  }

  getPolicies(): Promise<AccessPolicy[]> {
    return this.ctx.computeBridge.wbSecurityListPolicies();
  }

  getEffectiveAccess(principal: AccessPrincipal, target: AccessTarget): Promise<AccessLevel> {
    // The bridge returns a plain `string` because the Rust serde emits a
    // lowercase variant name; we cast to the narrow `AccessLevel` union
    // here rather than threading a bridge-side branded type through.
    return this.ctx.computeBridge.wbSecurityEffectiveAccess(
      target,
      principal,
    ) as Promise<AccessLevel>;
  }

  explainAccess(principal: AccessPrincipal, target: AccessTarget): Promise<AccessExplanation> {
    return this.ctx.computeBridge.wbSecurityExplainAccess(target, principal);
  }

  applyTemplate(templateId: string, options: Record<string, unknown>): Promise<PolicyId[]> {
    return this.ctx.computeBridge.wbSecurityApplyTemplate(
      buildTemplatePayload(templateId, options),
    );
  }

  removeTemplate(templateId: string): Promise<void> {
    return this.ctx.computeBridge.wbSecurityRemoveTemplate(templateId);
  }
}

// UUID v4 generator sufficient for PolicyId — the Rust serde wrapper accepts
// any parseable UUID string. Node and browsers both expose crypto.randomUUID.
function generatePolicyId(): PolicyId {
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  const raw = hasCrypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return raw as PolicyId;
}
