#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const HOOK_DIR = path.resolve(new URL(import.meta.url).pathname, "..");
const DEFAULT_PROJECTS = [];
const CODEX_HOME = path.resolve(process.env.COMPACT_CONTINUITY_CODEX_HOME || path.join(os.homedir(), ".codex"));
const MAX_HISTORY_ROLLUP_ENTRIES = 8;
const DEFAULT_CONTINUITY_PATH = ".codex-compact-continuity";

function nowIso() {
  return new Date().toISOString();
}

function jsonOut(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function readStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function parseJson(raw, fallback = {}) {
  if (!raw || !String(raw).trim()) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, value, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function ensureContinuityGitignore(ctx) {
  const gitignorePath = path.join(ctx.continuity_dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    writeTextAtomic(gitignorePath, "*\n!.gitignore\n");
  }
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function payloadCwd(payload) {
  const candidates = [
    payload?.cwd,
    payload?.workingDirectory,
    payload?.working_directory,
    payload?.workspaceRoot,
    payload?.workspace_root,
    payload?.session?.cwd,
    payload?.context?.cwd,
  ];
  return candidates.find((value) => typeof value === "string" && value.length > 0) || process.cwd();
}

function normalizeProject(project) {
  const root = project?.root || project?.project_root || project?.projectRoot;
  if (!project?.name || !root) {
    return null;
  }
  const ignored = project.ignored_child_roots || project.ignoredChildRoots || [];
  const continuityPath = configValue(project, "continuity_path", "continuityPath", DEFAULT_CONTINUITY_PATH);
  const rootStatePath = configValue(project, "state_path", "statePath", null);
  const sessionStatePath = configValue(project, "session_state_path", "sessionStatePath", null);
  return {
    name: String(project.name),
    root: path.resolve(root),
    ignored_child_roots: new Set(Array.isArray(ignored) ? ignored.map(String) : []),
    continuity_path: String(continuityPath || DEFAULT_CONTINUITY_PATH),
    root_state_path: rootStatePath,
    session_state_path: sessionStatePath,
  };
}

function configuredProjects() {
  const filePath = process.env.COMPACT_CONTINUITY_PROJECTS_FILE || path.join(HOOK_DIR, "projects.json");
  const fileConfig = readJson(filePath, null);
  if (fileConfig) {
    const projects = Array.isArray(fileConfig) ? fileConfig : fileConfig.projects;
    if (Array.isArray(projects)) {
      return projects.map(normalizeProject).filter(Boolean).sort((a, b) => b.root.length - a.root.length);
    }
  }
  const raw = process.env.COMPACT_CONTINUITY_PROJECTS_JSON;
  const parsed = raw ? parseJson(raw, []) : DEFAULT_PROJECTS;
  const projects = Array.isArray(parsed) ? parsed : DEFAULT_PROJECTS;
  return projects.map(normalizeProject).filter(Boolean).sort((a, b) => b.root.length - a.root.length);
}

function isInside(root, cwd) {
  const relative = path.relative(root, path.resolve(cwd));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function matchesIgnoredChild(project, cwd) {
  const relative = path.relative(project.root, path.resolve(cwd));
  if (relative === "") {
    return false;
  }
  const [firstSegment] = relative.split(path.sep);
  return project.ignored_child_roots.has(firstSegment);
}

function configValue(project, snakeName, camelName, fallback) {
  if (Object.prototype.hasOwnProperty.call(project, snakeName)) {
    return project[snakeName];
  }
  if (Object.prototype.hasOwnProperty.call(project, camelName)) {
    return project[camelName];
  }
  return fallback;
}

function resolveProject(cwd) {
  for (const project of configuredProjects()) {
    if (isInside(project.root, cwd) && !matchesIgnoredChild(project, cwd)) {
      return project;
    }
  }
  return null;
}

function projectContext(project) {
  const continuityDir = path.resolve(project.root, project.continuity_path);
  return {
    ...project,
    continuity_dir: continuityDir,
    snapshots_dir: path.join(continuityDir, "snapshots"),
    latest_json: path.join(continuityDir, "latest.json"),
    latest_md: path.join(continuityDir, "latest.md"),
    history_rollup_json: path.join(continuityDir, "history_rollup.json"),
    history_rollup_md: path.join(continuityDir, "history_rollup.md"),
    restore_sentinel: path.join(continuityDir, "needs-restore.json"),
    root_state: project.root_state_path ? path.resolve(project.root, project.root_state_path) : null,
    session_state: project.session_state_path ? path.resolve(project.root, project.session_state_path) : null,
  };
}

function eventName(payload) {
  return payload?.hook_event_name || payload?.hookEventName || payload?.event || payload?.name || "";
}

function compactTrigger(payload) {
  return payload?.trigger || payload?.compact_trigger || payload?.compaction_trigger || payload?.source || "unknown";
}

function truncate(value, max = 1000) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function summarizeState(state, sourcePath) {
  const checkpoint = state?.active_checkpoint || {};
  return {
    source_path: sourcePath,
    schema_version: state?.schema_version ?? null,
    active: Boolean(state?.active),
    active_capability_id: state?.active_capability_id || null,
    active_checkpoint_id: state?.active_checkpoint_id || null,
    active_checkpoint_title: checkpoint.title || null,
    active_checkpoint_status: checkpoint.status || null,
    active_checkpoint_phase: checkpoint.phase || null,
    active_docs: checkpoint.active_docs || [],
    audit_path: checkpoint.audit_path || checkpoint.previous_checkpoint_audit_path || null,
    context_snapshot_path: checkpoint.context_snapshot_path || null,
    current_slice: {
      id: state?.current_slice?.id || null,
      title: state?.current_slice?.title || null,
      phase: state?.current_slice?.phase || null,
      status: state?.current_slice?.status || null,
    },
    non_goals_until_next_checkpoint:
      checkpoint.non_goals_until_next_checkpoint || checkpoint.active_tranche?.non_goals_until_next_checkpoint || [],
    required_verification: checkpoint.verification_commands || checkpoint.targeted_verification_commands || [],
  };
}

function readTail(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const bytesToRead = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function findSessionPath(sessionId) {
  if (!sessionId) {
    return null;
  }
  const roots = [path.join(CODEX_HOME, "sessions"), path.join(CODEX_HOME, "archived_sessions")];
  for (const root of roots) {
    const found = findFileContaining(root, sessionId, 3000);
    if (found) {
      return found;
    }
  }
  return null;
}

function findFileContaining(root, needle, maxFiles) {
  const stack = [root];
  let seen = 0;
  while (stack.length > 0 && seen < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      seen += 1;
      if (entry.name.includes(needle) && entry.name.endsWith(".jsonl")) {
        return entryPath;
      }
    }
  }
  return null;
}

function extractRecentSessionEvents(sessionPath) {
  const text = readTail(sessionPath);
  if (!text) {
    return [];
  }
  const events = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const entry = parseJson(line, null);
    if (!entry) {
      continue;
    }
    const payload = entry.payload || {};
    const payloadType = payload.type || entry.type;
    if (entry.type === "compacted" || payloadType === "context_compacted") {
      events.push({
        line_type: entry.type,
        payload_type: payloadType,
        timestamp: entry.timestamp || null,
        summary: "context compacted",
      });
      continue;
    }
    if (payloadType === "agent_message") {
      events.push({
        line_type: entry.type,
        payload_type: payloadType,
        timestamp: entry.timestamp || null,
        summary: truncate(payload.message, 700),
      });
      continue;
    }
    if (payloadType === "task_complete") {
      events.push({
        line_type: entry.type,
        payload_type: payloadType,
        timestamp: entry.timestamp || null,
        summary: truncate(payload.last_agent_message, 700),
      });
      continue;
    }
    if (payloadType === "function_call") {
      const args = parseJson(payload.arguments || payload.input || "{}", {});
      events.push({
        line_type: entry.type,
        payload_type: payloadType,
        timestamp: entry.timestamp || null,
        summary: truncate(`${payload.name || "tool"} ${args.cmd || args.command || JSON.stringify(args)}`, 500),
      });
      continue;
    }
    if (payloadType === "function_call_output") {
      events.push({
        line_type: entry.type,
        payload_type: payloadType,
        timestamp: entry.timestamp || null,
        summary: truncate(payload.output, 500),
      });
    }
  }
  return events.slice(-18);
}

function readSessionState(ctx, payload) {
  const state = ctx.session_state ? readJson(ctx.session_state, {}) : {};
  const sessionId = payload?.session_id || payload?.sessionId || state.native_session_id || state.session_id || null;
  const sessionPath = findSessionPath(sessionId);
  return {
    session_id: sessionId,
    session_path: sessionPath,
    recent_events: extractRecentSessionEvents(sessionPath),
  };
}

function gitStatus(cwd, repoName) {
  const status = spawnSync("git", ["status", "--short", "--branch"], {
    cwd,
    encoding: "utf8",
    timeout: 3000,
  });
  return {
    repo: repoName,
    ok: status.status === 0,
    status: truncate(status.stdout || status.stderr, 1000),
  };
}

function listRepoStatuses(ctx) {
  if (fs.existsSync(path.join(ctx.root, ".git"))) {
    return [gitStatus(ctx.root, ctx.name)];
  }

  let entries = [];
  try {
    entries = fs.readdirSync(ctx.root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !ctx.ignored_child_roots.has(entry.name))
    .filter((entry) => fs.existsSync(path.join(ctx.root, entry.name, ".git")))
    .map((entry) => gitStatus(path.join(ctx.root, entry.name), entry.name));
}

function relativeIfExists(ctx, filePath) {
  if (!filePath) {
    return null;
  }
  return fs.existsSync(filePath) ? path.relative(ctx.root, filePath) : null;
}

function relativeProjectPath(ctx, filePath) {
  return path.relative(ctx.root, filePath);
}

function absoluteProjectPath(ctx, relativePath) {
  return path.resolve(ctx.root, relativePath);
}

function existingProjectPath(ctx, relativePath) {
  return relativePath && fs.existsSync(absoluteProjectPath(ctx, relativePath)) ? relativePath : null;
}

function requiredReadPaths(ctx, snapshot) {
  const state = snapshot.state || {};
  const required = [
    relativeProjectPath(ctx, ctx.latest_md),
    relativeProjectPath(ctx, ctx.latest_json),
    relativeIfExists(ctx, ctx.history_rollup_md),
    state.source_path,
    existingProjectPath(ctx, state.audit_path),
    existingProjectPath(ctx, state.context_snapshot_path),
    ...(Array.isArray(state.active_docs) ? state.active_docs.map((doc) => existingProjectPath(ctx, doc)) : []),
  ].filter(Boolean);
  return [...new Set(required)];
}

function factLines(values, maxItems) {
  return values
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => truncate(value, 220))
    .slice(0, maxItems);
}

function buildRollupEntry(snapshot) {
  const state = snapshot.state || {};
  const recentFacts = factLines((snapshot.session?.recent_events || []).map((event) => event.summary), 3);
  const repoFacts = factLines((snapshot.git?.repos || []).map((repo) => `${repo.repo}: ${repo.ok ? repo.status || "clean" : "status unavailable"}`), 2);
  return {
    created_at: snapshot.created_at,
    compact_trigger: snapshot.compact?.trigger || "unknown",
    checkpoint: state.active_checkpoint_id || "unknown",
    title: state.active_checkpoint_title || state.current_slice?.title || "unknown",
    facts: factLines([
      state.active_capability_id ? `Capability: ${state.active_capability_id}` : null,
      state.active_checkpoint_id ? `Checkpoint: ${state.active_checkpoint_id}` : null,
      state.active_checkpoint_title ? `Title: ${state.active_checkpoint_title}` : null,
      state.current_slice?.title ? `Current slice: ${state.current_slice.title}` : null,
      ...recentFacts,
      ...repoFacts,
    ], 8),
  };
}

function loadHistoryRollup(ctx) {
  const value = readJson(ctx.history_rollup_json, null);
  if (!value || !Array.isArray(value.entries)) {
    return {
      schema_version: 1,
      project: ctx.name,
      updated_at: null,
      entries: [],
    };
  }
  return {
    schema_version: 1,
    project: value.project || ctx.name,
    updated_at: value.updated_at || null,
    entries: value.entries.filter((entry) => entry && typeof entry === "object").slice(-MAX_HISTORY_ROLLUP_ENTRIES),
  };
}

function updateHistoryRollup(ctx, snapshot) {
  const previous = loadHistoryRollup(ctx);
  const next = {
    schema_version: 1,
    project: ctx.name,
    updated_at: snapshot.created_at,
    entries: [...previous.entries, buildRollupEntry(snapshot)].slice(-MAX_HISTORY_ROLLUP_ENTRIES),
  };
  writeJsonAtomic(ctx.history_rollup_json, next);
  writeTextAtomic(ctx.history_rollup_md, renderHistoryRollup(next));
  return next;
}

function renderHistoryRollup(rollup) {
  const entries = (rollup.entries || []).map((entry) => {
    const facts = markdownList(entry.facts || []);
    return `### ${entry.created_at || "unknown"} ${entry.compact_trigger || "unknown"}

- Checkpoint: ${entry.checkpoint || "unknown"}
- Title: ${entry.title || "unknown"}

${facts}`;
  });
  return `# Compact Continuity History Rollup

Project: ${rollup.project || "unknown"}
Updated: ${rollup.updated_at || "unknown"}

${entries.length > 0 ? entries.join("\n\n") : "- none"}
`;
}

function buildSnapshot(ctx, payload) {
  const rootStateSource = relativeIfExists(ctx, ctx.root_state);
  const state = summarizeState(readJson(ctx.root_state, {}), rootStateSource);
  const latestMdPath = relativeProjectPath(ctx, ctx.latest_md);
  return {
    schema_version: 2,
    project: ctx.name,
    project_root: ctx.root,
    created_at: nowIso(),
    compact: {
      event: eventName(payload),
      trigger: compactTrigger(payload),
      cwd: payloadCwd(payload),
    },
    state,
    session: readSessionState(ctx, payload),
    git: {
      repos: listRepoStatuses(ctx),
    },
    restore_protocol: [
      `Read ${latestMdPath} before doing any write, test, git, service, or destructive action after compact.`,
      "Read project state, audit, context, and active docs named in latest.md when present.",
      "Continue from the active cursor captured here; do not restart discovery from old transcript memory.",
      "Respect non-goals and user corrections captured in recent session signals.",
    ],
  };
}

function markdownList(values, fallback = "- none") {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function renderHandoff(snapshot) {
  const state = snapshot.state;
  const recent = snapshot.session.recent_events.map((event) => {
    const time = event.timestamp ? `${event.timestamp} ` : "";
    return `${time}${event.payload_type}: ${event.summary}`;
  });
  const repos = snapshot.git.repos.map((repo) => `${repo.repo}: ${repo.ok ? repo.status || "clean" : `status unavailable: ${repo.status}`}`);
  const history = (snapshot.history_rollup?.entries || []).map((entry) => {
    const facts = (entry.facts || []).map((fact) => `  - ${fact}`).join("\n");
    return `- ${entry.created_at || "unknown"} ${entry.title || entry.checkpoint || "unknown"}\n${facts}`;
  });
  const requiredFiles = snapshot.required_read_paths || [];

  return `# Compact Continuity Handoff

Generated: ${snapshot.created_at}
Project: ${snapshot.project}
Project root: ${snapshot.project_root}
Compact trigger: ${snapshot.compact.trigger}
Working directory: ${snapshot.compact.cwd}

## Restore Protocol

${markdownList(snapshot.restore_protocol)}

## Cumulative History Rollup

${markdownList(history)}

## Current Cursor

- Capability: ${state.active_capability_id || "unknown"}
- Checkpoint: ${state.active_checkpoint_id || "unknown"}
- Checkpoint title: ${state.active_checkpoint_title || "unknown"}
- Status: ${state.active_checkpoint_status || "unknown"}
- Phase: ${state.active_checkpoint_phase || "unknown"}
- Current slice: ${state.current_slice.title || state.current_slice.id || "unknown"}

## Required Reads Before Continuing

${markdownList(requiredFiles)}

## Non-goals / Guardrails

${markdownList(state.non_goals_until_next_checkpoint)}

## Required Verification Mentioned By State

${markdownList(state.required_verification)}

## Recent Session Signals

${markdownList(recent)}

## Repo Status Snapshot

${markdownList(repos)}
`;
}

function handlePreCompact(ctx, payload) {
  ensureContinuityGitignore(ctx);
  const snapshot = buildSnapshot(ctx, payload);
  const historyRollup = updateHistoryRollup(ctx, snapshot);
  snapshot.history_rollup = historyRollup;
  snapshot.required_read_paths = requiredReadPaths(ctx, snapshot);
  const compactId = snapshot.created_at.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  const snapshotPath = path.join(ctx.snapshots_dir, `${compactId}.json`);
  writeJsonAtomic(snapshotPath, snapshot);
  writeJsonAtomic(ctx.latest_json, { ...snapshot, snapshot_path: snapshotPath });
  writeTextAtomic(ctx.latest_md, renderHandoff({ ...snapshot, snapshot_path: snapshotPath }));
}

function requiredFirstReads(ctx, latest) {
  if (Array.isArray(latest.required_read_paths) && latest.required_read_paths.length > 0) {
    return [...new Set(latest.required_read_paths)];
  }
  return requiredReadPaths(ctx, latest).length > 0 ? requiredReadPaths(ctx, latest) : [
    relativeProjectPath(ctx, ctx.latest_md),
    relativeProjectPath(ctx, ctx.latest_json),
    latest.state?.source_path || null,
  ].filter(Boolean);
}

function handlePostCompact(ctx, payload) {
  if (!fs.existsSync(ctx.latest_json)) {
    handlePreCompact(ctx, payload);
  }
  const latest = readJson(ctx.latest_json, {});
  writeJsonAtomic(ctx.restore_sentinel, {
    schema_version: 1,
    project: ctx.name,
    project_root: ctx.root,
    created_at: nowIso(),
    compact_trigger: compactTrigger(payload),
    restored: false,
    latest_markdown: path.relative(ctx.root, ctx.latest_md),
    latest_json: path.relative(ctx.root, ctx.latest_json),
    active_checkpoint_id: latest.state?.active_checkpoint_id || null,
    required_first_reads: requiredFirstReads(ctx, latest),
    observed_reads: [],
    missing_reads: requiredFirstReads(ctx, latest),
  });
}

function toolName(payload) {
  return payload?.tool_name || payload?.toolName || payload?.tool || payload?.name || "";
}

function toolInput(payload) {
  return payload?.tool_input || payload?.toolInput || payload?.input || payload?.arguments || {};
}

function commandFromToolInput(input) {
  if (typeof input === "string") {
    const parsed = parseJson(input, null);
    return parsed?.cmd || parsed?.command || input;
  }
  return input?.cmd || input?.command || input?.shell_command || "";
}

function readRestoreSentinel(ctx) {
  return readJson(ctx.restore_sentinel, null);
}

function restoreRequiredReadPaths(ctx, sentinel = readRestoreSentinel(ctx)) {
  if (Array.isArray(sentinel?.required_first_reads) && sentinel.required_first_reads.length > 0) {
    return [...new Set(sentinel.required_first_reads)];
  }
  const latest = readJson(ctx.latest_json, {});
  return requiredFirstReads(ctx, latest);
}

function restoreObservedReads(sentinel) {
  return Array.isArray(sentinel?.observed_reads) ? [...new Set(sentinel.observed_reads)] : [];
}

function restoreMissingReads(ctx, sentinel = readRestoreSentinel(ctx)) {
  const observed = new Set(restoreObservedReads(sentinel));
  return restoreRequiredReadPaths(ctx, sentinel).filter((requiredPath) => !observed.has(requiredPath));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathReferenceVariants(ctx, requiredPath) {
  return [
    requiredPath,
    `./${requiredPath}`,
    absoluteProjectPath(ctx, requiredPath),
  ].filter(Boolean);
}

function textMentionsPathReference(text, reference) {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_./-])${escapeRegex(reference)}($|[^A-Za-z0-9_./-])`);
  return pattern.test(String(text || ""));
}

function mentionedReadPaths(ctx, requiredPaths, evidenceText) {
  const text = String(evidenceText || "");
  return requiredPaths.filter((requiredPath) =>
    pathReferenceVariants(ctx, requiredPath).some((reference) => textMentionsPathReference(text, reference)),
  );
}

function updateRestoreProgress(ctx, readEvidence) {
  const sentinel = readRestoreSentinel(ctx);
  if (!sentinel) {
    return false;
  }
  const required = restoreRequiredReadPaths(ctx, sentinel);
  const observed = new Set(restoreObservedReads(sentinel));
  for (const readPath of mentionedReadPaths(ctx, required, readEvidence)) {
    observed.add(readPath);
  }
  const observedReads = [...observed];
  const missingReads = required.filter((requiredPath) => !observed.has(requiredPath));
  writeJsonAtomic(path.join(ctx.continuity_dir, "last-restore-ack.json"), {
    acknowledged_at: nowIso(),
    read_evidence: truncate(readEvidence, 1000),
    observed_reads: observedReads,
    missing_reads: missingReads,
  });
  if (missingReads.length === 0) {
    safeUnlink(ctx.restore_sentinel);
    return true;
  }
  writeJsonAtomic(ctx.restore_sentinel, {
    ...sentinel,
    observed_reads: observedReads,
    missing_reads: missingReads,
  });
  return false;
}

function isReadOfContinuity(ctx, command, candidatePaths = restoreRequiredReadPaths(ctx)) {
  const text = String(command || "").trim();
  if (!/^(cat|sed|rg|head|tail|jq|nl|wc)\b/.test(text)) {
    return false;
  }
  if (/[;&|<>]/.test(text)) {
    return false;
  }
  return mentionedReadPaths(ctx, candidatePaths, text).length > 0;
}

function isShellToolName(name) {
  return name === "Bash" || name === "exec_command" || name === "functions.exec_command" || name === "";
}

function isReadOnlyToolName(name) {
  const normalized = String(name || "").toLowerCase();
  const leaf = normalized.split(/[:.]/).pop().split("__").pop();
  return [
    "read",
    "read_file",
    "readfile",
    "read_mcp_resource",
    "view_file",
    "viewfile",
  ].includes(leaf);
}

function collectPathLikeValues(value, results = []) {
  if (typeof value === "string") {
    results.push(value);
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathLikeValues(item, results);
    }
    return results;
  }
  if (!value || typeof value !== "object") {
    return results;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/^(path|paths|file|files|file_path|filePath|filename|uri)$/i.test(key)) {
      collectPathLikeValues(nested, results);
    }
  }
  return results;
}

function restoreReadEvidence(ctx, payload, candidatePaths = restoreRequiredReadPaths(ctx)) {
  const name = toolName(payload);
  const input = toolInput(payload);
  const command = commandFromToolInput(input);
  if (isShellToolName(name) && isReadOfContinuity(ctx, command, candidatePaths)) {
    return command;
  }
  if (!isReadOnlyToolName(name)) {
    return null;
  }
  const evidence = collectPathLikeValues(input).join("\n");
  return mentionedReadPaths(ctx, candidatePaths, evidence).length > 0 ? evidence : null;
}

function handlePreToolUse(ctx, payload) {
  const sentinel = readRestoreSentinel(ctx);
  if (!sentinel) {
    return;
  }
  const missingReads = restoreMissingReads(ctx, sentinel);
  if (missingReads.length === 0) {
    safeUnlink(ctx.restore_sentinel);
    return;
  }
  if (restoreReadEvidence(ctx, payload, missingReads)) {
    return;
  }
  const requiredReads = missingReads.map((value) => `\`${value}\``).join(", ");
  const message = [
    `${ctx.name} compact continuity restore is required before continuing.`,
    `Still missing required reads: ${requiredReads}.`,
    "Until that read is observed, writes, tests, git operations, service starts, and other non-restore tools are blocked.",
  ].join(" ");
  jsonOut({
    decision: "block",
    reason: message,
    systemMessage: message,
  });
  process.exit(0);
}

function toolSucceeded(payload) {
  const response = payload?.tool_response || payload?.toolResponse || payload?.response || payload?.result || {};
  const code = response.exit_code ?? response.exitCode ?? response.status ?? response.code;
  return code === undefined || code === 0 || code === "0";
}

function handlePostToolUse(ctx, payload) {
  if (!readRestoreSentinel(ctx)) {
    return;
  }
  if (!toolSucceeded(payload)) {
    return;
  }
  const evidence = restoreReadEvidence(ctx, payload);
  if (evidence) {
    updateRestoreProgress(ctx, evidence);
  }
}

async function main() {
  const payload = parseJson(await readStdin(), {});
  const project = resolveProject(payloadCwd(payload));
  if (!project) {
    jsonOut();
    return;
  }
  const ctx = projectContext(project);

  switch (eventName(payload)) {
    case "PreCompact":
      handlePreCompact(ctx, payload);
      break;
    case "PostCompact":
      handlePostCompact(ctx, payload);
      break;
    case "PreToolUse":
      handlePreToolUse(ctx, payload);
      break;
    case "PostToolUse":
      handlePostToolUse(ctx, payload);
      break;
    default:
      break;
  }
  jsonOut();
}

main().catch((error) => {
  process.stderr.write(`[compact-continuity] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
