//! Conditional-format domain contract types.

mod classification;
mod format;
mod normalize;
mod rule;
mod style;
mod value_ref;
mod visual;

pub use classification::{CFOperator, CFRuleType, CFTextOperator, DatePeriod};
pub use format::{CFCellRange, CellIdRange, ConditionalFormat};
pub use normalize::{
    CANONICAL_CF_RULE_TYPES, canonicalize_cf_rule_defaults,
    canonicalize_conditional_format_defaults, normalize_cf_rule_input,
    normalize_conditional_format_input,
};
pub use rule::CFRule;
pub use style::CFStyle;
pub use value_ref::CFValueRef;
pub use visual::{CFColorPoint, CFColorScale, CFCustomIcon, CFDataBar, CFIconSet, CFIconThreshold};
