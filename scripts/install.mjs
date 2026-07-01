#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL(import.meta.url).pathname, "..", "..");
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const targetDir = path.join(codexHome, "hooks", "compact-continuity");
const hooksPath = path.join(codexHome, "hooks.json");

function usage() {
  return `Usage:
  node scripts/install.mjs --project Name=/absolute/project/root [--ignore Name=child-dir]

Options:
  --project Name=/path     Add or replace a configured project. Repeatable.
  --ignore Name=child      Ignore a child directory under a project. Repeatable.
  --node /path/to/node     Node path used in hooks.json. Defaults to current Node.
  --dry-run                Print planned changes without writing.
  --help                   Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    projects: [],
    ignores: [],
    nodePath: process.execPath,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--node") {
      options.nodePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--project") {
      options.projects.push(parseAssignment(argv[index + 1], "--project"));
      index += 1;
      continue;
    }
    if (arg === "--ignore") {
      options.ignores.push(parseAssignment(argv[index + 1], "--ignore"));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  return options;
}

function parseAssignment(value, flag) {
  if (!value || !value.includes("=")) {
    throw new Error(`${flag} expects Name=/path style input`);
  }
  const [name, ...rest] = value.split("=");
  const assigned = rest.join("=");
  if (!name.trim() || !assigned.trim()) {
    throw new Error(`${flag} expects non-empty name and value`);
  }
  return {
    name: name.trim(),
    value: assigned.trim(),
  };
}

function shellQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function copyFile(name, mode = 0o755) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, name), path.join(targetDir, path.basename(name)));
  fs.chmodSync(path.join(targetDir, path.basename(name)), mode);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function backupHooks() {
  if (!fs.existsSync(hooksPath)) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
  const backupPath = `${hooksPath}.bak-compact-continuity-${stamp}`;
  fs.copyFileSync(hooksPath, backupPath);
  return backupPath;
}

function eventHasCommand(eventEntries, expectedCommand) {
  return eventEntries.some((group) =>
    (group.hooks || []).some((hook) => hook.type === "command" && hook.command === expectedCommand),
  );
}

function removeCommandHooksForScript(hooksConfig, scriptPath) {
  hooksConfig.hooks ||= {};
  let changed = false;
  for (const [eventName, eventEntries] of Object.entries(hooksConfig.hooks)) {
    if (!Array.isArray(eventEntries)) {
      continue;
    }
    hooksConfig.hooks[eventName] = eventEntries
      .map((group) => {
        const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
        const filteredHooks = hooks.filter((hook) => !(hook.type === "command" && String(hook.command || "").includes(scriptPath)));
        if (filteredHooks.length !== hooks.length) {
          changed = true;
        }
        return {
          ...group,
          hooks: filteredHooks,
        };
      })
      .filter((group) => (group.hooks || []).length > 0);
  }
  return changed;
}

function ensureEvent(hooksConfig, command, eventName, matcher, timeout, statusMessage) {
  hooksConfig.hooks ||= {};
  hooksConfig.hooks[eventName] ||= [];
  if (eventHasCommand(hooksConfig.hooks[eventName], command)) {
    return false;
  }
  hooksConfig.hooks[eventName].push({
    matcher,
    hooks: [
      {
        type: "command",
        command,
        timeout,
        statusMessage,
      },
    ],
  });
  return true;
}

function buildProjectsConfig(options) {
  if (options.projects.length === 0) {
    return null;
  }
  const ignoresByProject = new Map();
  for (const ignore of options.ignores) {
    const current = ignoresByProject.get(ignore.name) || [];
    current.push(ignore.value);
    ignoresByProject.set(ignore.name, current);
  }
  return {
    projects: options.projects.map((project) => ({
      name: project.name,
      root: path.resolve(project.value),
      ignored_child_roots: ignoresByProject.get(project.name) || [],
      continuity_path: ".codex-compact-continuity",
    })),
  };
}

function projectEntries(config) {
  if (Array.isArray(config)) {
    return config;
  }
  if (Array.isArray(config?.projects)) {
    return config.projects;
  }
  return [];
}

function mergeProjectsConfig(existingConfig, incomingConfig) {
  if (!incomingConfig) {
    return existingConfig;
  }
  const existing = projectEntries(existingConfig);
  const incoming = projectEntries(incomingConfig);
  const incomingByName = new Map(incoming.map((project) => [String(project.name), project]));
  const replaced = new Set();
  const projects = existing.map((project) => {
    const name = String(project?.name || "");
    if (incomingByName.has(name)) {
      replaced.add(name);
      return incomingByName.get(name);
    }
    return project;
  });
  for (const project of incoming) {
    const name = String(project.name);
    if (!replaced.has(name)) {
      projects.push(project);
    }
  }
  return { projects };
}

function install(options) {
  if (options.help) {
    console.log(usage());
    return;
  }

  const hookScriptPath = path.join(targetDir, "compact-continuity.mjs");
  const command = `${shellQuote(options.nodePath)} ${shellQuote(hookScriptPath)}`;
  const projectsConfig = buildProjectsConfig(options);
  const projectsPath = path.join(targetDir, "projects.json");
  const existingProjectsConfig = readJson(projectsPath, { projects: [] });
  const mergedProjectsConfig = projectsConfig ? mergeProjectsConfig(existingProjectsConfig, projectsConfig) : null;
  const hooksConfig = readJson(hooksPath, { hooks: {} });

  const removedExistingCompactHooks = removeCommandHooksForScript(hooksConfig, hookScriptPath);
  const changedHooks = [
    ensureEvent(hooksConfig, command, "PreCompact", "auto|manual", 30, "Saving compact continuity handoff"),
    ensureEvent(hooksConfig, command, "PostCompact", "auto|manual", 10, "Arming compact continuity restore gate"),
    ensureEvent(hooksConfig, command, "PreToolUse", ".*", 5, "Checking compact continuity restore gate"),
    ensureEvent(hooksConfig, command, "PostToolUse", ".*", 5, "Clearing compact continuity restore gate"),
  ].some(Boolean) || removedExistingCompactHooks;

  if (options.dryRun) {
    console.log(JSON.stringify({
      target_dir: targetDir,
      hooks_path: hooksPath,
      command,
      projects_config: mergedProjectsConfig || "preserve existing or copy example",
      hooks_changed: changedHooks,
    }, null, 2));
    return;
  }

  copyFile(path.join("src", "compact-continuity.mjs"), 0o755);
  copyFile(path.join("test", "compact-continuity.test.mjs"), 0o755);
  copyFile("README.md", 0o644);
  copyFile("AI_INSTALL.md", 0o644);
  copyFile("projects.example.json", 0o644);

  let projectsConfigMode = "preserved";
  if (mergedProjectsConfig) {
    writeJson(projectsPath, mergedProjectsConfig);
    projectsConfigMode = "merged from --project";
  } else if (!fs.existsSync(projectsPath)) {
    fs.copyFileSync(path.join(repoRoot, "projects.example.json"), projectsPath);
    projectsConfigMode = "created from example";
  }

  let hooksBackup = null;
  if (changedHooks) {
    hooksBackup = backupHooks();
    writeJson(hooksPath, hooksConfig);
  }

  console.log(JSON.stringify({
    installed_to: targetDir,
    hooks_path: hooksPath,
    hooks_backup: hooksBackup,
    hooks_changed: changedHooks,
    projects_config: projectsPath,
    projects_config_mode: projectsConfigMode,
    active_command: command,
    next_step: "Open /hooks in Codex and trust the compact continuity hook.",
  }, null, 2));
}

try {
  install(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
