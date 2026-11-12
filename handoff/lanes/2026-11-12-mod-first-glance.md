# Lane report: mod-first-glance, one story once and readable decisions at 50 columns (2026-11-12, fifth review)

Goal: the fifth independent review of the Cockpit mod at 50 columns. MAJOR 1: the same story twice (« Restrict the 4
laptop ssh keys », « Gmail app password », « Accept or reject V5.11 » under This laptop and again as decisions).
MAJOR 2: decision rows cut to one line, why cut, recommended option alone. MINOR: the critical strip says what is
stopped, where, the action, a severity word. Files: `mods/cockpit` only (and this report). Manifest 0.8.4.

## What changed
1. **One story once**: a to-do here whose uid is a decision row of the view, or one a decision row covers
   (`glance.decisions.rows[].uid` / `covers`, read as published, nothing recomputed), is dropped from This laptop and
   from « urgent to-dos on other machines ». This laptop says « 2 more are decisions below », or « All 10 steps here are
   decisions below » (live MSI today: all 10 are covered by I90, I87, I47 and the others). `/fleet` says the same.
2. **Decision rows**: title wrapped on `title_lines` (now 2) lines with a word-wrapping clip (`clipLines`), one dimmed
   line « organization: why » (the organization label under All), the recommended answer button and « more » (the page
   at that row), and « → what it does » in `effect_words` (7) words: the first clause of the option's note. The live
   rows carry `notes` (not `option_notes`): `decisionButtons` now reads either. Five rows (`global_max`), then one row
   of links: « show all N », « N more wait on you without blocking work », « N decided for you » (new, from
   `decisions.decided_for_you`).
3. **Critical strip**: « ! critical · <text> » (the row's own severity word when it has another), two lines at most,
   then the action and where (organization, the default organization when the row has none). A row whose story is a
   decision (its `uid`, or the to-do the hub files for its alert `key`: « in:provision:login-mbp-glab » ->
   « todo:alert-in-provision-login-mbp-glab », the same rule that gives « todo:alert-issue-i90 ») carries that
   decision's recommended answer and « more », and the decision is not repeated under Needs you now. Other rows:
   « Open <module> » from the row's `link`.
4. **Shorter pane**: views + refresh + age on top (no blank line), workspace folded to « All · N more › » (unfolds the
   organizations), the tile's reasons joined on two lines, fleet sentence one line, quota two, « Open in Cockpit ·
   modules › » on one line (unfolds the module buttons). Live, 50 columns, five decisions: 64 lines for the whole pane
   (was 90 with three to-dos and eight decisions); the fifth decision ends on line 47. The 45-line aim is met down to
   the decisions, not for the whole pane: Problems now, alerts and Send follow (17 lines).

## How verified (MSI, 12 Nov, about 21:45Z)
- `node --test --test-concurrency=1 --test-reporter=dot` on each of the 11 `tests/*.test.mjs`, one at a time: all exit
  0. `hub.test.mjs` 28 cases (4 new: one story once, decision rows at 50 columns, critical strip with a decision,
  `fewWords` / `clipLines`).
- `claude plugin test mods/cockpit`: 34 pass, 0 fail (the dispatcher test unfolds « modules › » before pressing
  « Fleet »). `claude plugin validate mods/cockpit`: « Validation passed ». `node tools/validate_mods.mjs`: exit 0.
- Live: `node mods/cockpit/scripts/preview.mjs --hub-live --cols 50` (read-only, the page's data.json of 22:46 Paris):
  This laptop ends « All 10 steps here are decisions below »; Needs you now « 7 decisions need you now », rows I90, I82,
  I87, I47, I68, each with its button, « [more] » and « → Turns on GitLab two-factor », « → The autonomy work running
  tonight finishes », … ; then « [show all 7] [5 more wait on you without blocking work] [50 decided for you] ».
  No critical row in live data at that minute (the mbp GitLab login alert had cleared); the strip is proven on fixtures.

## Problems hit
- This tool's Bash rejects some quoted heredocs (a backtick-heavy Python edit script): edits went through script files.
- The text renderer used by `preview.mjs` ignores `truncate-end`, so the dump wraps lines the engine would cut; the
  clips that matter (titles, why, reasons, quota) are applied in the model text itself so both agree.

## Remaining
- Whole pane at 50 columns is 64 lines, not 45: one patch could fold Problems now and the alerts line into one row of
  links when Needs you now has five rows (needs a product call on whether Problems now may hide behind a link).
- The critical-to-decision match relies on the hub's alert to-do naming (`todo:alert-<key slug>`); if the hub publishes
  `critical[].uid` or `decision` directly, prefer it (already read first).

## Follow-up (0.8.5, second PR of the lane)
At 21:50Z the hub published a live critical row (`kind: machine`, `link: #tile-msi`, `machine: msi`): the strip said
« [more] Fleet and tooling ». Now « where » is the machine (« MSI (JULP) »), the action is « [Open Fleet] » (a
`#tile-<id>` link is a Fleet tile), and This laptop shows « ! critical: see the strip above » instead of repeating the
same reasons (the other reasons stay). Test added (hub 29 cases).

## Installed
- 0.8.4 (#90, cf75ed7), 21:50Z: `bash mods/cockpit/scripts/deploy-fleet.sh`: msi main checkout at cf75ed7; hub tarball
  sha256 2170cd0d…; imac job 561 (b235088 -> cf75ed7), msiold job 562, mbp job 563: cockpit 0.8.4, validate passed,
  /fleet answered (its first line already the live critical strip).
- 0.8.5: see the second PR's description.
