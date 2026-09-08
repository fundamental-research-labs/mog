use std::sync::Arc;

use compute_api::Workbook;
use rquickjs::prelude::Func;
use rquickjs::promise::Promise;
use rquickjs::{AsyncContext, AsyncRuntime, CatchResultExt, Ctx};
use serde_json::Value;

use crate::error::OfficeJsError;
use crate::host::Host;

const BOOTSTRAP: &str = include_str!("bootstrap.js");

const RUNNER: &str = r#"
(async () => {
  try {
    const __result = await eval("(async () => {\n" + globalThis.__mogSource + "\n})()");
    if (globalThis.__mogPendingRuns && globalThis.__mogPendingRuns.length) {
      await Promise.all(globalThis.__mogPendingRuns);
    }
    return JSON.stringify({
      ok: true,
      value: __result === undefined ? null : __result,
    });
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e);
    const code = e && e.code ? String(e.code) : "GeneralException";
    const name = e && e.name ? String(e.name) : "Error";
    return JSON.stringify({
      ok: false,
      error: { message: message, code: code, name: name },
    });
  }
})()
"#;

#[derive(Debug, Clone)]
pub struct ScriptOutput {
    pub value: Value,
    pub stdout: String,
}

pub fn run_office_js(source: &str) -> Result<ScriptOutput, OfficeJsError> {
    let (workbook, _) = Workbook::blank()?;
    run_office_js_with_workbook(&workbook, source)
}

pub fn run_office_js_with_workbook(
    workbook: &Workbook,
    source: &str,
) -> Result<ScriptOutput, OfficeJsError> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(OfficeJsError::runtime)?;
    rt.block_on(run_async(workbook.clone(), source.to_string()))
}

async fn run_async(workbook: Workbook, source: String) -> Result<ScriptOutput, OfficeJsError> {
    let host = Arc::new(Host::new(workbook));
    let runtime = AsyncRuntime::new().map_err(OfficeJsError::runtime)?;
    let ctx = AsyncContext::full(&runtime)
        .await
        .map_err(OfficeJsError::runtime)?;

    let host_for_apply = host.clone();
    let host_for_log = host.clone();
    let json = ctx
        .async_with(async move |ctx| eval_in_ctx(ctx, host_for_apply, host_for_log, source).await)
        .await?;
    runtime.idle().await;

    let parsed: Value = serde_json::from_str(&json).map_err(OfficeJsError::runtime)?;
    if parsed.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(ScriptOutput {
            value: parsed.get("value").cloned().unwrap_or(Value::Null),
            stdout: host.take_stdout(),
        })
    } else {
        let message = parsed
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("Office.js script failed")
            .to_string();
        let code = parsed
            .pointer("/error/code")
            .and_then(Value::as_str)
            .unwrap_or("");
        if code.is_empty() {
            Err(OfficeJsError::Script(message))
        } else {
            Err(OfficeJsError::Script(format!("{code}: {message}")))
        }
    }
}

async fn eval_in_ctx(
    ctx: Ctx<'_>,
    host_apply: Arc<Host>,
    host_log: Arc<Host>,
    source: String,
) -> Result<String, OfficeJsError> {
    let globals = ctx.globals();
    globals
        .set(
            "__mogApply",
            Func::from(move |ops: String| host_apply.apply_json(&ops)),
        )
        .map_err(OfficeJsError::runtime)?;
    globals
        .set(
            "__mogLog",
            Func::from(move |line: String| host_log.log(&line)),
        )
        .map_err(OfficeJsError::runtime)?;

    let _: () = ctx
        .eval(BOOTSTRAP)
        .catch(&ctx)
        .map_err(|e| OfficeJsError::runtime(format!("failed to load Office.js bootstrap: {e}")))?;

    let console_src = r#"
      globalThis.console = {
        log: function () {
          var parts = [];
          for (var i = 0; i < arguments.length; i++) {
            var v = arguments[i];
            if (typeof v === "string") parts.push(v);
            else {
              try { parts.push(JSON.stringify(v)); }
              catch (e) { parts.push(String(v)); }
            }
          }
          __mogLog(parts.join(" "));
        }
      };
    "#;
    let _: () = ctx
        .eval(console_src)
        .catch(&ctx)
        .map_err(|e| OfficeJsError::runtime(format!("failed to bind console: {e}")))?;

    globals
        .set("__mogSource", source)
        .map_err(OfficeJsError::runtime)?;

    let promise: Promise = ctx
        .eval(RUNNER)
        .catch(&ctx)
        .map_err(|e| OfficeJsError::runtime(format!("failed to start script: {e}")))?;
    promise
        .into_future::<String>()
        .await
        .catch(&ctx)
        .map_err(|e| OfficeJsError::runtime(format!("script promise failed: {e}")))
}
