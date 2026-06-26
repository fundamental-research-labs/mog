import '@mog/app-spreadsheet/globals.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MogSpreadsheetApp,
  createSpreadsheetRuntime,
  type SpreadsheetRuntime,
  type SpreadsheetWorkbookSession,
} from '../../../runtime/spreadsheet-app/src/index';
import { devFormulaAI } from './dev-formula-ai';

type ManualCellValue = string | number;

const manualSessionId =
  globalThis.crypto?.randomUUID?.() ?? `session-${Date.now().toString(36)}`;

const rows: readonly (readonly ManualCellValue[])[] = [
  [
    'Month',
    'Segment',
    'Units',
    'Price',
    'Revenue',
    'COGS %',
    'COGS',
    'Gross Profit',
    'Target Revenue',
    'Status',
    'Discount',
    'Net Revenue',
    'Gross Margin',
    'Notes',
  ],
  [
    'Jan',
    'East',
    120,
    42,
    '=C2*D2',
    0.45,
    '=E2*F2',
    '=E2-G2',
    4800,
    '=IF(E2>=I2,"On Track","Below Target")',
    0.02,
    '=E2*(1-K2)',
    '=IFERROR(H2/E2,0)',
    'Baseline month',
  ],
  [
    'Jan',
    'West',
    95,
    45,
    '=C3*D3',
    0.46,
    '=E3*F3',
    '=E3-G3',
    4200,
    '=IF(E3>=I3,"On Track","Below Target")',
    0.03,
    '=E3*(1-K3)',
    '=IFERROR(H3/E3,0)',
    'Lower unit volume',
  ],
  [
    'Jan',
    'Central',
    88,
    40,
    '=C4*D4',
    0.44,
    '=E4*F4',
    '=E4-G4',
    3500,
    '=IF(E4>=I4,"On Track","Below Target")',
    0.04,
    '=E4*(1-K4)',
    '=IFERROR(H4/E4,0)',
    'Discounted pricing',
  ],
  [
    'Feb',
    'East',
    135,
    43,
    '=C5*D5',
    0.45,
    '=E5*F5',
    '=E5-G5',
    5300,
    '=IF(E5>=I5,"On Track","Below Target")',
    0.01,
    '=E5*(1-K5)',
    '=IFERROR(H5/E5,0)',
    'Growth campaign',
  ],
  [
    'Feb',
    'West',
    110,
    45,
    '=C6*D6',
    0.47,
    '=E6*F6',
    '=E6-G6',
    4700,
    '=IF(E6>=I6,"On Track","Below Target")',
    0.02,
    '=E6*(1-K6)',
    '=IFERROR(H6/E6,0)',
    'Channel promo',
  ],
  [
    'Feb',
    'Central',
    91,
    41,
    '=C7*D7',
    0.44,
    '=E7*F7',
    '=E7-G7',
    3700,
    '=IF(E7>=I7,"On Track","Below Target")',
    0.03,
    '=E7*(1-K7)',
    '=IFERROR(H7/E7,0)',
    'Stable demand',
  ],
  [
    'Mar',
    'East',
    142,
    44,
    '=C8*D8',
    0.45,
    '=E8*F8',
    '=E8-G8',
    5900,
    '=IF(E8>=I8,"On Track","Below Target")',
    0.01,
    '=E8*(1-K8)',
    '=IFERROR(H8/E8,0)',
    'Price increase',
  ],
  [
    'Mar',
    'West',
    128,
    46,
    '=C9*D9',
    0.47,
    '=E9*F9',
    '=E9-G9',
    5400,
    '=IF(E9>=I9,"On Track","Below Target")',
    0.02,
    '=E9*(1-K9)',
    '=IFERROR(H9/E9,0)',
    'Strong rebound',
  ],
  [
    'Mar',
    'Central',
    104,
    42,
    '=C10*D10',
    0.44,
    '=E10*F10',
    '=E10-G10',
    4200,
    '=IF(E10>=I10,"On Track","Below Target")',
    0.03,
    '=E10*(1-K10)',
    '=IFERROR(H10/E10,0)',
    'Volume lift',
  ],
  [
    'Apr',
    'East',
    150,
    44,
    '=C11*D11',
    0.46,
    '=E11*F11',
    '=E11-G11',
    6200,
    '=IF(E11>=I11,"On Track","Below Target")',
    0.01,
    '=E11*(1-K11)',
    '=IFERROR(H11/E11,0)',
    'Fulfillment tight',
  ],
  [
    'Apr',
    'West',
    136,
    47,
    '=C12*D12',
    0.47,
    '=E12*F12',
    '=E12-G12',
    6100,
    '=IF(E12>=I12,"On Track","Below Target")',
    0.02,
    '=E12*(1-K12)',
    '=IFERROR(H12/E12,0)',
    'Best west month',
  ],
  [
    'Apr',
    'Central',
    112,
    42,
    '=C13*D13',
    0.45,
    '=E13*F13',
    '=E13-G13',
    4500,
    '=IF(E13>=I13,"On Track","Below Target")',
    0.03,
    '=E13*(1-K13)',
    '=IFERROR(H13/E13,0)',
    'New account wins',
  ],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  [
    'Total',
    '',
    '=SUM(C2:C13)',
    '',
    '=SUM(E2:E13)',
    '',
    '=SUM(G2:G13)',
    '=SUM(H2:H13)',
    '',
    '',
    '',
    '=SUM(L2:L13)',
    '=IFERROR(H15/E15,0)',
    '',
  ],
  ['Average price', '', '', '=IFERROR(E15/C15,0)', '', '', '', '', '', '', '', '', '', ''],
  ['West revenue', '', '', '', '=SUMIF(B2:B13,"West",E2:E13)', '', '', '', '', '', '', '', '', ''],
  [
    'East gross profit',
    '',
    '',
    '',
    '',
    '',
    '',
    '=SUMIF(B2:B13,"East",H2:H13)',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'Feb East revenue',
    '',
    '',
    '',
    '=SUMIFS(E2:E13,A2:A13,"Feb",B2:B13,"East")',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'East growth vs Jan',
    '',
    '',
    '',
    '=SUMIFS(E2:E13,A2:A13,"Feb",B2:B13,"East")-SUMIFS(E2:E13,A2:A13,"Jan",B2:B13,"East")',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'Top revenue segment',
    '',
    '=INDEX(B2:B13,MATCH(MAX(E2:E13),E2:E13,0))',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'Plan check',
    '',
    '',
    '',
    '=IF(E17>18000,"West is over plan","West needs attention")',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'Weighted ASP',
    '',
    '',
    '=IFERROR(SUMPRODUCT(C2:C13,D2:D13)/SUM(C2:C13),0)',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    'COGS risk',
    '',
    '',
    '',
    '=IF(MAX(F2:F13)>0.46,"Review high COGS","COGS within range")',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ],
  ['Margin misses', '', '', '', '=COUNTIF(M2:M13,"<0.55")', '', '', '', '', '', '', '', '', ''],
];

async function seedWorkbook(workbook: SpreadsheetWorkbookSession): Promise<void> {
  const sheet = workbook.getWorkbook().activeSheet;
  for (let row = 0; row < rows.length; row++) {
    const values = rows[row];
    for (let col = 0; col < values.length; col++) {
      const value = values[col];
      if (value !== '') {
        await sheet.setCell(row, col, value);
      }
    }
  }
}

function ManualFormulaAIApp(): React.JSX.Element {
  const [state, setState] = useState<
    | { status: 'loading'; message: string }
    | { status: 'ready'; runtime: SpreadsheetRuntime; workbook: SpreadsheetWorkbookSession }
    | { status: 'error'; error: Error }
  >({ status: 'loading', message: 'Preparing Formula AI manual test...' });

  useEffect(() => {
    let cancelled = false;
    let runtime: SpreadsheetRuntime | undefined;
    let workbook: SpreadsheetWorkbookSession | undefined;
    const showLoading = (message: string) => {
      if (!cancelled) setState({ status: 'loading', message });
    };

    void (async () => {
      try {
        showLoading('Creating spreadsheet runtime...');
        runtime = await createSpreadsheetRuntime({
          runtimeId: `manual-formula-ai-runtime-${manualSessionId}`,
          host: {
            persistenceMode: 'host-owned-ephemeral',
            beforeUnloadPrompt: false,
          },
          services: {
            formulaAI: devFormulaAI,
          },
        });
        showLoading('Waiting for runtime readiness...');
        await runtime.ready;

        showLoading('Opening seeded workbook...');
        workbook = await runtime.openWorkbook({
          workbookId: `manual-formula-ai-workbook-${manualSessionId}`,
          displayName: 'Formula AI Manual Test',
          source: { kind: 'blank' },
        });
        showLoading('Waiting for workbook readiness...');
        await workbook.ready;
        showLoading('Seeding formula examples...');
        await seedWorkbook(workbook);

        if (!cancelled) {
          setState({ status: 'ready', runtime, workbook });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      void workbook?.dispose();
      void runtime?.dispose();
    };
  }, []);

  if (state.status === 'loading') {
    return <div className="grid h-screen place-items-center font-sans">{state.message}</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="grid h-screen place-items-center p-8 font-sans text-red-700">
        {state.error.message}
      </div>
    );
  }

  return (
    <MogSpreadsheetApp
      runtime={state.runtime}
      workbook={state.workbook}
      workspace={{
        mode: 'single-document',
        fileExplorer: false,
        appSwitcher: false,
        settings: true,
      }}
      chrome={{
        fileMenu: false,
        formulaBar: true,
        sheetTabs: true,
        statusBar: true,
      }}
      featurePolicy={{
        capabilities: {
          formulaAI: true,
          formulaBar: true,
        },
        ribbonVisibility: {
          formulaBar: true,
          nlFormulaBar: true,
        },
      }}
      onReady={(handle) => handle.focus()}
    />
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <ManualFormulaAIApp />
  </StrictMode>,
);
