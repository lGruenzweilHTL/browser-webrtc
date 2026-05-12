#!/bin/bash
# Syntax validation script - checks Python and JavaScript before committing

echo "=== Checking Python syntax ==="
python -m py_compile main.py || exit 1
echo "✓ Python syntax OK"

echo ""
echo "=== Checking JavaScript syntax ==="
if command -v node &> /dev/null; then
    node -c static/app.js || exit 1
    echo "✓ JavaScript syntax OK"
else
    echo "⚠ Node.js not found, skipping JS syntax check"
fi

echo ""
echo "=== Checking for Python docstrings in JS files ==="
if grep -r '"""' static/*.js &> /dev/null; then
    echo "✗ FAILED: Found triple-quoted strings in JS files (Python syntax)"
    grep -n '"""' static/*.js
    exit 1
fi
echo "✓ No Python docstrings found in JS"

echo ""
echo "✅ All syntax checks passed!"
