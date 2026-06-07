import { readFileSync } from 'node:fs';

describe('unsupported macro ribbon affordances', () => {
  test('View ribbon does not expose a Macros group or macro recording controls', () => {
    const source = readFileSync(new URL('../ViewRibbon.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('MACROS_COLLAPSE_CONFIG');
    expect(source).not.toContain('label="Macros"');
    expect(source).not.toContain('id="view-macros"');
    expect(source).not.toContain('id="view-record-macro"');
    expect(source).not.toContain('id="view-use-relative-references"');
    expect(source).not.toContain('TOGGLE_MACRO_RECORDING');
    expect(source).not.toContain('View Macros');
    expect(source).not.toContain('Record Macro');
    expect(source).not.toContain('Use Relative References');
  });
});

describe('removed ribbon tabs', () => {
  test('Automate and Experimental ribbons are not exported from the toolbar surface', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('AutomateRibbon');
    expect(source).not.toContain('ExperimentalRibbon');
    expect(source).toContain('HelpRibbon');
  });

  test('TabbedToolbar does not render removed base ribbons', () => {
    const source = readFileSync(
      new URL('../../primitives/TabbedToolbar.tsx', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('<AutomateRibbon');
    expect(source).not.toContain('<ExperimentalRibbon');
    expect(source).toContain('<HelpRibbon');
  });

  test('ribbon tab keytips do not register removed base tabs', () => {
    const source = readFileSync(
      new URL('../../../../keyboard/definitions/ribbon.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain("tabId: 'automate'");
    expect(source).not.toContain("tabId: 'experimental'");
    expect(source).toContain("tabId: 'help'");
  });
});

describe('removed Help ribbon affordances', () => {
  test("Help ribbon does not expose a What's New command", () => {
    const source = readFileSync(new URL('../HelpRibbon.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("What's New");
    expect(source).not.toContain('whatsNew');
    expect(source).not.toContain('OPEN_HELP_WHATS_NEW');
  });

  test("help URL utilities do not ship a What's New release-note target", () => {
    const source = readFileSync(
      new URL('../../../../infra/utils/help.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('whatsNew');
    expect(source).not.toContain('changelog');
  });
});

describe('unsupported Data ribbon affordances', () => {
  test('Data ribbon does not expose connection controls before connections are supported', () => {
    const source = readFileSync(new URL('../DataRibbon.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('QUERIES_CONNECTIONS_COLLAPSE_CONFIG');
    expect(source).not.toContain('PRODUCT_VOCABULARY.connections.label');
    expect(source).not.toContain('id="data-workbook-links"');
    expect(source).not.toContain('id="data-schema-browser"');
    expect(source).not.toContain('aria-label="Refresh All"');
    expect(source).not.toContain('aria-label="Workbook Links"');
    expect(source).not.toContain('aria-label="Schema Browser"');
  });
});
