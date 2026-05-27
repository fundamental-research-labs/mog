use regex::{NoExpand, Regex};

use super::range::{TableRangeInfo, table_data_a1_range};

fn escape_regex(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                result.push('\\');
                result.push(ch);
            }
            _ => result.push(ch),
        }
    }
    result
}

/// Check if a formula template contains a structured reference to a specific table.
pub fn template_contains_table_ref(template: &str, table_name: &str) -> bool {
    if table_name.is_empty() || template.is_empty() {
        return false;
    }

    let pattern = format!(r"(?i)\b{}\[", escape_regex(table_name));
    Regex::new(&pattern).is_ok_and(|re| re.is_match(template))
}

/// Check if a formula template contains a structured reference to a specific column.
pub fn template_contains_column_ref(template: &str, column_name: &str) -> bool {
    if column_name.is_empty() || template.is_empty() {
        return false;
    }

    let pattern = format!(r"(?i)\[[@#]?{}\]", escape_regex(column_name));
    Regex::new(&pattern).is_ok_and(|re| re.is_match(template))
}

/// Replace a table name in a formula string.
pub fn replace_table_name_in_formula(
    formula: &str,
    old_table_name: &str,
    new_table_name: &str,
) -> String {
    if formula.is_empty() || old_table_name.is_empty() {
        return formula.to_string();
    }

    let pattern = format!(r"(?i)\b{}\[", escape_regex(old_table_name));
    if let Ok(re) = Regex::new(&pattern) {
        re.replace_all(formula, format!("{}[", new_table_name).as_str())
            .to_string()
    } else {
        formula.to_string()
    }
}

/// Replace a column name in a formula string for a specific table.
pub fn replace_column_name_in_formula(
    formula: &str,
    _table_name: &str,
    old_column_name: &str,
    new_column_name: &str,
) -> String {
    if formula.is_empty() || old_column_name.is_empty() {
        return formula.to_string();
    }

    let pattern = format!(r"(?i)\[{}\]", escape_regex(old_column_name));
    if let Ok(re) = Regex::new(&pattern) {
        re.replace_all(formula, format!("[{}]", new_column_name).as_str())
            .to_string()
    } else {
        formula.to_string()
    }
}

/// Replace a table reference with `#REF!` in a formula.
pub fn replace_table_ref_with_ref_error(formula: &str, table_name: &str) -> String {
    if formula.is_empty() || table_name.is_empty() {
        return formula.to_string();
    }

    let pattern = format!(r"(?i)\b{}\[[^\]]*\]", escape_regex(table_name));
    if let Ok(re) = Regex::new(&pattern) {
        re.replace_all(formula, "#REF!").to_string()
    } else {
        formula.to_string()
    }
}

/// Replace a column reference with `#REF!` in a formula.
pub fn replace_column_ref_with_ref_error(
    formula: &str,
    table_name: &str,
    column_name: &str,
) -> String {
    if formula.is_empty() || column_name.is_empty() {
        return formula.to_string();
    }

    let mut result = formula.to_string();

    let pattern = format!(
        r"(?i)\b{}\[([^\]]*,)?\s*{}\s*(,[^\]]*)?\]",
        escape_regex(table_name),
        escape_regex(column_name)
    );
    if let Ok(re) = Regex::new(&pattern) {
        result = re.replace_all(&result, "#REF!").to_string();
    }

    let pattern = format!(r"(?i)\[@{}\]", escape_regex(column_name));
    if let Ok(re) = Regex::new(&pattern) {
        result = re.replace_all(&result, "#REF!").to_string();
    }

    let pattern = format!(r"(?i)\[{}\]", escape_regex(column_name));
    if let Ok(re) = Regex::new(&pattern) {
        result = re.replace_all(&result, "#REF!").to_string();
    }

    result
}

/// Replace all structured references to a table with A1 references.
pub fn replace_structured_refs_with_a1(formula: &str, table_info: &TableRangeInfo) -> String {
    if formula.is_empty() {
        return formula.to_string();
    }

    let a1_ref = table_data_a1_range(table_info);
    let pattern = format!(r"(?i)\b{}\[[^\]]*\]", escape_regex(&table_info.name));
    if let Ok(re) = Regex::new(&pattern) {
        re.replace_all(formula, NoExpand(a1_ref.as_str()))
            .to_string()
    } else {
        formula.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_info() -> TableRangeInfo {
        TableRangeInfo {
            name: "Sales".to_string(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec![
                ("Date".to_string(), 0),
                ("Amount".to_string(), 1),
                ("Tax".to_string(), 2),
            ],
            has_header_row: true,
            has_total_row: false,
        }
    }

    #[test]
    fn escape_regex_special_chars() {
        assert_eq!(escape_regex("Sales"), "Sales");
        assert_eq!(escape_regex("My.Table"), r"My\.Table");
        assert_eq!(escape_regex("Table (1)"), r"Table \(1\)");
        assert_eq!(escape_regex("a+b*c"), r"a\+b\*c");
        assert_eq!(escape_regex("[test]"), r"\[test\]");
    }

    #[test]
    fn table_detection_is_case_insensitive_and_word_bounded() {
        assert!(template_contains_table_ref("Sales[Amount]", "Sales"));
        assert!(template_contains_table_ref("sales[Amount]", "Sales"));
        assert!(!template_contains_table_ref("MySales[Amount]", "Sales"));
        assert!(!template_contains_table_ref("Revenue[Amount]", "Sales"));
        assert!(!template_contains_table_ref("", "Sales"));
        assert!(!template_contains_table_ref("Sales[Amount]", ""));
    }

    #[test]
    fn column_detection_handles_same_row_and_headers() {
        assert!(template_contains_column_ref("Sales[Amount]", "Amount"));
        assert!(template_contains_column_ref("Sales[@Amount]", "Amount"));
        assert!(template_contains_column_ref(
            "Sales[[#Headers],[Amount]]",
            "Amount"
        ));
        assert!(template_contains_column_ref("Sales[amount]", "Amount"));
        assert!(!template_contains_column_ref("Sales[Tax]", "Amount"));
        assert!(!template_contains_column_ref("", "Amount"));
        assert!(!template_contains_column_ref("Sales[Amount]", ""));
    }

    #[test]
    fn replace_table_name_preserves_existing_behavior() {
        assert_eq!(
            replace_table_name_in_formula("Sales[Amount]", "Sales", "Revenue"),
            "Revenue[Amount]"
        );
        assert_eq!(
            replace_table_name_in_formula("Sales[Amount]+Sales[Tax]", "Sales", "Revenue"),
            "Revenue[Amount]+Revenue[Tax]"
        );
        assert_eq!(
            replace_table_name_in_formula("sales[Amount]", "Sales", "Revenue"),
            "Revenue[Amount]"
        );
        assert_eq!(
            replace_table_name_in_formula("Revenue[Amount]", "Sales", "NewSales"),
            "Revenue[Amount]"
        );
        assert_eq!(
            replace_table_name_in_formula("MySales[Amount]", "Sales", "Revenue"),
            "MySales[Amount]"
        );
        assert_eq!(
            replace_table_name_in_formula("Table (1)[Amount]", "Table (1)", "Sales"),
            "Sales[Amount]"
        );
        assert_eq!(replace_table_name_in_formula("", "Sales", "Revenue"), "");
        assert_eq!(
            replace_table_name_in_formula("Sales[Amount]", "", "Revenue"),
            "Sales[Amount]"
        );
    }

    #[test]
    fn replace_column_name_is_currently_table_agnostic() {
        assert_eq!(
            replace_column_name_in_formula("Sales[Amount]", "Sales", "Amount", "Revenue"),
            "Sales[Revenue]"
        );
        assert_eq!(
            replace_column_name_in_formula("Sales[Amount]+Tax[Amount]", "Sales", "Amount", "Total"),
            "Sales[Total]+Tax[Total]"
        );
        assert_eq!(
            replace_column_name_in_formula("Sales[amount]", "Sales", "Amount", "Revenue"),
            "Sales[Revenue]"
        );
        assert_eq!(
            replace_column_name_in_formula("Sales[Amount ($)]", "Sales", "Amount ($)", "Revenue"),
            "Sales[Revenue]"
        );
    }

    #[test]
    fn replace_table_ref_with_ref_error_preserves_expression_shape() {
        assert_eq!(
            replace_table_ref_with_ref_error("Sales[Amount]", "Sales"),
            "#REF!"
        );
        assert_eq!(
            replace_table_ref_with_ref_error("SUM(Sales[Amount])+1", "Sales"),
            "SUM(#REF!)+1"
        );
        assert_eq!(
            replace_table_ref_with_ref_error("Sales[Amount]+Sales[Tax]", "Sales"),
            "#REF!+#REF!"
        );
        assert_eq!(
            replace_table_ref_with_ref_error("sales[Amount]", "Sales"),
            "#REF!"
        );
    }

    #[test]
    fn replace_column_ref_with_ref_error_preserves_current_edges() {
        assert_eq!(
            replace_column_ref_with_ref_error("Sales[Amount]", "Sales", "Amount"),
            "#REF!"
        );
        assert_eq!(
            replace_column_ref_with_ref_error("Sales[Amount]+Sales[Tax]", "Sales", "Amount"),
            "#REF!+Sales[Tax]"
        );
        assert_eq!(
            replace_column_ref_with_ref_error("Sales[@Amount]", "Sales", "Amount"),
            "Sales#REF!"
        );
        assert_eq!(
            replace_column_ref_with_ref_error("Sales[Amount]+Inventory[Amount]", "Sales", "Amount"),
            "#REF!+Inventory#REF!"
        );
    }

    #[test]
    fn replace_structured_refs_with_a1_uses_table_data_range() {
        let mut info = table_info();
        assert_eq!(
            replace_structured_refs_with_a1("Sales[Amount]", &info),
            "$A$2:$C$11"
        );
        assert_eq!(
            replace_structured_refs_with_a1("SUM(Sales[Amount])+1", &info),
            "SUM($A$2:$C$11)+1"
        );
        info.has_total_row = true;
        assert_eq!(
            replace_structured_refs_with_a1("Sales[Amount]", &info),
            "$A$2:$C$10"
        );
        info.has_header_row = false;
        info.has_total_row = false;
        assert_eq!(
            replace_structured_refs_with_a1("Sales[Amount]", &info),
            "$A$1:$C$11"
        );
    }
}
