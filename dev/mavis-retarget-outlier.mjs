// One-shot workspace migration record (2026-11-22).
// Rebinds the local runtime session and project from
// C:\Users\D\mavis-fantasy-grinder to C:\Users\D\mavis-outlier.
// Already applied: the old project row was merged and deleted, so
// re-running finds nothing to merge and only rewrites the same rows.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const OLD = "C:\\Users\\D\\mavis-fantasy-grinder";
const NEW = "C:\\Users\\D\\mavis-outlier";
const OLD_SLASH = "C:/Users/D/mavis-fantasy-grinder";
const NEW_SLASH = "C:/Users/D/mavis-outlier";
const DB = "C:\\Users\\D\\.minimax\\v2\\sqlite\\runtime-state.sqlite";
const db = new DatabaseSync(DB);
db.exec("PRAGMA busy_timeout = 8000");
const projects = db.prepare("SELECT project_id, workspace_dir, display_name, pinned, session_count FROM local_runtime_projects WHERE workspace_dir IN (?, ?)").all(OLD, NEW);
console.log("PROJECTS " + JSON.stringify(projects));
const newProj = projects.find(p => p.workspace_dir === NEW);
const oldProj = projects.find(p => p.workspace_dir === OLD);
if (newProj && oldProj) {
  db.prepare("UPDATE local_runtime_sessions SET project_id = ? WHERE project_id = ?").run(newProj.project_id, oldProj.project_id);
  db.prepare("DELETE FROM local_runtime_projects WHERE project_id = ?").run(oldProj.project_id);
  console.log("MERGED old_project " + oldProj.project_id + " -> " + newProj.project_id);
}
db.prepare("UPDATE local_runtime_projects SET display_name = ?, pinned = 1, updated_at_ms = ? WHERE workspace_dir = ?").run("mavis-outlier", Date.now(), NEW);
db.prepare("UPDATE local_runtime_projects SET session_count = (SELECT COUNT(*) FROM local_runtime_sessions WHERE project_id = local_runtime_projects.project_id), updated_at_ms = ? WHERE workspace_dir = ?").run(Date.now(), NEW);
const r4 = db.prepare("UPDATE local_runtime_workspace_indexing_sessions SET workspace_id = ?, workspace_real_path = ? WHERE workspace_id = ? OR workspace_real_path = ?").run(NEW, NEW, OLD, OLD);
console.log("INDEXING " + JSON.stringify(r4));
const r5 = db.prepare("UPDATE local_runtime_sessions_fts SET workspace_dir_terms = REPLACE(REPLACE(workspace_dir_terms, ?, ?), ?, ?) WHERE workspace_dir_terms LIKE ?").run(OLD, NEW, OLD_SLASH, NEW_SLASH, "%mavis-fantasy-grinder%");
console.log("FTS " + JSON.stringify(r5));
const r6 = db.prepare("UPDATE local_runtime_sessions SET workspace_dir = ?, project_workspace_dir = ? WHERE workspace_dir = ? OR project_workspace_dir = ?").run(NEW_SLASH, NEW, OLD_SLASH, OLD);
console.log("SESSIONS_BY_PATH " + JSON.stringify(r6));
const r7 = db.prepare("UPDATE local_runtime_sessions SET record_json = REPLACE(REPLACE(record_json, ?, ?), ?, ?) WHERE record_json LIKE ?").run(OLD, NEW, OLD_SLASH, NEW_SLASH, "%mavis-fantasy-grinder%");
console.log("SESSIONS_BY_RECORD " + JSON.stringify(r7));
const finalProjects = db.prepare("SELECT project_id, workspace_dir, display_name, session_count FROM local_runtime_projects WHERE workspace_dir LIKE ?").all("%mavis-%");
console.log("FINAL_PROJECTS " + JSON.stringify(finalProjects));
const finalSessions = db.prepare("SELECT session_id, workspace_dir, project_workspace_dir, project_id, title FROM local_runtime_sessions WHERE workspace_dir LIKE ? OR project_workspace_dir LIKE ?").all("%mavis-%", "%mavis-%");
console.log("FINAL_SESSIONS " + JSON.stringify(finalSessions));
db.close();
const CFG = "C:\\Users\\D\\.minimax\\agents\\mavis\\config.yaml";
const cfg = fs.readFileSync(CFG, "utf8");
const cfgOut = cfg.split(OLD).join(NEW).split(OLD_SLASH).join(NEW_SLASH);
if (cfgOut !== cfg) { fs.writeFileSync(CFG, cfgOut, "utf8"); console.log("CONFIG_UPDATED"); } else { console.log("CONFIG_NO_CHANGE"); }
console.log("CONFIG_WORKSPACE_LINES " + JSON.stringify(cfgOut.split(/\r?\n/).filter(l => /workspace/i.test(l))));