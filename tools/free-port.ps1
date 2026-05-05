# 释放本机指定 TCP 端口的占用（仅 State=Listen 的连接）
# -Mode node : 只结束 node.exe
# -Mode all  : 结束该端口上所有监听进程（谨慎）
param(
  [int]$Port,
  [ValidateSet("node", "all")]
  [string]$Mode = "node"
)
$ErrorActionPreference = "SilentlyContinue"
$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq $Port -and $_.AddressFamily -in @("InterNetwork", "InterNetworkV6") }
if (-not $conns) { exit 0 }
$owning = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($owningPid in $owning) {
  try {
    $proc = Get-Process -Id $owningPid -ErrorAction Stop
    if ($Mode -eq "node" -and $proc.ProcessName -ne "node") { continue }
    Stop-Process -Id $owningPid -Force -ErrorAction Stop
  } catch { }
}
exit 0
