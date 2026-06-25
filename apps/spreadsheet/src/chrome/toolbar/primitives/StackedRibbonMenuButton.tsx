import type { ReactNode } from 'react';

import { Tooltip } from '@mog/shell';
import { useRibbonButtonVisible } from '../visibility/RibbonVisibilityContext';
import { DropdownArrowIcon } from './ToolbarIcons';

interface StackedRibbonMenuButtonProps {
  id: string;
  testId: string;
  icon: ReactNode;
  label: string;
  visibilityKey: string;
  isOpen: boolean;
  onClick: () => void;
}

export function StackedRibbonMenuButton({
  id,
  testId,
  icon,
  label,
  visibilityKey,
  isOpen,
  onClick,
}: StackedRibbonMenuButtonProps) {
  const visible = useRibbonButtonVisible({ visibilityKey, label, testId });

  if (!visible) {
    return null;
  }

  return (
    <Tooltip title={label}>
      <button
        id={id}
        type="button"
        data-testid={testId}
        onClick={onClick}
        className="flex h-5 min-w-[132px] items-center gap-1.5 rounded px-1.5 text-ribbon-compact leading-none text-ss-text-secondary transition-colors duration-ss-fast hover:bg-ss-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-ss-primary"
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="flex-1 whitespace-nowrap text-left">{label}</span>
        <DropdownArrowIcon className={isOpen ? 'rotate-180' : ''} />
      </button>
    </Tooltip>
  );
}
