@echo off
cd /d "%~dp0"
echo Activating virtual environment...
call Set-Content -NoNewline "start.bat"
echo Starting Expense Manager...
python app.py
pause
