# PowerShell runner for Drowsiness Detection Platform
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Test current active python
$hasStreamlit = & python -c "import streamlit; print('OK')" 2>$null
if ($hasStreamlit -match "OK") {
    python -m streamlit run app.py
    exit 0
}

# 2. Test Conda AI-3.11
$condaPy = "C:\Users\student\miniconda3\envs\AI-3.11\python.exe"
if (Test-Path $condaPy) {
    & $condaPy -m streamlit run app.py
    exit 0
}

# 3. Test local venv
$venvPy = Join-Path $scriptDir "env\venv\Scripts\python.exe"
if (Test-Path $venvPy) {
    & $venvPy -m streamlit run app.py
    exit 0
}

Write-Error "No working Python environment with Streamlit found. Run env\setup.bat first."
