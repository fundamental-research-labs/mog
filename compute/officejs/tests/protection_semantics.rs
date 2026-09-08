//! Office.js worksheet/workbook protection semantics through the shipped host.

use mog::run_office_js;
use serde_json::json;

#[test]
fn worksheet_protection_loads_exact_options_and_fresh_proxy_state() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          worksheet.protection.protect({
            allowAutoFilter: true,
            allowDeleteColumns: true,
            allowDeleteRows: false,
            allowEditObjects: true,
            allowEditScenarios: false,
            allowFormatCells: true,
            allowFormatColumns: false,
            allowFormatRows: true,
            allowInsertColumns: true,
            allowInsertHyperlinks: false,
            allowInsertRows: true,
            allowPivotTables: true,
            allowSort: true,
            selectionMode: "Unlocked"
          }, "secret");
        });

        return await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          const protection = worksheet.protection;
          protection.load(["protected", "isPasswordProtected", "options", "savedOptions"]);
          await context.sync();
          return {
            type: protection instanceof Excel.WorksheetProtection,
            clientObject: protection instanceof OfficeExtension.ClientObject,
            protection: protection.toJSON(),
            sameOptions: JSON.stringify(protection.options) === JSON.stringify(protection.savedOptions)
          };
        });
        "#,
    )
    .expect("worksheet protection should persist");

    assert_eq!(
        output.value,
        json!({
            "type": true,
            "clientObject": true,
            "protection": {
                "protected": true,
                "isPasswordProtected": true,
                "options": {
                    "allowAutoFilter": true,
                    "allowDeleteColumns": true,
                    "allowDeleteRows": false,
                    "allowEditObjects": true,
                    "allowEditScenarios": false,
                    "allowFormatCells": true,
                    "allowFormatColumns": false,
                    "allowFormatRows": true,
                    "allowInsertColumns": true,
                    "allowInsertHyperlinks": false,
                    "allowInsertRows": true,
                    "allowPivotTables": true,
                    "allowSort": true,
                    "selectionMode": "Unlocked"
                },
                "savedOptions": {
                    "allowAutoFilter": true,
                    "allowDeleteColumns": true,
                    "allowDeleteRows": false,
                    "allowEditObjects": true,
                    "allowEditScenarios": false,
                    "allowFormatCells": true,
                    "allowFormatColumns": false,
                    "allowFormatRows": true,
                    "allowInsertColumns": true,
                    "allowInsertHyperlinks": false,
                    "allowInsertRows": true,
                    "allowPivotTables": true,
                    "allowSort": true,
                    "selectionMode": "Unlocked"
                }
            },
            "sameOptions": true
        })
    );
}

#[test]
fn worksheet_password_check_and_unprotect_use_engine_state() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          worksheet.protection.protect(undefined, "secret");
        });

        let checks;
        await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          const protection = worksheet.protection;
          const right = protection.checkPassword("secret");
          const wrong = protection.checkPassword("wrong");
          const missing = protection.checkPassword();
          protection.load(["protected", "isPasswordProtected"]);
          await context.sync();
          checks = {
            protected: protection.protected,
            isPasswordProtected: protection.isPasswordProtected,
            right: right.value,
            wrong: wrong.value,
            missing: missing.value
          };
        });

        let wrongUnprotect;
        await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          worksheet.protection.unprotect("wrong");
          try {
            await context.sync();
          } catch (error) {
            wrongUnprotect = error.code;
          }
        });

        return await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          const protection = worksheet.protection;
          protection.load(["protected", "isPasswordProtected"]);
          await context.sync();
          return {
            protected: checks.protected,
            isPasswordProtected: checks.isPasswordProtected,
            right: checks.right,
            wrong: checks.wrong,
            missing: checks.missing,
            freshProtected: protection.protected,
            freshIsPasswordProtected: protection.isPasswordProtected,
            wrongUnprotect
          };
        });
        "#,
    )
    .expect("password checks should use persisted protection");

    assert_eq!(
        output.value,
        json!({
            "protected": true,
            "isPasswordProtected": true,
            "right": true,
            "wrong": false,
            "missing": false,
            "freshProtected": true,
            "freshIsPasswordProtected": true,
            "wrongUnprotect": "InvalidArgument"
        })
    );
}

#[test]
fn worksheet_unprotect_clears_password_and_fresh_proxy_reads_false() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          worksheet.protection.protect(undefined, "secret");
        });
        await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          worksheet.protection.unprotect("secret");
        });
        return await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          const protection = worksheet.protection;
          protection.load(["protected", "isPasswordProtected"]);
          await context.sync();
          return protection.toJSON();
        });
        "#,
    )
    .expect("correct worksheet password should unprotect");

    assert_eq!(
        output.value,
        json!({ "protected": false, "isPasswordProtected": false })
    );
}

#[test]
fn workbook_protection_round_trips_and_keeps_structure_enforced() {
    let output = run_office_js(
        r#"
        await Excel.run(async context => {
          context.workbook.protection.protect("book-secret");
        });

        let addError;
        try {
          await Excel.run(async context => {
            context.workbook.worksheets.add("Blocked");
            await context.sync();
          });
        } catch (error) {
          addError = error.code;
        }

        let wrongPassword;
        try {
          await Excel.run(async context => {
            context.workbook.protection.unprotect("wrong");
            await context.sync();
          });
        } catch (error) {
          wrongPassword = error.code;
        }

        await Excel.run(async context => {
          context.workbook.protection.unprotect("book-secret");
        });

        return await Excel.run(async context => {
          const protection = context.workbook.protection;
          protection.load("protected");
          await context.sync();
          return {
            type: protection instanceof Excel.WorkbookProtection,
            clientObject: protection instanceof OfficeExtension.ClientObject,
            protected: protection.protected,
            addBlocked: typeof addError === "string",
            wrongPassword
          };
        });
        "#,
    )
    .expect("workbook protection should round trip");

    assert_eq!(
        output.value,
        json!({
            "type": true,
            "clientObject": true,
            "protected": false,
            "addBlocked": true,
            "wrongPassword": "InvalidArgument"
        })
    );
}

#[test]
fn protection_proxies_require_load_and_reject_unsupported_members() {
    let output = run_office_js(
        r#"
        return await Excel.run(async context => {
          const worksheet = context.workbook.worksheets.getItem("Sheet1");
          const protection = worksheet.protection;
          let unloaded;
          let pause;
          let badOptions;
          try { protection.protected; } catch (error) { unloaded = error.code; }
          try { protection.canPauseProtection; } catch (error) { pause = error.code; }
          try { protection.protect({ selectionMode: "invalid" }); } catch (error) { badOptions = error.code; }
          return { unloaded, pause, badOptions };
        });
        "#,
    )
    .expect("protection proxy errors should be observable");

    assert_eq!(
        output.value,
        json!({
            "unloaded": "PropertyNotLoaded",
            "pause": "ApiNotFound",
            "badOptions": "InvalidArgument"
        })
    );
}
