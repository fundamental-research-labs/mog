import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { cn, Popover, PopoverContent, PopoverTrigger } from '@mog/shell/components/ui';

interface FilterSubmenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  className?: string;
  side?: 'left' | 'right';
  minWidth?: number | string;
  maxHeight?: number | string;
  style?: CSSProperties;
}

export function FilterSubmenu({
  open,
  onOpenChange,
  trigger,
  children,
  className,
  side = 'right',
  minWidth = 180,
  maxHeight = 'min(480px, calc(100vh - 16px))',
  style,
}: FilterSubmenuProps): ReactElement {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={4}
        role="menu"
        closeOnClickOutside={false}
        disableScrollConstraints
        className={cn('overflow-y-auto overscroll-contain', className)}
        style={{
          minWidth,
          maxHeight,
          padding: 0,
          ...style,
        }}
        data-no-grid-pointer="true"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
