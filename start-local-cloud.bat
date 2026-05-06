@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Bit Trading Desk - local UI + Cloudflare Worker / D1

echo.
echo === Bit 交易决策平台 - 本地页面 + 云端 Worker + 云端 D1 ===
echo   - 行情 API: https://btc.feiniwork.com  （js/config.js 默认）
echo   - 舆情 API: https://yuqing.feiniwork.com
echo   - 保存 index.html / styles.css / js 下文件后会自动刷新浏览器
echo   - Worker 单独发版: cloudflare 目录 wrangler deploy（见 AGENTS.md）
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js 并将 npm 加入 PATH。
  pause
  exit /b 1
)

if not exist "node_modules\vite\package.json" (
  echo 首次运行：正在安装 dev 依赖 ^(vite、vite-plugin-full-reload^)...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败。
    pause
    exit /b 1
  )
)

echo 启动 Vite（默认 http://localhost:5173/ ）...
echo 按 Ctrl+C 可停止服务。
echo.
call npm run dev:local
set EXITCODE=!ERRORLEVEL!
if !EXITCODE! neq 0 pause
exit /b !EXITCODE!
