import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../src/compact-continuity.mjs", import.meta.url));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "continuity-brief-")));
const project = path.join(root, "project with spaces");
const codex = path.join(root, "codex");
const projects = path.join(root, "projects.json");
fs.mkdirSync(project, {recursive:true});
fs.mkdirSync(path.join(codex, "sessions"), {recursive:true});
fs.writeFileSync(projects, JSON.stringify({projects:[{name:"Fixture",root:project}]}));
const env = {...process.env, COMPACT_CONTINUITY_CODEX_HOME:codex, COMPACT_CONTINUITY_PROJECTS_FILE:projects};
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const base = path.join(project, ".codex-compact-continuity");
const dir = (id) => path.join(base,"sessions",id);
const read = (id, file) => JSON.parse(fs.readFileSync(path.join(dir(id),file),"utf8"));
const events = (id, entries) => fs.appendFileSync(path.join(codex,"sessions",`rollout-${id}.jsonl`),entries.map(x=>JSON.stringify(x)).join("\n")+"\n");
const request = (text, timestamp) => ({type:"event_msg",timestamp,payload:{type:"user_message",message:text}});
function run(id,event,extra={},args=[]) {
  const r=spawnSync(process.execPath,[source,...args],{cwd:project,env,encoding:"utf8",input:JSON.stringify({cwd:project,session_id:id,hook_event_name:event,...extra})});
  assert.equal(r.status,0,r.stderr);
  return JSON.parse(r.stdout);
}
const gate = (id, command) => run(id,"PreToolUse",{tool_name:"Bash",tool_input:{command}});
const ack = (id, command, exit_code=0) => run(id,"PostToolUse",{tool_name:"Bash",tool_input:{command},tool_response:{exit_code}});
const command = (id) => `Get-Content -LiteralPath '${path.join(dir(id),"latest.md")}'`;
const brief = {goal:"Improve continuity",work_in_progress:"Test session isolation",completed:[{summary:"Prior gate works",evidence:"Recorded successful restore"}],pending:["Verify new compaction"],decisions:["Keep native compact"],dead_ends:["Unquoted invocation failed in PowerShell"],assumptions:[{claim:"Hook delivery unchanged",verify_with:"Run real compact and inspect acknowledgment"}],constraints:["No application source edits"],next_step:"Run isolated regression tests",last_request_status:"partially_answered"};

events(A,[request("طوّر الأداة", "2026-10-24T10:00:00Z"), ...Array.from({length:30},(_,i)=>({type:"response_item",payload:{type:"function_call",name:"exec_command",arguments:JSON.stringify({cmd:`echo ${i}`})}}))]);
events(B,[{type:"response_item",timestamp:"2026-10-24T10:01:00Z",payload:{type:"message",role:"user",content:[{type:"input_text",text:"Independent task B"}]}}]);
events(A,[{type:"response_item",payload:{type:"custom_tool_call",name:"functions.exec",input:"latest_custom_command"}},{type:"response_item",payload:{type:"custom_tool_call_output",output:"latest_custom_result"}}]);
run(A,"",{brief},["--write-brief"]);
run(A,"PreCompact",{trigger:"manual"});
run(B,"PreCompact",{trigger:"auto"});
assert.equal(read(A,"latest.json").brief.freshness,"current_request");
assert.equal(read(A,"latest.json").brief.last_user_request.text,"طوّر الأداة");
assert.equal(read(A,"latest.json").brief.completed[0].evidence,brief.completed[0].evidence);
assert.match(read(A,"latest.json").session.recent_events.at(-1).summary,/latest_custom_result/);
assert.equal(read(A,"history_rollup.json").entries[0].title,brief.goal);
assert.equal(read(B,"latest.json").brief.source,"facts_only");
assert.equal(read(B,"latest.json").brief.last_user_request.text,"Independent task B");
assert.equal(read(B,"history_rollup.json").entries.length,1);
assert.equal(fs.existsSync(path.join(base,"latest.json")),false,"No shared latest alias is written");

run(A,"PostCompact");
assert.equal(gate(A,"Get-Date").decision,"block");
assert.equal(gate(B,"Get-Date").decision,undefined,"A cannot block B");
run(B,"PostCompact");
assert.equal(gate(A,command(B)).decision,"block","Cannot acknowledge a different session");
ack(A,command(B));
assert.equal(fs.existsSync(path.join(dir(A),"needs-restore.json")),true);
ack(A,command(A),1);
assert.equal(fs.existsSync(path.join(dir(A),"needs-restore.json")),true,"Failed reads do not clear");
assert.equal(gate(A,command(A)).decision,undefined);
ack(A,command(A));
assert.equal(read(A,"last-restore-ack.json").session_id,A);
assert.equal(fs.existsSync(path.join(dir(A),"needs-restore.json")),false);
assert.equal(fs.existsSync(path.join(dir(B),"needs-restore.json")),true,"A cannot clear B");
ack(B,command(B));
const notice=ack(A,"Get-Date");
assert.equal(notice.hookSpecificOutput,undefined,"No repeated same-session reminders");
const turnNotice=run(A,"PostToolUse",{turn_id:"next-turn",tool_response:{exit_code:0}});
assert.match(turnNotice.hookSpecificOutput.additionalContext,/--write-brief/);
assert.equal(run(A,"PostToolUse",{turn_id:"next-turn",tool_response:{exit_code:0}}).hookSpecificOutput,undefined);

events(A,[request("توقف عن التعديل واكتف بالفحص", "2026-10-24T10:02:00Z"),request("<environment_context>generated</environment_context>","2026-10-24T10:03:00Z")]);
run(A,"PreCompact");
assert.equal(read(A,"latest.json").brief.freshness,"stale_new_user_request");
assert.equal(read(A,"latest.json").brief.last_request_status,"unknown");
assert.equal(read(A,"latest.json").brief.last_user_request.text,"توقف عن التعديل واكتف بالفحص");
const handoff=fs.readFileSync(path.join(dir(A),"latest.md"),"utf8");
assert.match(handoff,/Structured Brief/);
assert.match(handoff,/stale_new_user_request/);
assert.match(handoff,/evidence: Recorded successful restore/);
const snapshot=read(A,"latest.json");
const sort=(v)=>Array.isArray(v)?v.map(sort):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const {digest,...envelope}=snapshot.handoff_envelope;
assert.equal(digest,"sha256:"+crypto.createHash("sha256").update(JSON.stringify(sort(envelope))).digest("hex"));
assert.equal(envelope.structured_brief.freshness,"stale_new_user_request");

// Repeated identical user requests must still mark old brief state as stale.
run(A,"",{brief},["--write-brief"]);
events(A,[request("توقف عن التعديل واكتف بالفحص", "2026-10-24T10:04:00Z")]);
run(A,"PreCompact");
assert.equal(read(A,"latest.json").brief.freshness,"stale_new_user_request");
fs.writeFileSync(path.join(dir(A),"brief.json"),'{"schema_version":1,"session_id":"'+A+'","completed":"invalid"}');
run(A,"PreCompact");
assert.equal(read(A,"latest.json").brief.source,"facts_only","Malformed brief must not break compact");
const invalid=spawnSync(process.execPath,[source,"--write-brief"],{cwd:project,env,encoding:"utf8",input:JSON.stringify({cwd:project,session_id:A,brief:{...brief,completed:[{summary:"No evidence"}]}})});
assert.notEqual(invalid.status,0,"Completed claims need evidence");
run("../unsafe/session","PreCompact");
const unsafeKey="s-"+crypto.createHash("sha256").update("../unsafe/session").digest("hex");
assert.equal(fs.existsSync(path.join(base,"sessions",unsafeKey,"latest.json")),true);
assert.equal(fs.existsSync(path.join(project,"unsafe")),false);

// Test the actual Windows invocation, including source and workspace paths with spaces.
if(process.platform==="win32") {
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const ps=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`& ${quote(process.execPath)} ${quote(source)}`],{cwd:project,env,encoding:"utf8",input:JSON.stringify({cwd:project,session_id:B,hook_event_name:"PreCompact",trigger:"manual"})});
  assert.equal(ps.status,0,ps.stderr);
  assert.equal(read(B,"latest.json").session.session_id,B);
}
console.log("brief freshness, evidence, fallback, per-session gates, notices, path safety and PowerShell tests passed");
