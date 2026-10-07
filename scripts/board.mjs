#!/usr/bin/env node
// The project board, built from docs/project/tasks/<phase>/tui-<n>-<slug>.md.
//
//   pnpm board                 open tasks by phase, with live branch/PR state from git and gh
//   pnpm board --all           include done and deferred tasks
//   pnpm board --phase P2      one phase (repeatable); --module billing, --status todo likewise
//   pnpm board --json          every task as JSON (for scripts and skills)
//   pnpm board --check         validate the task files; exits 1 on problems
//   pnpm board --offline       skip the git/gh lookups
//
// The files hold the durable state (status, branch, PR). "In progress" and "in review" come from
// local branches and open PRs, so a task's status in its file only changes in its own PR.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TASKS_DIR = join(ROOT, 'docs/project/tasks');

export const STATUSES = ['todo', 'in-progress', 'blocked', 'done', 'deferred'];
export const PHASES = {
  P0: 'p0-decisions',
  P1: 'p1-foundation',
  P2: 'p2-vertical-slice',
  P3: 'p3-core-modules',
  P4: 'p4-background-comms',
  P5: 'p5-saas-layer',
  P6: 'p6-launch-hardening',
  P7: 'p7-ui',
};
const PHASE_NAMES = {
  P0: 'Decisions',
  P1: 'Foundation',
  P2: 'Vertical slice',
  P3: 'Core modules',
  P4: 'Background & comms',
  P5: 'SaaS layer',
  P6: 'Launch hardening',
  P7: 'UI',
};
const PRIORITIES = ['P0', 'P1', 'P2'];
const SIZES = ['S', 'M', 'L'];

function unquote(v) {
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v);
  return v;
}

/** Parses the small YAML subset the task files use: `key: value`, `key: []` and `- item` lists. */
function parseFrontmatter(text, file) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file}: no frontmatter`);
  const data = {};
  let listKey = null;
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trim();
    if (value === '' && key === 'endpoints') {
      data[key] = [];
      listKey = key;
    } else {
      listKey = null;
      data[key] = value === '[]' ? [] : value === '' ? null : unquote(value);
    }
  }
  if (typeof data.pr === 'string' && /^\d+$/.test(data.pr)) data.pr = Number(data.pr);
  return data;
}

export function loadTasks() {
  const tasks = [];
  for (const dir of readdirSync(TASKS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const name of readdirSync(join(TASKS_DIR, dir.name))) {
      if (!name.endsWith('.md')) continue;
      const path = join(TASKS_DIR, dir.name, name);
      const task = parseFrontmatter(readFileSync(path, 'utf8'), name);
      tasks.push({ ...task, file: relative(ROOT, path), folder: dir.name, filename: name });
    }
  }
  return tasks.sort((a, b) => num(a.id) - num(b.id));
}

const num = (id) => Number(String(id).replace(/^TUI-/, ''));

function check(tasks) {
  const problems = [];
  const seen = new Map();
  for (const t of tasks) {
    const where = t.file;
    if (!/^TUI-\d+$/.test(t.id ?? '')) problems.push(`${where}: id must look like TUI-12`);
    else if (!t.filename.startsWith(`tui-${num(t.id)}-`))
      problems.push(`${where}: filename must start with tui-${num(t.id)}-`);
    if (seen.has(t.id)) problems.push(`${where}: duplicate id ${t.id} (also ${seen.get(t.id)})`);
    seen.set(t.id, where);
    if (!t.title) problems.push(`${where}: missing title`);
    if (!STATUSES.includes(t.status)) problems.push(`${where}: status must be one of ${STATUSES}`);
    if (!PHASES[t.phase]) problems.push(`${where}: phase must be P0–P7`);
    else if (PHASES[t.phase] !== t.folder)
      problems.push(`${where}: phase ${t.phase} belongs in tasks/${PHASES[t.phase]}/`);
    if (!PRIORITIES.includes(t.priority)) problems.push(`${where}: priority must be P0, P1 or P2`);
    if (!SIZES.includes(t.size)) problems.push(`${where}: size must be S, M or L`);
    if (!t.module) problems.push(`${where}: missing module`);
    if (!Array.isArray(t.endpoints)) problems.push(`${where}: endpoints must be a list (or [])`);
    if (t.pr !== null && t.pr !== undefined && !Number.isInteger(t.pr))
      problems.push(`${where}: pr must be a PR number`);
    if (t.status === 'done' && t.phase !== 'P0' && !t.pr && t.branch)
      problems.push(`${where}: done with a branch but no pr`);
  }
  return problems;
}

/** Task ids named by a branch: task/tui-27-…, task/tui-27-28-…, docs/tui-1-10-… */
function idsFromBranch(branch) {
  const m = branch.match(/^(?:task|docs|fix)\/tui-(\d+(?:-\d+)*)-[a-z]/);
  if (!m) return [];
  const nums = m[1].split('-').map(Number);
  // docs/tui-1-10-… and task/tui-27-29-… name a range when the second number is larger.
  if (nums.length === 2 && nums[1] > nums[0] + 1 && branch.startsWith('docs/'))
    return Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => `TUI-${nums[0] + i}`);
  return nums.map((n) => `TUI-${n}`);
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** Adds `live` to each unfinished task from local branches and GitHub PRs. */
function addLiveState(tasks) {
  const notes = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const branches = run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  for (const b of branches?.split('\n').filter(Boolean) ?? []) {
    for (const id of idsFromBranch(b)) {
      const t = byId.get(id);
      if (t && !['done', 'deferred'].includes(t.status))
        t.live = { state: 'in-progress', branch: b };
    }
  }
  const json = run('gh', [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,state,headRefName,baseRefName,isDraft,reviewDecision',
  ]);
  if (json === null) {
    notes.push('GitHub PR state unavailable (gh not installed or not signed in).');
    return notes;
  }
  const prs = JSON.parse(json);
  for (const pr of prs) {
    const ids = new Set(idsFromBranch(pr.headRefName));
    for (const t of tasks)
      if (t.pr === pr.number || (t.branch && t.branch === pr.headRefName)) ids.add(t.id);
    for (const id of ids) {
      const t = byId.get(id);
      if (!t || t.status === 'done' || t.status === 'deferred') continue;
      if (pr.state === 'OPEN') {
        const extra = pr.isDraft
          ? 'draft'
          : pr.reviewDecision === 'CHANGES_REQUESTED'
            ? 'changes requested'
            : pr.reviewDecision === 'APPROVED'
              ? 'approved'
              : '';
        t.live = { state: 'in-review', pr: pr.number, base: pr.baseRefName, note: extra };
      } else if (
        pr.state === 'MERGED' &&
        pr.baseRefName === 'main' &&
        t.pr === pr.number &&
        t.status !== 'blocked'
      ) {
        t.live = { state: 'merged', pr: pr.number, note: 'merged; file not marked done' };
      }
    }
  }
  return notes;
}

function statusLabel(t) {
  if (!t.live) return t.status;
  if (t.live.state === 'in-review')
    return `in review #${t.live.pr}${t.live.note ? ` (${t.live.note})` : ''}`;
  if (t.live.state === 'merged') return `merged #${t.live.pr}, needs sync`;
  return `in progress (${t.live.branch})`;
}

function table(tasks) {
  const rows = tasks.map((t) => [
    t.id,
    t.title.replaceAll('|', '\\|'),
    statusLabel(t),
    t.priority,
    t.size,
    t.module,
    t.pr ? `#${t.pr}` : '',
  ]);
  return [
    '| ID | Task | Status | Pri | Size | Module | PR |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const values = (name) =>
    argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));
  const tasks = loadTasks();

  if (flags.has('--check')) {
    const problems = check(tasks);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log(`${tasks.length} task files OK`);
    return;
  }

  const notes = flags.has('--offline') ? [] : addLiveState(tasks);

  const phases = values('phase');
  const modules = values('module');
  const statuses = values('status');
  let shown = tasks.filter(
    (t) =>
      (!phases.length || phases.includes(t.phase)) &&
      (!modules.length || modules.includes(t.module)) &&
      (!statuses.length || statuses.includes(t.status)),
  );
  if (!flags.has('--all') && !statuses.length)
    shown = shown.filter((t) => !['done', 'deferred'].includes(t.status) || t.live);

  if (flags.has('--json')) {
    console.log(JSON.stringify(shown, null, 2));
    return;
  }

  const count = (s) => tasks.filter((t) => t.status === s).length;
  const live = (s) => tasks.filter((t) => t.live?.state === s).length;
  const out = [
    `# Board: ${tasks.length} tasks · ${count('done')} done · ${live('in-review')} in review · ` +
      `${live('in-progress') + count('in-progress')} in progress · ${count('blocked')} blocked · ` +
      `${count('todo')} todo · ${count('deferred')} deferred · next id TUI-${Math.max(...tasks.map((t) => num(t.id))) + 1}`,
    ...notes.map((n) => `> ${n}`),
  ];
  for (const [phase, dir] of Object.entries(PHASES)) {
    const inPhase = shown.filter((t) => t.phase === phase);
    if (!inPhase.length) continue;
    out.push('', `## ${phase} ${PHASE_NAMES[phase]} (tasks/${dir}/)`, '', table(inPhase));
  }
  console.log(out.join('\n'));
}

main(process.argv.slice(2));
