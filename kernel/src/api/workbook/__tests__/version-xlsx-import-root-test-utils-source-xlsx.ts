import 'fake-indexeddb/auto';

import { createWorkbook } from '../create-workbook';
import { encodeUtf8, writeStoredZip } from './xlsx-clean-export-package-zip-test-utils';

export async function createSourceXlsx(a1Value = 'Imported'): Promise<Uint8Array> {
  const wb = await createWorkbook({ documentId: 'vc10-xlsx-import-source', userTimezone: 'UTC' });
  try {
    await wb.activeSheet.setCell('A1', a1Value);
    await wb.activeSheet.setCell('B1', 42);
    return wb.toXlsx();
  } finally {
    await wb.close('skipSave').catch(() => {
      wb.dispose();
    });
  }
}

export function createViewStateSourceXlsx(): Uint8Array {
  return writeStoredZip([
    {
      name: '[Content_Types].xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: 'xl/workbook.xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView activeTab="1" firstSheet="1" showHorizontalScroll="0" showVerticalScroll="1" showSheetTabs="0" autoFilterDateGrouping="0" xWindow="12" yWindow="24" windowWidth="14400" windowHeight="9000" tabRatio="650"/>
  </bookViews>
  <sheets>
    <sheet name="First" sheetId="1" r:id="rId1"/>
    <sheet name="Second" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:A1"/>
  <sheetData>
    <row r="1"><c r="A1"><v>1</v></c></row>
  </sheetData>
</worksheet>`),
    },
    {
      name: 'xl/worksheets/sheet2.xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="C4:C4"/>
  <sheetViews>
    <sheetView tabSelected="1" zoomScale="125" showGridLines="0" showRowColHeaders="0" showZeros="0" showFormulas="1" rightToLeft="1" workbookViewId="0">
      <pane xSplit="2" ySplit="3" topLeftCell="C4" activePane="bottomRight" state="frozen"/>
      <selection activeCell="C4" sqref="C4"/>
    </sheetView>
  </sheetViews>
  <sheetData>
    <row r="4"><c r="C4"><v>2</v></c></row>
  </sheetData>
</worksheet>`),
    },
  ]);
}
