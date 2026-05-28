use super::range_ref::{a1_range_to_identity_ref, identity_range_to_a1};
use super::schema_types::{
    EnforcementLevel, ErrorMessage, IdentityRangeSchemaRef, InputMessage, RangeSchema,
    RangeSchemaDefinition, RangeSchemaUi, SchemaConstraints, SchemaType,
};
use super::spec::{ErrorStyle, ImeMode, ValidationOperator, ValidationRule, ValidationSpec};

impl ValidationSpec {
    /// Convert an XLSX `ValidationSpec` to the canonical `RangeSchema` format.
    ///
    /// `id` is the unique identifier for the generated range schema (caller provides).
    /// Returns `None` if no ranges can be parsed.
    pub fn to_range_schema(&self, id: String) -> Option<RangeSchema> {
        let ranges: Vec<IdentityRangeSchemaRef> = self
            .ranges
            .iter()
            .filter_map(|r| a1_range_to_identity_ref(r))
            .collect();
        if ranges.is_empty() {
            return None;
        }

        let (schema_type, mut constraints) = validation_rule_to_schema_parts(&self.rule);

        // Propagate allow_blank into constraints.
        match constraints {
            Some(ref mut c) => c.allow_blank = Some(self.allow_blank),
            None => {
                constraints = Some(SchemaConstraints {
                    allow_blank: Some(self.allow_blank),
                    ..Default::default()
                });
            }
        }

        let enforcement = Some(EnforcementLevel::from(self.error_style));

        let error_message =
            if self.show_error && (self.error_title.is_some() || self.error_message.is_some()) {
                Some(ErrorMessage {
                    title: self.error_title.clone(),
                    message: self.error_message.clone(),
                })
            } else {
                None
            };

        let input_message =
            if self.show_prompt && (self.prompt_title.is_some() || self.prompt_message.is_some()) {
                Some(InputMessage {
                    title: self.prompt_title.clone(),
                    message: self.prompt_message.clone(),
                })
            } else {
                None
            };

        let show_dropdown = match &self.rule {
            ValidationRule::List { show_dropdown, .. } => Some(*show_dropdown),
            _ => None,
        };

        let ui = if error_message.is_some() || input_message.is_some() || show_dropdown.is_some() {
            Some(RangeSchemaUi {
                show_dropdown,
                error_message,
                input_message,
            })
        } else {
            None
        };

        Some(RangeSchema {
            id,
            created_at: 0,
            ranges,
            schema: RangeSchemaDefinition {
                schema_type,
                constraints,
            },
            enforcement,
            ui,
        })
    }
}

impl RangeSchema {
    /// Convert a `RangeSchema` back to an XLSX `ValidationSpec`.
    ///
    /// This is the inverse of [`ValidationSpec::to_range_schema`]. It is used
    /// by the runtime schemas API (which still speaks `RangeSchema`) to upsert
    /// into the single canonical `properties/dataValidations` store.
    ///
    /// Returns `None` if the schema has no convertible rule or no valid ranges.
    pub fn to_validation_spec(&self) -> Option<ValidationSpec> {
        let a1_ranges: Vec<String> = self
            .ranges
            .iter()
            .filter_map(identity_range_to_a1)
            .collect();
        if a1_ranges.is_empty() {
            return None;
        }

        let rule =
            build_validation_rule(self.schema.schema_type, self.schema.constraints.as_ref())?;

        let error_style: ErrorStyle = self.enforcement.unwrap_or(EnforcementLevel::Strict).into();

        let allow_blank = self
            .schema
            .constraints
            .as_ref()
            .and_then(|c| c.allow_blank)
            .unwrap_or(true);

        let (show_error, error_title, error_message) =
            match self.ui.as_ref().and_then(|u| u.error_message.as_ref()) {
                Some(em) => (true, em.title.clone(), em.message.clone()),
                None => (true, None, None),
            };
        let (show_prompt, prompt_title, prompt_message) =
            match self.ui.as_ref().and_then(|u| u.input_message.as_ref()) {
                Some(im) => (true, im.title.clone(), im.message.clone()),
                None => (false, None, None),
            };

        // Preserve the RangeSchema id as the ValidationSpec uid so the
        // runtime view layer can continue to find it by id on subsequent
        // reads. Empty ids leave uid absent so the XLSX writer won't emit
        // a blank `xr:uid` attribute.
        let uid = if self.id.is_empty() {
            None
        } else {
            Some(self.id.clone())
        };

        Some(ValidationSpec {
            ranges: a1_ranges,
            rule,
            error_style,
            show_error,
            error_title,
            error_message,
            show_prompt,
            prompt_title,
            prompt_message,
            allow_blank,
            ime_mode: ImeMode::NoControl,
            uid,
        })
    }
}

fn build_validation_rule(
    schema_type: Option<SchemaType>,
    constraints: Option<&SchemaConstraints>,
) -> Option<ValidationRule> {
    let c = constraints;

    if let Some(vals) = c.and_then(|c| c.enum_values.as_ref()) {
        let formula1 = format!("\"{}\"", vals.join(","));
        return Some(ValidationRule::List {
            formula1,
            show_dropdown: true,
        });
    }

    if let Some(formula) = c.and_then(|c| c.enum_source_formula.as_ref()) {
        return Some(ValidationRule::List {
            formula1: formula.clone(),
            show_dropdown: true,
        });
    }

    // Range-based list source — TS sends this for listSource = "=B1:B3".
    // Store the range as an A1-style formula1 so the round-trip reconstructs
    // `enum_source` in `validation_rule_to_schema_parts` below.
    if let Some(src) = c.and_then(|c| c.enum_source.as_ref())
        && let Some(a1) = identity_range_to_a1(src)
    {
        return Some(ValidationRule::List {
            formula1: a1,
            show_dropdown: true,
        });
    }

    if let Some(formula) = c.and_then(|c| c.formula.as_ref()) {
        return Some(ValidationRule::Custom {
            formula1: formula.clone(),
        });
    }

    // Text-length constraints without an explicit schema_type — TS sends
    // `{type: undefined, constraints: {minLength/maxLength}}` for textLength rules.
    if c.is_some_and(|c| c.min_length.is_some() || c.max_length.is_some()) {
        let (operator, f1, f2) = text_length_operator_and_formulas(c);
        if !f1.is_empty() {
            return Some(ValidationRule::TextLength {
                operator,
                formula1: f1,
                formula2: f2,
            });
        }
    }

    let st = schema_type?;

    match st {
        SchemaType::Integer => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::WholeNumber {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::Number | SchemaType::Currency | SchemaType::Percentage => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::Decimal {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::Date => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::Date {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::Time => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::Time {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::String | SchemaType::Email | SchemaType::Url | SchemaType::Phone => {
            let (operator, f1, f2) = text_length_operator_and_formulas(c);
            if f1.is_empty() {
                None
            } else {
                Some(ValidationRule::TextLength {
                    operator,
                    formula1: f1,
                    formula2: f2,
                })
            }
        }
        _ => None,
    }
}

fn numeric_operator_and_formulas(
    constraints: Option<&SchemaConstraints>,
) -> (ValidationOperator, String, Option<String>) {
    let c = match constraints {
        Some(c) => c,
        None => return (ValidationOperator::Between, String::new(), None),
    };

    if let Some(v) = c.equal {
        return (ValidationOperator::Equal, v.to_string(), None);
    }
    if let Some(v) = c.not_equal {
        return (ValidationOperator::NotEqual, v.to_string(), None);
    }
    if let (Some(lo), Some(hi)) = (c.not_between_min, c.not_between_max) {
        return (
            ValidationOperator::NotBetween,
            lo.to_string(),
            Some(hi.to_string()),
        );
    }
    if let (Some(lo), Some(hi)) = (c.min, c.max) {
        return (
            ValidationOperator::Between,
            lo.to_string(),
            Some(hi.to_string()),
        );
    }
    if let Some(v) = c.exclusive_min {
        return (ValidationOperator::GreaterThan, v.to_string(), None);
    }
    if let Some(v) = c.min {
        return (ValidationOperator::GreaterThanOrEqual, v.to_string(), None);
    }
    if let Some(v) = c.exclusive_max {
        return (ValidationOperator::LessThan, v.to_string(), None);
    }
    if let Some(v) = c.max {
        return (ValidationOperator::LessThanOrEqual, v.to_string(), None);
    }

    (ValidationOperator::Between, String::new(), None)
}

fn text_length_operator_and_formulas(
    constraints: Option<&SchemaConstraints>,
) -> (ValidationOperator, String, Option<String>) {
    let c = match constraints {
        Some(c) => c,
        None => return (ValidationOperator::Between, String::new(), None),
    };

    if let (Some(lo), Some(hi)) = (c.min_length, c.max_length) {
        return (
            ValidationOperator::Between,
            lo.to_string(),
            Some(hi.to_string()),
        );
    }
    if let Some(v) = c.min_length {
        return (ValidationOperator::GreaterThanOrEqual, v.to_string(), None);
    }
    if let Some(v) = c.max_length {
        return (ValidationOperator::LessThanOrEqual, v.to_string(), None);
    }

    (ValidationOperator::Between, String::new(), None)
}

fn validation_rule_to_schema_parts(
    rule: &ValidationRule,
) -> (Option<SchemaType>, Option<SchemaConstraints>) {
    match rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Integer), Some(c))
        }
        ValidationRule::Decimal {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Number), Some(c))
        }
        ValidationRule::Date {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Date), Some(c))
        }
        ValidationRule::Time {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Time), Some(c))
        }
        ValidationRule::TextLength {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_length_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::String), Some(c))
        }
        ValidationRule::List {
            formula1,
            show_dropdown: _,
        } => {
            let mut c = SchemaConstraints::default();
            if formula1.starts_with('"') && formula1.ends_with('"') {
                let inner = &formula1[1..formula1.len() - 1];
                c.enum_values = Some(inner.split(',').map(|s| s.to_string()).collect());
            } else if !formula1.starts_with('=')
                && let Some(src) = a1_range_to_identity_ref(formula1)
            {
                // Simple range reference (e.g. "B1:B3"): expose as enum_source so
                // the SDK's getDropdownItems can query live cell values.
                c.enum_source = Some(src);
            } else {
                c.enum_source_formula = Some(formula1.clone());
            }
            (None, Some(c))
        }
        ValidationRule::Custom { formula1 } => {
            let c = SchemaConstraints {
                formula: Some(formula1.clone()),
                ..Default::default()
            };
            (None, Some(c))
        }
        ValidationRule::None { .. } => (None, None),
    }
}

/// Convert operator + formula values to numeric `SchemaConstraints`.
fn operator_formulas_to_numeric_constraints(
    operator: &ValidationOperator,
    formula1: &str,
    formula2: Option<&str>,
) -> SchemaConstraints {
    let mut c = SchemaConstraints::default();
    let f1: Option<f64> = formula1.parse().ok();
    let f2: Option<f64> = formula2.and_then(|s| s.parse().ok());

    match operator {
        ValidationOperator::Between => {
            c.min = f1;
            c.max = f2;
        }
        ValidationOperator::NotBetween => {
            c.not_between_min = f1;
            c.not_between_max = f2;
        }
        ValidationOperator::Equal => {
            c.equal = f1;
        }
        ValidationOperator::NotEqual => {
            c.not_equal = f1;
        }
        ValidationOperator::GreaterThan => {
            c.exclusive_min = f1;
        }
        ValidationOperator::GreaterThanOrEqual => {
            c.min = f1;
        }
        ValidationOperator::LessThan => {
            c.exclusive_max = f1;
        }
        ValidationOperator::LessThanOrEqual => {
            c.max = f1;
        }
    }
    c
}

/// Convert operator + formula values to text-length `SchemaConstraints`.
fn operator_formulas_to_length_constraints(
    operator: &ValidationOperator,
    formula1: &str,
    formula2: Option<&str>,
) -> SchemaConstraints {
    let mut c = SchemaConstraints::default();
    let f1: Option<usize> = formula1.parse().ok();
    let f2: Option<usize> = formula2.and_then(|s| s.parse().ok());

    match operator {
        ValidationOperator::Between => {
            c.min_length = f1;
            c.max_length = f2;
        }
        ValidationOperator::GreaterThanOrEqual => {
            c.min_length = f1;
        }
        ValidationOperator::LessThanOrEqual => {
            c.max_length = f1;
        }
        _ => {
            c.min_length = f1;
        }
    }
    c
}
