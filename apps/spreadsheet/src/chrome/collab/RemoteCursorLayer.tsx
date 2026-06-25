import type { CollaborationPresenceState as PresenceState } from '@mog-sdk/kernel';
import { useEffect, useRef, useState } from 'react';

interface RemoteCursorLayerProps {
  participants: ReadonlyMap<string, PresenceState>;
  currentSheetId: string | null;
  getCellRect?: (
    sheetId: string,
    row: number,
    col: number,
  ) => { x: number; y: number; width: number; height: number } | null;
}

interface CursorLabelState {
  visible: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

function TypingBadge({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="absolute -bottom-5 left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
      style={{ backgroundColor: color }}
    >
      <span>{name} editing</span>
      <span className="inline-flex gap-px">
        <span className="animate-bounce [animation-delay:0ms]">.</span>
        <span className="animate-bounce [animation-delay:150ms]">.</span>
        <span className="animate-bounce [animation-delay:300ms]">.</span>
      </span>
    </div>
  );
}

function RemoteCursor({
  pid,
  state,
  getCellRect,
}: {
  pid: string;
  state: PresenceState;
  getCellRect?: RemoteCursorLayerProps['getCellRect'];
}) {
  const [labelState, setLabelState] = useState<CursorLabelState>({
    visible: true,
    timer: null,
  });
  const prevSelRef = useRef(state.selection);

  // Show label on selection change, fade after 3s
  useEffect(() => {
    const sel = state.selection;
    const prev = prevSelRef.current;
    if (
      sel &&
      prev &&
      (sel.row !== prev.row || sel.col !== prev.col || sel.sheetId !== prev.sheetId)
    ) {
      setLabelState((s) => {
        if (s.timer) clearTimeout(s.timer);
        const timer = setTimeout(() => {
          setLabelState((cur) => ({ ...cur, visible: false, timer: null }));
        }, 3000);
        return { visible: true, timer };
      });
    }
    prevSelRef.current = sel;
  }, [state.selection]);

  useEffect(() => {
    return () => {
      if (labelState.timer) clearTimeout(labelState.timer);
    };
  }, [labelState.timer]);

  if (!state.selection) return null;

  // If getCellRect is available, use it for pixel-precise positioning
  if (getCellRect) {
    const rect = getCellRect(state.selection.sheetId, state.selection.row, state.selection.col);
    if (!rect) return null;

    // Handle range selections
    let left = rect.x;
    let top = rect.y;
    let width = rect.width;
    let height = rect.height;
    const range = state.selection.ranges?.[0];
    if (range) {
      const startRect = getCellRect(state.selection.sheetId, range.startRow, range.startCol);
      const endRect = getCellRect(state.selection.sheetId, range.endRow, range.endCol);
      if (startRect && endRect) {
        left = startRect.x;
        top = startRect.y;
        width = endRect.x + endRect.width - startRect.x;
        height = endRect.y + endRect.height - startRect.y;
      }
    } else if (state.selection.endRow != null && state.selection.endCol != null) {
      const endRect = getCellRect(
        state.selection.sheetId,
        state.selection.endRow,
        state.selection.endCol,
      );
      if (endRect) {
        width = endRect.x + endRect.width - rect.x;
        height = endRect.y + endRect.height - rect.y;
      }
    }

    return (
      <div
        className="pointer-events-none absolute"
        style={{
          left,
          top,
          width,
          height,
        }}
      >
        <div className="absolute inset-0 border-2" style={{ borderColor: state.color }} />
        {labelState.visible && (
          <div
            className="absolute -top-5 left-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
            style={{ backgroundColor: state.color }}
          >
            {state.displayName}
          </div>
        )}
        {state.editing && <TypingBadge name={state.displayName} color={state.color} />}
      </div>
    );
  }

  // Fallback: render a floating indicator (no pixel mapping available)
  return (
    <div
      className="pointer-events-none absolute right-2 flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium text-white"
      style={{
        backgroundColor: state.color,
        top: `${20 + parseInt(pid.replace(/\D/g, '').slice(-2) || '0') * 24}px`,
      }}
    >
      <span>{state.displayName}</span>
      <span className="opacity-70">
        R{state.selection.row}C{state.selection.col}
      </span>
      {state.editing && <span className="ml-1 italic">editing...</span>}
    </div>
  );
}

export function RemoteCursorLayer({
  participants,
  currentSheetId,
  getCellRect,
}: RemoteCursorLayerProps) {
  if (participants.size === 0 || !currentSheetId) return null;

  const entries = Array.from(participants.entries()).filter(
    ([, state]) => state.selection?.sheetId === currentSheetId,
  );

  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {entries.slice(0, 20).map(([pid, state]) => (
        <RemoteCursor key={pid} pid={pid} state={state} getCellRect={getCellRect} />
      ))}
    </div>
  );
}
