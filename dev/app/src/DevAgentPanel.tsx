import type { ShellBootstrapResult } from '@mog/shell';
import { Bot, Loader2, PanelRightClose, Send, Square, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type AgentMessageRole = 'assistant' | 'user';

interface AgentMessage {
  readonly id: string;
  readonly role: AgentMessageRole;
  readonly content: string;
}

interface ActiveDocumentSnapshot {
  readonly activeFileId: string | null;
  readonly displayName: string;
  readonly loadingState: string;
  readonly hasHandle: boolean;
  readonly modeLabel: string;
}

interface DevAgentConfig {
  readonly endpoint: string;
  readonly model: string;
}

interface DevAgentPanelProps {
  readonly shell: ShellBootstrapResult;
  readonly onClose: () => void;
}

interface PivotChatMessage {
  readonly role: 'assistant' | 'system' | 'user';
  readonly content: string;
}

interface PivotRequestOptions {
  readonly config: DevAgentConfig;
  readonly requestId: string;
  readonly messages: readonly PivotChatMessage[];
  readonly signal: AbortSignal;
  readonly onDelta: (delta: string) => void;
}

const DEFAULT_PIVOT_MODEL = 'pivot';
const DEFAULT_DEV_AGENT_ENDPOINT = '/api/mog-dev-agent/chat/completions';
const DEV_AGENT_ENDPOINT_KEY = 'mog:dev-agent-endpoint';
const DEV_AGENT_MODEL_KEY = 'mog:dev-agent-model';
const DEV_AGENT_PANEL_WIDTH = 'min(100vw, 384px)';

function readActiveDocumentSnapshot(shell: ShellBootstrapResult): ActiveDocumentSnapshot {
  const state = shell.store.getState();
  const activeFileId = state.activeFileId;
  const file = activeFileId ? state.files[activeFileId] : undefined;
  const handle = activeFileId ? shell.documentManager.getDocument(activeFileId) : null;
  const mode = activeFileId ? shell.documentManager.getDocumentMode(activeFileId) : null;

  return {
    activeFileId,
    displayName: file?.displayName ?? activeFileId ?? 'No active document',
    loadingState: activeFileId ? shell.documentManager.getLoadingState(activeFileId) : 'idle',
    hasHandle: handle !== null,
    modeLabel:
      mode?.kind === 'collaboration'
        ? `collab:${mode.roomId}`
        : mode?.kind === 'normal'
          ? 'normal'
          : 'none',
  };
}

function useActiveDocumentSnapshot(shell: ShellBootstrapResult): ActiveDocumentSnapshot {
  const [snapshot, setSnapshot] = useState(() => readActiveDocumentSnapshot(shell));

  useEffect(() => {
    const update = () => setSnapshot(readActiveDocumentSnapshot(shell));
    const unsubscribeStore = shell.store.subscribe(update);
    const unsubscribeDocuments = shell.documentManager.subscribe(update);
    update();
    return () => {
      unsubscribeStore();
      unsubscribeDocuments();
    };
  }, [shell]);

  return snapshot;
}

function nextMessageId(role: AgentMessageRole): string {
  return `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function readSearchParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readLocalStorageValue(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

function readDevAgentConfig(): DevAgentConfig {
  const env = import.meta.env as ImportMetaEnv & {
    readonly VITE_MOG_AGENT_ENDPOINT?: string;
    readonly VITE_MOG_AGENT_MODEL?: string;
  };
  const endpoint =
    readSearchParam('mog-agent-endpoint') ??
    readLocalStorageValue(DEV_AGENT_ENDPOINT_KEY) ??
    env.VITE_MOG_AGENT_ENDPOINT?.trim() ??
    DEFAULT_DEV_AGENT_ENDPOINT;
  const model =
    readSearchParam('mog-agent-model') ??
    readLocalStorageValue(DEV_AGENT_MODEL_KEY) ??
    env.VITE_MOG_AGENT_MODEL?.trim() ??
    DEFAULT_PIVOT_MODEL;

  return {
    endpoint: endpoint.startsWith('/') ? endpoint : trimTrailingSlash(endpoint),
    model,
  };
}

function formatError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Request stopped.';
  if (error instanceof Error) return error.message;
  return String(error);
}

function agentEndpoint(config: DevAgentConfig): string {
  return config.endpoint;
}

function parseSseBlock(block: string): { event: string | null; payload: unknown } | null {
  if (!block.trim()) return null;
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (!event && dataLines.length === 0) return null;
  if (dataLines.length === 0) return { event, payload: null };
  const data = dataLines.join('\n');
  if (data === '[DONE]') return { event, payload: '[DONE]' };

  try {
    return { event, payload: JSON.parse(data) };
  } catch {
    return { event, payload: data };
  }
}

function messageFromErrorPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  const topLevelError = record.error;
  if (topLevelError && typeof topLevelError === 'object') {
    const message = (topLevelError as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  const detail = record.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const error = (detail as Record<string, unknown>).error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
  }
  return null;
}

async function throwForErrorResponse(response: Response): Promise<never> {
  const text = await response.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const message = messageFromErrorPayload(parsed) ?? text.split('\n').slice(0, 3).join('\n');
  throw new Error(
    message
      ? `LLM stream failed (${response.status}): ${message}`
      : `LLM stream failed (${response.status}).`,
  );
}

async function readPivotStream(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<void> {
  if (!response.body) throw new Error('LLM stream returned no response body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    if (parsed.payload === '[DONE]') return;
    if (parsed.event === 'text_delta') {
      const delta =
        parsed.payload && typeof parsed.payload === 'object'
          ? (parsed.payload as Record<string, unknown>).delta
          : null;
      if (typeof delta === 'string') onDelta(delta);
      return;
    }
    if (parsed.event === 'error') {
      throw new Error(messageFromErrorPayload(parsed.payload) ?? 'LLM stream failed.');
    }
    if (parsed.payload && typeof parsed.payload === 'object') {
      const message = messageFromErrorPayload(parsed.payload);
      if (message) throw new Error(message);

      const choices = (parsed.payload as Record<string, unknown>).choices;
      const firstChoice = Array.isArray(choices) ? choices[0] : null;
      if (firstChoice && typeof firstChoice === 'object') {
        const choice = firstChoice as Record<string, unknown>;
        const delta = choice.delta;
        if (delta && typeof delta === 'object') {
          const content = (delta as Record<string, unknown>).content;
          if (typeof content === 'string') onDelta(content);
          return;
        }
        const messagePayload = choice.message;
        if (messagePayload && typeof messagePayload === 'object') {
          const content = (messagePayload as Record<string, unknown>).content;
          if (typeof content === 'string') onDelta(content);
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) handleBlock(block);
  }

  buffer += decoder.decode();
  if (buffer.trim()) handleBlock(buffer);
}

async function runPivotRequest({
  config,
  requestId,
  messages,
  signal,
  onDelta,
}: PivotRequestOptions): Promise<void> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Agent-Runtime': 'mog_dev_app',
    'X-Client-Platform': 'mog-dev-app',
    'X-LLM-Operation': 'chat',
    'X-Request-Id': requestId,
  });

  const response = await fetch(agentEndpoint(config), {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      max_tokens: 4096,
      messages,
      model: config.model,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) await throwForErrorResponse(response);
  await readPivotStream(response, onDelta);
}

async function buildWorkbookContext(shell: ShellBootstrapResult): Promise<string> {
  const snapshot = readActiveDocumentSnapshot(shell);
  if (!snapshot.activeFileId) return 'No active workbook is open.';
  if (!snapshot.hasHandle) {
    return `Active file: ${snapshot.activeFileId}\nDisplay name: ${snapshot.displayName}\nLoading state: ${snapshot.loadingState}`;
  }

  const handle = shell.documentManager.getDocument(snapshot.activeFileId);
  if (!handle) {
    return `Active file: ${snapshot.activeFileId}\nDisplay name: ${snapshot.displayName}\nLoading state: ${snapshot.loadingState}`;
  }

  const workbook = await handle.workbook();
  const sheet = workbook.activeSheet;
  const usedRange = await sheet.getUsedRange();
  const preview = usedRange ? await sheet.describeRange(usedRange.address, false) : 'empty sheet';

  return [
    `Active file: ${snapshot.activeFileId}`,
    `Display name: ${snapshot.displayName}`,
    `Mode: ${snapshot.modeLabel}`,
    `Active sheet: ${sheet.name}`,
    `Sheets: ${workbook.sheetNames.join(', ') || 'none'}`,
    `Used range: ${usedRange?.address ?? 'empty'}`,
    `Preview:\n${preview}`,
  ].join('\n');
}

function systemPrompt(workbookContext: string): string {
  return [
    'You are a Spreadsheet agent.',
    'Use the workbook context below when it is relevant.',
    'Do not mention private implementation details.',
    '',
    '<workbook_context>',
    workbookContext,
    '</workbook_context>',
  ].join('\n');
}

function toPivotHistory(messages: readonly AgentMessage[]): PivotChatMessage[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));
}

export function DevAgentPanel({ shell, onClose }: DevAgentPanelProps): React.JSX.Element {
  const activeDocument = useActiveDocumentSnapshot(shell);
  const config = useMemo(readDevAgentConfig, []);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Pivot is ready.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canSubmit = draft.trim().length > 0 && !isRunning;
  const statusLabel = useMemo(() => {
    if (!activeDocument.activeFileId) return 'No document';
    if (!activeDocument.hasHandle) return activeDocument.loadingState;
    return activeDocument.modeLabel;
  }, [activeDocument]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isRunning]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const updateAssistantMessage = useCallback((id: string, update: (content: string) => string) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, content: update(message.content) } : message,
      ),
    );
  }, []);

  const runPrompt = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || isRunning) return;

      const userMessage: AgentMessage = {
        id: nextMessageId('user'),
        role: 'user',
        content: trimmed,
      };
      const assistantMessage: AgentMessage = {
        id: nextMessageId('assistant'),
        role: 'assistant',
        content: '',
      };
      const history = [...messages, userMessage];

      setDraft('');
      setMessages((current) => [...current, userMessage, assistantMessage]);
      setIsRunning(true);

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const workbookContext = await buildWorkbookContext(shell);
        await runPivotRequest({
          config,
          requestId: crypto.randomUUID(),
          messages: [
            { role: 'system', content: systemPrompt(workbookContext) },
            ...toPivotHistory(history),
          ],
          signal: abortController.signal,
          onDelta: (delta) => {
            updateAssistantMessage(assistantMessage.id, (content) => `${content}${delta}`);
          },
        });
        updateAssistantMessage(assistantMessage.id, (content) => content || '(No text returned.)');
      } catch (error) {
        updateAssistantMessage(assistantMessage.id, (content) =>
          content ? `${content}\n\n${formatError(error)}` : formatError(error),
        );
      } finally {
        if (abortRef.current === abortController) abortRef.current = null;
        setIsRunning(false);
      }
    },
    [config, isRunning, messages, shell, updateAssistantMessage],
  );

  const stopRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void runPrompt(draft);
    },
    [draft, runPrompt],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (canSubmit) {
        void runPrompt(draft);
      }
    },
    [canSubmit, draft, runPrompt],
  );

  return (
    <aside
      className="flex h-full flex-none flex-col border-l border-ss-border bg-ss-surface-secondary text-ss-text shadow-[-8px_0_18px_rgba(15,23,42,0.08)]"
      style={{
        flexBasis: DEV_AGENT_PANEL_WIDTH,
        maxWidth: DEV_AGENT_PANEL_WIDTH,
        minWidth: DEV_AGENT_PANEL_WIDTH,
        width: DEV_AGENT_PANEL_WIDTH,
      }}
      data-testid="dev-agent-panel"
      aria-label="Mog dev agent"
    >
      <header className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-ss-border px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-ss-accent text-white">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Pivot</div>
          <div className="truncate text-[11px] text-ss-text-secondary">
            {config.model} · {activeDocument.displayName} · {statusLabel}
          </div>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text"
          onClick={onClose}
          aria-label="Close dev agent"
          title="Close dev agent"
        >
          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-md px-3 py-2 text-sm leading-5 ${
                message.role === 'user'
                  ? 'bg-ss-accent text-white'
                  : 'border border-ss-border bg-ss-surface text-ss-text'
              }`}
            >
              <p className="m-0 whitespace-pre-wrap break-words">
                {message.content || (isRunning && message.role === 'assistant' ? 'Thinking' : '')}
              </p>
            </div>
          </div>
        ))}

        {isRunning && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-md border border-ss-border bg-ss-surface px-3 py-2 text-sm text-ss-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Streaming
            </div>
          </div>
        )}
      </div>

      <form className="border-t border-ss-border p-3" onSubmit={handleSubmit}>
        <div className="flex items-end gap-2 rounded-md border border-ss-border bg-ss-surface p-2 focus-within:border-ss-accent">
          <textarea
            className="max-h-28 min-h-11 flex-1 resize-none bg-transparent text-sm leading-5 text-ss-text outline-none placeholder:text-ss-text-tertiary"
            value={draft}
            rows={2}
            placeholder="Message Pivot"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
            data-testid="dev-agent-input"
          />
          {draft.length > 0 && !isRunning && (
            <button
              type="button"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text"
              onClick={() => setDraft('')}
              aria-label="Clear dev agent input"
              title="Clear"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {isRunning ? (
            <button
              type="button"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ss-accent text-white transition-colors hover:bg-ss-accent-hover"
              onClick={stopRequest}
              aria-label="Stop dev agent response"
              title="Stop"
              data-testid="dev-agent-stop"
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ss-accent text-white transition-colors hover:bg-ss-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit}
              aria-label="Send dev agent prompt"
              title="Send"
              data-testid="dev-agent-send"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
