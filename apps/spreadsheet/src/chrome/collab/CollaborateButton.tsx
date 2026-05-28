import { Check, Link2, Loader2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  useDocumentManager,
  useShellStore,
  useShellStoreApi,
} from '@mog/shell';
import { CollabStatusBadge } from './CollabStatusBadge';
import { generateDefaultAvatarUrl } from './default-avatar';
import { PRESENCE_COLORS } from './presence-colors';
import { useCollabStore } from './use-collab-store';
import {
  RibbonVisibilityPathItem,
  useRibbonVisibilityPathVisible,
} from '../toolbar/visibility/RibbonVisibilityContext';

const SESSION_PARTICIPANT_KEY = 'mog:collab-participant-id';

function getOrCreateSessionParticipantId(): string {
  let id = sessionStorage.getItem(SESSION_PARTICIPANT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_PARTICIPANT_KEY, id);
  }
  return id;
}

export function CollaborateButton() {
  const visible = useRibbonVisibilityPathVisible(['collaboration', 'tabBar', 'collaborate']);
  const enabled = useCollabStore((s) => s.enabled);
  const connecting = useCollabStore((s) => s.connecting);
  const roomId = useCollabStore((s) => s.roomId);
  const config = useCollabStore((s) => s.config);
  const status = useCollabStore((s) => s.status);
  const participants = useCollabStore((s) => s.participants);

  const activeFileId = useShellStore((s) => s.activeFileId);
  const shellStoreApi = useShellStoreApi();
  const documentManager = useDocumentManager();
  const documentMode = activeFileId ? documentManager.getDocumentMode(activeFileId) : null;
  const isRoomBacked = documentMode?.kind === 'collaboration';

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingOpenRef = useRef(false);

  const isActive = enabled && (status === 'online' || status === 'reconnecting');
  const isReconnecting = enabled && status === 'reconnecting';

  if (!visible) return null;

  const activeRoomId = isRoomBacked ? documentMode.roomId : roomId;
  const collabLink =
    activeRoomId && typeof window !== 'undefined'
      ? `${window.location.origin}?collab=${encodeURIComponent(activeRoomId)}`
      : '';

  const handleCopyLink = useCallback(() => {
    if (!collabLink) return;
    navigator.clipboard.writeText(collabLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [collabLink]);

  const handleStopCollaborating = useCallback(async () => {
    console.log(`[Collab:Button] stop — deactivating session fileId=${activeFileId}`);
    pendingOpenRef.current = false;

    try {
      if (activeFileId) {
        await documentManager.closeCollaborationDocument(activeFileId);
        shellStoreApi.getState().removeOpenFileId(activeFileId);
        shellStoreApi.getState().setActiveFileId(null);
      }
      useCollabStore.getState().deactivateCollabSession();

      setOpen(false);
    } catch (err) {
      console.error('[Collab:Button] Failed to stop collab session', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeFileId, documentManager, shellStoreApi]);

  const handleButtonClick = useCallback(async () => {
    console.log(
      `[Collab:Button] click — state=${isActive ? 'active' : connecting ? 'connecting' : 'idle'}`,
    );
    if (isActive) {
      return;
    }
    if (connecting) return;

    if (!isRoomBacked) {
      return;
    }

    if (!activeFileId) {
      console.error('[Collab:Button] No active file — cannot start collab');
      return;
    }
    if (!config) {
      console.error('[Collab:Button] No collab config — collabStore.config is null');
      return;
    }

    // Use config userId if available, otherwise generate a stable session participant ID
    const participantId = config.user.userId || getOrCreateSessionParticipantId();
    console.log(
      `[Collab:Button] starting session fileId=${activeFileId} participantId=${participantId}`,
    );

    useCollabStore.getState().setConnecting(true);
    setError(null);
    pendingOpenRef.current = true;

    try {
      const sidecar = documentManager.getSidecar(activeFileId);
      if (sidecar) {
        // Atomic activation: sets all fields, subscribes, broadcasts identity
        useCollabStore.getState().activateCollabSession(sidecar, activeRoomId!);
      } else {
        pendingOpenRef.current = false;
        useCollabStore.getState().setConnecting(false);
      }
    } catch (err) {
      console.error('[Collab:Button] Failed to start collab session', err);
      pendingOpenRef.current = false;
      useCollabStore.getState().setConnecting(false);
    }
  }, [isActive, connecting, activeFileId, config, documentManager, isRoomBacked, activeRoomId]);

  // Auto-open popover when first connection succeeds
  useEffect(() => {
    console.log(
      `[Collab:Button] isActive effect — isActive=${isActive} pendingOpen=${pendingOpenRef.current}`,
    );
    if (isActive && pendingOpenRef.current) {
      console.log(`[Collab:Button] auto-opening popover`);
      pendingOpenRef.current = false;
      setOpen(true);
    }
  }, [isActive]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(isActive ? nextOpen : false);
    },
    [isActive],
  );

  // Connection timeout — abort after 15s if still connecting
  useEffect(() => {
    if (!connecting) return;
    const timer = setTimeout(() => {
      console.log('[Collab:Button] connection timeout — aborting');
      handleStopCollaborating();
      setError('Connection timed out');
    }, 15_000);
    return () => clearTimeout(timer);
  }, [connecting, handleStopCollaborating]);

  // Clear error after 5s
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5_000);
    return () => clearTimeout(timer);
  }, [error]);

  return (
    <Popover open={open && isActive} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={connecting}
          data-testid={!isRoomBacked ? 'collab-start-blocked' : undefined}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            !isRoomBacked
              ? 'bg-neutral-100 text-neutral-500'
              : isReconnecting
                ? 'bg-amber-50 text-amber-600'
                : isActive
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : connecting
                    ? 'bg-amber-50 text-amber-600 cursor-wait'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
          title={
            !isRoomBacked
              ? 'Sharing requires room seeding'
              : isReconnecting
                ? 'Reconnecting...'
                : isActive
                  ? 'Collaboration active'
                  : connecting
                    ? 'Connecting...'
                    : 'Collaborate'
          }
        >
          {!isRoomBacked ? (
            <>
              <Users className="h-3.5 w-3.5" />
              <span>Sharing requires room seeding</span>
            </>
          ) : isReconnecting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Reconnecting...</span>
            </>
          ) : isActive ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>Live{participants.size > 1 ? ` (${participants.size})` : ''}</span>
            </>
          ) : connecting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Connecting...</span>
            </>
          ) : (
            <>
              <Users className="h-3.5 w-3.5" />
              <span>Collaborate</span>
            </>
          )}
        </button>
      </PopoverTrigger>

      {error && (
        <p className="absolute right-0 top-full mt-1 text-[10px] text-red-500 whitespace-nowrap">
          {error}
        </p>
      )}

      {isActive && (
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={4}
          className="w-72 rounded-lg border-neutral-200 bg-white p-3 shadow-lg"
        >
          {/* Share link */}
          <p className="mb-2 text-xs font-medium text-neutral-700">Share this spreadsheet</p>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5">
            <input
              type="text"
              readOnly
              value={collabLink}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-neutral-600 outline-none"
            />
            <RibbonVisibilityPathItem path={['collaboration', 'popover', 'copyLink']}>
              <button
                type="button"
                onClick={handleCopyLink}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
              >
                {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </RibbonVisibilityPathItem>
          </div>
          <p className="mb-3 text-[10px] text-neutral-400">
            Anyone with this link can edit this spreadsheet in real-time.
          </p>

          {/* Current user */}
          {config?.user?.displayName && (
            <p className="mb-2 text-[11px] text-neutral-500">
              You are{' '}
              <span className="font-medium text-neutral-700">{config.user.displayName}</span>
              {config.user.userId ? (
                <span className="text-neutral-400"> ({config.user.userId})</span>
              ) : null}
            </p>
          )}

          {/* Connection status */}
          <div className="mb-3">
            <CollabStatusBadge status={status} />
          </div>

          {/* Participant list */}
          {participants.size > 0 && (
            <div className="mb-3 border-t border-neutral-100 pt-2">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                In this room ({participants.size})
              </p>
              <div className="space-y-1">
                {Array.from(participants.entries()).map(([pid, state], index) => (
                  <div key={pid} className="flex items-center gap-2">
                    <img
                      src={
                        state.avatarUrl ||
                        generateDefaultAvatarUrl(
                          state.displayName,
                          PRESENCE_COLORS[index % PRESENCE_COLORS.length],
                        )
                      }
                      alt={state.displayName}
                      className="h-5 w-5 rounded-full object-cover"
                    />
                    <span className="text-[11px] text-neutral-600">{state.displayName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stop collaborating */}
          <div className="border-t border-neutral-100 pt-2">
            <RibbonVisibilityPathItem path={['collaboration', 'popover', 'stopCollaborating']}>
              <button
                type="button"
                onClick={handleStopCollaborating}
                className="flex w-full items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Stop collaborating
              </button>
            </RibbonVisibilityPathItem>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
