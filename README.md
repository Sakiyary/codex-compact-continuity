# Codex Compact Continuity

Codex Compact Continuity is a small hook package for preserving operational
state across Codex context compaction.

It is for long-running coding sessions where the compacted summary can lose
details that still matter: current task cursor, recent user corrections, dirty
repo state, active docs, verification requirements, and the exact files the next
model must reread before continuing.

## Why This Exists

Codex compaction is necessary for long sessions, but it can turn a live task
state into a vague summary. After that, an agent may restart discovery, forget
recent constraints, repeat work, or continue without checking the files that
contain the real state.

This package treats compaction as an interruption that requires a controlled
handoff restore before normal tool use continues.

## How It Works

- `PreCompact` writes a bounded handoff snapshot:
  - `<project>/.omx/continuity/latest.md`
  - `<project>/.omx/continuity/latest.json`
  - `<project>/.omx/continuity/snapshots/*.json`
- `PreCompact` also updates cumulative history:
  - `<project>/.omx/continuity/history_rollup.md`
  - `<project>/.omx/continuity/history_rollup.json`
- `PostCompact` arms a restore sentinel:
  - `<project>/.omx/continuity/needs-restore.json`
- `PreToolUse` blocks non-restore tool calls while the sentinel is armed.
- `PostToolUse` records which required files have been read and clears the
  sentinel only after all required reads are observed.

The hook is registered globally, but it no-ops unless the hook payload `cwd` is
inside a configured project root.

## Install

From this repository:

```bash
node scripts/install.mjs --project MyProject=/absolute/path/to/my-project
```

With an ignored child directory:

```bash
node scripts/install.mjs \
  --project MyProject=/absolute/path/to/my-project \
  --ignore MyProject=frontend
```

The installer copies files to:

```text
~/.codex/hooks/compact-continuity/
```

and registers this hook command in `~/.codex/hooks.json`:

```text
node ~/.codex/hooks/compact-continuity/compact-continuity.mjs
```

After installing or changing hooks, open `/hooks` in Codex and trust the updated
hook definition.

## Project Configuration

Configured projects live in:

```text
~/.codex/hooks/compact-continuity/projects.json
```

Example:

```json
{
  "projects": [
    {
      "name": "my-project",
      "root": "/absolute/path/to/my-project",
      "ignored_child_roots": [],
      "state_path": ".omx/continuous-dev/state.json",
      "session_state_path": ".omx/state/session.json"
    }
  ]
}
```

`state_path` and `session_state_path` are optional. When present, the hook uses
them to find active task state and Codex session metadata. Missing files are
handled gracefully.

## Verify

```bash
npm run verify
```

Simulate a configured project:

```bash
printf '{"hook_event_name":"PreCompact","trigger":"auto","cwd":"/absolute/path/to/my-project"}' \
  | node ~/.codex/hooks/compact-continuity/compact-continuity.mjs
```

Expected files:

- `<project>/.omx/continuity/latest.md`
- `<project>/.omx/continuity/latest.json`
- `<project>/.omx/continuity/history_rollup.md`

## AI-Assisted Installation

This repository includes [AI_INSTALL.md](AI_INSTALL.md), a short instruction
file for an AI coding assistant. A user can point an assistant at that file and
ask it to install the hook for their project.

For best results, tell the assistant:

```text
Install this Codex hook package for /absolute/path/to/my-project. Use the
project name MyProject. After installation, run the verification commands.
```

## Limits

This tool cannot rewrite Codex's internal compacted model history. It works by
creating durable project-side continuity artifacts and mechanically forcing the
next agent to read them before using non-restore tools.

That makes it stronger than prompt-only compact guidance, but weaker than a
native Codex feature that preserves recent operational steps directly inside the
post-compact context.
