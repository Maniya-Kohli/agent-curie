"""
Calculator Tool - Perform mathematical calculations
Uses Python's eval with restricted scope for safety
"""
import math
import operator


# Safe functions allowed in calculations
SAFE_FUNCTIONS = {
    'abs': abs,
    'round': round,
    'min': min,
    'max': max,
    'sum': sum,
    'pow': pow,
    # Math functions
    'sqrt': math.sqrt,
    'sin': math.sin,
    'cos': math.cos,
    'tan': math.tan,
    'log': math.log,
    'log10': math.log10,
    'exp': math.exp,
    'floor': math.floor,
    'ceil': math.ceil,
    'pi': math.pi,
    'e': math.e,
}


def calculate(expression: str) -> str:
    """
    Safely evaluate a mathematical expression
    
    Args:
        expression: Mathematical expression to evaluate
                   (e.g., "2 + 2", "sqrt(16)", "sin(pi/2)")
    
    Returns:
        Result of calculation or error message
    """
    try:
        # Remove any potentially dangerous characters
        dangerous_strings = ['__', 'import', 'exec', 'eval', 'open', 'file']
        for dangerous in dangerous_strings:
            if dangerous in expression.lower():
                return f"Error: Expression contains forbidden operation: {dangerous}"
        
        # Create a restricted namespace with only safe functions
        namespace = SAFE_FUNCTIONS.copy()
        
        # Evaluate expression in restricted namespace
        result = eval(expression, {"__builtins__": {}}, namespace)
        
        # Format result
        if isinstance(result, float):
            # Round to reasonable precision
            if result.is_integer():
                result = int(result)
            else:
                result = round(result, 10)
        
        return f"Result: {result}"
    
    except ZeroDivisionError:
        return "Error: Division by zero"
    
    except NameError as e:
        return f"Error: Unknown function or variable. Available functions: {', '.join(SAFE_FUNCTIONS.keys())}"
    
    except SyntaxError as e:
        return f"Error: Invalid expression syntax. {str(e)}"
    
    except Exception as e:
        return f"Error calculating: {str(e)}"


# Tool definition for Claude API
CALCULATOR_TOOL = {
    "name": "calculate",
    "description": (
        "Perform mathematical calculations. Supports basic arithmetic (+, -, *, /, **), "
        "and math functions like sqrt, sin, cos, tan, log, exp, etc. "
        "Available constants: pi, e. "
        "Examples: '2 + 2', '15 * 3.5', 'sqrt(144)', 'sin(pi/2)', 'log10(1000)'"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Mathematical expression to evaluate. Use Python syntax."
            }
        },
        "required": ["expression"]
    }
}