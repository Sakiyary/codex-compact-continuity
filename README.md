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
  - `<project>/.codex-compact-continuity/latest.md`
  - `<project>/.codex-compact-continuity/latest.json`
  - `<project>/.codex-compact-continuity/snapshots/*.json`
- `PreCompact` also updates cumulative history:
  - `<project>/.codex-compact-continuity/history_rollup.md`
  - `<project>/.codex-compact-continuity/history_rollup.json`
- `PostCompact` arms a restore sentinel:
  - `<project>/.codex-compact-continuity/needs-restore.json`
- `PreToolUse` blocks non-restore tool calls while the sentinel is armed.
- `PostToolUse` records which required files have been read and clears the
  sentinel only after all required reads are observed.

The hook is registered globally, but it no-ops unless the hook payload `cwd` is
inside a configured project root.

## Privacy And Git Safety

The generated continuity files may contain task context, recent session signals,
command summaries, repo status, and short tool-output excerpts. Treat
`<project>/.codex-compact-continuity/` as local working state, not source code.

Add the default generated directory to each target project's `.gitignore`
unless you intentionally want to version this state:

```gitignore
.codex-compact-continuity/
```

As a second line of defense, the hook writes
`<project>/.codex-compact-continuity/.gitignore` with rules that ignore the
generated files inside that directory. The project-level `.gitignore` entry is
still recommended because it hides the whole local state directory from normal
Git status output.

This package is self-contained. It uses its own project-local continuity
directory by default. If you already keep task or session state in another local
file, you can point the optional `state_path` and `session_state_path` fields at
those files.

## Optional State Integrations

This package does not require an external state manager. It can work by writing
and restoring its own compact-continuity files.

If your project already uses [oh-my-codex](https://github.com/Sakiyary/oh-my-codex)
or another local state system, those files can improve the quality of the
handoff. In that case, set `state_path` or `session_state_path` to the concrete
state files your project already has, including files under an existing `.omx`
directory.

Do not add optional state paths just because they appear in an example. Only
configure paths that exist in your project, or omit these fields entirely.

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

After installing or changing hooks, open Codex App -> Settings -> Hooks, or run
`/hooks` in Codex, and trust the updated hook definition.

Also add `.codex-compact-continuity/` to the target project's `.gitignore` unless
you have configured a different `continuity_path`.

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
      "continuity_path": ".codex-compact-continuity"
    }
  ]
}
```

`continuity_path` is optional and defaults to `.codex-compact-continuity`.
`state_path` and `session_state_path` are also optional. They are not directories
created by this package, and they are not required for the default workflow. Use
them only when your project already has local files that record task or session
state. Missing files are handled gracefully.

The paths can point anywhere inside your project, including an existing `.omx`
directory or any other local state directory you already use. Replace the
placeholder paths below with your own files, or omit these fields entirely:

```json
{
  "state_path": ".your-local-state/current.json",
  "session_state_path": ".your-local-state/session.json"
}
```

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

- `<project>/.codex-compact-continuity/latest.md`
- `<project>/.codex-compact-continuity/latest.json`
- `<project>/.codex-compact-continuity/history_rollup.md`

## AI-Assisted Installation

This repository includes [AI_INSTALL.md](AI_INSTALL.md), a short instruction
file for an AI coding assistant. A user can point an assistant at that file and
ask it to install the hook for their project.

For best results, tell the assistant:

```text
Install this Codex hook package for /absolute/path/to/my-project. Use the
project name MyProject. After installation, run the verification commands.
```

## Cleanup

To remove this tool:

1. Remove this hook command from `~/.codex/hooks.json`:

```text
node ~/.codex/hooks/compact-continuity/compact-continuity.mjs
```

2. Remove the installed hook files:

```bash
rm -rf ~/.codex/hooks/compact-continuity
```

3. Remove generated continuity files from each project where you enabled the
   tool. With the default configuration:

```bash
rm -rf /absolute/path/to/my-project/.codex-compact-continuity
```

4. Open Codex App -> Settings -> Hooks, or run `/hooks` in Codex, and confirm
   the removed hook definition is no longer trusted or listed.

If you configured a custom `continuity_path`, remove that directory instead and
inspect it before deleting if other local workflows may write there.

If you added the generated directory to a project `.gitignore`, remove that line
too.

## Limits

This tool cannot rewrite Codex's internal compacted model history. It works by
creating durable project-side continuity artifacts and mechanically forcing the
next agent to read them before using non-restore tools.

That makes it stronger than prompt-only compact guidance, but weaker than a
native Codex feature that preserves recent operational steps directly inside the
post-compact context.

This repository is a lightweight workaround for the current Codex hook and
compaction behavior. It may become unnecessary if Codex adds stronger native
post-compact continuity, context pins, recent-step preservation, or a first-class
compaction extension point.
