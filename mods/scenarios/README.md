# scenarios — Scénarios d'agents

**Now also inside Référence** (`mods/reference`, tab Scénarios, `/reference scenarios`): same drawing (`hooks/draw.tsx`, synced there), same scenarios. This mod and its `/scenarios` command keep working while it is loaded; once it is unloaded, `/scenarios` is answered by Référence.

`/scenarios [S1..] [prompt|agent|workflow|frontmatter|env] | close`: a read-only guide over editable presets of roles → model, effort, unit (session, sub-conversation, Workflow agent(), Agent subagent) and max parallel, each setting with the doc it rests on (« non vérifié » when the docs do not say), the documented limits, and ready-to-paste snippets with a Copy button.

- Scenarios: `scenarios.json` here, plus your own file (userConfig `file`, same shape; a same id replaces). Broken rows are left out and listed as errors.
- `agent.spawn`: a warn-only toast when an Agent or Workflow `agent()` call names no model (userConfig `warn_no_model`); the spawn always goes on unchanged.

## Claude vs GPT (`/scenarios vs [benchmark]`)

A second tab of the same pane: Anthropic and OpenAI models side by side, accuracy (benchmark score) against cost (a blended $ per million tokens, weights in `blend`, 3 input : 1 output by default). Data: `versus.json` here, or your own copy (userConfig `versus_file`).

- Every number has its **source URL and date** (`published`, or `accessed` when the page carries no date). A row without one reads **« non confirmé »** and is never drawn. Nothing is computed or fetched by the mod; `checked` says when the file was last verified.
- Vendor scores use each vendor's own harness and effort: compare inside one benchmark only. Independent measurements (Artificial Analysis) are listed as separate rows and drawn as hollow points.
- On desktop a static picture (score vs cost, log scale) sits above the list; the benchmark buttons stay buttons.

To update: read the vendors' launch and pricing pages, edit `versus.json` (a new row needs `source_url` and `source_date`), then `node mods/scenarios/scripts/regen-shipped.mjs`.

## Appliquer ce scénario

The **Appliquer Sx** button writes the scenario's per-role model and effort (and the env defaults it implies) to `~/.claude/scenarios/applied.json`, keeping the previous record as `applied.prev.json`, then shows the diff role by role: the lead against `~/.claude/settings.json` (`model`, `effortLevel`), each subagent or Workflow role against `~/.claude/agents/<agent>.md` frontmatter, the env defaults against settings `env`. Models compare by id (`opus` = `claude-opus-5-5`, a `[1m]` suffix ignored).

It **never** edits `settings.json`, an agent file or the environment: the record is a note for Julian and his agents, the diff says what to change by hand.

Code: `hooks/apply.ts` (record, frontmatter, diff; pure) and `hooks/apply_io.ts` (the two writes and the reads, through an `io` the register file builds on `$.fs`, since a hooks module may not pass `$` across an import).

## Tests

```sh
node --test mods/scenarios/tests/*.test.mjs   # includes versus.test.mjs
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test mods/scenarios
claude plugin validate mods/scenarios
```

After an edit of `scenarios.json` or `versus.json`: `node mods/scenarios/scripts/regen-shipped.mjs` (the test kit's copies), then `node scripts/sync-libs.mjs` (Référence's copy).
