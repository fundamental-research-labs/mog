import { Fragment } from 'react';

import {
  ContextMenuCheckboxItem,
  ContextMenuItem as ContextMenuItemComponent,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@mog/shell/components/ui';

import type { ContextMenuItem as ContextMenuItemType } from './types';

interface MenuItemRendererProps {
  items: ContextMenuItemType[];
  onClose: () => void;
}

export function MenuItemRenderer({ items, onClose }: MenuItemRendererProps) {
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {item.children && item.children.length > 0 ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger icon={item.icon} disabled={item.disabled}>
                {item.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <MenuItemRenderer items={item.children} onClose={onClose} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : item.checked !== undefined ? (
            <ContextMenuCheckboxItem
              checked={item.checked}
              disabled={item.disabled}
              onCheckedChange={() => {
                item.onClick();
                onClose();
              }}
            >
              {item.label}
            </ContextMenuCheckboxItem>
          ) : (
            <ContextMenuItemComponent
              data-testid={item.testId}
              icon={item.icon}
              shortcut={item.shortcut}
              disabled={item.disabled}
              destructive={item.danger}
              onSelect={() => {
                item.onClick();
                onClose();
              }}
            >
              {item.label}
            </ContextMenuItemComponent>
          )}
          {item.dividerAfter && index < items.length - 1 && <ContextMenuSeparator />}
        </Fragment>
      ))}
    </>
  );
}
