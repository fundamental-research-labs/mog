import type { CollaborationSidecarStatus as SidecarStatus } from '@mog-sdk/kernel';

interface CollabStatusBadgeProps {
  status: SidecarStatus | null;
}

const STATUS_CONFIG: Record<SidecarStatus, { dotClass: string; label: string }> = {
  online: { dotClass: 'bg-emerald-500', label: 'Connected' },
  connecting: { dotClass: 'bg-yellow-500 animate-pulse', label: 'Connecting...' },
  reconnecting: { dotClass: 'bg-yellow-500 animate-pulse', label: 'Reconnecting...' },
  offline: { dotClass: 'bg-red-500', label: 'Disconnected' },
};

export function CollabStatusBadge({ status }: CollabStatusBadgeProps) {
  if (!status) return null;
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      <span>{config.label}</span>
    </div>
  );
}
