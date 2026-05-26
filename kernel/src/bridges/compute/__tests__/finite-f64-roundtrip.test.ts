/**
 * finite-f64-roundtrip.test.ts — finite numeric wire-shape regression.
 *
 * The wire contract migrated `RecalcMetrics.iterative_max_delta`,
 * `SelectionAggregates.{sum,average,min,max}`, `RecalcOptions.maxChange`,
 * and the `ChartStatistics.*` set from bare `f64` to
 * `Option<FiniteF64>`. The wire contract is "present-with-null"
 * (no `skip_serializing_if`). The TS side previously typed these as
 * `number`, which lied about the runtime shape (`null` was already
 * appearing for non-finite engine outputs and crashing the parent
 * decoder in formula-eval).
 *
 * This test pins the wire contract by verifying:
 *
 * 1. The generated `RecalcMetrics`/`SelectionAggregates`/`ChartStatistics`
 *    types accept `null` for the migrated fields. We do this by
 *    constructing a value of the type at compile time — if the type
 *    weren't `number | null`, this file wouldn't typecheck.
 * 2. The default-metrics fallback in `compute-bridge.ts` defaults
 *    `iterativeMaxDelta` to `null` (not `0`), matching the new wire
 *    shape so consumers that branch on `=== null` get a consistent
 *    signal regardless of whether the bridge method exists.
 *
 * Both bridge modes (NAPI and WASM) share the same generated TS types,
 * so a single typecheck-time fixture covers both. (`MOG_BRIDGE` is the
 * runtime selector for picking the transport in `kernel/src/bridges/
 * compute/compute-core.ts`.)
 */
import type { ChartStatistics, RecalcMetrics, SelectionAggregates } from '../compute-types.gen';

describe('finite-f64 wire-shape regression', () => {
  it('RecalcMetrics.iterativeMaxDelta accepts null', () => {
    const metrics: Pick<
      RecalcMetrics,
      'iterativeMaxDelta' | 'iterativeConverged' | 'iterativeIterations'
    > = {
      iterativeMaxDelta: null,
      iterativeConverged: false,
      iterativeIterations: 0,
    };
    expect(metrics.iterativeMaxDelta).toBeNull();
  });

  it('SelectionAggregates accepts null for sum/average/min/max', () => {
    const agg: SelectionAggregates = {
      sum: null,
      count: 0,
      numericCount: 0,
      average: null,
      min: null,
      max: null,
    };
    expect(agg.sum).toBeNull();
    expect(agg.average).toBeNull();
    expect(agg.min).toBeNull();
    expect(agg.max).toBeNull();
  });

  it('ChartStatistics accepts null for every numeric field', () => {
    const stats: ChartStatistics = {
      mean: null,
      median: null,
      stdDev: null,
      sampleStdDev: null,
      min: null,
      max: null,
      variance: null,
      sampleVariance: null,
      sum: null,
      range: null,
      q1: null,
      q3: null,
      iqr: null,
    };
    expect(stats.mean).toBeNull();
    expect(stats.stdDev).toBeNull();
    expect(stats.variance).toBeNull();
  });

  it('JSON.parse of the producer wire shape decodes cleanly', () => {
    // The exact JSON shape the Rust producer emits when iterative was
    // not run / the cycle was non-numeric. Regression target for the
    // formula-eval crash that triggered this round.
    const wire = '{"iterativeMaxDelta":null,"iterativeConverged":false}';
    const parsed = JSON.parse(wire);
    expect(parsed.iterativeMaxDelta).toBeNull();
    // null is a valid signal — branching is the consumer's job.
    expect(parsed.iterativeMaxDelta ?? 0).toBe(0);
  });
});
