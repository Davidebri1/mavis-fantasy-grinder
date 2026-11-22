import { DatabaseSync } from "node:sqlite";
const dbPath = "C:\\Users\\D\\.minimax\\v2\\sqlite\\runtime-state.sqlite";
let db;
try { db = new DatabaseSync(dbPath, { readOnly: true }); }
catch (e) { console.log("OPEN_FAIL " + e.message); process.exit(0); }
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
for (const t of tables) console.log("TABLE " + t.name + "\n  " + (t.sql || "").replace(/\s+/g, " "));
const sid = "mvs_7ac968d537334b5d9d587015fbfd2c3b";
for (const t of tables) {
  const name = t.name;
  if (!/session|workspace|runtime|state|agent/i.test(name)) continue;
  try {
    const cols = db.prepare("PRAGMA table_info('" + name + "')").all().map(c => c.name);
    const textCols = cols.filter(c => /name|dir|path|workspace|session|id/i.test(c));
    for (const c of textCols) {
      const rows = db.prepare("SELECT * FROM '" + name + "' WHERE CAST('" + c + "' AS TEXT) LIKE ? LIMIT 5").all("%" + sid + "%");
      for (const r of rows) console.log("HIT " + name + "." + c + " -> " + JSON.stringify(r));
    }
  } catch (e) { console.log("ERR " + name + " " + e.message); }
}
