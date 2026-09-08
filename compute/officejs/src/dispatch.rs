//! Shared host extension dispatch and object binding contracts.
//!
//! The Office.js host is intentionally split between a small central router
//! and independently-owned object families.  A family handler claims its
//! operation names, performs the family-specific translation, and binds a
//! typed object through [`HostDispatchContext`].  Once bound, the normal
//! `load` and `set` operations are handled by the host for every family.
//! Handlers may also claim `load` or `set`, inspect the target ID/property,
//! and return `false` to let the existing core object path continue.  This is
//! the hook for adding scalar members to an existing Range, Worksheet, or
//! RangeFormat proxy without changing the central enum.
//!
//! Extension operation payloads are raw JSON objects with an `op` string and
//! family-defined fields.  This keeps the central `Op` enum stable while
//! retaining the existing wire protocol and sync ordering.

use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use compute_api::Workbook;
use serde_json::Value;

use crate::format::FormatRef;
use crate::host::{mark_object, BatchError, Host, RangeRef};
use crate::worksheets::WorksheetRef;

/// A host-side object exposed by an extension family.
///
/// Implementors own the family-specific reference and translation to/from
/// JSON.  The host invokes these methods for generic Office.js `load` and
/// `set` operations after a handler has bound the object ID.
pub(crate) trait ExtensionObject: Any + Send + Sync {
    /// The Office.js object name used in generic null-object diagnostics.
    fn object_type(&self) -> &'static str {
        "Object"
    }

    /// Project the requested scalar properties into the sync response.
    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError>;

    /// Apply one queued property mutation.
    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError>;
}

/// A host binding for an extension object ID.
#[derive(Clone)]
pub(crate) struct ExtensionBinding {
    object: Option<Arc<dyn ExtensionObject>>,
    typed: Option<Arc<dyn Any + Send + Sync>>,
    is_null_object: bool,
}

impl ExtensionBinding {
    pub(crate) fn object<T>(object: Arc<T>) -> Self
    where
        T: ExtensionObject + 'static,
    {
        let typed: Arc<dyn Any + Send + Sync> = object.clone();
        let object: Arc<dyn ExtensionObject> = object;
        Self {
            object: Some(object),
            typed: Some(typed),
            is_null_object: false,
        }
    }

    pub(crate) fn null() -> Self {
        Self {
            object: None,
            typed: None,
            is_null_object: true,
        }
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.is_null_object
    }

    pub(crate) fn downcast<T>(&self) -> Option<Arc<T>>
    where
        T: Any + Send + Sync,
    {
        self.typed.as_ref()?.clone().downcast::<T>().ok()
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let object_name = self
            .object
            .as_ref()
            .map(|object| object.object_type())
            .unwrap_or("Object");
        if self.is_null_object {
            let mut result = HashMap::new();
            for property in properties {
                if property == "isNullObject" {
                    result.insert(property.clone(), Value::Bool(true));
                } else {
                    return Err(BatchError {
                        code: "InvalidObjectPath",
                        message: format!(
                            "{object_name}.{property} cannot be loaded from a null object"
                        ),
                    });
                }
            }
            return Ok(result);
        }

        let object = self.object.as_ref().expect("non-null extension object");
        // `isNullObject` belongs to OfficeExtension's inherited object
        // contract.  Family objects only receive their declared properties;
        // forwarding it would make strict family adapters reject an
        // otherwise valid load projection.
        let delegated_properties: Vec<String> = properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .cloned()
            .collect();
        let mut result = object.load(&delegated_properties)?;
        if properties.iter().any(|property| property == "isNullObject") {
            result.insert("isNullObject".to_string(), Value::Bool(false));
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        if self.is_null_object {
            let object_name = self
                .object
                .as_ref()
                .map(|object| object.object_type())
                .unwrap_or("Object");
            return Err(BatchError {
                code: "InvalidObjectPath",
                message: format!("{object_name}.{property} cannot be set on a null object"),
            });
        }
        self.object
            .as_ref()
            .expect("non-null extension object")
            .set(property, value)
    }
}

/// A family handler participating in host sync dispatch.
///
/// `can_handle` must be deterministic and should claim only the operation
/// names owned by the family.  Handlers are consulted in registration order;
/// registration should therefore reject or avoid overlapping names.
pub(crate) trait ExtensionHandler: Send + Sync {
    fn can_handle(&self, operation: &str) -> bool;

    /// Return `true` when the operation was consumed.  Returning `false`
    /// leaves the operation for the core router or the next handler.
    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError>;
}

/// Registry of independently-owned family handlers.
#[derive(Default)]
pub(crate) struct ExtensionRegistry {
    handlers: Mutex<Vec<Arc<dyn ExtensionHandler>>>,
}

impl ExtensionRegistry {
    /// Register one handler.  Registration happens while a host is being
    /// assembled, before any script batch is evaluated.
    pub(crate) fn register<H>(&self, handler: H)
    where
        H: ExtensionHandler + 'static,
    {
        self.handlers
            .lock()
            .expect("extension handlers lock")
            .push(Arc::new(handler));
    }

    /// Register a handler that is already shared by another host owner.
    pub(crate) fn register_arc(&self, handler: Arc<dyn ExtensionHandler>) {
        self.handlers
            .lock()
            .expect("extension handlers lock")
            .push(handler);
    }

    pub(crate) fn dispatch(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let Some(name) = operation.get("op").and_then(Value::as_str) else {
            return Ok(false);
        };
        let handlers = self
            .handlers
            .lock()
            .expect("extension handlers lock")
            .clone();
        for handler in handlers {
            if handler.can_handle(name) && handler.handle(operation, context)? {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// Shared context passed to a family operation handler.
///
/// The context deliberately exposes only stable host hooks: workbook and
/// existing worksheet/range lookup, range/worksheet rebinding, object
/// binding, loaded-property projection, and deferred result completion.
pub(crate) struct HostDispatchContext<'a> {
    host: &'a Host,
    loaded: &'a mut HashMap<String, HashMap<String, Value>>,
    results: &'a mut HashMap<String, Value>,
    delegated_load: Option<(String, Vec<String>)>,
}

impl<'a> HostDispatchContext<'a> {
    pub(crate) fn new(
        host: &'a Host,
        loaded: &'a mut HashMap<String, HashMap<String, Value>>,
        results: &'a mut HashMap<String, Value>,
    ) -> Self {
        Self {
            host,
            loaded,
            results,
            delegated_load: None,
        }
    }

    /// Clone the workbook handle for family engine calls.
    pub(crate) fn workbook(&self) -> Workbook {
        self.host.workbook()
    }

    /// Resolve an already-bound Worksheet proxy.
    pub(crate) fn worksheet(&self, id: &str) -> Result<WorksheetRef, BatchError> {
        self.host.lookup_worksheet(id)
    }

    /// Resolve an already-bound Range proxy.
    pub(crate) fn range(&self, id: &str) -> Result<RangeRef, BatchError> {
        self.host.lookup_range(id)
    }

    /// Resolve an existing RangeFormat-family binding when a new family adds
    /// scalar properties to it.
    pub(crate) fn format(&self, id: &str) -> Result<FormatRef, BatchError> {
        self.host.lookup_format(id)
    }

    /// Bind a family-produced Worksheet reference and mark it present in the
    /// current sync response.
    pub(crate) fn bind_worksheet(&mut self, id: &str, worksheet: WorksheetRef) {
        self.host.bind_worksheet(id, worksheet);
        mark_object(self.loaded, id, false);
    }

    /// Bind a family-produced Range reference and mark it present in the
    /// current sync response.  This reuses the core Range host map, so all
    /// existing range navigation/content/format handlers can consume it.
    pub(crate) fn bind_range(&mut self, id: &str, range: RangeRef) {
        self.host.bind_range(id, range);
        mark_object(self.loaded, id, false);
    }

    /// Bind a typed extension object.  Generic `load`/`set` operations are
    /// automatically routed to its [`ExtensionObject`] implementation.
    pub(crate) fn bind_object<T>(&mut self, id: &str, object: Arc<T>)
    where
        T: ExtensionObject + 'static,
    {
        self.host
            .bind_extension_object(id, ExtensionBinding::object(object));
        mark_object(self.loaded, id, false);
    }

    /// Retrieve a typed parent locator previously bound by this or another
    /// family.  Child handlers can share one canonical object identity rather
    /// than maintaining a parallel map keyed by proxy ID.
    pub(crate) fn extension_object<T>(&self, id: &str) -> Result<Arc<T>, BatchError>
    where
        T: Any + Send + Sync,
    {
        self.host
            .extension_binding(id)
            .and_then(|binding| binding.downcast::<T>())
            .ok_or_else(|| BatchError {
                code: "InvalidObjectPath",
                message: "The extension object is not available.".to_string(),
            })
    }

    /// Bind an Office.js `OrNullObject` result.
    pub(crate) fn bind_null_object(&mut self, id: &str) {
        self.host
            .bind_extension_object(id, ExtensionBinding::null());
        mark_object(self.loaded, id, true);
    }

    /// Add one loaded property to the response for an object bound by this
    /// or another family operation in the same batch.
    pub(crate) fn set_loaded(&mut self, id: &str, property: &str, value: Value) {
        self.loaded
            .entry(id.to_string())
            .or_default()
            .insert(property.to_string(), value);
    }

    /// Merge a loaded-property projection into the response.
    pub(crate) fn extend_loaded(&mut self, id: &str, properties: HashMap<String, Value>) {
        self.loaded
            .entry(id.to_string())
            .or_default()
            .extend(properties);
    }

    /// Complete a deferred `ClientResult` queued by a family proxy.
    pub(crate) fn set_result(&mut self, result_id: &str, value: Value) {
        self.results.insert(result_id.to_string(), value);
    }

    /// Leave selected properties of a `load` operation for the central host
    /// loader.  A family handler can therefore project its own properties
    /// into `loaded`, delegate the remaining properties here, and return
    /// `true` without swallowing a mixed request such as
    /// `Range.load(["hyperlink", "values"])`.
    pub(crate) fn delegate_load(
        &mut self,
        id: &str,
        properties: &[String],
    ) -> Result<(), BatchError> {
        if self
            .delegated_load
            .replace((id.to_string(), properties.to_vec()))
            .is_some()
        {
            return Err(BatchError {
                code: "InvalidArgument",
                message: "A family load handler delegated properties more than once.".to_string(),
            });
        }
        Ok(())
    }

    pub(crate) fn take_delegated_load(&mut self) -> Option<(String, Vec<String>)> {
        self.delegated_load.take()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use compute_api::Workbook;
    use serde_json::{json, Value};

    use super::{BatchError, ExtensionHandler, ExtensionObject, HostDispatchContext};
    use crate::host::Host;

    struct TestObject;

    impl ExtensionObject for TestObject {
        fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
            if properties.iter().any(|property| property == "isNullObject") {
                return Err(BatchError {
                    code: "InvalidArgument",
                    message: "isNullObject must not be delegated to a family object".to_string(),
                });
            }
            Ok(properties
                .iter()
                .map(|property| (property.clone(), json!("loaded")))
                .collect())
        }

        fn set(&self, _property: &str, _value: &Value) -> Result<(), BatchError> {
            Ok(())
        }
    }

    struct TestHandler;

    impl ExtensionHandler for TestHandler {
        fn can_handle(&self, operation: &str) -> bool {
            operation == "bindTestObject"
        }

        fn handle(
            &self,
            operation: &Value,
            context: &mut HostDispatchContext<'_>,
        ) -> Result<bool, BatchError> {
            let id = operation
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| BatchError {
                    code: "InvalidArgument",
                    message: "bindTestObject requires an id".to_string(),
                })?;
            context.bind_object(id, Arc::new(TestObject));
            Ok(true)
        }
    }

    #[test]
    fn extension_binding_reuses_generic_load_and_set_wire_operations() {
        let (workbook, _) = Workbook::blank().expect("blank workbook");
        let host = Host::new(workbook);
        host.register_extension(TestHandler);

        let response: Value = serde_json::from_str(&host.apply_json(
            r#"[
                    {"op":"bindTestObject","id":"test"},
                    {"op":"load","id":"test","properties":["value","isNullObject"]},
                    {"op":"set","id":"test","property":"value","value":3}
                ]"#,
        ))
        .expect("valid sync response");

        assert_eq!(response["error"], Value::Null);
        assert_eq!(response["loaded"]["test"]["isNullObject"], json!(false));
        assert_eq!(response["loaded"]["test"]["value"], json!("loaded"));
    }
}
