import { describe, it, expect } from "vitest";

import {
  BREAKPOINT_RULES,
  cutOf,
  detectBreakpoints,
  detectHumps,
  projectDave,
  tPValue,
  welchT,
  type DaveProjection,
  type GameLog,
} from "./dave-projection";

/** Helper: build game logs from [score, factors] pairs. */
function games(rows: [number, Record<string, boolean | number | string>][]): GameLog[] {
  return rows.map(([score, factors], i) => ({
    date: "2026-10-" + String(1 + (i % 27)).padStart(2, "0"),
    score,
    factors,
  }));
}

/** A clean two-population player: every home game is a high game. */
const BOOM_BUST: [number, Record<string, boolean | number | string>][] = [
  [2, { isHome: false }],
  [4, { isHome: false }],
  [4, { isHome: false }],
  [6, { isHome: false }],
  [18, { isHome: true }],
  [20, { isHome: true }],
  [20, { isHome: true }],
  [22, { isHome: true }],
];

/** A multimodal player: the high half carries a boom hump of four games. */
const MULTIMODAL: [number, Record<string, boolean | number | string>][] = [
  [2, { isHome: false }],
  [3, { isHome: false }],
  [4, { isHome: false }],
  [4, { isHome: false }],
  [5, { isHome: false }],
  [5, { isHome: false }],
  [6, { isHome: false }],
  [7, { isHome: false }],
  [8, { isHome: false }],
  [9, { isHome: false }],
  [19, { isHome: false }],
  [19, { isHome: false }],
  [20, { isHome: false }],
  [20, { isHome: false }],
  [20, { isHome: false }],
  [20, { isHome: false }],
  [30, { isHome: true }],
  [30, { isHome: true }],
  [31, { isHome: true }],
  [45, { isHome: true }],
];

/** The engine's hand-worked same-means case: Welch t = 2.03 < 2.1. */
const FLAT: [number, Record<string, boolean | number | string>][] = [
  [0, { isHome: false }],
  [2, { isHome: false }],
  [14, { isHome: false }],
  [16, { isHome: false }],
  [16, { isHome: true }],
  [16.2, { isHome: true }],
  [16.4, { isHome: true }],
  [16.6, { isHome: true }],
];

const CAREER: [number, Record<string, boolean | number | string>][] = [
  [10, { team: "NE" }],
  [11, { team: "NE" }],
  [12, { team: "NE" }],
  [11, { team: "NE" }],
  [10, { team: "NE" }],
  [12, { team: "NE" }],
  [3, { team: "GB" }],
  [2, { team: "GB" }],
  [4, { team: "GB" }],
  [1, { team: "GB" }],
  [2, { team: "GB" }],
  [3, { team: "GB" }],
  [2, { team: "GB" }],
  [1, { team: "GB" }],
];

/** Every game lands in exactly one category, and the ranges tile the scores. */
function expectTiling(r: DaveProjection, logs: GameLog[]): void {
  const total = r.categories.reduce((a, c) => a + c.n, 0);
  expect(total).toBe(logs.length);
  for (const log of logs) {
    const hits = r.categories.filter(
      (c) =>
        (c.lo === null || log.score >= c.lo) &&
        (c.hi === null || log.score < c.hi),
    );
    expect(hits.length).toBe(1);
  }
  // The categories are sorted and their ranges meet without a gap.
  for (let i = 1; i < r.categories.length; i++) {
    expect(r.categories[i].lo).toBe(r.categories[i - 1].hi);
  }
}

describe("welchT (hand-computed)", () => {
  it("matches the hand-worked two-sample result", () => {
    // [18,20,20,22] vs [2,4,4,6]: both variances 8/3, so
    // t = 16 / sqrt(8/12 + 8/12) = 8*sqrt(3) = 13.856...
    const { t, df } = welchT([18, 20, 20, 22], [2, 4, 4, 6]);
    expect(t).toBeCloseTo(13.8564, 3);
    expect(df).toBeCloseTo(6, 5);
  });

  it("returns t = 0 for identical samples", () => {
    const { t } = welchT([5, 5, 5], [5, 5, 5]);
    expect(t).toBe(0);
  });
});

describe("tPValue (two-sided)", () => {
  it("matches known values", () => {
    // Checked against an independent numerical integration of the Student-t
    // tail: t=2.5, df=10 -> 0.0314468442; t=1.0, df=20 -> 0.3292565787.
    expect(tPValue(2.5, 10)).toBeCloseTo(0.0314468442, 8);
    expect(tPValue(1.0, 20)).toBeCloseTo(0.3292565787, 8);
    expect(tPValue(0, 10)).toBeCloseTo(1, 8);
  });

  it("returns null when the test cannot be computed", () => {
    expect(tPValue(NaN, 10)).toBeNull();
    expect(tPValue(2, 0)).toBeNull();
  });
});

describe("detectHumps (the peaks that don't belong)", () => {
  it("finds two humps and the valley between them", () => {
    const r = detectHumps([19, 19, 20, 20, 20, 20, 30, 30, 31, 45]);
    expect(r.peaks.length).toBe(2);
    expect(r.thresholds.length).toBe(1);
    expect(r.thresholds[0]).toBeCloseTo(22.5, 6);
  });

  it("finds no threshold in a single hump", () => {
    const r = detectHumps([10, 11, 12, 12, 13, 14, 15]);
    expect(r.peaks.length).toBe(1);
    expect(r.thresholds.length).toBe(0);
  });

  it("finds nothing in two isolated spikes", () => {
    const r = detectHumps([10, 10, 12, 12, 14, 14, 40]);
    expect(r.peaks.length).toBe(0);
    expect(r.thresholds.length).toBe(0);
  });
});

describe("projectDave - the categorical call", () => {
  it("calls the high category when the factor's state is known and holds", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: true });
    expect(r.call).toBe("high");
    expect(r.factor).toBe("isHome");
    expect(r.factorCondition).toBe("isHome=true");
    expect(r.projection).toBeCloseTo(r.highPopulationMean, 10);
    expect(r.highMean).toBeCloseTo(20, 10);
    expect(r.lowMean).toBeCloseTo(4, 10);
    expect(r.sameMeans).toBe(false);
  });

  it("calls the low category when the factor's state is known and does not hold", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: false });
    expect(r.call).toBe("low");
    expect(r.projection).toBeCloseTo(r.lowPopulationMean, 10);
    expect(r.projection).toBeCloseTo(4, 10);
  });

  it("falls to the even floor when the factor's state is unknown", () => {
    const r = projectDave(games(BOOM_BUST), {});
    expect(r.call).toBe("even");
    expect(r.projection).toBeCloseTo((r.highPopulationMean + r.lowPopulationMean) / 2, 10);
    expect(r.projection).toBeCloseTo(12, 10);
  });

  it("never exposes a coefficient", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: true }) as unknown as Record<string, unknown>;
    expect("p" in r).toBe(false);
    expect("peeled" in r).toBe(false);
    expect("normality" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("P=1");
    expect(JSON.stringify(r)).not.toContain("P=0");
  });

  it("reports the sameness test separately from the projection", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: true });
    expect(r.sameMeansTest).not.toBeNull();
    expect(r.sameMeansTest!.t).toBeCloseTo(13.8564, 3);
    expect(r.sameMeansTest!.df).toBeCloseTo(6, 4);
    expect(r.sameMeansTest!.p).toBeLessThan(0.001);
  });
});

describe("projectDave - multimodal data", () => {
  it("separates the hump and calls it", () => {
    const logs = games(MULTIMODAL);
    const r = projectDave(logs, { isHome: true });
    expect(r.shape.high.verdict).toBe("multimodal");
    expect(r.shape.low.verdict).toBe("single population");
    expect(r.separated.length).toBe(4);
    const ids = r.categories.map((c) => c.id).sort();
    expect(ids).toEqual(["high-normal", "high-outlier", "low"]);
  });

  it("makes the boom reachable: the high call returns the hump's mean", () => {
    const r = projectDave(games(MULTIMODAL), { isHome: true });
    expect(r.call).toBe("high-outlier");
    const boom = r.categories.find((c) => c.id === "high-outlier");
    expect(boom).toBeDefined();
    expect(r.projection).toBeCloseTo(boom!.mean, 10);
    expect(r.projection).toBeGreaterThan(r.highMean);
  });

  it("calls the low population when the factor does not hold", () => {
    const r = projectDave(games(MULTIMODAL), { isHome: false });
    expect(r.call).toBe("low");
    expect(r.projection).toBeCloseTo(r.lowPopulationMean, 10);
  });

  it("uses the population means for the even floor", () => {
    const r = projectDave(games(MULTIMODAL), {});
    expect(r.call).toBe("even");
    expect(r.projection).toBeCloseTo((r.highPopulationMean + r.lowPopulationMean) / 2, 10);
    expect(r.highPopulationMean).toBeLessThan(r.highMean);
  });

  it("keeps every game in exactly one category and tiles the ranges", () => {
    const logs = games(MULTIMODAL);
    expectTiling(projectDave(logs, { isHome: true }), logs);
  });
});

describe("projectDave - the same-means path", () => {
  it("projects the raw average when Welch says the halves are one population", () => {
    const logs = games(FLAT);
    const r = projectDave(logs, { isHome: true });
    expect(r.sameMeans).toBe(true);
    expect(r.call).toBe("even");
    expect(r.factor).toBeNull();
    expect(r.projection).toBeCloseTo(97.2 / 8, 10);
    expectTiling(r, logs);
  });
});

describe("projectDave - guards and invariants", () => {
  it("refuses fewer than 4 games", () => {
    expect(() => projectDave(games([[10, {}], [12, {}], [8, {}]]))).toThrow(/at least 4/);
  });

  it("tiles the categories for the clean fixture too", () => {
    const logs = games(BOOM_BUST);
    expectTiling(projectDave(logs, { isHome: true }), logs);
  });

  it("reports the cut as the largest score in the low half", () => {
    const r = projectDave(games(BOOM_BUST), { isHome: true });
    expect(r.cut).toBe(6);
    expect(cutOf([2, 4, 4, 6, 18, 20, 20, 22])).toBe(6);
    expect(cutOf([1, 2, 3])).toBe(2);
  });

  it("keeps the interval around the projection, never as its bound", () => {
    const r = projectDave(games(MULTIMODAL), { isHome: true });
    expect(r.low90).toBeLessThan(r.projection);
    expect(r.high90).toBeGreaterThan(r.projection);
  });
});

describe("detectBreakpoints - regime leads", () => {
  it("flags a team change with its dates", () => {
    const built = games(CAREER);
    const flags = detectBreakpoints(built).filter((f) => f.kind === "team change");
    expect(flags.length).toBe(1);
    expect(flags[0].date).toBe(built[6].date);
    expect(flags[0].detail).toContain("NE to GB");
  });

  it("flags a level shift once, with the two-sample t between the windows", () => {
    const rows: [number, Record<string, boolean | number | string>][] = [
      [18, {}], [18, {}], [19, {}], [19, {}], [18, {}],
      [4, {}], [4, {}], [5, {}], [4, {}], [5, {}], [4, {}], [4, {}],
    ];
    const built = games(rows);
    const flags = detectBreakpoints(built).filter((f) => f.kind === "level shift");
    expect(flags.length).toBe(1);
    expect(flags[0].detail).toContain("18.40 to 4.40");
  });

  it("keeps the named rules", () => {
    expect(BREAKPOINT_RULES.swingPoints).toBe(15);
    expect(BREAKPOINT_RULES.window).toBe(5);
  });
});
