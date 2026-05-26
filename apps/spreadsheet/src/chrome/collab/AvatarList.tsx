import type { CollaborationPresenceState as PresenceState } from '@mog-sdk/kernel';
import { useState } from 'react';
import { generateDefaultAvatarUrl } from './default-avatar';
import { PRESENCE_COLORS } from './presence-colors';

interface AvatarListProps {
  participants: ReadonlyMap<string, PresenceState>;
  maxVisible?: number;
}

function Avatar({
  state,
  color,
  size = 'sm',
}: {
  state: PresenceState;
  color: string;
  size?: 'sm' | 'md';
}) {
  const sizeClasses = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const [imgFailed, setImgFailed] = useState(false);

  const selectionLabel = state.selection
    ? `Sheet ${state.selection.sheetId.slice(0, 4)}, R${state.selection.row}C${state.selection.col}`
    : '';
  const tooltip = `${state.displayName}${selectionLabel ? ` — ${selectionLabel}` : ''}`;

  const avatarUrl =
    state.avatarUrl && !imgFailed
      ? state.avatarUrl
      : generateDefaultAvatarUrl(state.displayName, color);

  return (
    <img
      src={avatarUrl}
      alt={state.displayName}
      title={tooltip}
      className={`rounded-full object-cover ring-2 ring-white ${sizeClasses}`}
      onError={() => setImgFailed(true)}
    />
  );
}

export function AvatarList({ participants, maxVisible = 5 }: AvatarListProps) {
  if (participants.size === 0) return null;

  const entries = Array.from(participants.entries());
  const visible = entries.slice(0, maxVisible);
  const overflow = entries.length - maxVisible;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map(([pid, state], index) => (
        <Avatar key={pid} state={state} color={PRESENCE_COLORS[index % PRESENCE_COLORS.length]} />
      ))}
      {overflow > 0 && (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-300 text-[9px] font-semibold text-neutral-700 ring-2 ring-white">
          +{overflow}
        </div>
      )}
    </div>
  );
}
