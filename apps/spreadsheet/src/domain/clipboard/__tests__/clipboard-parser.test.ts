import { detectFormat, parseCSV, parseClipboardText, parseTSV } from '../clipboard-parser';

describe('clipboard-parser', () => {
  describe('detectFormat', () => {
    it('chooses CSV when quoted fields contain newlines before a comma delimiter', () => {
      expect(detectFormat('"a\nb",c')).toBe('csv');
    });

    it('chooses CSV when quoted fields contain literal tabs before a comma delimiter', () => {
      expect(detectFormat('"a\tb",c')).toBe('csv');
    });

    it('chooses TSV when unquoted tabs separate formulas that contain commas', () => {
      expect(detectFormat('=SUM(1,2,3)\t=MAX(4,5)')).toBe('tsv');
      expect(detectFormat('=IF(A1>0,1,0)\t=SUM(1,2)')).toBe('tsv');
    });

    it('still chooses CSV for comma-delimited data without tabs', () => {
      expect(detectFormat('hello,world\nfoo,bar')).toBe('csv');
    });
  });

  describe('parseClipboardText', () => {
    it('preserves newlines inside quoted CSV fields', () => {
      expect(parseClipboardText('"a\nb",c')).toEqual([['a\nb', 'c']]);
    });

    it('preserves tabs inside quoted CSV fields', () => {
      expect(parseClipboardText('"a\tb",c')).toEqual([['a\tb', 'c']]);
    });

    it('preserves comma-containing formulas in tab-delimited payloads', () => {
      expect(parseClipboardText('=SUM(1,2,3)\t=MAX(4,5)')).toEqual([['=SUM(1,2,3)', '=MAX(4,5)']]);
      expect(parseClipboardText('=IF(A1>0,1,0)\t=SUM(1,2)')).toEqual([
        ['=IF(A1>0,1,0)', '=SUM(1,2)'],
      ]);
    });

    it('still parses plain CSV rows', () => {
      expect(parseClipboardText('hello,world\nfoo,bar')).toEqual([
        ['hello', 'world'],
        ['foo', 'bar'],
      ]);
    });

    it('parses large delimiter-free text as a single cell without quadratic slowdown', () => {
      const payload = 'ABCDEFGHIJ'.repeat(100_000);
      const started = performance.now();

      expect(parseClipboardText(payload)).toEqual([[payload]]);

      const elapsedMs = performance.now() - started;
      expect(elapsedMs).toBeLessThan(1_000);
    });

    it('preserves large quoted fields', () => {
      const field = 'quoted,field\n'.repeat(10_000);
      expect(parseClipboardText(`"${field}"\tend`)).toEqual([[field, 'end']]);
    });
  });

  describe('parseCSV', () => {
    it('does not split unquoted formulas at argument commas', () => {
      expect(parseCSV('=SUM(1,2),=MAX(3,4)')).toEqual([['=SUM(1,2)', '=MAX(3,4)']]);
    });

    it('preserves formula string-literal quotes and commas', () => {
      expect(parseCSV('=IF(A1="x,y",1,0),done')).toEqual([['=IF(A1="x,y",1,0)', 'done']]);
    });
  });

  describe('parseTSV', () => {
    it('supports quoted tabs and newlines in TSV fields', () => {
      expect(parseTSV('"a\tb"\t"c\nd"')).toEqual([['a\tb', 'c\nd']]);
    });

    it('preserves formula string-literal tabs', () => {
      expect(parseTSV('="a\tb"\t=SUM(1,2)')).toEqual([['="a\tb"', '=SUM(1,2)']]);
    });
  });
});
