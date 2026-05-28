//! Web and media functions.

mod image;

use crate::FunctionRegistry;

/// Register web/media functions.
pub fn register(registry: &mut FunctionRegistry) {
    image::register(registry);
}
