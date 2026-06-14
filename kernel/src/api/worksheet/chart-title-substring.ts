import type { Chart, ChartFormatString } from '@mog-sdk/contracts/api';

function titleTextRuns(chart: Chart): ChartFormatString[] | undefined {
  if (chart.chartTitle?.richText?.length) return chart.chartTitle.richText;
  if (chart.titleRichText?.length) return chart.titleRichText;
  return undefined;
}

function plainTitleText(chart: Chart): string {
  return (
    chart.title ??
    chart.chartTitle?.text ??
    chart.titleRichText?.map((run) => run.text).join('') ??
    ''
  );
}

function normalizedSubstringRange(
  textLength: number,
  start: number,
  length: number,
): [number, number] {
  const safeStart = Number.isFinite(start) ? Math.max(0, Math.trunc(start)) : 0;
  const safeLength = Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : textLength;
  return [Math.min(safeStart, textLength), Math.min(safeStart + safeLength, textLength)];
}

function sliceChartFormatStringRuns(
  runs: readonly ChartFormatString[],
  start: number,
  length: number,
): ChartFormatString {
  const totalLength = runs.reduce((total, run) => total + run.text.length, 0);
  const [sliceStart, sliceEnd] = normalizedSubstringRange(totalLength, start, length);
  const fragments: ChartFormatString[] = [];
  let offset = 0;

  for (const run of runs) {
    const runStart = offset;
    const runEnd = runStart + run.text.length;
    offset = runEnd;

    const overlapStart = Math.max(runStart, sliceStart);
    const overlapEnd = Math.min(runEnd, sliceEnd);
    if (overlapStart < overlapEnd) {
      fragments.push({
        text: run.text.slice(overlapStart - runStart, overlapEnd - runStart),
        font: run.font,
      });
    }
    if (offset >= sliceEnd) break;
  }

  if (fragments.length === 0) return { text: '' };
  return {
    text: fragments.map((fragment) => fragment.text).join(''),
    font: fragments[0].font,
  };
}

export function sliceChartTitle(chart: Chart, start: number, length: number): ChartFormatString {
  const runs = titleTextRuns(chart);
  if (runs) return sliceChartFormatStringRuns(runs, start, length);

  const title = plainTitleText(chart);
  const [sliceStart, sliceEnd] = normalizedSubstringRange(title.length, start, length);
  return { text: title.slice(sliceStart, sliceEnd) };
}
