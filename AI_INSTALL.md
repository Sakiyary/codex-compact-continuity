# AI-Assisted Installation Guide

This file is written for an AI coding assistant helping a user install Codex
Compact Continuity.

## Goal

Install a global Codex hook that only activates inside the user's configured
project roots. The hook preserves compact handoff state and blocks normal tool
use after compaction until the restored agent reads the minimal continuity
handoff.

## Steps

1. Identify the user's project root as an absolute path.
2. Choose a short project name.
3. Add the generated continuity directory to the target project's `.gitignore`
   unless the user explicitly wants to version local compact handoff state:

```gitignore
.codex-compact-continuity/
```

If the user configured a custom `continuity_path`, ignore that directory
instead.

4. If the user already uses oh-my-codex or another local state system, ask
   whether they want to wire existing state files into `state_path` or
   `session_state_path`. These fields are optional. Do not invent paths, and do
   not require oh-my-codex for installation.

5. From this repository, run:

```bash
node scripts/install.mjs --project ProjectName=/absolute/path/to/project
```

If a child directory should be ignored, add:

```bash
--ignore ProjectName=child-dir
```

6. Verify:

```bash
npm run verify
```

7. Simulate a compact for the configured project:

```bash
printf '{"hook_event_name":"PreCompact","trigger":"auto","cwd":"/absolute/path/to/project"}' \
  | node ~/.codex/hooks/compact-continuity/compact-continuity.mjs
```

Expected files:

- `<project>/.codex-compact-continuity/latest.md`
- `<project>/.codex-compact-continuity/latest.json`
- `<project>/.codex-compact-continuity/history_rollup.md`

This simulation has no `session_id` and uses legacy root-level paths. Real
identified sessions use `.codex-compact-continuity/sessions/<session-key>/`.
Lowercase UUIDs are used directly; other IDs use `s-` plus their SHA-256 hash.
Do not use a different session's handoff or an old root-level file as evidence
that the current session restored successfully.

The generated `latest.json` should include a `handoff_envelope` with schema
version, source project/session, creation reason, recent operational tail,
referenced files, pending verification target, restore-required file list,
suggested read list, and a digest.

The restore-required list should stay small. Full state files, history rollups,
and project docs may appear as suggested reads, but they should not be required
just to clear the restore gate.

8. Ask the user to open Codex App -> Settings -> Hooks, or run `/hooks` in
   Codex, and trust the new hook definition.

9. Maintain the structured brief using the `--write-brief` command and schema
   in README.md. Include evidence for completed work. Never publish brief
   inputs or generated handoffs as part of a code contribution.

10. Verify a real `/compact` after approval. Read the current session's
    `latest.md`, check the new snapshot time and trigger, then confirm
    `last-restore-ack.json` records the read and `needs-restore.json` is cleared.
    Do not describe a synthetic invocation as proof of automatic delivery.

On Windows the installer registers PowerShell commands beginning with `&`.
Paths containing spaces are quoted by the installer. Use `Get-Content
-LiteralPath` for a restore read; keep it separate from other commands.

## Boundary To Explain

Tell the user this tool creates continuity evidence and a restore gate. It does
not create authoritative execution history.

If the resumed agent needs to claim that a patch was applied, a command passed,
or a file changed, it should verify that claim against durable sources such as
git state, file contents, tool logs, or fresh command output.

## Cleanup

If the user asks to remove this tool:

1. Remove only this package's hook command from `~/.codex/hooks.json`.
2. Remove `~/.codex/hooks/compact-continuity`.
3. Remove `<project>/.codex-compact-continuity`, or the configured
   `continuity_path`, for each configured project after checking that the user
   does not keep unrelated local files there.
4. Remove the generated directory entry from each target project's `.gitignore`
   if it was added only for this tool.
5. Ask the user to open Codex App -> Settings -> Hooks, or run `/hooks` in
   Codex, and confirm the removed hook definition is no longer trusted or
   listed.

## Do Not

- Do not publish or commit the user's generated `projects.json`.
- Do not remove unrelated hooks from `~/.codex/hooks.json`.
- Do not assume relative project paths; use absolute paths.
- Do not continue if the verification commands fail.
- Do not assume any external state system is installed. This tool works on its
  own.
