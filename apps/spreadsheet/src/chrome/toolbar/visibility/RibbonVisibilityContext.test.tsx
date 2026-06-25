import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

import {
  APP_EVAL_RIBBON_VISIBILITY_CONFIG,
  PUBLIC_RIBBON_VISIBILITY_CONFIG,
  isRibbonPathVisible,
  mergeRibbonVisibilityConfig,
} from '@mog-sdk/contracts/ribbon';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import { FeatureGatesProvider } from '../../../infra/context/feature-gates-context';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  RibbonVisibilityItem,
  RibbonVisibilityPathItem,
  RibbonVisibilityTab,
} from './RibbonVisibilityContext';

function wrapper(gates: FeatureGates) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <FeatureGatesProvider gates={gates}>{children}</FeatureGatesProvider>;
  };
}

describe('ribbon visibility config', () => {
  it('resolves boolean values at tab, group, and button levels', () => {
    const config = {
      home: {
        font: {
          bold: false,
        },
      },
      pageLayout: {
        themes: false,
      },
      data: false,
    } as const;

    expect(isRibbonPathVisible(config, ['home'])).toBe(true);
    expect(isRibbonPathVisible(config, ['home', 'font'])).toBe(true);
    expect(isRibbonPathVisible(config, ['home', 'font', 'bold'])).toBe(false);
    expect(isRibbonPathVisible(config, ['home', 'font', 'italic'])).toBe(true);
    expect(isRibbonPathVisible(config, ['pageLayout', 'themes'])).toBe(false);
    expect(isRibbonPathVisible(config, ['data', 'sortFilter'])).toBe(false);
  });

  it('lets the app-eval profile override public profile hidden nodes', () => {
    const publicConfig = {
      pageLayout: {
        themes: false,
      },
    } as const;
    const merged = mergeRibbonVisibilityConfig(publicConfig, APP_EVAL_RIBBON_VISIBILITY_CONFIG);

    expect(isRibbonPathVisible(merged, ['pageLayout', 'themes'])).toBe(true);
    expect(isRibbonPathVisible(merged, ['data', 'importData', 'fromWeb'])).toBe(true);
  });

  it('keeps public controls visible while hiding staged public ribbon chrome', () => {
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'tables', 'pivotTable']),
    ).toBe(true);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'tables', 'checkBox']),
    ).toBe(true);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'tables', 'comboBox']),
    ).toBe(false);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'tables', 'table']),
    ).toBe(true);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'illustrations'])).toBe(
      false,
    );
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'sparklines'])).toBe(
      false,
    );
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'filters'])).toBe(true);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'text'])).toBe(false);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'charts'])).toBe(true);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'links'])).toBe(true);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['insert', 'comments'])).toBe(true);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['data', 'importData', 'fromCsv']),
    ).toBe(true);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['data', 'importData', 'fromJson']),
    ).toBe(true);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['data', 'importData', 'fromWeb']),
    ).toBe(false);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['pageLayout'])).toBe(false);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['review'])).toBe(true);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['view'])).toBe(true);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, [
        'formulaBar',
        'controls',
        'toggleAiFormulaBar',
      ]),
    ).toBe(false);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, [
        'formulaBar',
        'controls',
        'expandCollapse',
      ]),
    ).toBe(true);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['collaboration'])).toBe(false);
    expect(
      isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, [
        'collaboration',
        'tabBar',
        'collaborate',
      ]),
    ).toBe(false);
    expect(isRibbonPathVisible(PUBLIC_RIBBON_VISIBILITY_CONFIG, ['home'])).toBe(true);
  });

  it('hides a rendered toolbar group from the nested config', () => {
    render(
      <RibbonVisibilityTab tab="pageLayout">
        <ToolbarGroup label="Themes">
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<span />}
            label="Colors"
            data-testid="ribbon-dropdown-theme-colors"
          />
        </ToolbarGroup>
      </RibbonVisibilityTab>,
      { wrapper: wrapper({ ribbonVisibility: { pageLayout: { themes: false } } }) },
    );

    expect(screen.queryByText('THEMES')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-dropdown-theme-colors')).not.toBeInTheDocument();
  });

  it('accepts the user-facing pageLayout tab key', () => {
    expect(isRibbonPathVisible({ pageLayout: false }, ['pageLayout', 'themes'])).toBe(false);
  });

  it('hides a rendered ribbon button from the nested config', () => {
    render(
      <RibbonVisibilityTab tab="pageLayout">
        <ToolbarGroup label="Themes">
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<span />}
            label="Colors"
            data-testid="ribbon-dropdown-theme-colors"
          />
        </ToolbarGroup>
      </RibbonVisibilityTab>,
      {
        wrapper: wrapper({
          ribbonVisibility: { pageLayout: { themes: { themeColors: false } } },
        }),
      },
    );

    expect(screen.getByRole('group', { name: 'Themes' })).toBeInTheDocument();
    expect(screen.queryByTestId('ribbon-dropdown-theme-colors')).not.toBeInTheDocument();
  });

  it('hides non-RibbonButton controls through the shared item wrapper', () => {
    render(
      <RibbonVisibilityTab tab="pageLayout">
        <ToolbarGroup label="Scale to Fit">
          <RibbonVisibilityItem item="width">
            <select aria-label="Scale Width">
              <option>Automatic</option>
            </select>
          </RibbonVisibilityItem>
          <RibbonVisibilityItem item="height">
            <select aria-label="Scale Height">
              <option>Automatic</option>
            </select>
          </RibbonVisibilityItem>
        </ToolbarGroup>
      </RibbonVisibilityTab>,
      {
        wrapper: wrapper({
          ribbonVisibility: { pageLayout: { scaleToFit: { width: false } } },
        }),
      },
    );

    expect(screen.queryByLabelText('Scale Width')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Scale Height')).toBeInTheDocument();
  });

  it('hides non-ribbon chrome controls through the shared path wrapper', () => {
    render(
      <div>
        <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'toggleAiFormulaBar']}>
          <button type="button">AI formula</button>
        </RibbonVisibilityPathItem>
        <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'expandCollapse']}>
          <button type="button">Expand formula bar</button>
        </RibbonVisibilityPathItem>
      </div>,
      {
        wrapper: wrapper({
          ribbonVisibility: {
            formulaBar: {
              controls: {
                toggleAiFormulaBar: false,
              },
            },
          },
        }),
      },
    );

    expect(screen.queryByText('AI formula')).not.toBeInTheDocument();
    expect(screen.getByText('Expand formula bar')).toBeInTheDocument();
  });

  it('uses explicit visibility keys before generated fallback keys', () => {
    render(
      <RibbonVisibilityTab tab="home">
        <ToolbarGroup label="Font">
          <RibbonButton
            layout="icon-only"
            icon={<span />}
            aria-label="Font color"
            data-testid="font-color-dropdown-trigger"
            visibilityKey="fontColor"
          />
        </ToolbarGroup>
      </RibbonVisibilityTab>,
      {
        wrapper: wrapper({
          ribbonVisibility: { home: { font: { fontColor: false } } },
        }),
      },
    );

    expect(screen.queryByTestId('font-color-dropdown-trigger')).not.toBeInTheDocument();
  });

  it('prefers visible labels over aria labels for button fallback keys', () => {
    render(
      <RibbonVisibilityTab tab="insert">
        <ToolbarGroup label="Illustrations">
          <RibbonButton
            layout="vertical"
            height="full"
            icon={<span />}
            label="Pictures"
            aria-label="Insert Picture"
          />
        </ToolbarGroup>
      </RibbonVisibilityTab>,
      {
        wrapper: wrapper({
          ribbonVisibility: { insert: { illustrations: { pictures: false } } },
        }),
      },
    );

    expect(screen.getByRole('group', { name: 'Illustrations' })).toBeInTheDocument();
    expect(screen.queryByText('Pictures')).not.toBeInTheDocument();
  });
});
