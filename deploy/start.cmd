@echo off
rem 【冷备专用】老机器 2026-11-05 退役日常用途，仅作手动应急/备份（见 README「老机器=冷备份」）；日常运行在鸿蒙 PC deploy/start-harmony.sh
rem littleDJ launcher: deveco serve(4096) + UI proxy(4097)
netstat -ano | findstr ":4096 " >nul
if %errorlevel%==0 goto proxy
wmic process call create "cmd /c C:\Users\Administrator\.config\littledj\serve.cmd" >nul
:proxy
netstat -ano | findstr ":4097 " >nul
if %errorlevel%==0 exit /b
wmic process call create "cmd /c E:\littleDJ\run-proxy.cmd" >nul
