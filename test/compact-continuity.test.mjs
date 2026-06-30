#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL(import.meta.url).pathname, "..");
const scriptPath = path.join(root, "..", "src", "compact-continuity.mjs");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runHook(cwd, codexHome, projectsFile, payload) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      COMPACT_CONTINUITY_CODEX_HOME: codexHome,
      COMPACT_CONTINUITY_PROJECTS_FILE: projectsFile,
      COMPACT_CONTINUITY_PROJECTS_JSON: "",
    },
  });
}

const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "compact-continuity-global-")));
const configDir = path.join(tempRoot, "hook-config");
const projectsFile = path.join(configDir, "projects.json");
const judgRoot = path.join(tempRoot, "ExampleMonorepo");
const growxRoot = path.join(tempRoot, "DocsProject");
const frontendRoot = path.join(judgRoot, "example-frontend");
const outsideRoot = path.join(tempRoot, "unrelated");
const codexHome = path.join(tempRoot, "codex-home");
const continuityDirName = ".codex-compact-continuity";
const projects = [
  {
    name: "ExampleMonorepo",
    root: judgRoot,
    ignored_child_roots: ["example-frontend"],
    state_path: ".external-state/current.json",
    session_state_path: ".external-state/session.json",
  },
  {
    name: "DocsProject",
    root: growxRoot,
    session_state_path: ".external-state/session.json",
  },
];

writeJson(projectsFile, { projects });
fs.mkdirSync(frontendRoot, { recursive: true });
fs.mkdirSync(growxRoot, { recursive: true });
fs.mkdirSync(outsideRoot, { recursive: true });

writeJson(path.join(judgRoot, ".external-state", "current.json"), {
  schema_version: 4,
  active: true,
  active_capability_id: "example.runner_kafka_sandbox",
  active_checkpoint_id: "example.runner_kafka_sandbox.next_checkpoint_selection_after_real_autoscaler_runner_lifecycle_mvp_module_v1",
  active_checkpoint: {
    title: "Select next backend/judge MVP module after real autoscaler / runner lifecycle",
    status: "in_progress",
    phase: "planning",
    active_docs: [
      "example-docs/implementation/progress.md",
      "example-docs/implementation/capability-roadmap.md",
    ],
    audit_path: ".external-state/audit/current.md",
    context_snapshot_path: ".external-state/context/current.json",
    non_goals_until_next_checkpoint: [
      "do not select a single DTO, helper, telemetry metric, smoke assertion, flag flip or port note",
    ],
    verification_commands: ["git -C example-docs diff --check"],
  },
  current_slice: {
    title: "Post-real-autoscaler lifecycle next checkpoint selection tranche",
    phase: "planning",
  },
});

writeText(path.join(judgRoot, "example-docs", "implementation", "progress.md"), "# Progress\n");
writeText(path.join(judgRoot, "example-docs", "implementation", "capability-roadmap.md"), "# Roadmap\n");
writeText(path.join(judgRoot, ".external-state", "audit", "current.md"), "# Audit\n");
writeJson(path.join(judgRoot, ".external-state", "context", "current.json"), { ok: true });

writeJson(path.join(judgRoot, ".external-state", "session.json"), {
  native_session_id: "019f-test-session",
  cwd: judgRoot,
});

writeJson(path.join(growxRoot, ".external-state", "session.json"), {
  native_session_id: "019f-growx-session",
  cwd: growxRoot,
});

writeJson(path.join(judgRoot, continuityDirName, "history_rollup.json"), {
  schema_version: 1,
  project: "ExampleMonorepo",
  updated_at: "2026-06-29T00:00:00.000Z",
  entries: [
    {
      created_at: "2026-06-29T00:00:00.000Z",
      compact_trigger: "auto",
      checkpoint: "previous.checkpoint",
      title: "Previous compact preserved database decision",
      facts: [
        "Previous compact preserved database decision",
        "Do not reopen the rejected DTO-only route.",
      ],
    },
  ],
});

const judgSessionFile = path.join(codexHome, "sessions", "2026", "06", "30", "rollout-2026-06-30T00-00-00-019f-test-session.jsonl");
fs.mkdirSync(path.dirname(judgSessionFile), { recursive: true });
fs.writeFileSync(
  judgSessionFile,
  [
    {
      timestamp: "2026-06-30T01:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "用户刚纠正过：以后 compact 后必须先读 handoff，再继续选择模块。",
      },
    },
    {
      timestamp: "2026-06-30T01:01:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd: "git -C example-docs diff --check",
        }),
      },
    },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  "utf8",
);

const growxSessionFile = path.join(codexHome, "sessions", "2026", "06", "30", "rollout-2026-06-30T00-00-00-019f-growx-session.jsonl");
fs.mkdirSync(path.dirname(growxSessionFile), { recursive: true });
fs.writeFileSync(
  growxSessionFile,
  JSON.stringify({
    timestamp: "2026-06-30T02:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message: "Docs project should restore latest project context after compact.",
    },
  }) + "\n",
  "utf8",
);

const judgPreCompact = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PreCompact",
  trigger: "auto",
  cwd: judgRoot,
});
assert.equal(judgPreCompact.status, 0, judgPreCompact.stderr);
assert.equal(JSON.parse(judgPreCompact.stdout).decision ?? "allow", "allow");

const judgLatestMarkdown = fs.readFileSync(path.join(judgRoot, continuityDirName, "latest.md"), "utf8");
assert.match(judgLatestMarkdown, /Project: ExampleMonorepo/);
assert.match(judgLatestMarkdown, /example\.runner_kafka_sandbox/);
assert.match(judgLatestMarkdown, /Previous compact preserved database decision/);
assert.match(judgLatestMarkdown, /Cumulative History Rollup/);
assert.match(judgLatestMarkdown, /Continuity Evidence, Not Authority/);
assert.match(judgLatestMarkdown, /Handoff digest: sha256:/);
assert.match(judgLatestMarkdown, /必须先读 handoff/);
assert.match(judgLatestMarkdown, /git -C example-docs diff --check/);
assert.equal(fs.readFileSync(path.join(judgRoot, continuityDirName, ".gitignore"), "utf8"), "*\n!.gitignore\n");

const judgLatestJson = readJson(path.join(judgRoot, continuityDirName, "latest.json"));
assert.equal(judgLatestJson.project, "ExampleMonorepo");
assert.equal(judgLatestJson.compact.trigger, "auto");
assert.equal(judgLatestJson.state.active_checkpoint_id, "example.runner_kafka_sandbox.next_checkpoint_selection_after_real_autoscaler_runner_lifecycle_mvp_module_v1");
assert.ok(judgLatestJson.session.recent_events.length >= 2);
assert.ok(judgLatestJson.history_rollup.entries.length >= 2);
assert.deepEqual(judgLatestJson.required_read_paths, [`${continuityDirName}/latest.md`]);
assert.ok(judgLatestJson.suggested_read_paths.includes(`${continuityDirName}/latest.json`));
assert.ok(judgLatestJson.suggested_read_paths.includes(`${continuityDirName}/history_rollup.md`));
assert.ok(judgLatestJson.suggested_read_paths.includes("example-docs/implementation/progress.md"));
assert.equal(judgLatestJson.handoff_envelope.schema_version, 1);
assert.equal(judgLatestJson.handoff_envelope.source.project, "ExampleMonorepo");
assert.equal(judgLatestJson.handoff_envelope.reason, "auto compact continuity handoff");
assert.match(judgLatestJson.handoff_envelope.digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(judgLatestJson.handoff_digest, judgLatestJson.handoff_envelope.digest);
assert.deepEqual(judgLatestJson.handoff_envelope.restore_required_files, judgLatestJson.required_read_paths);
assert.ok(judgLatestJson.handoff_envelope.suggested_read_files.includes("example-docs/implementation/progress.md"));
assert.deepEqual(judgLatestJson.pending_verification.targets, ["git -C example-docs diff --check"]);
assert.ok(judgLatestJson.handoff_envelope.operational_tail.length >= 2);
assert.ok(judgLatestJson.referenced_files.some((file) =>
  file.path === "example-docs/implementation/progress.md" &&
  file.exists === true &&
  /^([a-f0-9]{64})$/.test(file.sha256),
));
assert.ok(judgLatestJson.referenced_files.some((file) =>
  file.path === `${continuityDirName}/latest.md` &&
  file.role === "generated_continuity_file",
));
assert.equal(fs.existsSync(path.join(judgRoot, ".external-state", "continuity", "latest.md")), false);

const rollupMarkdown = fs.readFileSync(path.join(judgRoot, continuityDirName, "history_rollup.md"), "utf8");
assert.match(rollupMarkdown, /Previous compact preserved database decision/);
assert.match(rollupMarkdown, /Select next backend\/judge MVP module/);

const growxPreCompact = runHook(growxRoot, codexHome, projectsFile, {
  hook_event_name: "PreCompact",
  trigger: "manual",
  cwd: growxRoot,
});
assert.equal(growxPreCompact.status, 0, growxPreCompact.stderr);
const growxLatestMarkdown = fs.readFileSync(path.join(growxRoot, continuityDirName, "latest.md"), "utf8");
assert.match(growxLatestMarkdown, /Project: DocsProject/);
assert.match(growxLatestMarkdown, /Docs project should restore latest project context after compact/);
assert.equal(readJson(path.join(growxRoot, continuityDirName, "latest.json")).project, "DocsProject");
assert.equal(readJson(path.join(growxRoot, continuityDirName, "latest.json")).pending_verification.source, "default");

const ignoredFrontend = runHook(frontendRoot, codexHome, projectsFile, {
  hook_event_name: "PreCompact",
  cwd: frontendRoot,
});
assert.equal(ignoredFrontend.status, 0, ignoredFrontend.stderr);
assert.deepEqual(JSON.parse(ignoredFrontend.stdout), {});
assert.equal(fs.existsSync(path.join(frontendRoot, continuityDirName, "latest.md")), false);

const outsideProject = runHook(outsideRoot, codexHome, projectsFile, {
  hook_event_name: "PreCompact",
  cwd: outsideRoot,
});
assert.equal(outsideProject.status, 0, outsideProject.stderr);
assert.deepEqual(JSON.parse(outsideProject.stdout), {});
assert.equal(fs.existsSync(path.join(outsideRoot, continuityDirName, "latest.md")), false);

const postCompact = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PostCompact",
  trigger: "auto",
  cwd: judgRoot,
});
assert.equal(postCompact.status, 0, postCompact.stderr);
const sentinelPath = path.join(judgRoot, continuityDirName, "needs-restore.json");
const armedSentinel = readJson(sentinelPath);
assert.equal(armedSentinel.restored, false);
assert.deepEqual(armedSentinel.required_first_reads, [`${continuityDirName}/latest.md`]);

const blockedTool = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PreToolUse",
  cwd: judgRoot,
  tool_name: "Bash",
  tool_input: {
    cmd: "go test ./...",
  },
});
assert.equal(blockedTool.status, 0, blockedTool.stderr);
const blockedPayload = JSON.parse(blockedTool.stdout);
assert.equal(blockedPayload.decision, "block");
assert.match(blockedPayload.systemMessage, /ExampleMonorepo compact continuity restore/);
assert.match(blockedPayload.systemMessage, /\.codex-compact-continuity\/latest\.md/);

const misleadingRead = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PreToolUse",
  cwd: judgRoot,
  tool_name: "Bash",
  tool_input: {
    cmd: `cat ${continuityDirName}/latest.md.bak`,
  },
});
assert.equal(misleadingRead.status, 0, misleadingRead.stderr);
assert.equal(JSON.parse(misleadingRead.stdout).decision, "block");

const readLatestMd = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PostToolUse",
  cwd: judgRoot,
  tool_name: "Bash",
  tool_input: {
    cmd: `sed -n '1,220p' ${continuityDirName}/latest.md`,
  },
  tool_response: {
    exit_code: 0,
  },
});
assert.equal(readLatestMd.status, 0, readLatestMd.stderr);
assert.equal(fs.existsSync(sentinelPath), false, "reading latest.md should clear the minimal restore sentinel");

const postCompactForNativeRead = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PostCompact",
  trigger: "auto",
  cwd: judgRoot,
});
assert.equal(postCompactForNativeRead.status, 0, postCompactForNativeRead.stderr);
assert.equal(fs.existsSync(sentinelPath), true, "second compact should re-arm restore sentinel");

const nativeReadLatestMd = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PreToolUse",
  cwd: judgRoot,
  tool_name: "mcp__filesystem__read_file",
  tool_input: {
    path: `${continuityDirName}/latest.md`,
  },
});
assert.equal(nativeReadLatestMd.status, 0, nativeReadLatestMd.stderr);
assert.deepEqual(JSON.parse(nativeReadLatestMd.stdout), {});

const nativeReadLatestMdAck = runHook(judgRoot, codexHome, projectsFile, {
  hook_event_name: "PostToolUse",
  cwd: judgRoot,
  tool_name: "mcp__filesystem__read_file",
  tool_input: {
    path: `${continuityDirName}/latest.md`,
  },
  tool_response: {
    exit_code: 0,
  },
});
assert.equal(nativeReadLatestMdAck.status, 0, nativeReadLatestMdAck.stderr);
assert.equal(fs.existsSync(sentinelPath), false, "native read_file of latest.md should clear restore sentinel");
