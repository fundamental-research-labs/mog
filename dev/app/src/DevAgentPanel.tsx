import type { ShellBootstrapResult } from '@mog/shell';
import { Bot, Loader2, PanelRightClose, Plus, Send, Square, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEV_AGENT_TOOL_DEFINITIONS,
  buildDevAgentWorkbookContext,
  createDevAgentToolSession,
  executeDevAgentTool,
  readDevAgentActiveDocumentSnapshot,
  type DevAgentActiveDocumentSnapshot,
  type DevAgentToolDefinition,
  type DevAgentToolExecution,
} from './dev-agent-tools';
import {
  finalizeToolCallAccumulator,
  ingestToolCallDeltas,
  parseFallbackToolCalls,
  type DevAgentPendingToolCall,
  type DevAgentToolCall,
} from './dev-agent-tool-protocol';

type AgentMessageRole = 'assistant' | 'user';

interface AgentMessage {
  readonly id: string;
  readonly role: AgentMessageRole;
  readonly content: string;
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
  readonly role: 'assistant' | 'system' | 'tool' | 'user';
  readonly content: string | null;
  readonly tool_call_id?: string;
  readonly name?: string;
  readonly tool_calls?: readonly PivotToolCallMessage[];
}

interface PivotToolCallMessage {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface PivotAssistantResponse {
  readonly content: string;
  readonly toolCalls: readonly DevAgentToolCall[];
}

interface PivotRequestOptions {
  readonly config: DevAgentConfig;
  readonly requestId: string;
  readonly messages: readonly PivotChatMessage[];
  readonly tools?: readonly DevAgentToolDefinition[];
  readonly signal: AbortSignal;
  readonly onDelta?: (delta: string) => void;
}

const DEFAULT_PIVOT_MODEL = 'pivot';
const DEFAULT_DEV_AGENT_ENDPOINT = '/api/mog-dev-agent/chat/completions';
const DEV_AGENT_ENDPOINT_KEY = 'mog:dev-agent-endpoint';
const DEV_AGENT_MODEL_KEY = 'mog:dev-agent-model';
const DEV_AGENT_PANEL_WIDTH = 'min(100vw, 384px)';
const WELCOME_MESSAGE_ID = 'welcome';

function useActiveDocumentSnapshot(shell: ShellBootstrapResult): DevAgentActiveDocumentSnapshot {
  const [snapshot, setSnapshot] = useState(() => readDevAgentActiveDocumentSnapshot(shell));

  useEffect(() => {
    const update = () => setSnapshot(readDevAgentActiveDocumentSnapshot(shell));
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

function createInitialMessages(): AgentMessage[] {
  return [
    {
      id: WELCOME_MESSAGE_ID,
      role: 'assistant',
      content: 'Pivot is ready.',
    },
  ];
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

class PivotRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PivotRequestError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

  if (!event && dataLines.length === 0) {
    try {
      return { event: null, payload: JSON.parse(block) };
    } catch {
      return null;
    }
  }
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
  throw new PivotRequestError(
    response.status,
    message
      ? `LLM stream failed (${response.status}): ${message}`
      : `LLM stream failed (${response.status}).`,
  );
}

function contentFromMessagePayload(messagePayload: unknown): string | null {
  if (typeof messagePayload === 'string') return messagePayload;
  if (!Array.isArray(messagePayload)) return null;
  return messagePayload
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      const text = part.text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

function ingestToolCallsFromMessage(
  pendingToolCalls: DevAgentPendingToolCall[],
  messagePayload: unknown,
): void {
  if (!isRecord(messagePayload)) return;
  ingestToolCallDeltas(pendingToolCalls, messagePayload.tool_calls);
}

function handleChatCompletionPayload(
  payload: unknown,
  pendingToolCalls: DevAgentPendingToolCall[],
  appendContent: (delta: string) => void,
): void {
  if (!isRecord(payload)) return;

  const topLevelDelta = payload.delta;
  if (typeof topLevelDelta === 'string') appendContent(topLevelDelta);

  ingestToolCallDeltas(pendingToolCalls, payload.tool_calls);
  ingestToolCallsFromMessage(pendingToolCalls, payload.message);

  const choices = payload.choices;
  if (!Array.isArray(choices)) return;

  for (const choice of choices) {
    if (!isRecord(choice)) continue;

    const delta = choice.delta;
    if (isRecord(delta)) {
      const content = contentFromMessagePayload(delta.content);
      if (content) appendContent(content);
      ingestToolCallDeltas(pendingToolCalls, delta.tool_calls);
    }

    const messagePayload = choice.message;
    if (isRecord(messagePayload)) {
      const content = contentFromMessagePayload(messagePayload.content);
      if (content) appendContent(content);
      ingestToolCallDeltas(pendingToolCalls, messagePayload.tool_calls);
    }
  }
}

async function readPivotStream(
  response: Response,
  onDelta: (delta: string) => void = () => {},
): Promise<PivotAssistantResponse> {
  if (!response.body) throw new Error('LLM stream returned no response body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const pendingToolCalls: DevAgentPendingToolCall[] = [];

  const appendContent = (delta: string) => {
    content += delta;
    onDelta(delta);
  };

  const handleBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    if (parsed.payload === '[DONE]') return;
    if (parsed.event === 'text_delta') {
      const delta =
        parsed.payload && typeof parsed.payload === 'object'
          ? (parsed.payload as Record<string, unknown>).delta
          : null;
      if (typeof delta === 'string') appendContent(delta);
      return;
    }
    if (parsed.event === 'error') {
      throw new Error(messageFromErrorPayload(parsed.payload) ?? 'LLM stream failed.');
    }
    handleChatCompletionPayload(parsed.payload, pendingToolCalls, appendContent);
    if (parsed.payload && typeof parsed.payload === 'object') {
      const message = messageFromErrorPayload(parsed.payload);
      if (message) throw new Error(message);
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

  return {
    content,
    toolCalls: finalizeToolCallAccumulator(pendingToolCalls),
  };
}

async function runPivotRequest({
  config,
  requestId,
  messages,
  tools,
  signal,
  onDelta,
}: PivotRequestOptions): Promise<PivotAssistantResponse> {
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
      ...(tools && tools.length > 0 ? { tool_choice: 'auto', tools } : {}),
    }),
    signal,
  });

  if (!response.ok) await throwForErrorResponse(response);
  return readPivotStream(response, onDelta);
}

function systemPrompt(workbookContext: string): string {
  return [
    'You are a Spreadsheet agent.',
    'For every user request that needs workbook API use, first call mog_api_search with the current task intent.',
    'Then call mog_api_describe for the relevant path if the signature or options are not obvious.',
    'Then call mog_api_execute with JavaScript using only discovered public Mog APIs. The execution environment exposes wb/workbook, ws/worksheet, api, and console.',
    'Never claim a workbook edit has been made until mog_api_execute confirms it.',
    'Use A1 addresses when the API expects spreadsheet addresses.',
    'If this chat provider does not support tool calls, respond with exactly one JSON object command at a time using {"tool":"mog_api_search","arguments":{"query":"..."}} or {"tool":"mog_api_execute","arguments":{"code":"..."}}. Execute code must be based on API paths returned by previous search/describe results, not examples from this prompt. Do not wrap JSON tool commands in prose.',
    'After tool results are provided, answer briefly with what changed or what you found.',
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
    .filter((message) => message.id !== WELCOME_MESSAGE_ID)
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));
}

function toPivotToolCallMessage(call: DevAgentToolCall): PivotToolCallMessage {
  return {
    id: call.id,
    type: 'function',
    function: {
      name: call.name,
      arguments: call.argumentsJson,
    },
  };
}

function toolResultContent(result: DevAgentToolExecution): string {
  return JSON.stringify(result);
}

function shouldRetryWithoutTools(error: unknown): boolean {
  if (!(error instanceof PivotRequestError)) return false;
  if (error.status !== 400 && error.status !== 422) return false;
  return /tool|function|tool_choice/i.test(error.message);
}

function appendToolResultsForFallback(
  messages: PivotChatMessage[],
  results: readonly DevAgentToolExecution[],
): void {
  messages.push({
    role: 'user',
    content: [
      'Mog API tool results:',
      ...results.map((result) => toolResultContent(result)),
      '',
      'If more workbook work is required, respond with the next JSON tool command. Otherwise answer normally and briefly.',
    ].join('\n'),
  });
}

function hasVisibleText(content: string): boolean {
  return content.trim().length > 0;
}

interface RunAgentConversationOptions {
  readonly shell: ShellBootstrapResult;
  readonly config: DevAgentConfig;
  readonly requestId: string;
  readonly messages: readonly PivotChatMessage[];
  readonly signal: AbortSignal;
  readonly onDelta: (delta: string) => void;
  readonly ensureTurnSeparator: () => void;
}

async function runAgentConversation({
  shell,
  config,
  requestId,
  messages,
  signal,
  onDelta,
  ensureTurnSeparator,
}: RunAgentConversationOptions): Promise<void> {
  const llmMessages: PivotChatMessage[] = [...messages];
  const toolSession = createDevAgentToolSession();
  let toolMode: 'native' | 'fallback' = 'native';

  while (true) {
    const streamToTranscript = toolMode === 'native';
    let bufferedContent = '';
    const captureDelta = (delta: string) => {
      bufferedContent += delta;
      if (streamToTranscript) onDelta(delta);
    };

    let response: PivotAssistantResponse;
    try {
      response = await runPivotRequest({
        config,
        requestId,
        messages: llmMessages,
        tools: toolMode === 'native' ? DEV_AGENT_TOOL_DEFINITIONS : undefined,
        signal,
        onDelta: captureDelta,
      });
    } catch (error) {
      if (!shouldRetryWithoutTools(error) || toolMode === 'fallback') throw error;
      toolMode = 'fallback';
      bufferedContent = '';
      response = await runPivotRequest({
        config,
        requestId,
        messages: llmMessages,
        signal,
        onDelta: (delta) => {
          bufferedContent += delta;
        },
      });
    }

    const fallbackCalls = response.toolCalls.length
      ? []
      : parseFallbackToolCalls(response.content || bufferedContent);
    const toolCalls = response.toolCalls.length ? response.toolCalls : fallbackCalls;

    if (toolCalls.length === 0) {
      if (!streamToTranscript && hasVisibleText(response.content || bufferedContent)) {
        ensureTurnSeparator();
        onDelta(response.content || bufferedContent);
      }
      return;
    }

    if (toolMode === 'native') {
      llmMessages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: toolCalls.map(toPivotToolCallMessage),
      });
    } else {
      llmMessages.push({
        role: 'assistant',
        content: response.content || bufferedContent,
      });
    }

    const results: DevAgentToolExecution[] = [];
    for (const call of toolCalls) {
      const result = await executeDevAgentTool(shell, call, toolSession);
      results.push(result);
      if (toolMode === 'native') {
        llmMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: toolResultContent(result),
        });
      }
    }

    if (toolMode === 'fallback') {
      appendToolResultsForFallback(llmMessages, results);
    }

    ensureTurnSeparator();
  }
}

export function DevAgentPanel({ shell, onClose }: DevAgentPanelProps): React.JSX.Element {
  const activeDocument = useActiveDocumentSnapshot(shell);
  const config = useMemo(readDevAgentConfig, []);
  const [messages, setMessages] = useState<AgentMessage[]>(createInitialMessages);
  const [draft, setDraft] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

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

      const runId = crypto.randomUUID();
      const abortController = new AbortController();
      abortRef.current = abortController;
      activeRunIdRef.current = runId;

      try {
        const workbookContext = await buildDevAgentWorkbookContext(shell);
        const appendAssistantDelta = (delta: string) => {
          updateAssistantMessage(assistantMessage.id, (content) => `${content}${delta}`);
        };
        const ensureTurnSeparator = () => {
          updateAssistantMessage(assistantMessage.id, (content) => {
            if (!content.trim()) return content;
            return content.endsWith('\n\n') ? content : `${content}\n\n`;
          });
        };

        await runAgentConversation({
          shell,
          config,
          requestId: runId,
          messages: [
            { role: 'system', content: systemPrompt(workbookContext) },
            ...toPivotHistory(history),
          ],
          signal: abortController.signal,
          onDelta: appendAssistantDelta,
          ensureTurnSeparator,
        });
        updateAssistantMessage(assistantMessage.id, (content) => content || '(No text returned.)');
      } catch (error) {
        updateAssistantMessage(assistantMessage.id, (content) =>
          content ? `${content}\n\n${formatError(error)}` : formatError(error),
        );
      } finally {
        if (activeRunIdRef.current === runId) {
          activeRunIdRef.current = null;
          if (abortRef.current === abortController) abortRef.current = null;
          setIsRunning(false);
        }
      }
    },
    [config, isRunning, messages, shell, updateAssistantMessage],
  );

  const startNewConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRunIdRef.current = null;
    setDraft('');
    setMessages(createInitialMessages());
    setIsRunning(false);
  }, []);

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
        <div className="flex h-7 w-7 items-center justify-center rounded bg-ss-primary text-ss-text-inverse">
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
          onClick={startNewConversation}
          aria-label="Start new dev agent conversation"
          title="New conversation"
          data-testid="dev-agent-new-conversation"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
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
                  ? 'bg-ss-primary text-ss-text-inverse'
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
        <div className="flex items-end gap-2 rounded-md border border-ss-border bg-ss-surface p-2 focus-within:border-ss-primary">
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
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ss-primary text-ss-text-inverse transition-colors hover:bg-ss-primary-hover"
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
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-ss-primary text-ss-text-inverse transition-colors hover:bg-ss-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
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
