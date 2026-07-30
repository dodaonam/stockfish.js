param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Root "native_host.py"

& $Python -m pip install --requirement (Join-Path $Root "requirements-build.txt")
& $Python -m PyInstaller --noconfirm --clean --onefile --name "lc0-native-host" $Source

Write-Host "Built: $(Join-Path $Root 'dist\lc0-native-host.exe')"
