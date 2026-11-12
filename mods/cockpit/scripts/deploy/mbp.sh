set -u
# MacBook Pro: no claude-mod checkout; the merged mods/cockpit comes as a tarball from the hub, checked by its sha256,
# into ~/.claude/mods/cockpit (the folder CLAUDE_CODE_PLUGIN_DIRS already names); the old copy is kept in mods-backup
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE=$(command -v node || true)
[ -n "$NODE" ] || { echo "BLOCKED no node"; exit 3; }
ALIAS=$("$NODE" -e 'console.log(require(process.env.HOME+"/.herd/worker/config.json").ssh_alias||"")')
echo "alias_set=$([ -n "$ALIAS" ] && echo yes || echo no)"
ST=$(mktemp -d "${TMPDIR:-/tmp}/cockpit-deploy.XXXXXX")
ssh -o BatchMode=yes "$ALIAS" cat @TAR@ > "$ST/cockpit.tar"
SUM=$(shasum -a 256 "$ST/cockpit.tar" | cut -d" " -f1)
echo "sha256=$SUM"
[ "$SUM" = "@SUM@" ] || { echo "BLOCKED sha256 differs from @SUM@"; exit 3; }
tar -xf "$ST/cockpit.tar" -C "$ST"; echo "extract_exit=$?"
D="$HOME/.claude/mods/cockpit"
if [ -e "$D" ]; then B="$HOME/.claude/mods-backup/cockpit-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$(dirname "$B")"; mv "$D" "$B"; echo "old_cockpit_kept=$B"; fi
cp -R "$ST/mods/cockpit" "$D"
echo "cockpit_version=$("$NODE" -e "console.log(require(process.argv[1]).version)" "$D/.claude-plugin/plugin.json") sha=@SHA@"
rm -rf "${ST:?}"
if command -v claude >/dev/null; then
  claude plugin validate "$D" 2>&1 | grep -E "Validation (passed|failed)" | sed "s/^/validate=/"
  T=$(mktemp); claude -p "/fleet" > "$T" 2>&1; echo "fleet_exit=$?"; head -3 "$T" | sed "s/^/fleet> /"; rm -f "$T"
else echo "claude=missing"; fi
