import { REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS } from './domain-support-manifest-validator-constants';
import type {
  DomainSupportManifestDiagnostic,
  DomainSupportManifestValidationOptions,
} from './domain-support-manifest-validator-types';

export function validateRequiredCoverage(
  seenMatrixRows: ReadonlySet<string>,
  seenDomains: ReadonlySet<string>,
  options: DomainSupportManifestValidationOptions,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  // --- required first-slice matrix row coverage ---------------------------
  const requiredMatrixRows = options.requiredMatrixRowIds ?? REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS;
  for (const matrixRowId of requiredMatrixRows) {
    if (!seenMatrixRows.has(matrixRowId)) {
      diagnostics.push({
        code: 'required-matrix-row-missing',
        message: `Required first-slice matrix row "${matrixRowId}" is absent from the manifest.`,
        matrixRowId,
      });
    }
  }

  if (options.requiredDomainIds) {
    for (const requiredId of options.requiredDomainIds) {
      if (!seenDomains.has(requiredId)) {
        diagnostics.push({
          code: 'required-domain-missing',
          message: `Required domain "${requiredId}" is absent from the manifest.`,
          domainId: requiredId,
        });
      }
    }
  }
}

export function validateDetectorCoverage(
  seenMatrixRows: ReadonlySet<string>,
  seenDomains: ReadonlySet<string>,
  options: DomainSupportManifestValidationOptions,
  diagnostics: DomainSupportManifestDiagnostic[],
): void {
  // --- detector row coverage: a present matrix row needs policy -----------
  if (!options.detectorRows) return;

  for (const detector of options.detectorRows) {
    if (!detector.present) continue;

    if (detector.matrixRowId) {
      if (seenMatrixRows.has(detector.matrixRowId)) continue;
      diagnostics.push({
        code: 'detector-row-missing',
        message: `Matrix row "${detector.matrixRowId}" was detected present but has no policy row in the manifest.`,
        matrixRowId: detector.matrixRowId,
        domainId: detector.domainId,
      });
      continue;
    }

    if (!seenDomains.has(detector.domainId)) {
      diagnostics.push({
        code: 'detector-row-missing',
        message: `Domain "${detector.domainId}" was detected present but has no policy row in the manifest.`,
        domainId: detector.domainId,
      });
    }
  }
}
