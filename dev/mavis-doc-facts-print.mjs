import fs from "node:fs";
const f = JSON.parse(fs.readFileSync("C:/Users/D/mavis-outlier/dev/mavis-doc-facts.json", "utf8"));
const cov = { ...f.coverage };
if (Array.isArray(cov.perSeason)) cov.perSeason = "per-season table: " + cov.perSeason.length + " seasons (in the JSON, not quoted here)";
if (Array.isArray(cov.seasons)) cov.seasons = "per-season table: " + cov.seasons.length + " seasons (in the JSON, not quoted here)";
const out = {
  harnessGeneratedAt: f.harnessGeneratedAt, config: f.config, coverage: cov,
  requests: f.requestCount, lookups: f.positionLookups, failures: f.failureCount, runtime: f.runtimeSeconds,
  limitsCoverage: f.limitsCoverage, limitsOutcomeClasses: f.limitsOutcomeClasses, limitsRange: f.limitsRange,
  limitsPerEra: f.limitsPerEra, limitsPerPosition: f.limitsPerPosition,
  tightest: f.limitsPlayers.tightest, widest: f.limitsPlayers.widest, poolEvaluations: f.limitsPlayers.poolEvaluations,
};
console.log(JSON.stringify(out, null, 1));
