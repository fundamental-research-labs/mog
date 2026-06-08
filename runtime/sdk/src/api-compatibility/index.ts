import generatedCompatibility from '../generated/api-compatibility.json';
import type { ApiCompatibilityIndex } from './types';

export { apiCompatibilityRegistry as apiCompatibilityRegistrySource } from './registry';
export type {
  ApiCompatibilityAppliesTo,
  ApiCompatibilityDiagnostic,
  ApiCompatibilityDiagnosticCode,
  ApiCompatibilityEntry,
  ApiCompatibilityEvidence,
  ApiCompatibilityEvidenceSource,
  ApiCompatibilityIndex,
  ApiCompatibilityReference,
  ApiCompatibilityStatus,
  ApiCompatibilitySurface,
} from './types';

export const apiCompatibility = generatedCompatibility as ApiCompatibilityIndex;
