# Video Review — перенесення агента та відео-папки на інший диск (напр. H:)
# Одна команда з PowerShell:
#   & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/yumediawork-stack/video-review/main/agent/relocate-agent.ps1'))) 'H:\VideoReviewAgent' 'H:\DaVinci Exports'
# Що робить:
#   - створює H:\VideoReviewAgent (агент + конфіг) та H:\DaVinci Exports (папку відео);
#   - переносить/підхоплює ваш агент-токен зі старої комплектації (C:\Users\<ви>\.video-review-agent);
#   - оновлює ярлик «Video Review Agent» на робочому столі → H:;
#   - запускає агента одразу.
param(
  [Parameter(Position=0)] [string]$BaseDir = 'H:\VideoReviewAgent',
  [Parameter(Position=1)] [string]$Watch  = 'H:\DaVinci Exports',
  [Parameter()]          [string]$Source = ''
)
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$drive = $BaseDir.Substring(0, $BaseDir.IndexOf(':') + 1)
if (-not (Test-Path $drive)) {
  Write-Host "[x] Диск $drive недоступний. Перевірте, що те він підключений." -ForegroundColor Red
  if ($Host.Name -eq 'ConsoleHost') { Read-Host "Enter — закрити" | Out-Null }
  exit 1
}

if (-not $Source) { $Source = Join-Path $HOME '.video-review-agent' }

# --- агент-токен: зі старої комплектації або вручну
$oldJson = Join-Path $Source 'agent.json'
$projectId = $null; $agentToken = $null; $apiUrl = $null; $publicKey = $null
if (Test-Path $oldJson) {
  $old = Get-Content $oldJson -Raw | ConvertFrom-Json
  $projectId  = $old.projectId
  $agentToken = $old.agentToken
  $apiUrl     = $old.apiUrl
  $publicKey  = $old.publicKey
  Write-Host "Агент-токен підхоплено з попередньої комплектації ($Source)."
}
if (-not $agentToken -or -not $apiUrl -or -not $projectId) {
  Write-Host "Стару комплектацію не знайдено — введіть дані з адмінки (розділ «Трансляція з PC» → «Активувати агент»):"
  if (-not $agentToken) { $agentToken = Read-Host "  агент-токен" }
  if (-not $apiUrl)     { $apiUrl     = Read-Host "  Supabase URL (https://....supabase.co)" }
  if (-not $projectId)  { $projectId  = Read-Host "  projectId (UUID з панелі «Трансляція з PC» — або лиште порожнім: агент сам визначить)" }
}

# --- теки
New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
New-Item -ItemType Directory -Force -Path $Watch  | Out-Null

# --- agent.mjs: спершу спробуємо з-copyвати наявний, інакше — свіже з GitHub
$dstAgent = Join-Path $BaseDir 'agent.mjs'
$copyFrom = Join-Path $Source 'agent.mjs'
if (Test-Path $copyFrom) {
  Copy-Item $copyFrom $dstAgent -Force
} else {
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/yumediawork-stack/video-review/main/agent/agent.mjs" -OutFile $dstAgent
}

# --- конфіг на новому місці
$cfg = New-Object System.Collections.Specialized.OrderedDictionary
$cfg.projectId  = $projectId
$cfg.agentToken = $agentToken
$cfg.apiUrl     = $apiUrl
$cfg.publicKey  = $publicKey
$cfg.watchDir   = $Watch
$cfg | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $BaseDir 'agent.json') -Encoding UTF8

# --- бігунок + ярлик на робочому столі
$runPs1 = @'
cd "$PSScriptRoot"
& node agent.mjs
Write-Host ""
Write-Host "Агент зупинено." -ForegroundColor Gray
'@
Set-Content -Path (Join-Path $BaseDir 'run.ps1') -Value $runPs1 -Encoding UTF8

try {
  $ws = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'Video Review Agent.lnk'))
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$BaseDir\run.ps1`""
  $lnk.WorkingDirectory = $BaseDir
  $lnk.Save()
  Write-Host "Ярлик «Video Review Agent» (H:\VideoReviewAgent) оновлено на робочому столі." -ForegroundColor Green
} catch {
  Write-Host "(Ярлик не оновлено: $($_.Exception.Message))" -ForegroundColor Gray
}

# --- необов'язково: прибрати стару комплектацію з C:
Write-Host ""
$cleanup = Read-Host "Прибрати стару комплектацію з $Source? [Enter = так / n = ні]"
if (([string]::IsNullOrWhiteSpace($cleanup)) -or ($cleanup -match '^(y|д|так)$')) {
  try { Remove-Item -Recurse -Force $Source -ErrorAction SilentlyContinue; Write-Host "Стару теку видалено." -ForegroundColor Green } catch { Write-Host "(Не вдалося видалити: $($_.Exception.Message))" -ForegroundColor Gray }
}

Write-Host ""
Write-Host "Все перенесено на $BaseDir. Запуск…" -ForegroundColor Cyan
Set-Location $BaseDir
& node agent.mjs
