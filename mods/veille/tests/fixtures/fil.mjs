// Invented session files and transcripts for the Fil tests (no real data). Written to a temp folder by fil.test.mjs:
// app/<acct>/<org>/local_<id>.json and projects/<folder>/<cli>.jsonl, as the desktop app and Claude Code lay them out.
export const MIN = 60000

// A token-like string built at run time, so this file itself holds no secret-looking text.
export const FAKE_TOKEN = 'ghp_' + 'Ab12'.repeat(6)

const user = (text, ts) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: text } })
const result = (id, ts) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
const say = (id, text, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } })
const tool = (id, name, input, ts, useId) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: useId || `tu_${id}`, name, input }] } })
const think = (id, ts) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden' }] } })

// at(n): ISO time n minutes before `now`
export function sessions(now) {
  const at = (n) => new Date(now - n * MIN).toISOString()
  const S = []
  const add = (o) => S.push({ model: 'claude-opus-5-5', effort: 'medium', isArchived: false, ...o })

  // alpha: a lead that finished with a wrap_up recap (no ask), and two sub-conversations, one of them in another repo
  add({ id: 'lead1', cli: 'c-lead1', title: 'Alpha lead', cwd: 'C:/work/alpha', last: 30, mtimeAgo: 30, pts: { status_category: 'completed' },
    lines: [
      user('Build the thing', at(60)), think('m1', at(59)),
      say('m1', 'Old answer from an earlier turn.', at(58)),
      user('Next step please', at(50)),
      tool('m2', 'Bash', { command: 'npm test' }, at(40), 'b1'), result('b1', at(39)),
      say('m3', '## Done\n\nPR merged: https://github.com/acme/alpha/pull/12\n\n| a | b |\n|---|---|\n| 1 | 2 |', at(31)),
      tool('m3', 'mcp__ccd_turn__wrap_up', { recap: 'The feature is merged and tests pass. Nothing is left.' }, at(30)),
    ] })
  add({ id: 'kid1', cli: 'c-kid1', title: 'Alpha lane: needs input', cwd: 'C:/work/beta/.claude/worktrees/lane-x', parent: 'lead1', last: 20, mtimeAgo: 20,
    pts: { status_category: 'review_ready' },
    lines: [
      user('Run lane x', at(40)),
      say('k1', 'I need one decision before going on.', at(21)),
      tool('k2', 'AskUserQuestion', { questions: [{ question: 'Needs your input: keep the old schema?', header: 'Schema' }] }, at(20), 'ask1'),
    ] })
  add({ id: 'kid2', cli: 'c-kid2', title: 'Alpha lane: merge #29', cwd: 'C:/work/alpha/.claude/worktrees/lane-y', parent: 'lead1', last: 25, mtimeAgo: 25,
    pts: { status_category: 'review_ready' },
    lines: [
      user('Merge lane y', at(45)),
      say('j1', `PR #29 is green. The deploy key ${FAKE_TOKEN} was rotated.\n\nTell me whether the #29 merge stays or I revert it.\n\nVérifié à 17:23`, at(25)),
    ] })

  // beta: a contradiction report, a live one, a blocked one, an archived one from yesterday
  add({ id: 'b1', cli: 'c-b1', title: 'Beta release', cwd: 'C:/work/beta', last: 10, mtimeAgo: 10, pts: { status_category: 'review_ready' },
    lines: [
      user('Release beta', at(30)),
      say('r1', 'Ready to merge.\n\nYour message said no merge, but the brief says merge on green. I stopped here.', at(10)),
    ] })
  add({ id: 'b2', cli: 'c-b2', title: 'Beta live work', cwd: 'C:/work/beta', last: 0, mtimeAgo: 0,
    lines: [user('Go', at(5)), say('w1', 'Working on step 2.', at(1)), tool('w2', 'Bash', { command: 'npm ci' }, at(0), 'run1')] })
  add({ id: 'b3', cli: 'c-b3', title: 'Beta blocked', cwd: 'C:/work/beta', last: 50, mtimeAgo: 50, pts: { status_category: 'blocked' },
    lines: [
      user('Fix CI', at(70)),
      tool('x1', 'mcp__ccd_turn__wrap_up', { recap: 'Old recap.', ask: 'Old question?', actions: [{ label: 'Yes' }] }, at(65)),
      user('Try again', at(60)),
      say('x2', 'CI is still red on the runner; the cause is outside this repo.', at(50)),
    ] })
  add({ id: 'b4', cli: 'c-b4', title: 'Beta yesterday', cwd: 'C:/work/beta', last: 26 * 60, mtimeAgo: 26 * 60, isArchived: true, pts: { status_category: 'completed' },
    lines: [user('Old', at(26 * 60 + 5)), say('o1', 'Finished yesterday.', at(26 * 60))] })

  // gamma: a wrap_up with an ask and buttons (attend Julian)
  add({ id: 'g1', cli: 'c-g1', title: 'Gamma plan', cwd: '/srv/gamma', last: 5, mtimeAgo: 5,
    lines: [
      user('Plan gamma', at(15)),
      say('p1', 'Here is the plan in three steps.', at(6)),
      tool('p2', 'mcp__ccd_turn__wrap_up', { recap: 'The plan is written, nothing is committed.', ask: 'Start step 1 now?', actions: JSON.stringify([{ label: 'Start', message: 'go' }, { label: 'Wait' }]) }, at(5)),
    ] })
  return S
}

export function appJson(s, now) {
  return {
    sessionId: `local_${s.id}`, cliSessionId: s.cli, cwd: s.cwd, originCwd: s.cwd, title: s.title, model: s.model, effort: s.effort,
    isArchived: s.isArchived, lastActivityAt: now - s.last * MIN, postTurnSummary: s.pts || {}, interruptedAwaitingPerson: null,
    ...(s.parent ? { spawnedFrom: { sessionId: `local_${s.parent}`, title: 'parent' } } : {}),
    prs: s.id === 'lead1' ? [{ url: 'https://github.com/acme/alpha/pull/12', state: 'MERGED', prNumber: 12, repo: 'acme/alpha' }] : [],
  }
}
