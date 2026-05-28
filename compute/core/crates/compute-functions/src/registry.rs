//! FunctionRegistry -- central dispatch for all Excel-compatible functions.
//!
//! Stores both PureFunction (flat args, no role semantics) and ExcelFunction
//! (declarative signatures with per-argument error propagation).

use crate::ExcelFunction;
use crate::PureFunction;
pub use crate::registered_function::RegisteredFunction;
use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue};

pub struct FunctionRegistry {
    functions: Vec<RegisteredFunction>,
    name_to_id: FxHashMap<String, u16>,
}

impl FunctionRegistry {
    fn normalize_lookup_name(name: &str) -> &str {
        if name.len() >= 12 && name[..12].eq_ignore_ascii_case("_xlfn._xlws.") {
            &name[12..]
        } else if name.len() >= 6 && name[..6].eq_ignore_ascii_case("_xlfn.") {
            &name[6..]
        } else {
            name
        }
    }

    pub fn new() -> Self {
        let mut reg = Self {
            functions: Vec::with_capacity(600),
            name_to_id: FxHashMap::default(),
        };
        reg.register_all();
        reg
    }
    pub fn get_by_name(&self, name: &str) -> Option<(u16, &RegisteredFunction)> {
        let name = Self::normalize_lookup_name(name);
        // Fast path: try direct lookup first (names from the parser are almost always uppercase)
        if let Some(&id) = self.name_to_id.get(name) {
            let f = self.functions.get(id as usize)?;
            return Some((id, f));
        }
        // Slow path: uppercase and retry (avoids allocation in the common case)
        let upper = name.to_uppercase();
        let id = *self.name_to_id.get(&upper)?;
        let f = self.functions.get(id as usize)?;
        Some((id, f))
    }

    pub fn get_by_id(&self, id: u16) -> Option<&RegisteredFunction> {
        self.functions.get(id as usize)
    }

    pub fn call(&self, name: &str, args: &[CellValue]) -> CellValue {
        match self.get_by_name(name) {
            Some((_id, func)) => {
                if args.len() < func.min_args() {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "{name} requires at least {} argument(s), got {}",
                            func.min_args(),
                            args.len()
                        ),
                    );
                }
                if let Some(max) = func.max_args()
                    && args.len() > max
                {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "{name} accepts at most {max} argument(s), got {}",
                            args.len()
                        ),
                    );
                }
                func.call(args)
            }
            None => {
                CellValue::error_with_message(CellError::Name, format!("Unknown function '{name}'"))
            }
        }
    }

    pub fn len(&self) -> usize {
        self.functions.len()
    }
    pub fn is_empty(&self) -> bool {
        self.functions.is_empty()
    }

    /// Iterate over all registered function names (uppercase).
    pub fn function_names(&self) -> impl Iterator<Item = &str> {
        self.name_to_id.keys().map(|s| s.as_str())
    }

    /// Iterate over all registered functions with their IDs and names.
    pub fn iter(&self) -> impl Iterator<Item = (u16, &str, &RegisteredFunction)> {
        self.name_to_id.iter().filter_map(move |(name, &id)| {
            self.functions
                .get(id as usize)
                .map(|f| (id, name.as_str(), f))
        })
    }

    pub fn is_volatile(&self, name: &str) -> bool {
        self.get_by_name(name)
            .map(|(_, f)| f.is_volatile())
            .unwrap_or(false)
    }

    pub fn returns_array(&self, name: &str) -> bool {
        self.get_by_name(name)
            .map(|(_, f)| f.returns_array())
            .unwrap_or(false)
    }

    pub(crate) fn register(&mut self, func: Box<dyn PureFunction>) {
        let name = func.name().to_uppercase();
        let id = self.functions.len() as u16;
        self.name_to_id.insert(name, id);
        self.functions.push(RegisteredFunction::Pure(func));
    }

    pub(crate) fn register_excel(&mut self, func: Box<dyn ExcelFunction>) {
        let name = func.name().to_uppercase();
        let id = self.functions.len() as u16;
        self.name_to_id.insert(name, id);
        self.functions.push(RegisteredFunction::Excel(func));
    }

    fn register_all(&mut self) {
        crate::math::register(self);
        crate::text::register(self);
        crate::logical::register(self);
        crate::lookup::register(self);
        crate::statistical::register(self);
        crate::datetime::register(self);
        crate::financial::register(self);
        crate::engineering::register(self);
        crate::database::register(self);
        crate::information::register(self);
        crate::web::register(self);
    }
}

impl Default for FunctionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
