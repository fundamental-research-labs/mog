import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = resolve(packageRoot, 'fixtures');

await mkdir(fixturesDir, { recursive: true });

async function writeSimpleValues() {
  const workbook = new ExcelJS.Workbook();
  const sheet1 = workbook.addWorksheet('Sheet1');
  sheet1.getCell('A1').value = 'Mog';
  sheet1.getCell('B1').value = 42;
  sheet1.getCell('C1').value = { formula: 'B1*2', result: 84 };
  sheet1.getCell('A2').value = 'second row';
  const sheet2 = workbook.addWorksheet('Second');
  sheet2.getCell('A1').value = 'second sheet';
  sheet2.getCell('B1').value = 7;
  await workbook.xlsx.writeFile(resolve(fixturesDir, 'simple-values.xlsx'));
}

async function writeFormatsAndTabs() {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { key: 'label', width: 18 },
    { key: 'value', width: 14 },
  ];
  summary.getCell('A1').value = 'Currency';
  summary.getCell('B1').value = 1234.5;
  summary.getCell('B1').numFmt = '$#,##0.00';
  summary.getCell('A2').value = 'Percent';
  summary.getCell('B2').value = 0.375;
  summary.getCell('B2').numFmt = '0.0%';
  summary.getRow(1).height = 24;
  const data = workbook.addWorksheet('Data Tab');
  data.getCell('A1').value = 'data';
  data.getCell('B2').value = 99;
  await workbook.xlsx.writeFile(resolve(fixturesDir, 'formats-and-tabs.xlsx'));
}

async function writeEditSaveReopen() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.getCell('A1').value = 'before';
  sheet.getCell('B1').value = 1;
  await workbook.xlsx.writeFile(resolve(fixturesDir, 'edit-save-reopen.xlsx'));
}

await Promise.all([writeSimpleValues(), writeFormatsAndTabs(), writeEditSaveReopen()]);
console.log(`[mog-xlsx-editor] fixtures written to ${fixturesDir}`);
