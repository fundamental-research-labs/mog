const REDACTED_VERSION_REF = '[version ref]';
const REDACTED_PRINCIPAL = '[principal]';
const REDACTED_COMMIT = '[commit]';
const REDACTED_PENDING_REMOTE_SEGMENT = '[pending remote segment]';
const REDACTED_SYNC_BATCH = '[sync batch]';
const REDACTED_INTERNAL_REFERENCE = '[internal reference]';
const REDACTED_EXTERNAL_LINK = '[external link]';
const REDACTED_SECRET = '[secret]';
const REDACTED_DIAGNOSTIC_PAYLOAD = '[diagnostic payload]';

export function sanitizeVersionStatusText(
  value: string | undefined,
  fallback: string,
): string | undefined {
  const message = value?.trim() ?? '';
  if (message.length === 0) return undefined;
  const redacted = redactSensitiveVersionDiagnosticText(message).replace(/\s+/g, ' ').trim();
  return redacted.length > 0 ? redacted : fallback;
}

function redactSensitiveVersionDiagnosticText(message: string): string {
  return message
    .replace(
      /["']?\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b["']?\s*:\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal\b\s+(?:"[^"]*"|'[^']*'|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|principal:[^\s,;)}]+|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED_PRINCIPAL)
    .replace(/\brefs\/(?!heads\/(?:<branch>|\*))[^\s"'`<>),;]+/g, REDACTED_VERSION_REF)
    .replace(/\bcommit:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_COMMIT)
    .replace(/\bpending-remote-segment:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_PENDING_REMOTE_SEGMENT)
    .replace(/\bsync-batch-status:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_SYNC_BATCH)
    .replace(/\/Users\/[^\s"'`<>),;]+/g, REDACTED_INTERNAL_REFERENCE)
    .replace(
      /\b(?:internal-workstream|workspace-plan|local-plan)[^\s"'`<>),;]*/gi,
      REDACTED_INTERNAL_REFERENCE,
    )
    .replace(/\bhttps?:\/\/[^\s"'`<>),;]+/gi, REDACTED_EXTERNAL_LINK)
    .replace(
      /["']?\b(?:rawPayload|raw_payload|providerPayload|provider_payload|diagnosticPayload|diagnostic_payload|rawWorkbookBytes|raw_workbook_bytes|workbookBytes|workbook_bytes|payloadBytes|payload_bytes)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|\[[^\]]*\]|[^\s,;)}]+)/gi,
      `diagnosticPayload ${REDACTED_DIAGNOSTIC_PAYLOAD}`,
    )
    .replace(
      /\b(password|token|secret|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      (_match, label: string) => `${label} ${REDACTED_SECRET}`,
    );
}
