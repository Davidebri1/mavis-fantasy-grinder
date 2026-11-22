/**
 * mavis-dk-live-probe.mjs
 *
 * Ground truth for the live DraftKings slate.
 *
 * The app must never serve a slate it invented. This probe answers one
 * question with evidence: which public DraftKings endpoint returns the
 * current slate's draftables — real salaries, real positions, real DK
 * projections — and what its shape is.
 *
 * It also mines the lobby capture already on disk (dev/dk-lobbies-nfl.json)
 * for the field names DraftKings actually uses, so the parser is written
 * against what DK publishes rather than against a guess.
 *
 * Read-only. It fetches and prints; it writes nothing.
 */
import fs from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const HEADER = {
  "user-agent": UA,
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
};

/** Print a short, bounded excerpt of any fetched text. */
function excerpt(text, n = 400) {
  return String(text).slice(0, n).replace(/\s+/g, " ");
}

/** Mine the on-disk lobby capture for the field names DraftKings uses. */
function inspectCapture() {
  const path = "dev/dk-lobbies-nfl.json";
  if (!fs.existsSync(path)) {
    console.log("capture: none on disk");
    return null;
  }
  const capture = JSON.parse(fs.readFileSync(path, "utf8"));
  const lobby = capture.lobby ?? {};
  console.log("=== lobby capture ===");
  console.log("bytes:", fs.statSync(path).size);
  console.log("lobby keys:", Object.keys(lobby).join(", "));
  const ids = lobby.draftGroupIds ?? [];
  console.log("draftGroupIds:", ids.length, ids.slice(0, 8).join(", "));

  const flat = JSON.stringify(lobby);
  for (const key of [
    '"draftables"',
    '"salary"',
    '"fppg"',
    '"draftStatAttributes"',
    '"playerId"',
    '"teamAbbreviation"',
    '"contestGames"',
    '"gameTypeId"',
  ]) {
    const at = flat.indexOf(key);
    console.log(`  ${key} present=${at >= 0}`);
    if (at >= 0) {
      console.log("    ", excerpt(flat.slice(Math.max(0, at - 180), at + 240), 420));
    }
  }
  return lobby;
}

/** Try one endpoint and report what came back. */
async function probe(url) {
  try {
    const res = await fetch(url, { headers: HEADER });
    const text = await res.text();
    const line = `${res.status} ${res.headers.get("content-type") ?? "?"} len=${text.length}`;
    console.log(`\n--- ${url}\n    ${line}`);
    console.log("    ", excerpt(text, 320));
    if (res.ok) {
      try {
        const json = JSON.parse(text);
        const keys = Object.keys(json).slice(0, 25).join(", ");
        console.log("    top-level keys:", keys);
        if (Array.isArray(json)) {
          console.log("    array length:", json.length);
          if (json[0]) console.log("    first item keys:", Object.keys(json[0]).join(", "));
        }
      } catch {
        /* not JSON */
      }
    }
    return { url, status: res.status, ok: res.ok, text };
  } catch (err) {
    console.log(`\n--- ${url}\n    ERROR ${err.message}`);
    return { url, status: 0, ok: false, text: "" };
  }
}

const lobby = inspectCapture();
const groupId = (lobby?.draftGroupIds ?? [])[0];

const candidates = [
  "https://api.draftkings.com/lobbies/v1/lobbies/nfl",
  "https://api.draftkings.com/lobbies/nfl",
  "https://api.draftkings.com/slates/v1/slates",
  "https://api.draftkings.com/slates/v1/slates?format=json",
];
if (groupId !== undefined) {
  candidates.push(
    `https://api.draftkings.com/slates/v1/slates/${groupId}`,
    `https://api.draftkings.com/slates/v1/slates/${groupId}/draftables`,
    `https://api.draftkings.com/draftables/v1/draftables/${groupId}`,
    `https://api.draftkings.com/lineups/get_available_lineups/${groupId}`,
    `https://api.draftkings.com/draftgroups/v1/draftgroups/${groupId}`,
  );
}

console.log("\n=== endpoint probes ===");
for (const url of candidates) {
  await probe(url);
}
