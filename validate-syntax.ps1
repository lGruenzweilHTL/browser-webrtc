# Syntax validation script - checks Python and JavaScript before committing
# Run this before committing: .\validate-syntax.ps1

Write-Host "=== Checking Python syntax ===" -ForegroundColor Cyan
python -m py_compile main.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed: Python syntax error" -ForegroundColor Red
    exit 1
}
Write-Host "OK: Python syntax valid" -ForegroundColor Green

Write-Host ""
Write-Host "=== Checking JavaScript syntax ===" -ForegroundColor Cyan
if (Get-Command node -ErrorAction SilentlyContinue) {
    node -c static/app.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed: JavaScript syntax error" -ForegroundColor Red
        exit 1
    }
    Write-Host "OK: JavaScript syntax valid" -ForegroundColor Green
}
else {
    Write-Host "WARN: Node.js not found, skipping JS check" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Checking for Python docstrings in JS ===" -ForegroundColor Cyan
$docstrings = Select-String '"""' static/*.js -ErrorAction SilentlyContinue
if ($docstrings) {
    Write-Host "Failed: Found Python docstrings in JS files" -ForegroundColor Red
    $docstrings
    exit 1
}
Write-Host "OK: No Python docstrings found" -ForegroundColor Green

Write-Host ""
Write-Host "All syntax checks passed!" -ForegroundColor Green
