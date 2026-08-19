param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Root "native_host.py"

& $Python -m pip install --requirement (Join-Path $Root "requirements-build.txt")
Push-Location $Root
try {
    & $Python -m PyInstaller --noconfirm --clean --onefile --name "stf-native-host" "native_host.py"
}
finally {
    Pop-Location
}

Write-Host "Built: $(Join-Path $Root 'dist\stf-native-host.exe')"
