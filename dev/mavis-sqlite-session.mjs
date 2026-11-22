import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const dbPath = "C:\\Users\\D\\.minimax\\v2\\sqlite\\runtime-state.sqlite";
const sid = process.argv[2] || "mvs_7ac968d537334b5d9d587015fbfd2c3b";
const db = new DatabaseSync(dbPath, { readOnly: true });
const row = db.prepare("SELECT * FROM local_runtime_sessions WHERE session_id = ?").get(sid);
if (!row) { console.log("NO SESSION ROW " + sid); process.exit(0); }
console.log("=== session columns ===");
for (const k of Object.keys(row)) { if (k === "record_json") continue; console.log(k + " = " + (row[k] === null ? "NULL" : String(row[k]))); }
let rec = {};
try { rec = JSON.parse(row.record_json); } catch (e) { console.log("record_json parse fail: " + e.message); }
console.log("=== record_json top keys ===");
console.log(Object.keys(rec).join(", "));
console.log("=== record_json workspace-related paths ===");
const walk = (obj, prefix, depth) => {
  if (depth > 5 || !obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + "." + k : k;
    if (/workspace|dir|path|project/i.test(k)) console.log(p + " = " + (typeof v === "object" ? JSON.stringify(v).slice(0, 400) : String(v)));
    else if (v && typeof v === "object") walk(v, p, depth + 1);
  }
};
walk(rec, "", 0);
console.log("=== agents table ===");
for (const a of db.prepare("SELECT * FROM local_runtime_agents").all()) {
  let ar = {}; try { ar = JSON.parse(a.record_json); } catch (e) {}
  console.log("agent " + a.name + " -> " + JSON.stringify(ar).slice(0, 600));
}
console.log("=== agents (legacy table) ===");
for (const a of db.prepare("SELECT agent_name, main_session_id, source_project, framework_type FROM agents").all()) console.log(JSON.stringify(a));
console.log("=== projects ===");
for (const p of db.prepare("SELECT * FROM local_runtime_projects").all()) console.log(JSON.stringify(p));
