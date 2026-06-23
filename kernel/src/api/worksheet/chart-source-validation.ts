import type { ChartConfig } from '@mog-sdk/contracts/api';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { DocumentContext } from '../../context';
import { invalidChartConfig } from '../../errors/api';

type ChartSourceRefKind =
  | 'dataRange'
  | 'categoryRange'
  | 'seriesRange'
  | 'seriesName'
  | 'seriesValues'
  | 'seriesCategories'
  | 'seriesBubbleSizes';

interface ChartSourceRef {
  kind: ChartSourceRefKind;
  ref: string;
}

function addChartSourceRef(
  refs: ChartSourceRef[],
  kind: ChartSourceRefKind,
  value: string | null | undefined,
): void {
  const ref = value?.trim();
  if (ref) refs.push({ kind, ref });
}

function collectChartSourceRefs(config: ChartConfig): ChartSourceRef[] {
  const refs: ChartSourceRef[] = [];
  addChartSourceRef(refs, 'dataRange', config.dataRange);
  addChartSourceRef(refs, 'categoryRange', config.categoryRange);
  addChartSourceRef(refs, 'seriesRange', config.seriesRange);
  for (const series of config.series ?? []) {
    addChartSourceRef(refs, 'seriesName', series.nameRef);
    addChartSourceRef(refs, 'seriesValues', series.values);
    addChartSourceRef(refs, 'seriesCategories', series.categories);
    addChartSourceRef(refs, 'seriesBubbleSizes', series.bubbleSize);
  }
  return refs;
}

async function sheetNameExists(ctx: DocumentContext, sheetName: string): Promise<boolean> {
  const sheetIds = await ctx.computeBridge.getSheetOrder();
  const names = await Promise.all(sheetIds.map((id) => ctx.computeBridge.getSheetName(id)));
  const folded = sheetName.toLocaleLowerCase();
  return names.some((name) => name === sheetName || name?.toLocaleLowerCase() === folded);
}

export async function assertChartSourceRefsResolvable(
  ctx: DocumentContext,
  config: ChartConfig,
): Promise<void> {
  const diagnostics: string[] = [];

  for (const sourceRef of collectChartSourceRefs(config)) {
    const parsed = parseCellRange(sourceRef.ref);
    if (!parsed) {
      diagnostics.push(`Chart ${sourceRef.kind} is not a valid Excel A1 range`);
      continue;
    }

    if (parsed.sheetName && !(await sheetNameExists(ctx, parsed.sheetName))) {
      diagnostics.push(`Chart ${sourceRef.kind} references unknown sheet "${parsed.sheetName}"`);
    }
  }

  if (diagnostics.length > 0) {
    throw invalidChartConfig(diagnostics.join('; '));
  }
}
