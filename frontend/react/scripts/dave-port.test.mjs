import { describe, it, expect } from "vitest";

// Parity test: the bare-node port must mirror the TypeScript engine
// exactly on every shared field. Cases cover the clean separation, the
// multi-factor ranking with its fallback, the same-means raw-average
// path, outlier peeling, and the breakpoint flagger.
import { projectDave as portProject, detectBreakpoints as portFlags, cutOf } from "./dave-port.mjs";
import { projectDave as engProject, detectBreakpoints as engFlags } from "../src/lib/dave-projection.ts";

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

const MULTI_FACTOR = [
  [2, { isHome: false, restDays: 3 }], [4, { isHome: false, restDays: 4 }],
  [4, { isHome: false, restDays: 3 }], [6, { isHome: false, restDays: 2 }],
  [18, { isHome: true, restDays: 10 }], [20, { isHome: true, restDays: 2 }],
  [20, { isHome: true, restDays: 11 }], [22, { isHome: true, restDays: 13 }],
];

const PEEL_CASE = [
  [2, {}], [4, {}], [4, {}], [6, {}], [18, {}], [19, {}], [20, {}], [45, {}],
];

const FLAT = [
  // The engine's own hand-worked same-means case: t = 2.03 < 2.1.
  [0, { isHome: false }], [2, { isHome: false }], [14, { isHome: false }], [16, { isHome: false }],
  [16, { isHome: true }], [16.2, { isHome: true }], [16.4, { isHome: true }], [16.6, { isHome: true }],
];

const CAREER = [
  [10, { team: "NE" }], [11, { team: "NE" }], [12, { team: "NE" }], [11, { team: "NE" }], [10, { team: "NE" }],
  [12, { team: "NE" }], [3, { team: "GB" }], [2, { team: "GB" }], [4, { team: "GB" }], [1, { team: "GB" }],
  [2, { team: "GB" }], [3, { team: "GB" }], [2, { team: "GB" }], [1, { team: "GB" }],
];

function shared(r) {
  return {
    projection: +r.projection.toFixed(10),
    low90: +r.low90.toFixed(10),
    high90: +r.high90.toFixed(10),
    highMean: +r.highMean.toFixed(10),
    lowMean: +r.lowMean.toFixed(10),
    p: r.p,
    factor: r.factor,
    sameMeans: r.sameMeans,
    peeled: r.peeled,
    condDetail: r.factors ? r.factors.map((f) => f.detail) : [],
  };
}

function compare(rows, upcoming, label) {
  const eng = engProject(games(rows), upcoming);
  const port = portProject(games(rows), upcoming);
  expect(shared(port), label).toEqual(shared(eng));
  return { eng, port };
}

describe("dave-port parity with src/lib/dave-projection.ts", () => {
  it("clean boom/bust split", () => compare(BOOM_BUST, { isHome: true }, "boombust"));
  it("multi-factor ranked list and fallback", () => compare(MULTI_FACTOR, { restDays: 12 }, "multi"));
  it("same-means raw-average path", () => compare(FLAT, { isHome: true }, "flat"));
  it("outlier peeling", () => compare(PEEL_CASE, {}, "peel"));
  it("cutOf returns the largest value of the low half (the harness cut C)", () => {
    // Even count: the low half of [2,4,4,6,18,20,20,22] is [2,4,4,6] -> C = 6.
    expect(cutOf(BOOM_BUST.map((r) => r[0]))).toBe(6);
    // Odd count: the middle game joins the LOW half, so C is the median score.
    expect(cutOf([1, 2, 3])).toBe(2);
    // Single earlier game: C is that game's own score.
    expect(cutOf([7])).toBe(7);
  });
  it("breakpoint flags mirror", () => {
    const built = games(CAREER);
    expect(portFlags(built).map((f) => [f.kind, f.date, f.detail])).toEqual(
      engFlags(built).map((f) => [f.kind, f.date, f.detail]),
    );
  });
  it("sameMeans t matches port's halvesT", () => {
    const port = portProject(games(FLAT), { isHome: true });
    expect(port.sameMeans).toBe(true);
    expect(Math.abs(port.halvesT)).toBeLessThan(2.1);
  });
});
