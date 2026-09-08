use mog::run_office_js;
use serde_json::json;

#[test]
fn trace_is_queued_and_sync_errors_report_only_executed_messages() {
    let output = run_office_js(
        r#"
      const context = new Excel.RequestContext();
      const initial = context.debugInfo.pendingStatements;
      const firstTrace = context.trace("before lookup");
      const afterFirstTrace = context.debugInfo.pendingStatements;
      context.workbook.worksheets.getItem("Missing");
      context.trace("after failing lookup");

      let failure;
      try { await context.sync(); }
      catch (error) {
        failure = {
          code: error.code,
          traceMessages: error.traceMessages,
          debugCode: error.debugInfo.code,
          standard: error instanceof OfficeExtension.Error,
        };
      }

      return {
        traceReturnsVoid: firstTrace === undefined,
        initialStatements: initial.length,
        firstTraceStatements: afterFirstTrace.filter((statement) => statement === "context.trace();").length,
        queuedTraceStatements: context.debugInfo.pendingStatements.filter((statement) => statement === "context.trace();").length,
        failure,
      };
    "#,
    )
    .expect("Office.js trace script should succeed");

    assert!(
        output.stdout.is_empty(),
        "context.trace must remain a queued request action, not console output"
    );
    assert_eq!(
        output.value,
        json!({
            "traceReturnsVoid": true,
            "initialStatements": 0,
            "firstTraceStatements": 1,
            "queuedTraceStatements": 0,
            "failure": {
                "code": "ItemNotFound",
                "traceMessages": ["before lookup"],
                "debugCode": "ItemNotFound",
                "standard": true,
            },
        })
    );
}

#[test]
fn load_recursive_validates_options_before_queuing_a_bounded_query() {
    let output = run_office_js(
        r#"
      const context = new Excel.RequestContext();
      const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");

      let invalidOptions;
      try { context.loadRecursive(range, []); }
      catch (error) { invalidOptions = { code: error.code, standard: error instanceof OfficeExtension.Error }; }

      let invalidSelection;
      try { context.loadRecursive(range, { Range: { select: 42 } }); }
      catch (error) { invalidSelection = { code: error.code, standard: error instanceof OfficeExtension.Error }; }

      let invalidObject;
      try { context.loadRecursive({}, {}); }
      catch (error) { invalidObject = { code: error.code, standard: error instanceof OfficeExtension.Error }; }

      const returned = context.loadRecursive(range, {
        Range: { select: ["values", "items/name"], expand: "format" },
        RangeFormat: { select: "horizontalAlignment" },
      }, 1);
      const statements = context.debugInfo.pendingStatements;
      return {
        returnsVoid: returned === undefined,
        invalidOptions,
        invalidSelection,
        invalidObject,
        recursiveStatements: statements.filter((statement) => statement === "object.loadRecursive(...);").length,
        traceStatements: statements.filter((statement) => statement === "context.trace();").length,
      };
    "#,
    )
    .expect("Office.js loadRecursive validation script should succeed");

    assert_eq!(
        output.value,
        json!({
            "returnsVoid": true,
            "invalidOptions": { "code": "InvalidArgument", "standard": true },
            "invalidSelection": { "code": "InvalidArgument", "standard": true },
            "invalidObject": { "code": "InvalidRequestContext", "standard": true },
            "recursiveStatements": 1,
            "traceStatements": 0,
        })
    );
}

#[test]
fn load_recursive_loads_root_and_current_format_navigation_at_the_requested_depth() {
    let output = run_office_js(
        r#"
      return await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const range = sheet.getRange("A1");
        range.values = [[17]];
        const format = range.format;

        context.loadRecursive(range, {
          Range: { select: "values", expand: "format" },
          RangeFormat: "horizontalAlignment",
        }, 1);
        await context.sync();
        return { values: range.values, alignment: format.horizontalAlignment };
      });
    "#,
    )
    .expect("Office.js recursive navigation script should succeed");

    assert_eq!(
        output.value,
        json!({ "values": [[17]], "alignment": "General" })
    );
}
