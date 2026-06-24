import type {
  VersionCheckoutOptions,
  VersionCheckoutResult,
  VersionCheckoutTarget,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  clearPersistedActiveCheckoutMaterialization,
  updatePersistedActiveCheckoutMaterializationAfterCheckout,
} from './version/active-checkout/version-active-checkout-persistence';
import {
  readVersionCheckoutAdmissionState,
  revalidateVersionCheckoutAdmissionLease,
} from './version/checkout/version-checkout-admission';
import {
  checkoutAdmissionDiagnostic,
  degradedCheckout,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version/checkout/version-checkout-diagnostic-factories';
import {
  isMaterializerUnavailableResult,
  mapCheckoutResult,
} from './version/checkout/version-checkout-result-mapping';
import { getAttachedCheckoutMaterializationService } from './version/checkout/version-checkout-service';
import {
  validateCheckoutOptions,
  validateCheckoutTarget,
} from './version/checkout/version-checkout-validation';
import { validateVersionDomainSupportManifestGate } from './version/domain-support/version-domain-support-gate';
import { validateVersionOperationGate } from './version-operation-gate';

export {
  checkoutDirtyWorkingStateDiagnostic,
  checkoutWriteFenceStaleDiagnostic,
  checkoutWriteFenceUnavailableDiagnostic,
} from './version/checkout/version-checkout-diagnostic-factories';
export { hasAttachedVersionCheckoutService } from './version/checkout/version-checkout-service';

export type VersionCheckoutTransactionToken = object;

export type VersionCheckoutTransactionBeginResult =
  | {
      readonly ok: true;
      readonly token: VersionCheckoutTransactionToken;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export interface VersionCheckoutTransactionGuard {
  beginCheckoutTransaction(): VersionCheckoutTransactionBeginResult;
  endCheckoutTransaction(token: VersionCheckoutTransactionToken): void;
}

export async function checkoutWorkbookVersion(
  ctx: DocumentContext,
  target: VersionCheckoutTarget,
  options: VersionCheckoutOptions = {},
  transactionGuard?: VersionCheckoutTransactionGuard,
): Promise<VersionCheckoutResult> {
  const optionDiagnostics = validateCheckoutOptions(options);
  if (optionDiagnostics.length > 0) {
    return degradedCheckout(optionDiagnostics);
  }

  const parsed = validateCheckoutTarget(target);
  if (!parsed.ok) {
    return degradedCheckout(parsed.diagnostics);
  }

  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'checkout',
    'version:checkout',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedCheckout(operationGateDiagnostics);
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'checkout');
  if (gateDiagnostics.length > 0) {
    return degradedCheckout(gateDiagnostics);
  }

  const service = getAttachedCheckoutMaterializationService(ctx);
  if (!service?.planCheckout && !service?.checkout) {
    return degradedCheckout([serviceUnavailableDiagnostic(parsed.payload)]);
  }

  const admission = await readVersionCheckoutAdmissionState(ctx);
  if (admission.block) {
    return degradedCheckout([checkoutAdmissionDiagnostic(admission.block, parsed.payload)]);
  }

  const transaction = transactionGuard?.beginCheckoutTransaction();
  if (transaction && !transaction.ok) {
    return degradedCheckout(transaction.diagnostics);
  }
  const token = transaction?.token ?? null;
  const fencedBlock = await revalidateVersionCheckoutAdmissionLease(ctx, admission.lease);
  if (fencedBlock) {
    if (token) transactionGuard?.endCheckoutTransaction(token);
    return degradedCheckout([checkoutAdmissionDiagnostic(fencedBlock, parsed.payload)]);
  }

  let materializationAttempted = false;
  try {
    const planCheckout = service.planCheckout;
    if (service.checkout) {
      materializationAttempted = true;
      const checkoutResult = await service.checkout(parsed.request);
      if (!isMaterializerUnavailableResult(checkoutResult) || !planCheckout) {
        const result = mapCheckoutResult(checkoutResult, parsed.payload);
        await updatePersistedActiveCheckoutMaterializationAfterCheckout(ctx, result, {
          materializationAttempted,
        });
        return result;
      }
      materializationAttempted = false;
    }
    if (!planCheckout) {
      return degradedCheckout([serviceUnavailableDiagnostic(parsed.payload)]);
    }
    return mapCheckoutResult(await planCheckout(parsed.request), parsed.payload);
  } catch {
    if (materializationAttempted) {
      await clearPersistedActiveCheckoutMaterialization(ctx);
    }
    return degradedCheckout([providerErrorDiagnostic(parsed.payload)]);
  } finally {
    if (token) transactionGuard?.endCheckoutTransaction(token);
  }
}
