"""
Code execution tool - Execute Python code in a restricted environment.
WARNING: This is still dangerous for production. Use Docker/VM isolation in real deployments.
"""

import sys
import io
import ast
from typing import Dict
from contextlib import redirect_stdout, redirect_stderr


def execute_python(code: str, timeout: int = 5) -> str:
    """
    Execute Python code in a restricted environment.
    
    Args:
        code: Python code to execute
        timeout: Execution timeout in seconds (not implemented in MVP)
    
    Returns:
        Output from code execution or error message
    """
    try:
        # Check for dangerous operations
        dangerous_patterns = [
            'import os',
            'import sys',
            'import subprocess',
            '__import__',
            'eval(',
            'exec(',
            'compile(',
            'open(',  # Use file_ops tool instead
            'input(',
            'raw_input(',
        ]
        
        code_lower = code.lower()
        for pattern in dangerous_patterns:
            if pattern in code_lower:
                return f"Error: Code contains potentially dangerous operation: '{pattern}'. This is not allowed for security reasons."
        
        # Parse the code to check syntax
        try:
            ast.parse(code)
        except SyntaxError as e:
            return f"Syntax Error: {str(e)}"
        
        # Capture stdout and stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        
        # Create a restricted global namespace
        safe_globals = {
            '__builtins__': {
                'print': print,
                'len': len,
                'range': range,
                'int': int,
                'float': float,
                'str': str,
                'list': list,
                'dict': dict,
                'set': set,
                'tuple': tuple,
                'bool': bool,
                'abs': abs,
                'min': min,
                'max': max,
                'sum': sum,
                'sorted': sorted,
                'enumerate': enumerate,
                'zip': zip,
                'map': map,
                'filter': filter,
                'all': all,
                'any': any,
                'round': round,
                'pow': pow,
            }
        }
        
        # Execute the code
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            exec(code, safe_globals)
        
        # Get output
        stdout_result = stdout_capture.getvalue()
        stderr_result = stderr_capture.getvalue()
        
        output = ""
        if stdout_result:
            output += f"Output:\n{stdout_result}"
        if stderr_result:
            output += f"\nErrors/Warnings:\n{stderr_result}"
        
        if not output:
            output = "Code executed successfully (no output)"
        
        return output
        
    except MemoryError:
        return "Error: Code consumed too much memory"
    
    except RecursionError:
        return "Error: Maximum recursion depth exceeded"
    
    except Exception as e:
        return f"Runtime Error: {type(e).__name__}: {str(e)}"


# Tool definition for Claude API
PYTHON_EXEC_TOOL: Dict = {
    "name": "execute_python",
    "description": """Execute Python code in a sandboxed environment. 
    
Available built-in functions: print, len, range, int, float, str, list, dict, set, tuple, bool, abs, min, max, sum, sorted, enumerate, zip, map, filter, all, any, round, pow.

Restrictions:
- No file I/O (use read_file/write_file tools instead)
- No imports allowed (except math operations)
- No network access
- Limited to basic Python operations

Good for: calculations, data processing, algorithms, string manipulation.""",
    "input_schema": {
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "description": "Python code to execute. Should be complete, working code."
            }
        },
        "required": ["code"]
    }
}