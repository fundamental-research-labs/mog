import { dispatch } from '../../../internal-api';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';

function HelpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7.8 7.7a2.3 2.3 0 014.4.9c0 1.6-1.7 2-2.1 3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="14.7" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function HelpRibbon() {
  const deps = useActionDependencies();

  return (
    <ToolbarGroup label="Help" isLast visibilityKey="help">
      <RibbonButton
        layout="vertical"
        height="full"
        icon={<HelpIcon />}
        label="Help"
        title="Help"
        data-testid="help-help"
        visibilityKey="help"
        onClick={() => dispatch('OPEN_HELP', deps)}
      />
    </ToolbarGroup>
  );
}
