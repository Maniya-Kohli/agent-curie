"""
File operations tool - Read and write files in a sandboxed directory.
"""

import os
from pathlib import Path
from typing import Dict


# Sandbox directory for file operations
SANDBOX_DIR = Path("./sandbox_files")
SANDBOX_DIR.mkdir(exist_ok=True)


def _get_safe_path(filename: str) -> Path:
    """
    Get a safe path within the sandbox directory.
    
    Args:
        filename: Filename or relative path
    
    Returns:
        Absolute path within sandbox
    
    Raises:
        ValueError: If path tries to escape sandbox
    """
    # Resolve the path relative to sandbox
    safe_path = (SANDBOX_DIR / filename).resolve()
    
    # Check if it's within the sandbox
    if not str(safe_path).startswith(str(SANDBOX_DIR.resolve())):
        raise ValueError(f"Access denied: Path '{filename}' is outside sandbox directory")
    
    return safe_path


def read_file(filename: str) -> str:
    """
    Read a file from the sandbox directory.
    
    Args:
        filename: Name of the file to read
    
    Returns:
        File contents or error message
    """
    try:
        file_path = _get_safe_path(filename)
        
        if not file_path.exists():
            return f"Error: File '{filename}' does not exist in sandbox"
        
        if not file_path.is_file():
            return f"Error: '{filename}' is not a file"
        
        # Check file size (limit to 1MB)
        if file_path.stat().st_size > 1_000_000:
            return f"Error: File '{filename}' is too large (max 1MB)"
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return f"Content of '{filename}':\n\n{content}"
        
    except ValueError as e:
        return str(e)
    
    except UnicodeDecodeError:
        return f"Error: File '{filename}' is not a text file or has invalid encoding"
    
    except Exception as e:
        return f"Error reading file: {str(e)}"


def write_file(filename: str, content: str) -> str:
    """
    Write content to a file in the sandbox directory.
    
    Args:
        filename: Name of the file to write
        content: Content to write to the file
    
    Returns:
        Success or error message
    """
    try:
        file_path = _get_safe_path(filename)
        
        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Check content size (limit to 1MB)
        if len(content.encode('utf-8')) > 1_000_000:
            return "Error: Content is too large (max 1MB)"
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return f"Successfully wrote {len(content)} characters to '{filename}'"
        
    except ValueError as e:
        return str(e)
    
    except Exception as e:
        return f"Error writing file: {str(e)}"


def list_files(directory: str = ".") -> str:
    """
    List files in a directory within the sandbox.
    
    Args:
        directory: Directory to list (relative to sandbox)
    
    Returns:
        List of files and directories
    """
    try:
        dir_path = _get_safe_path(directory)
        
        if not dir_path.exists():
            return f"Error: Directory '{directory}' does not exist"
        
        if not dir_path.is_dir():
            return f"Error: '{directory}' is not a directory"
        
        items = []
        for item in sorted(dir_path.iterdir()):
            relative_path = item.relative_to(SANDBOX_DIR)
            item_type = "DIR" if item.is_dir() else "FILE"
            size = item.stat().st_size if item.is_file() else "-"
            items.append(f"{item_type:4} {size:>10} {relative_path}")
        
        if not items:
            return f"Directory '{directory}' is empty"
        
        header = f"Contents of '{directory}':\n\n"
        header += f"{'TYPE':4} {'SIZE':>10} {'NAME'}\n"
        header += "-" * 50 + "\n"
        
        return header + "\n".join(items)
        
    except ValueError as e:
        return str(e)
    
    except Exception as e:
        return f"Error listing directory: {str(e)}"


# Tool definitions for Claude API
READ_FILE_TOOL: Dict = {
    "name": "read_file",
    "description": "Read the contents of a text file from the sandbox directory. Files are isolated in a safe sandbox environment.",
    "input_schema": {
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Name or path of the file to read (e.g., 'notes.txt', 'scripts/hello.py')"
            }
        },
        "required": ["filename"]
    }
}

WRITE_FILE_TOOL: Dict = {
    "name": "write_file",
    "description": "Write content to a text file in the sandbox directory. Creates the file if it doesn't exist, overwrites if it does.",
    "input_schema": {
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "Name or path of the file to write (e.g., 'output.txt', 'code/script.py')"
            },
            "content": {
                "type": "string",
                "description": "The content to write to the file"
            }
        },
        "required": ["filename", "content"]
    }
}

LIST_FILES_TOOL: Dict = {
    "name": "list_files",
    "description": "List all files and directories in the sandbox. Shows file sizes and types.",
    "input_schema": {
        "type": "object",
        "properties": {
            "directory": {
                "type": "string",
                "description": "Directory to list (default: root of sandbox). Use '.' for root.",
                "default": "."
            }
        },
        "required": []
    }
}