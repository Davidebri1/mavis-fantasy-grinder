import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
const DB = "C:\\Users\\D\\.minimax\\v2\\sqlite\\runtime-state.sqlite";
const SID = "mvs_7ac968d537334b5d9d587015fbfd2c3b";
const db = new DatabaseSync(DB, { readOnly: true });
const row = db.prepare("SELECT extra_data_json, record_json FROM local_runtime_sessions WHERE session_id = ?").get(SID);
db.close();
const findings = [];
const walk = (obj, trail) => {
  if (obj === null || obj === undefined) return;
  if (typeof obj === "string") { if (/collider_flutter_ARGON_8474/i.test(obj)) findings.push({ path: trail, value: obj.slice(0, 300) }); return; }
  if (typeof obj !== "object") return;
  for (const k of Object.keys(obj)) walk(obj[k], trail + "." + k);
};
let extra = null;
try { extra = JSON.parse(row.extra_data_json); } catch (e) { extra = { parseError: String(e) }; }
walk(extra, "extra_data_json");
walk(JSON.parse(row.record_json), "record_json");
const extraKeys = [];
const collect = (o, trail, depth) => {
  if (!o || typeof o !== "object" || depth > 3) return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    extraKeys.push(trail + "." + k + " = " + (v && typeof v === "object" ? "[obj]" : String(v).slice(0, 140)));
    if (v && typeof v === "object") collect(v, trail + "." + k, depth + 1);
  }
};
collect(extra, "extra", 0);
const histRoot = "C:\\Users\\D\\.minimax\\v2\\sessions";
const histHits = [];
const walkDir = (dir, depth) => {
  if (depth > 4) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "reports" && e.name !== "tool-outputs") walkDir(p, depth + 1); continue; }
    if (!/\.(json|jsonl|yaml|yml)$/i.test(e.name)) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.size > 4 * 1024 * 1024) continue;
    let s; try { s = fs.readFileSync(p, "utf8"); } catch { continue; }
    if (/collider_flutter_ARGON_8474/i.test(s)) {
      const m = s.match(/.{0,140}collider_flutter_ARGON_8474.{0,140}/i);
      histHits.push({ file: p, size: st.size, snippet: m ? m[0].replace(/\s+/g, " ") : "" });
    }
  }
};
walkDir(histRoot, 0);
console.log(JSON.stringify({ extraColliderFindings: findings, extraKeys: extraKeys.slice(0, 90), historyHitCount: histHits.length, historyHits: histHits.slice(0, 25) }, null, 1));