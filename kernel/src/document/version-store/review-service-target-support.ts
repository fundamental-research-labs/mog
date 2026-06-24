import type {
  VersionDiffStructuralMetadata,
  WorkbookVersionReviewDecisionTarget,
} from '@mog-sdk/contracts/api';

type ReviewSemanticTarget = Pick<
  Extract<WorkbookVersionReviewDecisionTarget, { readonly kind: 'semanticChange' }>,
  'entityKind' | 'propertyPath'
>;

type ReviewTargetSupportResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unsupportedDomain' | 'unsupportedPropertyPath' };

const REVIEW_TARGET_PROPERTY_PATHS = new Map<string, readonly (readonly string[])[]>([
  ['cell', [['value']]],
  ['cells.values', [[], ['value']]],
  ['cells.formulas', [['formula'], ['value']]],
  ['sheet', [['name'], ['tabColor'], ['frozen'], ['sheet'], ['order']]],
  ['rows-columns', [['order']]],
  ['cells.formats.direct', [['format']]],
  ['named-ranges', [['definition'], ['range']]],
  ['tables', [['definition'], ['range']]],
  ['comments-notes', [['cell']]],
  ['conditional-formatting', [['rule'], ['range']]],
  ['data-validation', [['range']]],
  ['filters', [['state']]],
  ['sorts', [['order']]],
  ['charts.source-range', [['sourceRange']]],
  ['floating-objects.anchors', [['anchor']]],
]);

export function reviewServiceSemanticTargetSupport(
  target: ReviewSemanticTarget,
): ReviewTargetSupportResult {
  const paths = REVIEW_TARGET_PROPERTY_PATHS.get(target.entityKind);
  if (!paths) return { ok: false, reason: 'unsupportedDomain' };
  return paths.some((path) => propertyPathEquals(path, target.propertyPath))
    ? { ok: true }
    : { ok: false, reason: 'unsupportedPropertyPath' };
}

export function reviewServiceStructuralTargetSupport(
  structural: VersionDiffStructuralMetadata,
): ReviewTargetSupportResult {
  if (structural.kind !== 'metadata') return { ok: true };
  return reviewServiceSemanticTargetSupport({
    entityKind: structural.domain,
    propertyPath: structural.propertyPath,
  });
}

function propertyPathEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => right[index] === segment);
}
