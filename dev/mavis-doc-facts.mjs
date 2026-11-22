// mavis-doc-facts.mjs - prints the facts the evaluation document quotes.
import fs from "node:fs";
const base = "C:/Users/D/mavis-outlier/frontend/react/.tmp-audit/";
const harness = JSON.parse(fs.readFileSync(base + "projection-evaluation.json", "utf8"));
const limits = JSON.parse(fs.readFileSync(base + "projection-control-limits.json", "utf8"));
const sig = JSON.parse(fs.readFileSync(base + "projection-control-limit-significance.json", "utf8"));

const out = {
  harnessGeneratedAt: harness.generatedAt,
  config: harness.config,
  coverage: harness.coverage,
  factorUsage: harness.factorUsage,
  pCounts: harness.pCounts,
  modelPaths: harness.modelPaths,
  requestCount: harness.requestCount,
  positionLookups: harness.positionLookups,
  failureCount: harness.failureCount,
  runtimeSeconds: harness.runtimeSeconds,
  histograms: (harness.charts.histogramPlayers || []).map((p) => ({
    label: p.label, player: p.player, position: p.position, teams: p.teams,
    games: p.games, span: p.span, cut: p.cut, reason: p.reason,
  })),
  scatter: { sampledEvery: harness.charts.scatter?.sampledEvery, points: (harness.charts.scatter?.points || []).length },
  timeline: harness.charts.timeline ? {
    player: harness.charts.timeline.player, position: harness.charts.timeline.position,
    teams: harness.charts.timeline.teams, games: harness.charts.timeline.games,
    span: harness.charts.timeline.span, reason: harness.charts.timeline.reason,
    flags: (harness.charts.timeline.flags || []).length,
    flagKinds: (harness.charts.timeline.flags || []).map((f) => f.kind + " " + String(f.date).slice(0,10)),
  } : null,
  limitsCoverage: limits.coverage,
  limitsOutcomeClasses: limits.outcomeClasses,
  limitsRange: limits.controlLimitRange,
  limitsPredictability: limits.predictability,
  limitsDirection: limits.direction,
  limitsDiagnostics: limits.diagnostics,
  limitsPerEra: limits.perEra,
  limitsPerPosition: limits.perPosition,
  limitsPlayers: limits.players,
  sig: {
    model: sig.model, baseline: sig.baseline, paired: sig.paired,
    bandAccuracy: sig.bandAccuracy, factorInformativeness: sig.factorInformativeness,
    containment: sig.containment, coverage: sig.coverage, references: sig.references,
  },
};
fs.writeFileSync("C:/Users/D/mavis-outlier/dev/mavis-doc-facts.json", JSON.stringify(out, null, 1));
console.log("wrote dev/mavis-doc-facts.json");
console.log(JSON.stringify({
  coverage: out.coverage,
  modelPaths: out.modelPaths,
  factorUsage: out.factorUsage,
  pCounts: out.pCounts,
  requests: out.requestCount, lookups: out.positionLookups, failures: out.failureCount, runtime: out.runtimeSeconds,
  histograms: out.histograms, scatter: out.scatter, timeline: out.timeline,
}, null, 1));
