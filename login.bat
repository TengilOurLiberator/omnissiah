@echo off
rem One-time sign-in so the Omnissiah can think with your Claude account.
cd /d "%~dp0"
set "PATH=%~dp0tools\node;%PATH%"
echo.
echo  Claude Code will open. If it asks you to sign in, follow the prompts
echo  (or type /login). When you see the prompt box, type /exit to finish.
echo.
call "%~dp0node_modules\.bin\claude.cmd"
pause
