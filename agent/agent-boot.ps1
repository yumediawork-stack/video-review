# Video Review — підключення агента КОМП'ЮТЕРУ МОНТАЖЕРА (Windows)
# Викликається ОДНИМКОПІЙОВАНОЮ командою з веб-інтерфейсу (розділ «Трансляція з PC»):
#   & ([scriptblock]::Create((irm '<RAW-URL>/agent-boot.ps1'))) '<Supabase URL>' '<TOKEN>' -Watch 'D:\Resolve Exports'
# Параметри:
#   $Api   — URL Supabase (публічне значення)
#   $Token — агент-токен (показується в адмінці один раз)
#   $Watch — папка, яку стежимо (куди Resolve пише MP4)
param(
  [Parameter(Position=0)] [string]$Api = "",
  [Parameter(Position=1)] [string]$Token = "",
  [Parameter()]          [string]$Watch = ""
)
$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host ""
Write-Host "Video Review — підключення агента трансляції" -ForegroundColor Cyan

# --- Node перевірка
function Test-Node {
  try { $null = & node -v; return $LASTEXITCODE -eq 0 } catch { return $false }
}
if (-not (Test-Node)) {
  Write-Host "[x] Node.js не знайдено. Встановіть LTS з https://nodejs.org (2 хвилини) і запустіть цю команду знову." -ForegroundColor Red
  if ($Host.Name -eq 'ConsoleHost') { Read-Host "Enter — закрити"; }
  exit 1
}

# --- тека агента
$dir = Join-Path $HOME ".video-review-agent"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir

# --- лишаємо exe-файл агента з публразом streamingйого репозиторію
$rawAgent = "https://raw.githubusercontent.com/yumediawork-stack/video-review/main/agent/agent.mjs"
Write-Host "Завантаження агенту…"
Invoke-WebRequest -UseBasicParsing -Uri $rawAgent -OutFile (Join-Path $dir "agent.mjs")

if (-not $Token) {
  $Token = Read-Host "Вставте агент-токен із веб-інтерфейсу (розділ «Трансляція з PC»)"
}
if (-not $Watch) {
  $Watch = Read-Host "Шлях до папки, яку стежимо (напр. D:\Resolve Exports)"
}

# --- файл автозапуску + ярлик на робочий столі (наступні запуски — без команди)
$startPs1 = @'
cd "$env:USERPROFILE\.video-review-agent"
& node agent.mjs
Write-Host ""
Write-Host "Агент зупинено." -ForegroundColor Gray
'@
# збережений конфіг з'явіться агентом в агент.json (після першого успійного bootstrap)
Set-Content -Path (Join-Path $dir 'start.ps1') -Value $startPs1 -Encoding UTF8
try {
  $ws = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'Video Review Agent.lnk'))
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$dir\start.ps1`""
  $lnk.WorkingDirectory = $dir
  $lnk.Save()
  Write-Host "Ярлик «Video Review Agent» створено на робочому столі." -ForegroundColor Green
} catch { Write-Host "(Ярлик не створено: $($_.Exception.Message))" -ForegroundColor Gray }

Write-Host ""
Write-Host "Запуск…" -ForegroundColor Cyan
& node agent.mjs --api $Api --token $Token --watch $Watch
