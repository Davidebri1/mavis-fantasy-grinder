// Measure the GZIP wire size DraftKings actually sends (raw TLS, no auto-decompress).
import https from "node:https";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const targets = [
  ["nfl-lobby", "https://api.draftkings.com/lobbies/v1/lobbies/nfl"],
  ["nba-lobby", "https://api.draftkings.com/lobbies/v1/lobbies/nba"],
  ["draftables", "https://api.draftkings.com/draftgroups/v1/draftgroups/156561/draftables"],
];

function measure(path) {
  return new Promise((resolve) => {
    const req = https.request(
      path,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "accept-encoding": "gzip, deflate, br",
          "user-agent": UA,
          referer: "https://www.draftkings.com/",
        },
      },
      (res) => {
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            wireBytes: bytes,
            encoding: res.headers["content-encoding"] ?? "none",
            acao: res.headers["access-control-allow-origin"] ?? null,
          }),
        );
      },
    );
    req.on("error", (e) => resolve({ error: String(e) }));
    req.end();
  });
}

for (const [name, path] of targets) {
  console.log(JSON.stringify({ name, ...(await measure(path)) }));
}
