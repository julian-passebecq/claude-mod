$ErrorActionPreference = "Continue"
# iMac: a claude-mod checkout follows main (fast-forward only; local changes stop it, nothing is overwritten)
$r = "C:\PROJ\claude-mod"
"before=" + (git -C $r rev-parse --short HEAD)
git -C $r -c credential.interactive=never fetch -q origin 2>&1 | Select-Object -First 3
git -C $r merge --ff-only -q origin/main 2>&1 | Select-Object -First 5
"merge_exit=" + $LASTEXITCODE
"after=" + (git -C $r rev-parse --short HEAD) + " want=@SHA@"
"cockpit_version=" + (Get-Content "$r\mods\cockpit\.claude-plugin\plugin.json" -Raw | ConvertFrom-Json).version
$cl = (Get-Command claude -ErrorAction SilentlyContinue).Source
if ($cl) {
  & $cl plugin validate "$r\mods\cockpit" 2>&1 | Select-String -Pattern "Validation (passed|failed)" | ForEach-Object { "validate=" + $_.Line.Trim() }
  $env:MSYS_NO_PATHCONV = "1"
  $out = & $cl -p "/fleet" 2>&1 | Select-Object -First 3
  "fleet_exit=" + $LASTEXITCODE
  $out | ForEach-Object { "fleet> " + $_ }
} else { "claude=missing" }
