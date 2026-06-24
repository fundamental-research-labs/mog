export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('principal') ||
    normalized.includes('hidden') ||
    normalized.includes('digest') ||
    normalized === 'actorid' ||
    normalized === 'reviewerid' ||
    normalized === 'agentrunid' ||
    normalized === 'userid' ||
    normalized === 'useremail' ||
    normalized === 'domain' ||
    normalized === 'domains' ||
    normalized === 'omittedchangecount' ||
    normalized === 'omitteddomains' ||
    normalized === 'path' ||
    normalized === 'changeid' ||
    normalized === 'entityid' ||
    normalized === 'proposalid' ||
    normalized === 'mergepreviewid' ||
    normalized === 'conflictid' ||
    normalized === 'optionid' ||
    normalized === 'payloadid' ||
    normalized === 'resultid' ||
    normalized === 'resolutionsetdigest' ||
    normalized === 'resolvedattemptdigest' ||
    normalized === 'basecommitid' ||
    normalized === 'headcommitid' ||
    normalized === 'value' ||
    normalized === 'values' ||
    normalized === 'before' ||
    normalized === 'after' ||
    normalized === 'oldvalue' ||
    normalized === 'newvalue' ||
    normalized === 'rawvalue' ||
    normalized === 'cellvalue' ||
    normalized === 'displayvalue' ||
    normalized === 'formula' ||
    normalized === 'result'
  );
}

export function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
