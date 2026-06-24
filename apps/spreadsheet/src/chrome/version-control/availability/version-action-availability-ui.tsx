import { VERSION_ACTION_UNAVAILABLE } from './version-action-availability-metadata';
import { sanitizeVersionStatusText } from './version-action-availability-sanitize';

export function DisabledReason({
  id,
  reason,
}: {
  readonly id: string;
  readonly reason?: string;
}): React.JSX.Element | null {
  const sanitizedReason = sanitizeVersionStatusText(reason, VERSION_ACTION_UNAVAILABLE);
  if (!sanitizedReason) return null;

  return (
    <div id={id} className="text-[11px] leading-snug text-ss-text-secondary">
      {sanitizedReason}
    </div>
  );
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}
