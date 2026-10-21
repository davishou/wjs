@echo off
rem Double-click to run. Uses Excel to merge JMSSAL / JMSSBK into the master workbook.
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0update-master.ps1"
pause
