import type { FormulaAIService } from '@mog-sdk/contracts/services';

interface FormulaAIProxyResponse {
  readonly explanation?: unknown;
  readonly error?: unknown;
}

function errorMessage(payload: FormulaAIProxyResponse | undefined, status: number): string {
  if (typeof payload?.error === 'string' && payload.error.trim() !== '') return payload.error;
  return `Formula AI request failed with HTTP ${status}.`;
}

export const devFormulaAI: FormulaAIService = {
  async explainFormula(request, options) {
    const response = await fetch('/api/formula-ai/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options?.signal,
    });

    let payload: FormulaAIProxyResponse | undefined;
    try {
      payload = (await response.json()) as FormulaAIProxyResponse;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      throw new Error(errorMessage(payload, response.status));
    }

    const explanation = payload?.explanation;
    if (typeof explanation !== 'string' || explanation.trim() === '') {
      throw new Error('Formula AI returned an empty explanation.');
    }

    return {
      explanation: explanation.trim(),
    };
  },
};
