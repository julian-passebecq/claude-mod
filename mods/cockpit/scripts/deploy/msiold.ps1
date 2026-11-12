$ErrorActionPreference = "Continue"
# old MSI: no claude-mod checkout; the merged mods/cockpit comes as a tarball from the hub, checked by its sha256,
# into ~/.claude/mods/cockpit (the folder CLAUDE_CODE_PLUGIN_DIRS already names); the old copy is kept in mods-backup
$cfg = Get-Content (Join-Path $env:USERPROFILE ".herd\worker\config.json") -Raw | ConvertFrom-Json
$alias = $cfg.ssh_alias
"alias_set=" + [bool]$alias
$st = Join-Path $env:TEMP "cockpit-deploy-@SHA@"
if (Test-Path $st) { Remove-Item -Recurse -Force $st }
New-Item -ItemType Directory -Force $st | Out-Null
$tar = Join-Path $st "cockpit.tar"
cmd /c "ssh -o BatchMode=yes $alias cat @TAR@ > `"$tar`""
$sum = (Get-FileHash $tar -Algorithm SHA256).Hash.ToLower()
"sha256=" + $sum
if ($sum -ne "@SUM@") { "BLOCKED sha256 differs from @SUM@"; exit 3 }
tar -xf $tar -C $st
"extract_exit=" + $LASTEXITCODE
$dest = Join-Path $env:USERPROFILE ".claude\mods\cockpit"
if (Test-Path $dest) { $bak = Join-Path $env:USERPROFILE (".claude\mods-backup\cockpit-" + (Get-Date -Format "yyyyMMddTHHmmss")); New-Item -ItemType Directory -Force (Split-Path $bak) | Out-Null; Move-Item $dest $bak; "old_cockpit_kept=" + $bak }
Copy-Item -Recurse (Join-Path $st "mods\cockpit") $dest
"cockpit_version=" + (Get-Content (Join-Path $dest ".claude-plugin\plugin.json") -Raw | ConvertFrom-Json).version + " sha=@SHA@"
Remove-Item -Recurse -Force $st
$cl = (Get-Command claude -ErrorAction SilentlyContinue).Source
if ($cl) {
  & $cl plugin validate $dest 2>&1 | Select-String -Pattern "Validation (passed|failed)" | ForEach-Object { "validate=" + $_.Line.Trim() }
  $env:MSYS_NO_PATHCONV = "1"
  $out = & $cl -p "/fleet" 2>&1 | Select-Object -First 3
  "fleet_exit=" + $LASTEXITCODE
  $out | ForEach-Object { "fleet> " + $_ }
} else { "claude=missing" }
