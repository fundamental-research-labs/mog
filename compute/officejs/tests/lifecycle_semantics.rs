use mog::run_office_js;
use serde_json::json;

#[test]
fn tracked_objects_reject_unsupported_range_reference_lifetime() {
    let output = run_office_js(
        r#"
      const context = new Excel.RequestContext();
      const sheet = context.workbook.worksheets.getItem("Sheet1");
      const range = sheet.getRange("A1");
      const otherContext = new Excel.RequestContext();
      const otherRange = otherContext.workbook.worksheets.getItem("Sheet1").getRange("B1");

      let addRange;
      try { context.trackedObjects.add(range); }
      catch (error) { addRange = { code: error.code, standard: error instanceof OfficeExtension.Error }; }
      let addRangeArray;
      try { context.trackedObjects.add([sheet, range]); }
      catch (error) { addRangeArray = error.code; }
      let trackRange;
      try { range.track(); }
      catch (error) { trackRange = error.code; }
      let removeRange;
      try { context.trackedObjects.remove(range); }
      catch (error) { removeRange = error.code; }
      let untrackRange;
      try { range.untrack(); }
      catch (error) { untrackRange = error.code; }

      // ClientObject tracking is a no-op for proxy types that do not expose
      // the private reference-retention hook required by Office.js.
      const addSheet = context.trackedObjects.add(sheet);
      const removeSheet = context.trackedObjects.remove(sheet);
      await context.sync();

      // Ordinary range usage remains valid across explicit sync calls.  This
      // is independent of the unsupported tracking API above.
      range.values = [[17]];
      await context.sync();
      const afterSync = range.values;

      const computed = sheet.getRange("B1");
      computed.formulas = [["=17*2"]];
      computed.load("values");
      await context.sync();
      const computedValue = computed.values;

      let wrongContext;
      try { context.trackedObjects.add(otherRange); }
      catch (error) { wrongContext = error.code; }

      return {
        addRange,
        addRangeArray,
        trackRange,
        removeRange,
        untrackRange,
        addSheetUndefined: addSheet === undefined,
        removeSheetUndefined: removeSheet === undefined,
        afterSync,
        computedValue,
        wrongContext,
        trackedObjects: context.trackedObjects instanceof OfficeExtension.TrackedObjects,
      };
    "#,
    )
    .expect("Office.js lifecycle script should succeed");

    assert_eq!(
        output.value,
        json!({
            "addRange": { "code": "ApiNotFound", "standard": true },
            "addRangeArray": "ApiNotFound",
            "trackRange": "ApiNotFound",
            "removeRange": "ApiNotFound",
            "untrackRange": "ApiNotFound",
            "addSheetUndefined": true,
            "removeSheetUndefined": true,
            "afterSync": [[17]],
            "computedValue": [[34]],
            "wrongContext": "InvalidRequestContext",
            "trackedObjects": true,
        })
    );
}

#[test]
fn tracked_objects_reject_non_client_objects_without_partial_adds() {
    let output = run_office_js(
        r#"
      const context = new Excel.RequestContext();
      const range = context.workbook.worksheets.getItem("Sheet1").getRange("A1");
      let invalid;
      try { context.trackedObjects.add([range, {}]); }
      catch (error) { invalid = { code: error.code, standard: error instanceof OfficeExtension.Error }; }

      // The invalid array is rejected before capability checks, while a
      // valid Range reports the unsupported reference-lifetime boundary.
      let rangeUnsupported;
      try { context.trackedObjects.add(range); }
      catch (error) { rangeUnsupported = error.code; }
      await context.sync();
      return { invalid, rangeUnsupported, track: typeof range.track, untrack: typeof range.untrack };
    "#,
    )
    .expect("Office.js lifecycle script should succeed");

    assert_eq!(
        output.value,
        json!({
            "invalid": { "code": "InvalidArgument", "standard": true },
            "rangeUnsupported": "ApiNotFound",
            "track": "function",
            "untrack": "function",
        })
    );
}

#[test]
fn successful_sync_materializes_ordinary_unbound_proxies_without_reviving_failed_paths() {
    let output = run_office_js(
        r#"
      const context = new Excel.RequestContext();
      const workbook = context.workbook;
      const worksheetCollection = workbook.worksheets;
      const sheet = worksheetCollection.getItem("Sheet1");
      const tables = sheet.tables;
      await context.sync();

      const ordinary = {
        workbook: workbook.isNullObject,
        worksheetCollection: worksheetCollection.isNullObject,
        tables: tables.isNullObject,
      };

      const failedContext = new Excel.RequestContext();
      const failedSheet = failedContext.workbook.worksheets.getItem("Missing");
      let failedCode;
      try { await failedContext.sync(); }
      catch (error) { failedCode = error.code; }
      await failedContext.sync();
      let failedPathCode;
      try { failedSheet.isNullObject; }
      catch (error) { failedPathCode = error.code; }

      return { ordinary, failedCode, failedPathCode };
    "#,
    )
    .expect("Office.js lifecycle script should succeed");

    assert_eq!(
        output.value,
        json!({
            "ordinary": {
                "workbook": false,
                "worksheetCollection": false,
                "tables": false,
            },
            "failedCode": "ItemNotFound",
            "failedPathCode": "PropertyNotLoaded",
        })
    );
}
