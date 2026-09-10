use mog::run_office_js;
use serde_json::json;

#[test]
fn caught_run_rejection_does_not_reject_the_script() {
    let output = run_office_js(
        r#"
      let code;
      try {
        await Excel.run(async context => {
          context.workbook.worksheets.getItem("Missing");
          await context.sync();
        });
      } catch (error) { code = error.code; }
      return { code, continued: true };
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!({"code":"ItemNotFound","continued":true})
    );
}

#[test]
fn explicit_context_load_defaults_and_sync_passthrough() {
    let output = run_office_js(r#"
      const context = new Excel.RequestContext();
      const sheet = context.workbook.worksheets.getItem("Sheet1");
      const loadResult = context.load(sheet);
      const token = { marker: 42 };
      const returned = await context.sync(token);
      return { name: sheet.name, same: returned === token,
        base: context instanceof OfficeExtension.ClientRequestContext,
        distinctBase: Excel.RequestContext.prototype instanceof OfficeExtension.ClientRequestContext,
        baseHasNoWorkbook: new OfficeExtension.ClientRequestContext().workbook === undefined,
        loadReturnsVoid: loadResult === undefined };
    "#).unwrap();
    assert_eq!(
        output.value,
        json!({"name":"Sheet1","same":true,"base":true,
        "distinctBase":true,"baseHasNoWorkbook":true,"loadReturnsVoid":true})
    );
}

#[test]
fn setter_cache_and_fresh_proxy_have_distinct_read_contracts() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const sheet = context.workbook.worksheets.getItem("Sheet1");
        const assigned = sheet.getRange("A1");
        assigned.values = [[17]];
        const before = assigned.values;
        const fresh = sheet.getRange("A1");
        let unloaded;
        try { fresh.values; } catch (error) {
          unloaded = error.code === "PropertyNotLoaded" && error instanceof OfficeExtension.Error;
        }
        context.load(fresh, { select: "values" });
        await context.sync();
        return { before, after: fresh.values, unloaded };
      });
    "#,
    )
    .unwrap();
    assert_eq!(
        output.value,
        json!({"before":[[17]],"after":[[17]],"unloaded":true})
    );
}

#[test]
fn whole_worksheet_range_reads_unbounded_cell_properties_as_null() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const range = context.workbook.worksheets.getItem("Sheet1").getRange();
        range.load(["values", "formulas"]);
        await context.sync();
        return { values: range.values, formulas: range.formulas };
      });
    "#,
    )
    .unwrap();
    assert_eq!(output.value, json!({"values":null,"formulas":null}));
}

#[test]
fn documented_run_overloads_reuse_the_expected_context() {
    let output = run_office_js(r#"
      const explicit = new Excel.RequestContext();
      const sheet = explicit.workbook.worksheets.getItem("Sheet1");
      let contextOverload;
      await Excel.run(explicit, async context => {
        contextOverload = context === explicit;
        await context.sync();
      });

      let objectOverload;
      await Excel.run(sheet, async context => {
        objectOverload = context === explicit;
        sheet.load("name");
        await context.sync();
      });

      const first = sheet.getRange("A1");
      const second = sheet.getRange("B1");
      let arrayOverload;
      await Excel.run([first, second], async context => {
        arrayOverload = context === explicit;
        first.values = [[1]];
        second.values = [[2]];
        await context.sync();
      });

      let optionsPreviousObjects;
      await Excel.run({ previousObjects: [first, second], delayForCellEdit: false }, async context => {
        optionsPreviousObjects = context === explicit;
        await context.sync();
      });

      let optionsNewContext;
      await Excel.run({ delayForCellEdit: true }, async context => {
        optionsNewContext = context instanceof Excel.RequestContext && context !== explicit;
        await context.sync();
      });

      const callbackResult = await Excel.run(async context => {
        await context.sync();
        return sheet.name;
      });
      return { contextOverload, objectOverload, arrayOverload,
        optionsPreviousObjects, optionsNewContext, callbackResult };
    "#).unwrap();

    assert_eq!(
        output.value,
        json!({
            "contextOverload": true,
            "objectOverload": true,
            "arrayOverload": true,
            "optionsPreviousObjects": true,
            "optionsNewContext": true,
            "callbackResult": "Sheet1"
        })
    );
}

#[test]
fn run_rejects_invalid_context_sets_and_nonpromise_callbacks() {
    let output = run_office_js(
        r#"
      async function errorCode(action) {
        try { await action(); }
        catch (error) {
          return error instanceof OfficeExtension.Error ? error.code : "wrong-error-type";
        }
        return "missing-error";
      }

      const firstContext = new Excel.RequestContext();
      const secondContext = new Excel.RequestContext();
      const first = firstContext.workbook.worksheets.getItem("Sheet1");
      const second = secondContext.workbook.worksheets.getItem("Sheet1");

      const mixed = await errorCode(() => Excel.run([first, second], async () => {}));
      const empty = await errorCode(() => Excel.run([], async () => {}));
      const nonPromise = await errorCode(() => Excel.run(() => 42));
      const inventedBatch = await errorCode(() => Excel.run({ batch: async () => {} }));
      return { mixed, empty, nonPromise, inventedBatch };
    "#,
    )
    .unwrap();

    assert_eq!(
        output.value,
        json!({
            "mixed": "InvalidRequestContext",
            "empty": "InvalidArgument",
            "nonPromise": "RunMustReturnPromise",
            "inventedBatch": "InvalidArgument"
        })
    );
}

#[test]
fn client_result_and_null_object_guards_use_structured_errors() {
    let output = run_office_js(
        r#"
      return await Excel.run(async context => {
        const result = new OfficeExtension.ClientResult();
        const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
        let resultError;
        let nullObjectError;
        try { result.value; } catch (error) {
          resultError = {
            code: error.code,
            location: error.debugInfo.errorLocation,
            standard: error instanceof OfficeExtension.Error
          };
        }
        try { range.isNullObject; } catch (error) {
          nullObjectError = {
            code: error.code,
            standard: error instanceof OfficeExtension.Error
          };
        }
        return { resultError, nullObjectError };
      });
    "#,
    )
    .unwrap();

    assert_eq!(
        output.value,
        json!({
            "resultError": {
                "code": "ValueNotLoaded",
                "location": "clientResult.value",
                "standard": true
            },
            "nullObjectError": {
                "code": "PropertyNotLoaded",
                "standard": true
            }
        })
    );
}
