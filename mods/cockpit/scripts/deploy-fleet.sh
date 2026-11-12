#!/usr/bin/env bash
# One command after each merge of mods/cockpit (register I145: the copies on the other machines do not follow main by
# themselves). Run on the MSI from any checkout of claude-mod, in Git Bash:
#
#   bash mods/cockpit/scripts/deploy-fleet.sh            # msi main checkout + imac, msiold, mbp
#   bash mods/cockpit/scripts/deploy-fleet.sh imac mbp   # only these machines
#
# What it does, each step printed:
#   1. msi: the main checkout D:/PROJ/claude-mod fast-forwards to origin/main (only when it is on main; never resets).
#   2. a tarball of origin/main's mods/cockpit goes to the hub (~/tmp/cockpit-deploy/cockpit-<sha>.tar), sha256 checked
#      on both ends.
#   3. one herdq job per machine (scripts/deploy/<machine>.ps1|.sh), sent through `herdq submit job msi` (the narrow
#      path a laptop's Cockpit uses; `herdq add` is refused over plain ssh by design and is not worked around):
#      imac fast-forwards its claude-mod checkout; msiold
#      and mbp copy the tarball into ~/.claude/mods/cockpit (old copy kept in ~/.claude/mods-backup), after checking
#      its sha256; each validates the mod and answers /fleet.
#   4. waits for the jobs and prints their output. Exit 0 only when every job ended done.
# Needs: ssh alias oracle-herd, herdq on the hub. Writes nothing but the hub tarball and the machines' mod folders.
set -u
HUB="${HUB:-oracle-herd}"
HERDQ="/usr/bin/python3 herdq/q.py"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
MAIN="${MAIN_CHECKOUT:-D:/PROJ/claude-mod}"
MACHINES=("$@")
[ ${#MACHINES[@]} -gt 0 ] || MACHINES=(imac msiold mbp)

git -C "$REPO" fetch -q origin || { echo "BLOCKED fetch failed"; exit 2; }
SHA="$(git -C "$REPO" rev-parse --short origin/main)"
echo "origin/main=$SHA"

# 1. this MSI's main checkout (the copy CLAUDE_CODE_PLUGIN_DIRS names here)
if [ -d "$MAIN/.git" ] && [ "$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)" = "main" ]; then
  git -C "$MAIN" merge --ff-only -q origin/main && echo "msi: main checkout at $(git -C "$MAIN" rev-parse --short HEAD)" || echo "msi: fast-forward refused (local commits?)"
else echo "msi: main checkout not on main, left alone"; fi

# 2. the tarball on the hub
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK:?}"' EXIT
git -C "$REPO" archive --format=tar -o "$WORK/cockpit.tar" origin/main mods/cockpit || { echo "BLOCKED archive failed"; exit 2; }
SUM="$(sha256sum "$WORK/cockpit.tar" | cut -d' ' -f1)"
TAR="tmp/cockpit-deploy/cockpit-$SHA.tar"
ssh -o BatchMode=yes "$HUB" "mkdir -p tmp/cockpit-deploy && cat > $TAR" < "$WORK/cockpit.tar" || { echo "BLOCKED upload failed"; exit 2; }
HUBSUM="$(ssh -o BatchMode=yes "$HUB" "sha256sum $TAR" | cut -d' ' -f1)"
[ "$SUM" = "$HUBSUM" ] || { echo "BLOCKED sha256 on the hub $HUBSUM differs from $SUM"; exit 2; }
echo "hub: $TAR sha256=$SUM"

# 3. one queue job per machine
declare -A JOB
RCQ=0
for M in "${MACHINES[@]}"; do
  if [ -f "$HERE/deploy/$M.ps1" ]; then KIND=ps; SRC="$HERE/deploy/$M.ps1"
  elif [ -f "$HERE/deploy/$M.sh" ]; then KIND=sh; SRC="$HERE/deploy/$M.sh"
  else echo "$M: no deploy/$M.ps1 or .sh, skipped"; continue; fi
  sed -e "s|@SHA@|$SHA|g" -e "s|@SUM@|$SUM|g" -e "s|@TAR@|$TAR|g" "$SRC" | tr -d '\r' > "$WORK/$M.job"
  # one JSON object {machine, kind, text}: what the Cockpit's Send posts
  python -c 'import json,sys; print(json.dumps({"machine": sys.argv[1], "kind": sys.argv[2], "text": open(sys.argv[3], encoding="utf-8").read()}))' "$M" "$KIND" "$WORK/$M.job" > "$WORK/$M.json"
  ANS="$(ssh -o BatchMode=yes "$HUB" "$HERDQ submit job ${SENDER:-msi} --stdin" < "$WORK/$M.json" 2>&1)"
  ID="$(printf '%s' "$ANS" | python -c 'import json,sys
try: print(json.load(sys.stdin).get("id") or "")
except Exception: print("")')"
  [ -n "$ID" ] && JOB[$M]="$ID" && echo "$M: queued job $ID" || { echo "$M: could not queue: $ANS"; RCQ=1; }
done

# 4. results
RC=${RCQ:-0}
for M in "${!JOB[@]}"; do
  ID="${JOB[$M]}"
  ssh -o BatchMode=yes "$HUB" "$HERDQ wait $ID --max 600" >/dev/null 2>&1
  OUT="$(ssh -o BatchMode=yes "$HUB" "$HERDQ show $ID")"
  STATE="$(printf '%s\n' "$OUT" | sed -n 's/^id: [0-9]*  state: \([a-z]*\).*/\1/p')"
  echo "== $M job $ID: $STATE"
  printf '%s\n' "$OUT" | sed -n '/^--- stdout ---$/,$p' | sed '1d' | head -20
  [ "$STATE" = "done" ] || RC=1
done
exit $RC
