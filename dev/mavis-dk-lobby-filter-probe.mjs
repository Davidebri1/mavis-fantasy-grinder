// Probe: can the DraftKings lobby be trimmed for a browser fetch?
const ORIGIN = "https://api.draftkings.com";
const HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  referer: "https://www.draftkings.com/",
};

const candidates = [
  "/lobbies/v1/lobbies/nfl",
  "/lobbies/v1/lobbies/nfl?gameTypeId=1",
  "/lobbies/v1/lobbies/nfl?gameTypeName=classic",
];

for (const path of candidates) {
  const t0 = Date.now();
  try {
    const res = await fetch(ORIGIN + path, { headers: HEADERS });
    const text = await res.text();
    let contests = 0, classic = 0;
    const groups = new Set();
    try {
      const j = JSON.parse(text);
      const list = j?.lobby?.contests ?? [];
      contests = list.length;
      for (const c of list) {
        if (String(c.gameTypeName ?? "").trim().toLowerCase() === "classic") {
          classic++;
          groups.add(c.draftGroupId);
        }
      }
    } catch {}
    console.log(JSON.stringify({
      path,
      status: res.status,
      bytes: text.length,
      ms: Date.now() - t0,
      acao: res.headers.get("access-control-allow-origin"),
      contentEncoding: res.headers.get("content-encoding"),
      contentLength: res.headers.get("content-length"),
      contests,
      classic,
      classicGroups: [...groups].slice(0, 12),
    }));
  } catch (e) {
    console.log(JSON.stringify({ path, error: String(e) }));
  }
}
