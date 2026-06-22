import { MSG, encodeJson, decode } from './wire-codec';

const SNAPSHOT_TOKEN_VERSION = 'room-snapshot-v1';

export interface RoomSnapshot {
  roomId: string;
  fullState: Uint8Array;
  stateVector: Uint8Array;
  roomEpoch: number;
  fullStateHash: string;
  snapshotToken: string;
  snapshotTokenVersion: 'room-snapshot-v1';
}

export function fetchRoomSnapshot(
  url: string,
  roomId: string = inferRoomIdFromUrl(url),
  timeoutMs = 10_000,
): Promise<RoomSnapshot> {
  validateRoomId(roomId);
  return new Promise<RoomSnapshot>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error('Timed out waiting for ROOM_SNAPSHOT_RESPONSE'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const finish = (snapshot: RoomSnapshot) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.close();
      resolve(snapshot);
    };

    function onOpen() {
      socket.send(encodeJson(MSG.ROOM_SNAPSHOT, { roomId }));
    }

    function onMessage(event: MessageEvent) {
      void handleSnapshotMessage(event);
    }

    async function handleSnapshotMessage(event: MessageEvent) {
      try {
        const decoded = decode(event.data as ArrayBuffer);
        if (decoded.type !== MSG.ROOM_SNAPSHOT_RESPONSE) {
          fail(new Error(`Expected ROOM_SNAPSHOT_RESPONSE, got type ${decoded.type}`));
          return;
        }
        const meta = decoded.json as {
          ok?: boolean;
          roomId?: string;
          stateVector?: number[];
          roomEpoch?: number;
          fullStateHash?: string;
          snapshotToken?: string;
          snapshotTokenVersion?: string;
          error?: string;
          message?: string;
        };
        if (meta.ok === false) {
          fail(new Error(meta.message ?? meta.error ?? 'ROOM_SNAPSHOT rejected'));
          return;
        }
        if (
          meta.ok !== true ||
          meta.roomId !== roomId ||
          typeof meta.roomEpoch !== 'number' ||
          !Array.isArray(meta.stateVector) ||
          typeof meta.fullStateHash !== 'string' ||
          typeof meta.snapshotToken !== 'string' ||
          meta.snapshotTokenVersion !== SNAPSHOT_TOKEN_VERSION
        ) {
          fail(new Error('ROOM_SNAPSHOT_RESPONSE missing required bootstrap metadata'));
          return;
        }
        const fullState = decoded.binary ? new Uint8Array(decoded.binary) : new Uint8Array(0);
        const fullStateHash = meta.fullStateHash;
        if (!fullStateHash || (await sha256Hex(fullState)) !== fullStateHash) {
          fail(new Error('ROOM_SNAPSHOT fullStateHash mismatch'));
          return;
        }
        finish({
          roomId,
          fullState,
          stateVector: new Uint8Array(meta.stateVector),
          roomEpoch: meta.roomEpoch,
          fullStateHash,
          snapshotToken: meta.snapshotToken,
          snapshotTokenVersion: SNAPSHOT_TOKEN_VERSION,
        });
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    }

    function onClose() {
      fail(new Error('WebSocket closed before ROOM_SNAPSHOT completed'));
    }

    function onError() {
      fail(new Error('WebSocket error during ROOM_SNAPSHOT'));
    }

    socket.addEventListener('open', onOpen);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
  });
}

function inferRoomIdFromUrl(url: string): string {
  const parsed = new URL(url);
  const finalSegment = parsed.pathname.split('/').filter(Boolean).pop();
  if (!finalSegment) {
    throw new Error('Collaboration room URL must include a room id final path segment');
  }
  const roomId = decodeURIComponent(finalSegment);
  validateRoomId(roomId);
  return roomId;
}

function validateRoomId(roomId: string): void {
  if (!roomId || roomId === '.' || roomId === '..' || /[/?#]/.test(roomId)) {
    throw new Error(`Invalid collaboration room id: ${roomId}`);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable');
  }
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
