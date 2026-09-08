//! Application and workbook calculation semantics through the public
//! Office.js request-context path.

use mog::{run_office_js, run_office_js_with_workbook};
use serde_json::json;

#[test]
fn application_navigation_is_context_canonical_and_loads_engine_settings() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const application = context.application;
          const workbookApplication = context.workbook.application;
          application.load(["calculationMode", "calculationState"]);
          context.workbook.load("usePrecisionAsDisplayed");
          await context.sync();
          return {
            sameApplication: application === workbookApplication &&
              application === context.workbook.application,
            mode: application.calculationMode,
            state: application.calculationState,
            precision: context.workbook.usePrecisionAsDisplayed,
            calculationType: Excel.CalculationType.fullRebuild,
          };
        });
        "#,
    )
    .expect("application load should succeed");

    assert_eq!(
        output.value,
        json!({
            "sameApplication": true,
            "mode": "Automatic",
            "state": "Done",
            "precision": false,
            "calculationType": "FullRebuild",
        })
    );
}

#[test]
fn application_calculate_types_recalculate_real_engine_values() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          const application = context.application;
          const sheet = context.workbook.worksheets.getItem("Sheet1");
          application.calculationMode = Excel.CalculationMode.manual;
          sheet.getRange("A1").values = [[2]];
          sheet.getRange("B1").formulas = [["=A1*3"]];
          const initial = sheet.getRange("B1");
          initial.load("values");
          await context.sync();

          sheet.getRange("A1").values = [[4]];
          const stale = sheet.getRange("B1");
          stale.load("values");
          await context.sync();

          application.calculate(Excel.CalculationType.recalculate);
          const recalculated = sheet.getRange("B1");
          recalculated.load("values");
          application.load(["calculationMode", "calculationState"]);
          await context.sync();

          application.calculate("Full");
          application.calculate("FullRebuild");
          const rebuilt = sheet.getRange("B1");
          rebuilt.load("values");
          await context.sync();

          return {
            initial: initial.values,
            stale: stale.values,
            recalculated: recalculated.values,
            rebuilt: rebuilt.values,
            mode: application.calculationMode,
            state: application.calculationState,
          };
        });
        "#,
    )
    .expect("application calculation should use the engine");

    assert_eq!(
        output.value,
        json!({
            "initial": [[6]],
            "stale": [[6]],
            "recalculated": [[12]],
            "rebuilt": [[12]],
            "mode": "Manual",
            "state": "Done",
        })
    );
}

#[test]
fn precision_and_iterative_settings_round_trip_through_engine() {
    let (workbook, _) = compute_api::Workbook::blank().expect("blank workbook");
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async (context) => {
          const application = context.application;
          const iterative = application.iterativeCalculation;
          iterative.load(["enabled", "maxChange", "maxIteration"]);
          context.workbook.load("usePrecisionAsDisplayed");
          await context.sync();
          const before = {
            enabled: iterative.enabled,
            maxChange: iterative.maxChange,
            maxIteration: iterative.maxIteration,
            precision: context.workbook.usePrecisionAsDisplayed,
          };

          iterative.enabled = true;
          iterative.maxChange = 0.0005;
          iterative.maxIteration = 20;
          context.workbook.usePrecisionAsDisplayed = true;
          iterative.load(["enabled", "maxChange", "maxIteration"]);
          context.workbook.load("usePrecisionAsDisplayed");
          await context.sync();
          return {
            before,
            after: {
              enabled: iterative.enabled,
              maxChange: iterative.maxChange,
              maxIteration: iterative.maxIteration,
              precision: context.workbook.usePrecisionAsDisplayed,
            },
          };
        });
        "#,
    )
    .expect("calculation settings should round-trip");

    assert_eq!(
        output.value,
        json!({
            "before": {
                "enabled": false,
                "maxChange": 0.001,
                "maxIteration": 100,
                "precision": false,
            },
            "after": {
                "enabled": true,
                "maxChange": 0.0005,
                "maxIteration": 20,
                "precision": true,
            },
        })
    );
}

#[test]
fn calculation_types_are_exact_and_date_system_is_not_invented() {
    let output = run_office_js(
        r#"
        const context = new Excel.RequestContext();
        const application = context.application;
        let modeCode;
        let calculateCode;
        try { application.calculationMode = "automatic"; }
        catch (error) { modeCode = error.code; }
        try { application.calculate("rebuild"); }
        catch (error) { calculateCode = error.code; }

        const workbook = context.workbook;
        workbook.load("date1904");
        let dateCode;
        try { await context.sync(); }
        catch (error) { dateCode = error.code; }
        return { modeCode, calculateCode, dateCode };
        "#,
    )
    .expect("invalid calculation arguments should be reported");

    assert_eq!(
        output.value,
        json!({
            "modeCode": "InvalidArgument",
            "calculateCode": "InvalidArgument",
            "dateCode": "ApiNotFound",
        })
    );
}

#[test]
fn unloaded_application_and_precision_properties_keep_office_errors() {
    let output = run_office_js(
        r#"
        return await Excel.run(async (context) => {
          let applicationCode;
          let workbookCode;
          try { context.application.calculationMode; }
          catch (error) { applicationCode = error.code; }
          try { context.workbook.usePrecisionAsDisplayed; }
          catch (error) { workbookCode = error.code; }
          return { applicationCode, workbookCode };
        });
        "#,
    )
    .expect("unloaded property errors should be catchable Office errors");

    assert_eq!(
        output.value,
        json!({
            "applicationCode": "PropertyNotLoaded",
            "workbookCode": "PropertyNotLoaded",
        })
    );
}
