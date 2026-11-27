import { describe, it, expect } from "vitest";

// Parity test: the bare-node mirror must match the TypeScript engine on
// every shared field. The mirror is compiled from the engine, so this suite
// is the guard that proves the file on disk is still in step with the
// source - a stale mirror fails here.
import {
  projectDave as portProject,
  detectHumps as portHumps,
  detectBreakpoints as portFlags,
  cutOf as portCut,
} from "./dave-port.mjs";
import {
  projectDave as engProject,
  detectHumps as engHumps,
  detectBreakpoints as engFlags,
} from "../src/lib/dave-projection.ts";

function games(rows) {
  return rows.map(([score, factors], i) => ({
    date: "2026-10-" + String(1 + (i % 27)).padStart(2, "0"),
    score,
    factors,
  }));
}

const BOOM_BUST = [
  [2, { isHome: false }], [4, { isHome: false }], [4, { isHome: false }], [6, { isHome: false }],
  [18, { isHome: true }], [20, { isHome: true }], [20, { isHome: true }], [22, { isHome: true }],
];

const MULTIMODAL = [
  [2, { isHome: false }], [3, { isHome: false }], [4, { isHome: false }], [4, { isHome: false }],
  [5, { isHome: false }], [5, { isHome: false }], [6, { isHome: false }], [7, { isHome: false }],
  [8, { isHome: false }], [9, { isHome: false }],
  [19, { isHome: false }], [19, { isHome: false }], [20, { isHome: false }], [20, { isHome: false }],
  [20, { isHome: false }], [20, { isHome: false }], [30, { isHome: true }], [30, { isHome: true }],
  [31, { isHome: true }], [45, { isHome: true }],
];

const MULTI_FACTOR = [
  [2, { isHome: false, restDays: 3 }], [4, { isHome: false, restDays: 4 }],
  [4, { isHome: false, restDays: 3 }], [6, { isHome: false, restDays: 2 }],
  [18, { isHome: true, restDays: 10 }], [20, { isHome: true, restDays: 2 }],
  [20, { isHome: true, restDays: 11 }], [22, { isHome: true, restDays: 13 }],
];

const FLAT = [
  [0, { isHome: false }], [2, { isHome: false }], [14, { isHome: false }], [16, { isHome: false }],
  [16, { isHome: true }], [16.2, { isHome: true }], [16.4, { isHome: true }], [16.6, { isHome: true }],
];

const CAREER = [
  [10, { team: "NE" }], [11, { team: "NE" }], [12, { team: "NE" }], [11, { team: "NE" }], [10, { team: "NE" }],
  [12, { team: "NE" }], [3, { team: "GB" }], [2, { team: "GB" }], [4, { team: "GB" }], [1, { team: "GB" }],
  [2, { team: "GB" }], [3, { team: "GB" }], [2, { team: "GB" }], [1, { team: "GB" }],
];

const r10 = (x) => (Number.isFinite(x) ? Math.round(x * 1e10) / 1e10 : x);

/** Everything both implementations must agree on, field for field. */
function shared(r) {
  return {
    projection: r10(r.projection),
    low90: r10(r.low90),
    high90: r10(r.high90),
    highMean: r10(r.highMean),
    lowMean: r10(r.lowMean),
    highPopulationMean: r10(r.highPopulationMean),
    lowPopulationMean: r10(r.lowPopulationMean),
    call: r.call,
    factor: r.factor,
    factorCondition: r.factorCondition,
    sameMeans: r.sameMeans,
    sameMeansTest: r.sameMeansTest
      ? { t: r10(r.sameMeansTest.t), df: r10(r.sameMeansTest.df), p: r.sameMeansTest.p }
      : null,
    shape: JSON.stringify(r.shape),
    categories: JSON.stringify(
      r.categories.map((c) => [c.id, c.side, c.kind, r10(c.mean), c.n, c.indices, c.lo, c.hi]),
    ),
    separated: JSON.stringify(r.separated),
    cut: r10(r.cut),
    factors: JSON.stringify(
      r.factors.map((f) => [
        f.key, f.condition, r10(f.test.t), r10(f.test.df), f.test.p,
        f.test.withN, r10(f.test.withMean), f.test.withoutN, r10(f.test.withoutMean),
        f.marks, f.marksCategory, r10(f.coverage), r10(f.purity), f.detail,
      ]),
    ),
  };
}

function compare(rows, upcoming, label) {
  const logs = games(rows);
  const eng = engProject(logs, upcoming);
  const port = portProject(logs, upcoming);
  expect(shared(port), label).toEqual(shared(eng));
  return { eng, port };
}

/** A deterministic PRNG so the random fixtures never change under us. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFixture(seed) {
  const rand = mulberry32(seed);
  const n = 6 + Math.floor(rand() * 15);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const base = rand() < 0.5 ? 4 + rand() * 8 : 14 + rand() * 22;
    rows.push([
      Math.round(base * 10) / 10,
      {
        isHome: rand() < 0.5,
        opponent: ["NE", "GB", "PIT", "SF"][Math.floor(rand() * 4)],
        restDays: 1 + Math.floor(rand() * 10),
      },
    ]);
  }
  return rows;
}

describe("dave-port parity with src/lib/dave-projection.ts", () => {
  it("clean two-population split", () => compare(BOOM_BUST, { isHome: true }, "boombust"));
  it("multimodal separation and the boom call", () => compare(MULTIMODAL, { isHome: true }, "multimodal"));
  it("multi-factor ranking", () => compare(MULTI_FACTOR, { restDays: 12 }, "multi"));
  it("same-means raw-average path", () => compare(FLAT, { isHome: true }, "flat"));
  it("unknown factor state falls to the even floor", () => compare(BOOM_BUST, {}, "unknown"));
  it("agrees on 120 random fixtures", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rows = randomFixture(seed);
      compare(rows, { isHome: seed % 2 === 0, restDays: 1 + (seed % 9) }, "random-" + seed);
    }
  });
  it("detectHumps mirrors", () => {
    const cases = [
      [19, 19, 20, 20, 20, 20, 30, 30, 31, 45],
      [10, 10, 12, 12, 14, 14, 40],
      [10, 11, 12, 12, 13, 14, 15],
    ];
    for (const scores of cases) {
      expect(portHumps(scores)).toEqual(engHumps(scores));
    }
  });
  it("breakpoint flags mirror", () => {
    const built = games(CAREER);
    expect(portFlags(built).map((f) => [f.kind, f.date, f.detail])).toEqual(
      engFlags(built).map((f) => [f.kind, f.date, f.detail]),
    );
  });
  it("cutOf returns the largest value of the low half", () => {
    expect(portCut(BOOM_BUST.map((r) => r[0]))).toBe(6);
    expect(portCut([1, 2, 3])).toBe(2);
    expect(portCut([7])).toBe(7);
  });
  it("the mirror exposes no coefficient either", () => {
    const r = portProject(games(BOOM_BUST), { isHome: true });
    expect("p" in r).toBe(false);
    expect("peeled" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("P=1");
  });
});
