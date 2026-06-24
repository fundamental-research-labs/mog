import type {
  VersionPromotePendingRemoteOptions,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { OPTION_KEYS } from './remote-constants';
import { invalidOptionsDiagnostic } from './remote-diagnostics';
import { isRecord } from './remote-utils';

export function validatePendingRemotePromotionOptions(
  input: VersionPromotePendingRemoteOptions,
): readonly VersionStoreDiagnostic[] {
  if (!isRecord(input) || Array.isArray(input)) {
    return [
      invalidOptionsDiagnostic('promotePendingRemote options must be an object when supplied.'),
    ];
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const key of Object.keys(input)) {
    if (!OPTION_KEYS.has(key)) {
      diagnostics.push(invalidOptionsDiagnostic('Unsupported promotePendingRemote option.', key));
    }
  }
  if (
    'includeDiagnostics' in input &&
    input.includeDiagnostics !== undefined &&
    typeof input.includeDiagnostics !== 'boolean'
  ) {
    diagnostics.push(
      invalidOptionsDiagnostic(
        'includeDiagnostics must be a boolean when supplied.',
        'includeDiagnostics',
      ),
    );
  }
  return diagnostics;
}
