/**
 * Shared eval output contract — mog.eval.result.v1
 *
 * Defines the minimum common envelope all public-surface evals emit.
 * Individual eval schemas are unchanged; this wraps them for CI, agents,
 * and release gates.
 *
 * Wire format: snake_case (matches Rust majority; TS adapters convert).
 */

export type EvalName =
  | 'app-eval'
  | 'api-eval'
  | 'colab-eval'
  | 'views-eval'
  | 'embed-eval'
  | 'formula-eval'
  | 'format-eval'
  | 'xlsx-roundtrip'
  | 'api-eval-py';

export type ScenarioStatus = 'passed' | 'failed' | 'skipped' | 'blocked';

export type ConformanceTier = 'internal' | 'public' | 'both';

export interface EvalArtifactIdentity {
  name: string;
  version: string;
  path?: string;
}

export interface EvalTotals {
  scenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  release_blocking_failures: number;
}

export interface EvalScenarioResult {
  id: string;
  status: ScenarioStatus;
  conformance?: ConformanceTier;
  release_blocking?: boolean;
  duration_ms?: number;
  message?: string;
}

export interface EvalResultEnvelope<D = unknown> {
  $schema: 'mog.eval.result.v1';
  eval: EvalName;
  run_id: string;
  timestamp: string;
  git_sha?: string;
  profile?: string;
  artifact_under_test?: EvalArtifactIdentity;
  fixture_version?: string;
  conformance_tier?: ConformanceTier;
  totals: EvalTotals;
  duration_ms: number;
  scenarios: EvalScenarioResult[];
  domain?: D;
}

export function emptyTotals(): EvalTotals {
  return {
    scenarios: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    release_blocking_failures: 0,
  };
}

export function computeTotals(scenarios: EvalScenarioResult[]): EvalTotals {
  const totals = emptyTotals();
  totals.scenarios = scenarios.length;
  for (const s of scenarios) {
    switch (s.status) {
      case 'passed':
        totals.passed++;
        break;
      case 'failed':
        totals.failed++;
        if (s.release_blocking !== false) {
          totals.release_blocking_failures++;
        }
        break;
      case 'skipped':
        totals.skipped++;
        break;
      case 'blocked':
        totals.blocked++;
        break;
    }
  }
  return totals;
}

export function printResultFileLine(absolutePath: string): void {
  console.log(`result_file=${absolutePath}`);
}
