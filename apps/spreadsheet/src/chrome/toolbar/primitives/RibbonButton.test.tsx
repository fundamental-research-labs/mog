import { render, screen } from '@testing-library/react';

import { GroupRenderModeProvider } from '../collapse/context';
import { RibbonButton } from './RibbonButton';

describe('RibbonButton', () => {
  it('preserves explicit label line breaks after compact collapse', () => {
    render(
      <GroupRenderModeProvider value="compact">
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<span aria-hidden="true" />}
          label={'Conditional\nFormatting'}
          hasDropdown
          dropdownPosition="inline"
          aria-label="Conditional Formatting"
        />
      </GroupRenderModeProvider>,
    );

    const button = screen.getByRole('button', { name: 'Conditional Formatting' });
    const label = Array.from(button.querySelectorAll('span')).find(
      (element) =>
        element.textContent === 'Conditional\nFormatting' &&
        element.classList.contains('text-ribbon'),
    );

    expect(label).toBeInstanceOf(HTMLElement);
    expect(label).toHaveClass('whitespace-pre');
    expect(label).not.toHaveClass('whitespace-nowrap');
  });

  it('does not wrap explicit multi-line full-height labels into extra lines', () => {
    render(
      <GroupRenderModeProvider value="full">
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<span aria-hidden="true" />}
          label={'Header &\nFooter'}
          aria-label="Edit Header & Footer"
        />
      </GroupRenderModeProvider>,
    );

    const button = screen.getByRole('button', { name: 'Edit Header & Footer' });
    const label = Array.from(button.querySelectorAll('span')).find(
      (element) =>
        element.textContent === 'Header &\nFooter' && element.classList.contains('text-ribbon'),
    );

    expect(label).toBeInstanceOf(HTMLElement);
    expect(label).toHaveClass('whitespace-pre');
    expect(label).not.toHaveClass('whitespace-pre-wrap');
  });

  it('does not render a corner status dot for open buttons', () => {
    render(
      <GroupRenderModeProvider value="full">
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<span aria-hidden="true" />}
          label="Freeze Panes"
          isOpen
          aria-label="Freeze Panes"
        />
      </GroupRenderModeProvider>,
    );

    const button = screen.getByRole('button', { name: 'Freeze Panes' });

    expect(button.querySelector('span.absolute.rounded-full.bg-ss-primary')).toBeNull();
  });

  it('reserves width for icon-only dropdown triggers', () => {
    render(
      <GroupRenderModeProvider value="full">
        <RibbonButton
          layout="icon-only"
          icon={<svg aria-hidden="true" data-testid="sample-icon" />}
          hasDropdown
          aria-label="Orientation"
        />
      </GroupRenderModeProvider>,
    );

    const button = screen.getByRole('button', { name: 'Orientation' });

    expect(button).toHaveClass('min-w-[28px]');
    expect(button.querySelectorAll('svg')).toHaveLength(2);
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });
});
