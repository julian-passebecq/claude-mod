# Lane report: mod-one-count, the mod prints the page's decisions (2026-11-12, fourth review pass)

Goal: at the same minute the Cockpit mod and the page (http://127.0.0.1:24365) show the same Needs you now count and the
same top rows, each with the page's recommended answer button, plus « more »; organization label on each row; a
critical strip on top when the page data has one; This laptop lists only this machine's items; one deploy command.
Files: `mods/cockpit` only (and this report).

## What changed (manifest 0.8.3)
1. **Needs you now = `data.glance.decisions`** (claude-control `herd/cockpit/glance.py decisions()`): the count is
   `counts.now` (« 11 decisions need you now (at 22:14) », the page's sentence), « 101 more wait on you without blocking
   work » is `counts.waiting`, the rows are `decisions.top` in its order. A workspace: the `decisions.rows` of that
   organization; a confidential one (left out of decisions) keeps the inbox path. `/fleet`'s last line says « numbers:
   the page's own (data.glance.decisions of HH:MM) ».
2. **A button on every row** (the « Gmail app password » to-do had none: the mod's `answerButtons` required
   `answerable`, which to-dos and plan items never are). `decisionButtons` = the page's `logic.js answerButtons`:
   `answer: decide` rows carry the hub's yes / no / later with one recommended, register rows their options with
   « rec » first when the advice is no option; a `recommended` that is an option KEY (shared contract) marks it when
   `rec_key` is absent. One click sends the page's own text with its click line: « Answer I90: a » or « Cockpit:
   decide todo:x: yes » (`decisionText`). « more » opens the page at that row (`#r-<uidKey(uid)>`, the page's own
   element id, checked present for the five live rows). `option_notes` are kept on the buttons; `why` shows dimmed.
3. **Organization label** in each row's sub-line under All (« Security · Fleet and tooling · urgent · covers I4, I2 and
   3 to-dos · I90 »), the page's order: application · organization · urgency · covers · codes · id.
4. **Critical strip** above both blocks: `glance.critical` (list or `{rows}`) when the other lane publishes it, else
   `glance.problems` of severity critical; a row on the strip is not repeated under Problems now. None in live data now.
5. **This laptop**: only this machine's list (`data.todo[<me>]`), and never an item whose `deliver_to` names another
   machine. A tile reason « CPU 90 C » no longer gets a third copy from the pane's own temperature warning.
6. **One deploy command**: `bash mods/cockpit/scripts/deploy-fleet.sh` (Git Bash on the MSI) after each merge: MSI main
   checkout fast-forward, a tarball of origin/main's `mods/cockpit` on the hub (sha256 checked both ends), one herdq job
   per machine (`scripts/deploy/imac.ps1` fast-forwards its checkout; `msiold.ps1` and `mbp.sh` copy into
   `~/.claude/mods/cockpit` after checking the sha256, old copy kept in `~/.claude/mods-backup`), waits and prints
   version, validate and `/fleet` per machine.

## How verified (MSI, 12 Nov, times UTC)
- `node --test --test-concurrency=1 --test-reporter=dot` on each of the 11 `tests/*.test.mjs`, one at a time: all exit 0.
  `hub.test.mjs` 24 cases (5 new on the `DATA4` fixture: decisions counts and rows, buttons and texts, pane at 50
  columns, critical strip, This laptop).
- `claude plugin test mods/cockpit`: 34 pass, 0 fail. `claude plugin validate mods/cockpit`: « Validation passed ».
  `node tools/validate_mods.mjs`: exit 0.
- Live, 21:15Z: `node mods/cockpit/scripts/preview.mjs --hub-live --cols 50` and `CLAUDE_CODE_PLUGIN_DIRS=<worktree>/mods/cockpit
  claude -p "/fleet"` (exit 0, answered by the worktree's cockpit) both print « 11 decisions need you now (at 22:14) »,
  the rows I90, msi-veille-smtp, I72, I82, I87 with buttons « a) 30 minutes with an agent draft », « I will do it »,
  « Plan is alive in practice … », « a) yes », « a) accept with Fable lead at low », each « [more] », then « 101 more
  wait on you without blocking work ». The page at 21:15:30Z (browser pane, All): « 11 decisions need you now (at
  22:14) », « 101 more wait on you without blocking work », the same five rows in the same order with the same
  RECOMMENDED buttons.

## Problems hit
- This tool's Bash heredocs turn `\\n` into a newline inside a quoted heredoc: test lines were fixed with Edit.

## Remaining
- The page itself still counts with its own `youList` (equal to `decisions.counts` today); when the page moves to
  `glance.decisions` nothing changes here. One patch if they ever differ: none needed in the mod.
- Critical strip: drawn from fixtures only until the hub publishes a critical row (another lane).
- `option_notes` are carried on the buttons but only `why` is drawn (narrow pane; « more » shows all notes on the page).
