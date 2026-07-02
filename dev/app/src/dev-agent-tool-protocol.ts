export interface DevAgentToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  readonly arguments: Record<string, unknown>;
  readonly argumentParseError?: string;
}

export interface DevAgentPendingToolCall {
  id?: string;
  type?: string;
  name?: string;
  argumentsJson: string;
}

export function ingestToolCallDeltas(
  pending: DevAgentPendingToolCall[],
  toolCallsPayload: unknown,
): void {
  if (!Array.isArray(toolCallsPayload)) return;

  for (let fallbackIndex = 0; fallbackIndex < toolCallsPayload.length; fallbackIndex += 1) {
    const raw = toolCallsPayload[fallbackIndex];
    if (!isRecord(raw)) continue;

    const index = typeof raw.index === 'number' ? raw.index : fallbackIndex;
    const current = pending[index] ?? { argumentsJson: '' };
    pending[index] = current;

    if (typeof raw.id === 'string') current.id = raw.id;
    if (typeof raw.type === 'string') current.type = raw.type;
    if (typeof raw.name === 'string') current.name = raw.name;

    const fn = raw.function;
    if (!isRecord(fn)) continue;
    if (typeof fn.name === 'string') current.name = fn.name;
    if (typeof fn.arguments === 'string') {
      current.argumentsJson += fn.arguments;
    } else if (fn.arguments !== undefined) {
      current.argumentsJson += JSON.stringify(fn.arguments);
    }
  }
}

export function finalizeToolCallAccumulator(
  pending: readonly DevAgentPendingToolCall[],
): DevAgentToolCall[] {
  return pending
    .filter((call): call is DevAgentPendingToolCall & { readonly name: string } => {
      return typeof call?.name === 'string' && call.name.length > 0;
    })
    .map((call, index) => {
      const argumentsJson = call.argumentsJson.trim() || '{}';
      const parsed = parseToolArguments(argumentsJson);
      return {
        id: call.id ?? `mog-dev-agent-call-${index}`,
        name: call.name,
        argumentsJson,
        arguments: parsed.arguments,
        argumentParseError: parsed.error,
      };
    });
}

export function parseFallbackToolCalls(content: string): DevAgentToolCall[] {
  for (const candidate of jsonCandidates(content)) {
    const parsed = parseJson(candidate);
    if (!parsed.ok) continue;
    const calls = toolCallsFromFallbackPayload(parsed.value);
    if (calls.length > 0) return calls;
  }
  return [];
}

function parseToolArguments(argumentsJson: string): {
  readonly arguments: Record<string, unknown>;
  readonly error?: string;
} {
  try {
    const parsed = JSON.parse(argumentsJson || '{}');
    if (!isRecord(parsed)) {
      return { arguments: {}, error: 'Tool arguments must be a JSON object.' };
    }
    return { arguments: parsed };
  } catch (error) {
    return { arguments: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseJson(value: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function jsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content))) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    candidates.push(trimmed);
  }
  return candidates;
}

function toolCallsFromFallbackPayload(payload: unknown): DevAgentToolCall[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry, index) => toolCallFromFallbackEntry(entry, index));
  }
  if (!isRecord(payload)) return [];

  const toolCalls = payload.tool_calls;
  if (Array.isArray(toolCalls)) {
    return toolCalls.flatMap((entry, index) => toolCallFromFallbackEntry(entry, index));
  }
  return toolCallFromFallbackEntry(payload, 0);
}

function toolCallFromFallbackEntry(entry: unknown, index: number): DevAgentToolCall[] {
  if (!isRecord(entry)) return [];

  const fn = entry.function;
  const name =
    typeof entry.tool === 'string'
      ? entry.tool
      : typeof entry.name === 'string'
        ? entry.name
        : isRecord(fn) && typeof fn.name === 'string'
          ? fn.name
          : null;
  if (!name) return [];

  const rawArguments = isRecord(fn) && fn.arguments !== undefined ? fn.arguments : entry.arguments;
  const argumentsJson =
    typeof rawArguments === 'string'
      ? rawArguments
      : rawArguments === undefined
        ? '{}'
        : JSON.stringify(rawArguments);
  const parsed = parseToolArguments(argumentsJson);

  return [
    {
      id: typeof entry.id === 'string' ? entry.id : `mog-dev-agent-fallback-${index}`,
      name,
      argumentsJson,
      arguments: parsed.arguments,
      argumentParseError: parsed.error,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
