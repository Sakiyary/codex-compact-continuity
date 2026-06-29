#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL(import.meta.url).pathname, "..", "..");
const installPath = path.join(root, "scripts", "install.mjs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runInstall(codexHome, args) {
  return spawnSync(process.execPath, [installPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
    },
  });
}

function commandCount(hooksConfig, eventName) {
  return (hooksConfig.hooks?.[eventName] || [])
    .flatMap((group) => group.hooks || [])
    .filter((hook) => hook.type === "command" && /compact-continuity\.mjs/.test(hook.command || ""))
    .length;
}

const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "compact-continuity-install-")));
const codexHome = path.join(tempRoot, "codex-home");
const alphaRoot = path.join(tempRoot, "alpha");
const betaRoot = path.join(tempRoot, "beta");
const alphaMovedRoot = path.join(tempRoot, "alpha-moved");
fs.mkdirSync(alphaRoot, { recursive: true });
fs.mkdirSync(betaRoot, { recursive: true });
fs.mkdirSync(alphaMovedRoot, { recursive: true });

const firstInstall = runInstall(codexHome, [
  "--project", `Alpha=${alphaRoot}`,
  "--ignore", "Alpha=frontend",
]);
assert.equal(firstInstall.status, 0, firstInstall.stderr);

const secondInstall = runInstall(codexHome, [
  "--project", `Beta=${betaRoot}`,
]);
assert.equal(secondInstall.status, 0, secondInstall.stderr);

const thirdInstall = runInstall(codexHome, [
  "--project", `Alpha=${alphaMovedRoot}`,
  "--ignore", "Alpha=docs",
]);
assert.equal(thirdInstall.status, 0, thirdInstall.stderr);

const projectsPath = path.join(codexHome, "hooks", "compact-continuity", "projects.json");
const projectsConfig = readJson(projectsPath);
assert.equal(projectsConfig.projects.length, 2);
assert.deepEqual(projectsConfig.projects.map((project) => project.name), ["Alpha", "Beta"]);

const alpha = projectsConfig.projects.find((project) => project.name === "Alpha");
const beta = projectsConfig.projects.find((project) => project.name === "Beta");
assert.equal(alpha.root, alphaMovedRoot);
assert.deepEqual(alpha.ignored_child_roots, ["docs"]);
assert.equal(alpha.continuity_path, ".codex-compact-continuity");
assert.equal(beta.root, betaRoot);
assert.deepEqual(beta.ignored_child_roots, []);
assert.equal(beta.continuity_path, ".codex-compact-continuity");

const hooksConfig = readJson(path.join(codexHome, "hooks.json"));
for (const eventName of ["PreCompact", "PostCompact", "PreToolUse", "PostToolUse"]) {
  assert.equal(commandCount(hooksConfig, eventName), 1, `${eventName} should have one compact-continuity command`);
}

console.log("install tests passed");
