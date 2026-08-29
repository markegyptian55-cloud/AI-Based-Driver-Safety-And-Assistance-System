@echo off
cd /d "%~dp0"

rem 1. Check if current active Python (e.g. conda AI-3.11) has streamlit installed
python -c "import streamlit" >nul 2>&1
if not errorlevel 1 (
    python -m streamlit run app.py
    goto :eof
)

rem 2. Check if local venv has streamlit installed
if exist "env\venv\Scripts\activate.bat" (
    call env\venv\Scripts\activate.bat
    python -c "import streamlit" >nul 2>&1
    if not errorlevel 1 (
        python -m streamlit run app.py
        goto :eof
    )
)

rem 3. Check if standard Conda AI-3.11 environment exists
if exist "%USERPROFILE%\miniconda3\envs\AI-3.11\python.exe" (
    "%USERPROFILE%\miniconda3\envs\AI-3.11\python.exe" -m streamlit run app.py
    goto :eof
)

if exist "C:\Users\student\miniconda3\envs\AI-3.11\python.exe" (
    "C:\Users\student\miniconda3\envs\AI-3.11\python.exe" -m streamlit run app.py
    goto :eof
)

echo [ERROR] No Python environment with Streamlit found.
echo Please run:  env\setup.bat
pause
exit /b 1

