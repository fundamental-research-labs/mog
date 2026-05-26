import { useUIStore } from '../../infra/context';
import { WorkbookLinksPanel } from './WorkbookLinksPanel';

export function WorkbookLinksPanelContainer(): React.JSX.Element | null {
  const isOpen = useUIStore((s) => s.workbookLinksPanel?.isOpen ?? false);
  if (!isOpen) return null;
  return (
    <div className="absolute top-0 right-0 bottom-0 z-ss-sticky">
      <WorkbookLinksPanel />
    </div>
  );
}
