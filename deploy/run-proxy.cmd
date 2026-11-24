@echo off
rem 【冷备专用】老机器 2026-11-05 退役日常用途，仅手动应急（README「老机器=冷备份」）
cd /d E:\littleDJ
if not exist logs mkdir logs
set LITTLEDJ_ROOT=E:\littleDJ
set LITTLEDJ_BACKEND_PORT=4096
rem 老机器只做鸿蒙 PC 的透明入口（主脑在 192.0.2.10）
set LITTLEDJ_UPSTREAM=http://192.0.2.10:4097
C:\Users\Administrator\.codearts\runtimes\node\node.exe server\proxy.js >> logs\proxy2.log 2>&1
