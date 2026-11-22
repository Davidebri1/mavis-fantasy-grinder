/**
 * Does DraftKings' API allow a browser to read it cross-origin?
 *
 * If the API answers with Access-Control-Allow-Origin, the app can pull the
 * live slate from the customer's own browser (a residential IP, which
 * DraftKings answers), and the Worker only has to run the optimizer.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ORIGIN = "https://mavis-fantasy-grinder.pages.dev";

function show(label, res, bodyHead) {
  console.log("\n=== " + label + " ===");
  console.log("status:", res.status);
  for (const key of ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "access-control-max-age", "vary", "server", "content-type"]) {
    const v = res.headers.get(key);
    if (v) console.log(key + ":", v);
  }
  console.log("body:", String(bodyHead).slice(0, 120).replace(/\s+/g, " "));
}

const lobby = await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", {
  headers: { accept: "application/json", "user-agent": UA, origin: ORIGIN },
});
show("GET lobby with Origin", lobby, (await lobby.text()).slice(0, 120));

const preflight = await fetch("https://api.draftkings.com/lobbies/v1/lobbies/nfl", {
  method: "OPTIONS",
  headers: {
    origin: ORIGIN,
    "access-control-request-method": "GET",
    "access-control-request-headers": "accept",
  },
});
show("OPTIONS preflight", preflight, (await preflight.text()).slice(0, 120));

const dg = await fetch("https://api.draftkings.com/draftgroups/v1/draftgroups/156561/draftables", {
  headers: { accept: "application/json", "user-agent": UA, origin: ORIGIN },
});
show("GET draftables with Origin", dg, (await dg.text()).slice(0, 120));
