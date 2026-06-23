import type {
  VersionDiffDisplay,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

export type MergeBranch = 'ours' | 'theirs';
export type MergeDiagnostic = PublicVersionStoreDiagnostic;

export type SemanticValueChange = {
  readonly key: string;
  readonly structural: Exclude<VersionDiffStructuralMetadata, VersionRedactedValue>;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
  readonly display?: VersionDiffDisplay;
};

export type ParsedSemanticChangeSet =
  | {
      readonly ok: true;
      readonly changes: readonly SemanticValueChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    };

export type ParsedSemanticChange =
  | {
      readonly ok: true;
      readonly change: SemanticValueChange;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly MergeDiagnostic[];
    };

export type SemanticValueChangeSupport =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
    };
