# AI-Assisted Installation Guide

This file is written for an AI coding assistant helping a user install Codex
Compact Continuity.

## Goal

Install a global Codex hook that only activates inside the user's configured
project roots. The hook preserves compact handoff state and blocks normal tool
use after compaction until the restored agent reads the required continuity
files.

## Steps

1. Identify the user's project root as an absolute path.
2. Choose a short project name.
3. From this repository, run:

```bash
node scripts/install.mjs --project ProjectName=/absolute/path/to/project
```

If a child directory should be ignored, add:

```bash
--ignore ProjectName=child-dir
```

4. Verify:

```bash
npm run verify
```

5. Simulate a compact for the configured project:

```bash
printf '{"hook_event_name":"PreCompact","trigger":"auto","cwd":"/absolute/path/to/project"}' \
  | node ~/.codex/hooks/compact-continuity/compact-continuity.mjs
```

Expected files:

- `<project>/.omx/continuity/latest.md`
- `<project>/.omx/continuity/latest.json`
- `<project>/.omx/continuity/history_rollup.md`

6. Ask the user to open Codex App -> Settings -> Hooks, or run `/hooks` in
   Codex, and trust the new hook definition.

## Cleanup

If the user asks to remove this tool:

1. Remove only this package's hook command from `~/.codex/hooks.json`.
2. Remove `~/.codex/hooks/compact-continuity`.
3. Remove `<project>/.omx/continuity` for each configured project, after
   checking that the user does not keep unrelated local files there.
4. Ask the user to open Codex App -> Settings -> Hooks, or run `/hooks` in
   Codex, and confirm the removed hook definition is no longer trusted or
   listed.

## Do Not

- Do not publish or commit the user's generated `projects.json`.
- Do not remove unrelated hooks from `~/.codex/hooks.json`.
- Do not assume relative project paths; use absolute paths.
- Do not continue if the verification commands fail.
