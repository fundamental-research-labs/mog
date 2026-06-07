/**
 * FormulasRibbon
 *
 * Formulas tab content: Function library, defined names, formula auditing, calculation options.
 *
 * Features implemented:
 * - Insert Function: Opens dialog to browse and insert 310+ Excel functions
 * - AutoSum: Automatically detects numeric range and inserts SUM formula
 * - Function Categories: Financial, Logical, Text, Date/Time, Lookup, Math/Trig, More
 * - Defined Names: Name Manager, Define Name, Create from Selection (stubs)
 * - Formula Auditing: Precedents, Dependents, Remove Arrows, Show Formulas, Error Checking
 * - Calculation: Auto/Manual mode, Calculate Now, Calculate Sheet
 *
 * implementation (F1-F4) - Excel 365 parity
 */

import { useCallback, useEffect, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore, useWorkbook } from '../../../internal-api';

import { ChevronDownSvg } from '@mog/icons';
import type { CalculationSettings } from '@mog-sdk/contracts/core';
import {
  CALCULATION_COLLAPSE_CONFIG,
  DEFINED_NAMES_COLLAPSE_CONFIG,
  FUNCTION_LIBRARY_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useWorkbookSettings } from '../../../hooks/settings/use-workbook-settings';
import { keyTipRegistry } from '../keytips';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@mog/shell';
import {
  CalculateSheetIcon,
  CreateFromSelectionIcon,
  DateTimeFunctionIcon,
  DefineNameIcon,
  FinancialFunctionIcon,
  LogicalFunctionIcon,
  LookupFunctionIcon,
  MathTrigFunctionIcon,
  MoreFunctionsIcon,
  RecentlyUsedIcon,
  TextFunctionIcon,
  UseInFormulaIcon,
} from '../primitives/FormulasIcons';
import { RibbonButton } from '../primitives/RibbonButton';
import {
  RibbonDropdown,
  RibbonDropdownDivider,
  RibbonDropdownItem,
  RibbonDropdownSubmenu,
} from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  AutoSumIcon,
  CalculateIcon,
  FunctionIcon,
  NameManagerIcon,
} from '../primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../visibility/RibbonVisibilityContext';
import { FormulaAuditingGroup } from './formulas/FormulaAuditingGroup';
import { FUNCTION_CATEGORIES } from './formulas/function-categories';

// =============================================================================
// Component
// =============================================================================

export function FormulasRibbon() {
  // Action dependencies for unified action system
  const deps = useActionDependencies();
  const { settings: workbookSettings } = useWorkbookSettings();

  // UI Store - READ ONLY selectors (mutations go through dispatch)
  const calculationSettings: CalculationSettings = workbookSettings.calculationSettings ?? {
    enableIterativeCalculation: false,
    maxIterations: 100,
    maxChange: 0.001,
    calcMode: 'auto' as const,
    fullPrecision: true,
    r1c1Mode: false,
    fullCalcOnLoad: false,
    calcCompleted: true,
    calcOnSave: true,
    concurrentCalc: true,
    concurrentManualCount: null,
    forceFullCalc: false,
    hasExplicitIterateCount: false,
    hasExplicitIterateDelta: false,
  };
  const calculationMode = calculationSettings.calcMode === 'manual' ? 'manual' : 'auto';
  const iterativeCalculationEnabled = calculationSettings.enableIterativeCalculation === true;

  // Workbook API for recalculation
  const wb = useWorkbook();
  const mruFunctions = useUIStore((s) => s.mruFunctions);

  // AutoSum dispatch hook
  const dispatchAction = useDispatch();

  // Dropdown states (F1)
  const [autoSumOpen, setAutoSumOpen] = useState(false);
  const [recentlyUsedOpen, setRecentlyUsedOpen] = useState(false);

  const [lookupOpen, setLookupOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [useInFormulaOpen, setUseInFormulaOpen] = useState(false);
  const [definedNames, setDefinedNames] = useState<Array<{ name: string; scope?: string }>>([]);

  // function-category dropdowns lifted into the ribbonDropdowns slice
  // so the keytip chord (Alt+M,F/L/T/D/G) can open them via OPEN_RIBBON_DROPDOWN.
  const financialOpen = useUIStore((s) => s.ribbonDropdowns['formulas.financial'] ?? false);
  const logicalOpen = useUIStore((s) => s.ribbonDropdowns['formulas.logical'] ?? false);
  const textOpen = useUIStore((s) => s.ribbonDropdowns['formulas.text'] ?? false);
  const dateTimeOpen = useUIStore((s) => s.ribbonDropdowns['formulas.date-time'] ?? false);
  const mathTrigOpen = useUIStore((s) => s.ribbonDropdowns['formulas.math-trig'] ?? false);
  const openRibbonDropdown = useUIStore((s) => s.openRibbonDropdown);
  const closeRibbonDropdown = useUIStore((s) => s.closeRibbonDropdown);
  const setFinancialOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('formulas.financial') : closeRibbonDropdown('formulas.financial'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setLogicalOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('formulas.logical') : closeRibbonDropdown('formulas.logical'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setTextOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('formulas.text') : closeRibbonDropdown('formulas.text'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setDateTimeOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('formulas.date-time') : closeRibbonDropdown('formulas.date-time'),
    [openRibbonDropdown, closeRibbonDropdown],
  );
  const setMathTrigOpen = useCallback(
    (open: boolean) =>
      open ? openRibbonDropdown('formulas.math-trig') : closeRibbonDropdown('formulas.math-trig'),
    [openRibbonDropdown, closeRibbonDropdown],
  );

  const refreshDefinedNames = useCallback(async () => {
    try {
      const names = await wb.names.list();
      setDefinedNames(
        names
          .filter((name) => name.visible !== false)
          .map((name) => ({ name: name.name, scope: name.scope })),
      );
    } catch (error) {
      console.error('Failed to load defined names:', error);
      setDefinedNames([]);
    }
  }, [wb]);

  useEffect(() => {
    if (useInFormulaOpen) {
      void refreshDefinedNames();
    }
  }, [refreshDefinedNames, useInFormulaOpen]);

  useEffect(() => {
    const unsubscribe = wb.on('namedRangeChanged', () => {
      if (useInFormulaOpen) {
        void refreshDefinedNames();
      }
    });
    return unsubscribe;
  }, [refreshDefinedNames, useInFormulaOpen, wb]);

  // Handle Insert Function click - uses unified action system
  const handleInsertFunction = useCallback(() => {
    dispatch('OPEN_INSERT_FUNCTION_DIALOG', deps);
  }, [deps]);

  // Handle AutoSum click (default SUM variant)
  const handleAutoSum = useCallback(() => {
    dispatchAction('AUTO_SUM');
  }, [dispatchAction]);

  // Handle Calculation Mode change - uses unified action system
  const handleCalculationModeChange = useCallback(
    (mode: string) => {
      dispatch('SET_CALCULATION_MODE', deps, {
        mode: mode as 'auto' | 'manual',
      });
    },
    [deps],
  );

  const handleIterativeCalculationChange = useCallback(
    async (enabled: boolean) => {
      await wb.setIterativeCalculation(enabled);
      await wb.calculate();
    },
    [wb],
  );

  // Handle Calculate Now (F9)
  const handleCalculateNow = useCallback(() => {
    void wb.calculate();
  }, [wb]);

  // Handle Calculate Sheet (Shift+F9) - F4
  const handleCalculateSheet = useCallback(() => {
    // Recalculate (currently triggers full workbook recalc via Workbook API)
    void wb.calculate();
  }, [wb]);

  // Handle function selection from category dropdown (F1) - uses unified action system
  // THIS IS THE KEY FIX: Inserts the function directly instead of opening dialog
  const handleFunctionSelect = useCallback(
    (functionName: string) => {
      dispatch('INSERT_FUNCTION', deps, { functionName });
    },
    [deps],
  );

  // Handle Name Manager click (F2) - uses unified action system
  const handleNameManager = useCallback(() => {
    dispatch('OPEN_NAME_MANAGER', deps);
  }, [deps]);

  // Handle Define Name click (F2) - uses unified action system
  const handleDefineName = useCallback(() => {
    dispatch('OPEN_DEFINE_NAME_DIALOG', deps, { mode: 'create' });
  }, [deps]);

  // Handle Create from Selection click (F2) - uses unified action system
  const handleCreateFromSelection = useCallback(() => {
    dispatch('CREATE_NAMES_FROM_SELECTION', deps);
  }, [deps]);

  const handleUseDefinedName = useCallback(
    (name: string) => {
      dispatch('PASTE_NAME_IN_FORMULA', deps, { name });
    },
    [deps],
  );

  // Render function items for a category dropdown. `data-value` carries
  // the function name so the harness can locate a specific function
  // inside `[data-testid="ribbon-dropdown-menu-<category>"]`.
  const renderFunctionItems = (functions: string[]) =>
    functions.map((fn) => (
      <RibbonDropdownItem key={fn} dataValue={fn} onClick={() => handleFunctionSelect(fn)}>
        {fn}
      </RibbonDropdownItem>
    ));

  const recentlyUsedFunctions =
    mruFunctions.length > 0 ? mruFunctions : ['SUM', 'AVERAGE', 'IF', 'COUNT'];

  // ===========================================================================
  // KeyTip Registration (display-only — keytip overlay reads `key`,
  // `tabId`, `elementId` here; the unified keyboard system fires the action
  // via typed `KeyboardShortcut` entries in
  // `keyboard/definitions/keytips-formulas.ts`.)
  // ===========================================================================

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Insert Function - I
    keyTipRegistry.register({
      key: 'I',
      tabId: 'formulas',
      elementId: 'formulas-insert-function',
    });
    cleanups.push(() => keyTipRegistry.unregister('I', 'formulas'));

    // AutoSum - A
    keyTipRegistry.register({ key: 'A', tabId: 'formulas', elementId: 'formulas-autosum' });
    cleanups.push(() => keyTipRegistry.unregister('A', 'formulas'));

    // Financial - F
    keyTipRegistry.register({ key: 'F', tabId: 'formulas', elementId: 'formulas-financial' });
    cleanups.push(() => keyTipRegistry.unregister('F', 'formulas'));

    // Logical - L
    keyTipRegistry.register({ key: 'L', tabId: 'formulas', elementId: 'formulas-logical' });
    cleanups.push(() => keyTipRegistry.unregister('L', 'formulas'));

    // Text - T
    keyTipRegistry.register({ key: 'T', tabId: 'formulas', elementId: 'formulas-text' });
    cleanups.push(() => keyTipRegistry.unregister('T', 'formulas'));

    // Date & Time - D
    keyTipRegistry.register({ key: 'D', tabId: 'formulas', elementId: 'formulas-datetime' });
    cleanups.push(() => keyTipRegistry.unregister('D', 'formulas'));

    // Math & Trig - G
    keyTipRegistry.register({ key: 'G', tabId: 'formulas', elementId: 'formulas-mathtrig' });
    cleanups.push(() => keyTipRegistry.unregister('G', 'formulas'));

    // Name Manager - N
    keyTipRegistry.register({ key: 'N', tabId: 'formulas', elementId: 'formulas-name-manager' });
    cleanups.push(() => keyTipRegistry.unregister('N', 'formulas'));

    // Define Name - E
    keyTipRegistry.register({ key: 'E', tabId: 'formulas', elementId: 'formulas-define-name' });
    cleanups.push(() => keyTipRegistry.unregister('E', 'formulas'));

    return () => cleanups.forEach((c) => c());
  }, []);

  return (
    <>
      {/* Function Library Group - F1: Add category buttons */}
      <ToolbarGroup
        label="Function Library"
        collapseConfig={FUNCTION_LIBRARY_COLLAPSE_CONFIG}
        dropdownIcon={<FunctionIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          {/* Insert Function - Large button */}
          <RibbonButton
            id="formulas-insert-function"
            layout="vertical"
            height="full"
            icon={<FunctionIcon />}
            label={'Insert\nFunction'}
            onClick={handleInsertFunction}
            title="Insert Function - Browse and insert functions (Shift+F3)"
            aria-label="Insert Function"
          />

          {/* AutoSum with dropdown - matches Excel */}
          <RibbonDropdown
            open={autoSumOpen}
            onOpenChange={setAutoSumOpen}
            menuTestId="ribbon-dropdown-menu-formulas-autosum"
            trigger={
              <RibbonButton
                id="formulas-autosum"
                layout="vertical"
                height="full"
                data-testid="ribbon-dropdown-formulas-autosum"
                icon={<AutoSumIcon />}
                label="AutoSum"
                hasDropdown
                dropdownPosition="inline"
                isOpen={autoSumOpen}
                title="AutoSum - Insert SUM formula (Alt+=)"
                aria-label="AutoSum"
                visibilityKey="autoSum"
              />
            }
            width="auto"
            menuLabel="AutoSum options"
          >
            <RibbonDropdownItem
              dataValue="SUM"
              onClick={() => dispatchAction('AUTO_SUM', { functionName: 'SUM' })}
            >
              Sum
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="AVERAGE"
              onClick={() => dispatchAction('AUTO_SUM', { functionName: 'AVERAGE' })}
            >
              Average
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="COUNT"
              onClick={() => dispatchAction('AUTO_SUM', { functionName: 'COUNT' })}
            >
              Count Numbers
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="MAX"
              onClick={() => dispatchAction('AUTO_SUM', { functionName: 'MAX' })}
            >
              Max
            </RibbonDropdownItem>
            <RibbonDropdownItem
              dataValue="MIN"
              onClick={() => dispatchAction('AUTO_SUM', { functionName: 'MIN' })}
            >
              Min
            </RibbonDropdownItem>
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          {/* Function Category Dropdowns - matching Excel's layout */}
          {/* Excel shows: Recently Used, Financial, Logical, Text, Date & Time, Lookup & Reference, Math & Trig, More Functions */}
          {/* All as compact buttons with icon above label in a single row */}

          <RibbonDropdown
            open={recentlyUsedOpen}
            onOpenChange={setRecentlyUsedOpen}
            menuTestId="ribbon-dropdown-menu-recently-used"
            trigger={
              <RibbonButton
                layout="vertical"
                height="full"
                width="normal"
                data-testid="ribbon-dropdown-recently-used"
                icon={<RecentlyUsedIcon />}
                label={'Recently\nUsed'}
                hasDropdown
                isOpen={recentlyUsedOpen}
                title="Recently Used Functions"
                aria-label="Recently Used"
              />
            }
            width="auto"
            menuLabel="Recently used functions"
          >
            {renderFunctionItems(recentlyUsedFunctions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="insert-function" onClick={handleInsertFunction}>
              Insert Function...
            </RibbonDropdownItem>
          </RibbonDropdown>

          <RibbonDropdown
            open={financialOpen}
            onOpenChange={setFinancialOpen}
            menuTestId="ribbon-dropdown-menu-financial"
            menuTestIdAliases={['ribbon-dropdown-menu-formulas-financial']}
            trigger={
              <RibbonButton
                id="formulas-financial"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-financial"
                icon={<FinancialFunctionIcon />}
                label="Financial"
                hasDropdown
                isOpen={financialOpen}
                title="Financial Functions"
                aria-label="Financial"
              />
            }
            width="auto"
            menuLabel="Financial functions"
          >
            {renderFunctionItems(FUNCTION_CATEGORIES.financial.functions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Financial Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          <RibbonDropdown
            open={logicalOpen}
            onOpenChange={setLogicalOpen}
            menuTestId="ribbon-dropdown-menu-logical"
            menuTestIdAliases={['ribbon-dropdown-menu-formulas-logical']}
            trigger={
              <RibbonButton
                id="formulas-logical"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-logical"
                icon={<LogicalFunctionIcon />}
                label="Logical"
                hasDropdown
                isOpen={logicalOpen}
                title="Logical Functions"
                aria-label="Logical"
              />
            }
            width="auto"
            menuLabel="Logical functions"
          >
            {renderFunctionItems(FUNCTION_CATEGORIES.logical.functions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Logical Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          <RibbonDropdown
            open={textOpen}
            onOpenChange={setTextOpen}
            menuTestId="ribbon-dropdown-menu-text"
            menuTestIdAliases={['ribbon-dropdown-menu-formulas-text']}
            trigger={
              <RibbonButton
                id="formulas-text"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-text"
                icon={<TextFunctionIcon />}
                label="Text"
                hasDropdown
                isOpen={textOpen}
                title="Text Functions"
                aria-label="Text"
              />
            }
            width="auto"
            menuLabel="Text functions"
          >
            {renderFunctionItems(FUNCTION_CATEGORIES.text.functions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Text Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          <RibbonDropdown
            open={dateTimeOpen}
            onOpenChange={setDateTimeOpen}
            menuTestId="ribbon-dropdown-menu-date-time"
            menuTestIdAliases={['ribbon-dropdown-menu-formulas-date-time']}
            trigger={
              <RibbonButton
                id="formulas-datetime"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-date-time"
                icon={<DateTimeFunctionIcon />}
                label={'Date &\nTime'}
                hasDropdown
                isOpen={dateTimeOpen}
                title="Date & Time Functions"
                aria-label="Date & Time"
              />
            }
            width="auto"
            menuLabel="Date and time functions"
          >
            {renderFunctionItems(FUNCTION_CATEGORIES.dateTime.functions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Date/Time Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          <RibbonDropdown
            open={lookupOpen}
            onOpenChange={setLookupOpen}
            menuTestId="ribbon-dropdown-menu-lookup"
            menuTestIdAliases={['ribbon-dropdown-menu-formulas-lookup']}
            trigger={
              <RibbonButton
                id="formulas-lookup"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-lookup"
                icon={<LookupFunctionIcon />}
                label={'Lookup &\nReference'}
                hasDropdown
                isOpen={lookupOpen}
                title="Lookup & Reference Functions"
                aria-label="Lookup & Reference"
              />
            }
            width="auto"
            menuLabel="Lookup and reference functions"
          >
            {renderFunctionItems(FUNCTION_CATEGORIES.lookup.functions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Lookup Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          <RibbonDropdown
            open={mathTrigOpen}
            onOpenChange={setMathTrigOpen}
            menuTestId="ribbon-dropdown-menu-math-trig"
            menuTestIdAliases={['ribbon-dropdown-menu-formulas-math-trig']}
            trigger={
              <RibbonButton
                id="formulas-mathtrig"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-math-trig"
                icon={<MathTrigFunctionIcon />}
                label={'Math &\nTrig'}
                hasDropdown
                isOpen={mathTrigOpen}
                title="Math & Trig Functions"
                aria-label="Math & Trig"
              />
            }
            width="auto"
            menuLabel="Math and trig functions"
          >
            {renderFunctionItems(FUNCTION_CATEGORIES.mathTrig.functions)}
            <RibbonDropdownDivider />
            <RibbonDropdownItem dataValue="more" onClick={handleInsertFunction}>
              More Math Functions...
            </RibbonDropdownItem>
          </RibbonDropdown>

          {/* More Functions with submenus */}
          <RibbonDropdown
            open={moreOpen}
            onOpenChange={setMoreOpen}
            menuTestId="ribbon-dropdown-menu-more-functions"
            trigger={
              <RibbonButton
                id="formulas-more-functions"
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-more-functions"
                icon={<MoreFunctionsIcon />}
                label={'More\nFunctions'}
                hasDropdown
                isOpen={moreOpen}
                title="More Functions"
                aria-label="More Functions"
              />
            }
            width="sm"
            menuLabel="More functions"
          >
            <RibbonDropdownSubmenu label="Statistical">
              {renderFunctionItems(FUNCTION_CATEGORIES.more.statistical)}
            </RibbonDropdownSubmenu>
            <RibbonDropdownSubmenu label="Engineering">
              {renderFunctionItems(FUNCTION_CATEGORIES.more.engineering)}
            </RibbonDropdownSubmenu>
            <RibbonDropdownSubmenu label="Information">
              {renderFunctionItems(FUNCTION_CATEGORIES.more.information)}
            </RibbonDropdownSubmenu>
            <RibbonDropdownSubmenu label="Database">
              {renderFunctionItems(FUNCTION_CATEGORIES.more.database)}
            </RibbonDropdownSubmenu>
          </RibbonDropdown>
        </div>
      </ToolbarGroup>

      <ToolbarGroup label="Python" dropdownIcon={<FunctionIcon />}>
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <RibbonButton
            layout="vertical"
            height="full"
            width="normal"
            icon={<FunctionIcon />}
            label={'Insert\nPython'}
            title="Insert Python"
            aria-label="Insert Python"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<CalculateIcon />}
            label="Reset"
            title="Reset Python"
            aria-label="Reset"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<TextFunctionIcon />}
            label="Editor"
            title="Python Editor"
            aria-label="Editor"
          />
          <RibbonButton
            layout="vertical"
            height="full"
            width="normal"
            icon={<MoreFunctionsIcon />}
            label="Initialization"
            title="Python Initialization"
            aria-label="Initialization"
          />
        </div>
      </ToolbarGroup>

      {/* Defined Names Group - F2: Named Ranges */}
      <ToolbarGroup
        label="Defined Names"
        collapseConfig={DEFINED_NAMES_COLLAPSE_CONFIG}
        dropdownIcon={<NameManagerIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <RibbonButton
            id="formulas-name-manager"
            layout="vertical"
            height="full"
            icon={<NameManagerIcon />}
            label={'Name\nManager'}
            onClick={handleNameManager}
            title="Name Manager (Ctrl+F3) - View and manage all defined names"
            aria-label="Name Manager"
          />

          {/* F2: Define Name */}
          <RibbonButton
            id="formulas-define-name"
            layout="vertical"
            height="full"
            width="narrow"
            icon={<DefineNameIcon />}
            label="Define"
            onClick={handleDefineName}
            title="Define Name - Create a named range from selection"
            aria-label="Define Name"
            visibilityKey="defineName"
          />

          <RibbonDropdown
            open={useInFormulaOpen}
            onOpenChange={setUseInFormulaOpen}
            position="bottom-left"
            width="md"
            menuLabel="Use in Formula"
            menuTestId="ribbon-dropdown-menu-use-in-formula"
            trigger={
              <RibbonButton
                layout="vertical"
                height="full"
                width="narrow"
                data-testid="ribbon-dropdown-use-in-formula"
                icon={<UseInFormulaIcon />}
                label={'Use in\nFormula'}
                hasDropdown
                title="Use in Formula - Insert a defined name into the formula"
                aria-label="Use in Formula"
              />
            }
          >
            {definedNames.length === 0 ? (
              <RibbonDropdownItem disabled>No names defined</RibbonDropdownItem>
            ) : (
              definedNames.map((definedName) => (
                <RibbonDropdownItem
                  key={`${definedName.scope ?? 'workbook'}:${definedName.name}`}
                  onClick={() => handleUseDefinedName(definedName.name)}
                  testId="ribbon-use-in-formula-name"
                  dataValue={definedName.name}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{definedName.name}</span>
                    {definedName.scope && (
                      <span className="truncate text-dropdown-header text-ss-text-tertiary">
                        {definedName.scope}
                      </span>
                    )}
                  </div>
                </RibbonDropdownItem>
              ))
            )}
          </RibbonDropdown>

          {/* F2: Create from Selection */}
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<CreateFromSelectionIcon />}
            label="Create"
            onClick={handleCreateFromSelection}
            title="Create from Selection - Create names from row/column labels (Ctrl+Shift+F3)"
            aria-label="Create from Selection"
            visibilityKey="createFromSelection"
          />
        </div>
      </ToolbarGroup>

      <FormulaAuditingGroup />

      {/* Calculation Group - F4: Add Calculate Sheet */}
      <ToolbarGroup
        label="Calculation"
        isLast
        collapseConfig={CALCULATION_COLLAPSE_CONFIG}
        dropdownIcon={<CalculateIcon />}
      >
        <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
          <RibbonVisibilityItem item="calculationOptions">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-7 min-w-[90px] px-2 text-ribbon text-ss-text-secondary bg-transparent border border-transparent rounded hover:bg-ss-surface-hover focus:border-ss-border-focus cursor-pointer outline-none flex items-center justify-between gap-1"
                  title="Calculation Options"
                  aria-label="Calculation Mode"
                >
                  <span>{calculationMode === 'auto' ? 'Automatic' : 'Manual'}</span>
                  <ChevronDownSvg className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={calculationMode}
                  onValueChange={handleCalculationModeChange}
                >
                  <DropdownMenuRadioItem value="auto">Automatic</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="partial" disabled>
                    Partial
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="manual">Manual</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuCheckboxItem checked={false} disabled>
                  Format Stale Values
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={false} disabled>
                  Compatibility Version
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  id="formulas-iterative-calculation"
                  checked={iterativeCalculationEnabled}
                  onCheckedChange={handleIterativeCalculationChange}
                >
                  Enable Iterative Calculation
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </RibbonVisibilityItem>

          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<CalculateIcon />}
            label="Calculate"
            onClick={handleCalculateNow}
            title="Calculate Now (F9) - Recalculate all formulas in workbook"
            aria-label="Calculate Now"
            visibilityKey="calculateNow"
          />

          {/* F4: Calculate Sheet */}
          <RibbonButton
            layout="vertical"
            height="full"
            width="narrow"
            icon={<CalculateSheetIcon />}
            label="Sheet"
            onClick={handleCalculateSheet}
            title="Calculate Sheet (Shift+F9) - Recalculate active sheet only"
            aria-label="Calculate Sheet"
            visibilityKey="calculateSheet"
          />
        </div>
      </ToolbarGroup>
    </>
  );
}
