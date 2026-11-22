import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const dbPath = "C:\\Users\\D\\.minimax\\v2\\sqlite\\runtime-state.sqlite";
const sid = process.argv[2] || "mvs_7ac968d537334b5d9d587015fbfd2c3b";
const TARGET = "C:\\Users\\D\\mavis-fantasy-grinder";
const TARGET_SLASH = "C:/Users/D/mavis-outlier";

const backup = dbPath + ".bak-before-workspace-rebind-" + Date.now();
fs.copyFileSync(dbPath, backup);
console.log("BACKUP " + backup);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 8000");

const before = db.prepare("SELECT workspace_dir, project_workspace_dir, project_id FROM local_runtime_sessions WHERE session_id = ?").get(sid);
console.log("BEFORE " + JSON.stringify(before));

const ftsBefore = db.prepare("SELECT * FROM local_runtime_sessions_fts WHERE session_id = ?").get(sid);
console.log("FTS_BEFORE " + JSON.stringify(ftsBefore));
const idxBefore = db.prepare("SELECT session_id, workspace_id, workspace_real_path FROM local_runtime_workspace_indexing_sessions WHERE session_id = ?").get(sid);
console.log("INDEXING_BEFORE " + JSON.stringify(idxBefore));

// 1. project row for the mavis folder
let proj = db.prepare("SELECT project_id FROM local_runtime_projects WHERE workspace_dir = ?").get(TARGET);
if (!proj) {
  const now = Date.now();
  db.prepare(
    "INSERT INTO local_runtime_projects (project_kind, workspace_dir, pinned, hidden, order_index, recent_at_ms, latest_activity_at_ms, session_count, extra_data_json, created_at_ms, updated_at_ms, display_name)" +
    " VALUES ('workspace', ?, 1, 0, ?, ?, ?, 0, '{}', ?, ?, ?)"
  ).run(TARGET, 2147483647, now, now, now, now, "mavis-fantasy-grinder");
  proj = db.prepare("SELECT project_id FROM local_runtime_projects WHERE workspace_dir = ?").get(TARGET);
  console.log("CREATED_PROJECT " + proj.project_id);
} else {
  db.prepare("UPDATE local_runtime_projects SET pinned = 1, updated_at_ms = ? WHERE project_id = ?").run(Date.now(), proj.project_id);
  console.log("EXISTING_PROJECT " + proj.project_id);
}

// 2. the session itself
db.prepare("UPDATE local_runtime_sessions SET workspace_dir = ?, project_workspace_dir = ?, project_id = ?, is_default_workspace = 0 WHERE session_id = ?")
  .run(TARGET_SLASH, TARGET, proj.project_id, sid);

const row = db.prepare("SELECT record_json FROM local_runtime_sessions WHERE session_id = ?").get(sid);
const rec = JSON.parse(row.record_json);
rec.workspaceDir = TARGET_SLASH;
db.prepare("UPDATE local_runtime_sessions SET record_json = ? WHERE session_id = ?").run(JSON.stringify(rec), sid);

// 3. keep the search index in step
if (ftsBefore) {
  const terms = ftsBefore.workspace_dir_terms.replace(/collider_flutter_ARGON_8474/gi, "mavis-fantasy-grinder");
  try {
    db.prepare("UPDATE local_runtime_sessions_fts SET workspace_dir_terms = ? WHERE session_id = ?").run(terms, sid);
    console.log("FTS_UPDATED");
  } catch (e) { console.log("FTS_FAIL " + e.message); }
}

// 4. workspace indexing rows
if (idxBefore) {
  try {
    db.prepare("UPDATE local_runtime_workspace_indexing_sessions SET workspace_id = ?, workspace_real_path = ? WHERE session_id = ?")
      .run(TARGET, TARGET, sid);
    console.log("INDEXING_UPDATED");
  } catch (e) { console.log("INDEXING_FAIL " + e.message); }
}

// 5. project session counter
db.prepare("UPDATE local_runtime_projects SET session_count = (SELECT COUNT(*) FROM local_runtime_sessions WHERE project_id = ?), updated_at_ms = ? WHERE project_id = ?")
  .run(proj.project_id, Date.now(), proj.project_id);

const after = db.prepare("SELECT session_id, workspace_dir, project_workspace_dir, project_id, is_default_workspace, title FROM local_runtime_sessions WHERE session_id = ?").get(sid);
console.log("AFTER " + JSON.stringify(after));
const recAfter = JSON.parse(db.prepare("SELECT record_json FROM local_runtime_sessions WHERE session_id = ?").get(sid).record_json);
console.log("AFTER_RECORD_WORKSPACE " + recAfter.workspaceDir);
const ftsAfter = db.prepare("SELECT workspace_dir_terms FROM local_runtime_sessions_fts WHERE session_id = ?").get(sid);
console.log("FTS_AFTER " + JSON.stringify(ftsAfter));
db.close();
