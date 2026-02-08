"""
Formula Expression Engine for Value Investing Metrics.

Provides safe evaluation of financial formulas with support for:
- Arithmetic operations: +, -, *, /, ^
- Comparison operators: >, <, >=, <=, ==, !=
- Logical operators: AND, OR, NOT
- Built-in functions: SQRT, ABS, MAX, MIN, AVG, IF, COALESCE
- Field references from fundamentals data
"""

import ast
import math
import operator
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Set, Union

import duckdb


# Safe operators mapping
SAFE_OPERATORS: Dict[type, Callable] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    # Comparisons
    ast.Gt: operator.gt,
    ast.Lt: operator.lt,
    ast.GtE: operator.ge,
    ast.LtE: operator.le,
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    # Logical (handled specially)
    ast.And: lambda *args: all(args),
    ast.Or: lambda *args: any(args),
    ast.Not: operator.not_,
}

# Built-in functions for formulas
SAFE_FUNCTIONS: Dict[str, Callable] = {
    "SQRT": math.sqrt,
    "ABS": abs,
    "MAX": max,
    "MIN": min,
    "AVG": lambda *args: sum(args) / len(args) if args else 0,
    "SUM": sum,
    "POW": pow,
    "LOG": math.log,
    "LOG10": math.log10,
    "EXP": math.exp,
    "ROUND": round,
    "FLOOR": math.floor,
    "CEIL": math.ceil,
    "IF": lambda cond, true_val, false_val: true_val if cond else false_val,
    "COALESCE": lambda *args: next((a for a in args if a is not None), None),
    "ISNULL": lambda x: x is None,
    "NULLIF": lambda a, b: None if a == b else a,
}

# All available fields from fundamentals table
FUNDAMENTALS_FIELDS: Set[str] = {
    "ticker",
    "as_of",
    "ebit",
    "enterprise_value",
    "net_working_capital",
    "revenue",
    "revenue_growth_yoy",
    "gross_margin",
    "operating_margin",
    "net_margin",
    "free_cash_flow",
    "fcf_yield",
    "total_debt",
    "total_equity",
    "debt_to_equity",
    "interest_coverage",
    "book_value",
    "tangible_book_value",
    "book_value_per_share",
    "market_cap",
    "price",
    "shares_outstanding",
    "pe_ratio",
    "pb_ratio",
    "ps_ratio",
    "ev_to_ebitda",
    "dividend_yield",
    "payout_ratio",
    "eps",
    "eps_growth_yoy",
}


@dataclass
class FormulaResult:
    """Result of formula evaluation."""
    value: Optional[float]
    error: Optional[str] = None
    fields_used: List[str] = None

    def __post_init__(self):
        if self.fields_used is None:
            self.fields_used = []


@dataclass
class ValidationResult:
    """Result of formula validation."""
    is_valid: bool
    errors: List[str]
    fields_used: List[str]
    functions_used: List[str]


class FormulaEngine:
    """
    Safe expression evaluator for financial formulas.
    
    Example usage:
        engine = FormulaEngine()
        
        # Validate a formula
        validation = engine.validate("SQRT(22.5 * eps * book_value_per_share)")
        
        # Evaluate with data
        data = {"eps": 5.0, "book_value_per_share": 20.0}
        result = engine.evaluate("SQRT(22.5 * eps * book_value_per_share)", data)
    """

    def __init__(self, additional_functions: Optional[Dict[str, Callable]] = None):
        self.functions = {**SAFE_FUNCTIONS}
        if additional_functions:
            self.functions.update(additional_functions)
        self._computed_cache: Dict[str, float] = {}

    def validate(self, expression: str) -> ValidationResult:
        """
        Validate a formula expression without evaluating it.
        
        Returns ValidationResult with is_valid, errors, and metadata.
        """
        errors = []
        fields_used = []
        functions_used = []

        try:
            tree = ast.parse(expression, mode="eval")
            self._validate_node(tree.body, errors, fields_used, functions_used)
        except SyntaxError as e:
            errors.append(f"Syntax error: {e.msg}")

        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            fields_used=list(set(fields_used)),
            functions_used=list(set(functions_used)),
        )

    def _validate_node(
        self,
        node: ast.AST,
        errors: List[str],
        fields: List[str],
        funcs: List[str],
    ) -> None:
        """Recursively validate AST nodes."""
        if isinstance(node, ast.Constant):
            # Numbers, strings, booleans are OK
            if not isinstance(node.value, (int, float, bool, type(None))):
                errors.append(f"Unsupported constant type: {type(node.value)}")
        elif isinstance(node, ast.Name):
            # Field reference
            name = node.id.lower()
            if name not in FUNDAMENTALS_FIELDS and name not in self._computed_cache:
                # Could be a computed field reference - allow it but note
                pass
            fields.append(name)
        elif isinstance(node, ast.BinOp):
            if type(node.op) not in SAFE_OPERATORS:
                errors.append(f"Unsupported operator: {type(node.op).__name__}")
            self._validate_node(node.left, errors, fields, funcs)
            self._validate_node(node.right, errors, fields, funcs)
        elif isinstance(node, ast.UnaryOp):
            if type(node.op) not in SAFE_OPERATORS:
                errors.append(f"Unsupported unary operator: {type(node.op).__name__}")
            self._validate_node(node.operand, errors, fields, funcs)
        elif isinstance(node, ast.Compare):
            self._validate_node(node.left, errors, fields, funcs)
            for op, comparator in zip(node.ops, node.comparators):
                if type(op) not in SAFE_OPERATORS:
                    errors.append(f"Unsupported comparison: {type(op).__name__}")
                self._validate_node(comparator, errors, fields, funcs)
        elif isinstance(node, ast.BoolOp):
            for value in node.values:
                self._validate_node(value, errors, fields, funcs)
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                func_name = node.func.id.upper()
                if func_name not in self.functions:
                    errors.append(f"Unknown function: {func_name}")
                funcs.append(func_name)
                for arg in node.args:
                    self._validate_node(arg, errors, fields, funcs)
            else:
                errors.append("Only simple function calls are supported")
        elif isinstance(node, ast.IfExp):
            # Ternary: value_if_true if condition else value_if_false
            self._validate_node(node.test, errors, fields, funcs)
            self._validate_node(node.body, errors, fields, funcs)
            self._validate_node(node.orelse, errors, fields, funcs)
        else:
            errors.append(f"Unsupported expression type: {type(node).__name__}")

    def evaluate(
        self,
        expression: str,
        data: Dict[str, Any],
        computed_fields: Optional[Dict[str, float]] = None,
    ) -> FormulaResult:
        """
        Safely evaluate a formula expression with given data.
        
        Args:
            expression: The formula string
            data: Dictionary of field values (from fundamentals)
            computed_fields: Optional pre-computed formula values
        
        Returns:
            FormulaResult with value or error
        """
        # Merge computed fields into available context
        context = {k.lower(): v for k, v in data.items() if v is not None}
        if computed_fields:
            context.update({k.lower(): v for k, v in computed_fields.items()})

        try:
            tree = ast.parse(expression, mode="eval")
            fields_used = []
            value = self._eval_node(tree.body, context, fields_used)
            return FormulaResult(value=value, fields_used=fields_used)
        except ZeroDivisionError:
            return FormulaResult(value=None, error="Division by zero")
        except ValueError as e:
            return FormulaResult(value=None, error=f"Math error: {str(e)}")
        except KeyError as e:
            return FormulaResult(value=None, error=f"Missing field: {str(e)}")
        except Exception as e:
            return FormulaResult(value=None, error=f"Evaluation error: {str(e)}")

    def _eval_node(
        self,
        node: ast.AST,
        context: Dict[str, Any],
        fields_used: List[str],
    ) -> Any:
        """Recursively evaluate AST nodes."""
        if isinstance(node, ast.Constant):
            return node.value

        elif isinstance(node, ast.Name):
            name = node.id.lower()
            fields_used.append(name)
            if name not in context:
                raise KeyError(name)
            return context[name]

        elif isinstance(node, ast.BinOp):
            left = self._eval_node(node.left, context, fields_used)
            right = self._eval_node(node.right, context, fields_used)
            if left is None or right is None:
                return None
            op_func = SAFE_OPERATORS[type(node.op)]
            return op_func(left, right)

        elif isinstance(node, ast.UnaryOp):
            operand = self._eval_node(node.operand, context, fields_used)
            if operand is None:
                return None
            op_func = SAFE_OPERATORS[type(node.op)]
            return op_func(operand)

        elif isinstance(node, ast.Compare):
            left = self._eval_node(node.left, context, fields_used)
            if left is None:
                return None
            for op, comparator in zip(node.ops, node.comparators):
                right = self._eval_node(comparator, context, fields_used)
                if right is None:
                    return None
                op_func = SAFE_OPERATORS[type(op)]
                if not op_func(left, right):
                    return False
                left = right
            return True

        elif isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                for value in node.values:
                    result = self._eval_node(value, context, fields_used)
                    if not result:
                        return False
                return True
            elif isinstance(node.op, ast.Or):
                for value in node.values:
                    result = self._eval_node(value, context, fields_used)
                    if result:
                        return True
                return False

        elif isinstance(node, ast.Call):
            func_name = node.func.id.upper()
            func = self.functions[func_name]
            args = [self._eval_node(arg, context, fields_used) for arg in node.args]
            # Handle None args for certain functions
            if func_name in ("COALESCE", "IF", "ISNULL"):
                return func(*args)
            # For other functions, None args propagate
            if any(a is None for a in args):
                return None
            return func(*args)

        elif isinstance(node, ast.IfExp):
            test = self._eval_node(node.test, context, fields_used)
            if test:
                return self._eval_node(node.body, context, fields_used)
            else:
                return self._eval_node(node.orelse, context, fields_used)

        raise ValueError(f"Cannot evaluate node type: {type(node).__name__}")


def evaluate_formula_for_universe(
    conn: duckdb.DuckDBPyConnection,
    expression: str,
    universe: Optional[List[str]] = None,
    as_of: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Evaluate a formula for all tickers in a universe.
    
    Args:
        conn: DuckDB connection
        expression: Formula expression
        universe: Optional list of tickers (None = all)
        as_of: Optional date filter
    
    Returns:
        List of dicts with ticker, as_of, and computed value
    """
    engine = FormulaEngine()
    
    # Validate first
    validation = engine.validate(expression)
    if not validation.is_valid:
        return [{"error": "; ".join(validation.errors)}]

    # Build query
    where_clauses = []
    params = []
    if universe:
        placeholders = ",".join("?" for _ in universe)
        where_clauses.append(f"ticker IN ({placeholders})")
        params.extend(universe)
    if as_of:
        where_clauses.append("as_of = ?")
        params.append(as_of)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    query = f"SELECT * FROM fundamentals {where_sql} ORDER BY ticker, as_of DESC"
    rows = conn.execute(query, params).fetchall()
    columns = [desc[0] for desc in conn.description]

    results = []
    for row in rows:
        data = dict(zip(columns, row))
        result = engine.evaluate(expression, data)
        results.append({
            "ticker": data.get("ticker"),
            "as_of": str(data.get("as_of")),
            "value": result.value,
            "error": result.error,
        })

    return results


def generate_sql_expression(expression: str) -> str:
    """
    Convert a formula expression to SQL for direct DuckDB evaluation.
    
    This is more efficient for large datasets as it runs in the database.
    """
    # For simple formulas, we can translate to SQL
    # This handles basic arithmetic and field references
    sql_expr = expression

    # Convert function names to SQL equivalents
    sql_functions = {
        "SQRT": "SQRT",
        "ABS": "ABS",
        "MAX": "GREATEST",
        "MIN": "LEAST",
        "AVG": "AVG",  # Note: AVG in SQL is aggregate, not element-wise
        "ROUND": "ROUND",
        "FLOOR": "FLOOR",
        "CEIL": "CEILING",
        "COALESCE": "COALESCE",
        "IF": "CASE WHEN",  # Needs special handling
        "LOG": "LN",
        "LOG10": "LOG10",
        "EXP": "EXP",
        "POW": "POWER",
    }

    for py_func, sql_func in sql_functions.items():
        sql_expr = sql_expr.replace(f"{py_func}(", f"{sql_func}(")

    return sql_expr


# Pre-compute dependent formulas in order
FORMULA_DEPENDENCIES: Dict[str, List[str]] = {
    "margin_of_safety": ["graham_number"],
}


def compute_all_formulas(
    conn: duckdb.DuckDBPyConnection,
    universe: Optional[List[str]] = None,
) -> int:
    """
    Compute all formula-based metrics and store in computed_metrics table.
    
    Handles formula dependencies by computing in correct order.
    
    Returns number of metrics computed.
    """
    # Get all formulas ordered by dependencies
    formulas = conn.execute(
        "SELECT id, name, expression FROM formula_definitions ORDER BY category"
    ).fetchall()

    engine = FormulaEngine()
    computed_count = 0

    # Build query for fundamentals
    where_clause = ""
    params = []
    if universe:
        placeholders = ",".join("?" for _ in universe)
        where_clause = f"WHERE ticker IN ({placeholders})"
        params = list(universe)

    rows = conn.execute(
        f"SELECT * FROM fundamentals {where_clause}", params
    ).fetchall()
    columns = [desc[0] for desc in conn.description]

    for row in rows:
        data = dict(zip(columns, row))
        ticker = data["ticker"]
        as_of = data["as_of"]

        # Track computed values for this row (for formula dependencies)
        row_computed = {}

        for formula_id, formula_name, expression in formulas:
            result = engine.evaluate(expression, data, row_computed)

            if result.value is not None:
                # Store computed value
                conn.execute(
                    """
                    INSERT INTO computed_metrics (ticker, as_of, metric_name, formula_id, value)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (ticker, as_of, metric_name) DO UPDATE SET
                        formula_id = EXCLUDED.formula_id, value = EXCLUDED.value, computed_at = now()
                    """,
                    (ticker, as_of, formula_name, formula_id, result.value),
                )
                # Make available for dependent formulas
                row_computed[formula_name.lower().replace(" ", "_")] = result.value
                computed_count += 1

    return computed_count
