import { analyzeMogCode, preflightMogCode } from './analyze';
import { apiGuidanceCatalog } from './catalog';
import { explainApiSymbol } from './explain';
import { apiGuidanceTargets } from './targets';
import type { ApiGuidanceApi } from './types';

export { analyzeMogCode, diagnosticFromGuidanceEntry, preflightMogCode } from './analyze';
export { apiGuidanceCatalog } from './catalog';
export { explainApiSymbol } from './explain';
export {
  apiGuidanceCatalogValidation,
  apiGuidanceTargets,
  normalizeMogApiPath,
  resolveGuidanceTarget,
  validateApiGuidanceCatalog,
} from './targets';
export type {
  ApiGuidanceApi,
  ApiGuidanceCatalogValidation,
  ApiGuidanceCatalogValidationIssue,
  ApiGuidanceCategory,
  ApiGuidanceCompoundMatcher,
  ApiGuidanceDiagnostic,
  ApiGuidanceDiagnosticCode,
  ApiGuidanceDialect,
  ApiGuidanceEntry,
  ApiGuidanceExplanation,
  ApiGuidanceMatcher,
  ApiGuidanceMatcherKind,
  ApiGuidancePreflightResult,
  ApiGuidanceSourceLocation,
  ApiGuidanceSymbolMatcher,
  ApiGuidanceTarget,
  ApiGuidanceTargetKind,
  ForeignApiGuidanceExplanation,
  MogApiGuidanceExplanation,
  MogReplacement,
  SourceSpan,
} from './types';

export const apiGuidance: ApiGuidanceApi = {
  analyze: analyzeMogCode,
  preflight: preflightMogCode,
  explain: explainApiSymbol,
  catalog: apiGuidanceCatalog,
  targets: apiGuidanceTargets,
};
