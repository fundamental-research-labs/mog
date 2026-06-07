import { useCallback, useState } from 'react';

import { FORMULA_AUDITING_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';

import {
  dispatch,
  useActionDependencies,
  useActiveSheetId,
  useSheetViewOptions,
  useUIStore,
} from '../../../../internal-api';
import { useTraceArrows } from '../../../../hooks/view/use-trace-arrows';
import {
  ErrorCheckingIcon,
  EvaluateFormulaIcon,
  FormulaReferencesIcon,
  RemoveArrowsIcon,
  WatchWindowIcon,
} from '../../primitives/FormulasIcons';
import { RibbonButton } from '../../primitives/RibbonButton';
import { RibbonDropdown, RibbonDropdownItem } from '../../primitives/RibbonDropdown';
import { SplitButton } from '../../primitives/SplitButton';
import { ToolbarGroup } from '../../primitives/ToolbarGroup';
import {
  ShowFormulasIcon,
  TraceDependentsIcon,
  TracePrecedentsIcon,
} from '../../primitives/ToolbarIcons';

export function FormulaAuditingGroup() {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const { viewOptions } = useSheetViewOptions(activeSheetId);
  const showFormulas = viewOptions.showFormulas;
  const setSidePanelContent = useUIStore((s) => s.setSidePanelContent);
  const setSidePanelVisible = useUIStore((s) => s.setSidePanelVisible);
  const {
    tracePrecedents,
    traceDependents,
    removeAllArrows,
    removePrecedentArrows,
    removeDependentArrows,
    hasArrows,
  } = useTraceArrows();
  const [removeArrowsOpen, setRemoveArrowsOpen] = useState(false);

  const handleTracePrecedents = useCallback(() => {
    tracePrecedents();
  }, [tracePrecedents]);

  const handleTraceDependents = useCallback(() => {
    traceDependents();
  }, [traceDependents]);

  const handleRemoveArrows = useCallback(() => {
    removeAllArrows();
    setRemoveArrowsOpen(false);
  }, [removeAllArrows]);

  const handleRemoveArrowsDropdownClick = useCallback(() => {
    setRemoveArrowsOpen((open) => !open);
  }, []);

  const handleRemovePrecedentArrows = useCallback(() => {
    removePrecedentArrows();
    setRemoveArrowsOpen(false);
  }, [removePrecedentArrows]);

  const handleRemoveDependentArrows = useCallback(() => {
    removeDependentArrows();
    setRemoveArrowsOpen(false);
  }, [removeDependentArrows]);

  const handleShowFormulas = useCallback(() => {
    dispatch('TOGGLE_SHOW_FORMULAS', deps);
  }, [deps]);

  const handleErrorChecking = useCallback(() => {
    dispatch('OPEN_ERROR_CHECKING_DIALOG', deps);
  }, [deps]);

  const handleEvaluateFormula = useCallback(() => {
    dispatch('OPEN_EVALUATE_FORMULA_DIALOG', deps);
  }, [deps]);

  const handleFormulaReferences = useCallback(() => {
    setSidePanelContent('formula-references');
    setSidePanelVisible(true);
  }, [setSidePanelContent, setSidePanelVisible]);

  const handleWatchWindow = useCallback(() => {
    dispatch('OPEN_WATCH_WINDOW', deps);
  }, [deps]);

  return (
    <ToolbarGroup
      label="Formula Auditing"
      collapseConfig={FORMULA_AUDITING_COLLAPSE_CONFIG}
      dropdownIcon={<TracePrecedentsIcon />}
    >
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<TracePrecedentsIcon />}
          label="Precedents"
          onClick={handleTracePrecedents}
          title="Trace Precedents - Show cells that affect selected cell"
          aria-label="Trace Precedents"
          visibilityKey="tracePrecedents"
        />

        <RibbonButton
          layout="vertical"
          height="full"
          width="narrow"
          icon={<TraceDependentsIcon />}
          label="Dependents"
          onClick={handleTraceDependents}
          title="Trace Dependents - Show cells affected by selected cell"
          aria-label="Trace Dependents"
          visibilityKey="traceDependents"
        />

        <RibbonDropdown
          open={removeArrowsOpen}
          onOpenChange={setRemoveArrowsOpen}
          menuTestId="ribbon-dropdown-menu-remove-arrows"
          trigger={
            <SplitButton
              icon={<RemoveArrowsIcon />}
              label="Remove"
              variant="large"
              isOpen={removeArrowsOpen}
              disabled={!hasArrows}
              onMainClick={handleRemoveArrows}
              onDropdownClick={handleRemoveArrowsDropdownClick}
              mainTestId="ribbon-dropdown-remove-arrows"
              dropdownTestId="ribbon-dropdown-remove-arrows-options"
              title="Remove Arrows - Remove trace arrows"
              aria-label="Remove Arrows"
              visibilityKey="removeArrows"
            />
          }
          width="auto"
          menuLabel="Remove arrows options"
          manualTrigger
        >
          <RibbonDropdownItem dataValue="all" onClick={handleRemoveArrows}>
            Remove Arrows
          </RibbonDropdownItem>
          <RibbonDropdownItem dataValue="precedent" onClick={handleRemovePrecedentArrows}>
            Remove Precedent Arrows
          </RibbonDropdownItem>
          <RibbonDropdownItem dataValue="dependent" onClick={handleRemoveDependentArrows}>
            Remove Dependent Arrows
          </RibbonDropdownItem>
        </RibbonDropdown>

        <RibbonButton
          layout="vertical"
          height="full"
          width="normal"
          icon={<ShowFormulasIcon />}
          label={'Show\nFormulas'}
          onClick={handleShowFormulas}
          isOpen={showFormulas}
          title={`Show Formulas (Ctrl+\`) - ${showFormulas ? 'ON' : 'OFF'}`}
          aria-label="Show Formulas"
          aria-pressed={showFormulas}
          visibilityKey="showFormulas"
        />

        <RibbonButton
          layout="vertical"
          height="full"
          width="normal"
          icon={<ErrorCheckingIcon />}
          label={'Error\nChecking'}
          onClick={handleErrorChecking}
          title="Error Checking - Check formulas for errors"
          aria-label="Error Checking"
          visibilityKey="errorChecking"
        />

        <RibbonButton
          layout="vertical"
          height="full"
          width="normal"
          icon={<EvaluateFormulaIcon />}
          label={'Evaluate\nFormula'}
          onClick={handleEvaluateFormula}
          title="Evaluate Formula - Step through selected formula"
          aria-label="Evaluate Formula"
          visibilityKey="evaluateFormula"
        />

        <RibbonButton
          layout="vertical"
          height="full"
          width="normal"
          icon={<FormulaReferencesIcon />}
          label={'Formula\nReferences'}
          onClick={handleFormulaReferences}
          title="Formula References - Inspect formula reference links"
          aria-label="Formula References"
          visibilityKey="formulaReferences"
        />

        <RibbonButton
          layout="vertical"
          height="full"
          width="normal"
          icon={<WatchWindowIcon />}
          label={'Watch\nWindow'}
          onClick={handleWatchWindow}
          title="Watch Window - Monitor selected cells"
          aria-label="Watch Window"
          visibilityKey="watchWindow"
        />
      </div>
    </ToolbarGroup>
  );
}
