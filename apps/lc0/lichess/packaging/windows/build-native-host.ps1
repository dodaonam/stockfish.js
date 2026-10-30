param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Requirements = Join-Path $PSScriptRoot "requirements-build.txt"
$Source = Join-Path $ProjectRoot "host\native_host.py"
$Dist = Join-Path $ProjectRoot "dist"
$Work = Join-Path $ProjectRoot "build\pyinstaller"
$Spec = Join-Path $ProjectRoot "build"

New-Item -ItemType Directory -Force -Path $Dist, $Work, $Spec | Out-Null

& $Python -m pip install --requirement $Requirements
if ($LASTEXITCODE -ne 0) { throw "Could not install native-host build requirements." }

& $Python -m PyInstaller --noconfirm --clean --onefile --name "lc0-native-host" `
    --distpath $Dist --workpath $Work --specpath $Spec $Source
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed to build the LC0 Native host." }

Write-Host "Built: $(Join-Path $Dist 'lc0-native-host.exe')"
