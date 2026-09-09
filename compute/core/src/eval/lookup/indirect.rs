//! INDIRECT reference construction, shared by value and reference consumers.

use cell_types::col_to_letter;
use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;
use crate::eval::engine::reference_resolution::parse_defined_name_formula;

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// Resolve INDIRECT without discarding the reference's sheet and geometry.
    /// User errors are represented as AST error nodes so both value consumers
    /// and functions such as ROW/COLUMN preserve their Excel error code.
    pub(in crate::eval) async fn indirect_reference_node(
        &mut self,
        args: &[ASTNode],
    ) -> Result<ASTNode, ComputeError> {
        if args.is_empty() || args.len() > 2 {
            return Ok(ASTNode::Error(CellError::Value));
        }
        let ref_value = self.eval_node_cv(&args[0]).await?;
        let ref_text = match ref_value.coerce_to_string() {
            Ok(text) => text,
            Err(error) => return Ok(ASTNode::Error(error)),
        };
        let a1 = if args.len() == 2 && !matches!(args[1], ASTNode::Omitted) {
            match self.eval_node_cv(&args[1]).await?.coerce_to_bool() {
                Ok(flag) => flag,
                Err(error) => return Ok(ASTNode::Error(error)),
            }
        } else {
            true
        };
        let ref_text = ref_text.trim();
        let converted = if a1 {
            None
        } else {
            let position = self.meta.resolve_position(&self.meta.current_cell());
            r1c1_to_a1(ref_text, position.map(|(_, row, col)| (row, col)))
        };
        // Defined names are legal in either reference style.
        let reference = converted.as_deref().unwrap_or(ref_text);
        let Some(node) = parse_defined_name_formula(reference, self.meta) else {
            return Ok(ASTNode::Error(CellError::Ref));
        };
        // INDIRECT accepts reference text, not a formula to execute. In R1C1
        // mode an unsuccessful conversion must not accidentally accept A1.
        if (!a1 && converted.is_none() && !matches!(node, ASTNode::Identifier(_)))
            || !indirect_reference_syntax(&node)
        {
            return Ok(ASTNode::Error(CellError::Ref));
        }
        if let ASTNode::Identifier(name) = &node
            && self.meta.resolve_defined_name(name).is_none()
        {
            return Ok(ASTNode::Error(CellError::Ref));
        }
        Ok(node)
    }

    /// Evaluate INDIRECT(ref_text, [a1]) in a value context.
    pub(in crate::eval) async fn eval_indirect(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        let node = self.indirect_reference_node(args).await?;
        self.eval_node_cv(&node).await
    }
}

fn indirect_reference_syntax(node: &ASTNode) -> bool {
    match node {
        ASTNode::CellReference(_)
        | ASTNode::Range(_)
        | ASTNode::Identifier(_)
        | ASTNode::StructuredRef(_) => true,
        ASTNode::ExternalNameRef { workbook, .. } => workbook.is_current_workbook(),
        ASTNode::SheetRef { inner, .. } | ASTNode::UnresolvedSheetRef { inner, .. } => {
            indirect_reference_syntax(inner)
        }
        _ => false,
    }
}

/// Convert only R1C1 reference syntax to the canonical A1 parser's input.
/// Absolute, relative and omitted axes can be combined; whole rows/columns
/// require a range. Sheet names retain their quoting and escaped apostrophes.
fn r1c1_to_a1(text: &str, position: Option<(u32, u32)>) -> Option<String> {
    let (prefix, address) = text.rsplit_once('!').map_or(("", text), |(_, address)| {
        let prefix_len = text.len() - address.len();
        (text.get(..prefix_len).unwrap(), address)
    });
    let address = address.to_ascii_uppercase();
    let endpoints: Vec<&str> = address.split(':').collect();
    if endpoints.len() > 2 {
        return None;
    }
    let mut converted = Vec::new();
    let mut range_kind = None;
    for endpoint in &endpoints {
        let (kind, value) = if let Some(row_axis) = endpoint.strip_prefix('R') {
            if let Some((row_axis, col_axis)) = row_axis.split_once('C') {
                let row = r1c1_axis(row_axis, position.map(|p| p.0), 1_048_576)?;
                let col = r1c1_axis(col_axis, position.map(|p| p.1), 16_384)?;
                (0, format!("${}${}", col_to_letter(col), row + 1))
            } else {
                let row = r1c1_axis(row_axis, position.map(|p| p.0), 1_048_576)?;
                (1, format!("${}", row + 1))
            }
        } else if let Some(col_axis) = endpoint.strip_prefix('C') {
            let col = r1c1_axis(col_axis, position.map(|p| p.1), 16_384)?;
            (2, format!("${}", col_to_letter(col)))
        } else {
            return None;
        };
        if range_kind.is_some_and(|previous| previous != kind)
            || (kind != 0 && endpoints.len() != 2)
        {
            return None;
        }
        range_kind = Some(kind);
        converted.push(value);
    }
    Some(format!("{prefix}{}", converted.join(":")))
}

fn r1c1_axis(axis: &str, current: Option<u32>, limit: u32) -> Option<u32> {
    let index = if axis.is_empty() {
        i64::from(current?)
    } else if let Some(relative) = axis.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        i64::from(current?).checked_add(relative.parse::<i64>().ok()?)?
    } else if axis.bytes().all(|byte| byte.is_ascii_digit()) {
        axis.parse::<i64>().ok()?.checked_sub(1)?
    } else {
        return None;
    };
    (index >= 0 && index < i64::from(limit)).then_some(index as u32)
}
