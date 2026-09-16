@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1
title Bit Trading Desk - Local Web

echo.
echo === Bit 交易决策平台 - 本地网页 ===
echo   本地页面自动刷新；行情、报告和数据库仍连接云端 Worker。
echo   本启动器不会部署，也不会恢复已暂停的云端服务。
echo   默认地址 http://localhost:5173/index.html，实际端口以 Vite 输出为准。
echo.

where node.exe >nul 2>&1
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node
if not exist "package.json" goto missing_project
if not exist "vite.config.mjs" goto missing_project
if not exist "node_modules\vite\package.json" goto install_dependencies
if not exist "node_modules\vite-plugin-full-reload\package.json" goto install_dependencies
goto start_web

:install_dependencies
echo 首次运行或依赖缺失，正在安装开发依赖...
call npm.cmd ci --include=dev
if errorlevel 1 goto install_failed

:start_web
echo 启动网页并打开浏览器。按 Ctrl+C 或关闭窗口停止。
call npm.cmd run dev:local
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%

:missing_node
echo [错误] 未找到 Node.js 或 npm.cmd，请安装 Node.js 并加入 PATH。
pause
exit /b 1

:missing_project
echo [错误] 缺少 package.json 或 vite.config.mjs，请把启动器放在项目根目录。
pause
exit /b 1

:install_failed
echo [错误] 依赖安装失败，请检查上方网络或 npm 错误后重试。
pause
exit /b 1
