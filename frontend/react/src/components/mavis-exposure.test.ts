import { describe, expect, it } from "vitest";

import { computeExposure } from "@/components/ExposureReport";
import { NFL_CLASSIC_SLOTS, normalizeSlotLabel, slotBuckets } from "@/lib/mavis-slots";
import type { Lineup, Player } from "@/types";

describe("ExposureReport slot bucketing", () => {
  const players: Player[] = [
    { id: "qb1", name: "Josh Allen", sport: "nfl", salary: 8000, projection: 25, team: "BUF", positions: ["QB"], roster_positions: ["QB"] },
    { id: "qb2", name: "Patrick Mahomes", sport: "nfl", salary: 7500, projection: 24, team: "KC", positions: ["QB"], roster_positions: ["QB"] },
    { id: "rb1", name: "Saquon Barkley", sport: "nfl", salary: 8200, projection: 22, team: "PHI", positions: ["RB"], roster_positions: ["RB", "FLEX"] },
    { id: "rb2", name: "Jahmyr Gibbs", sport: "nfl", salary: 7400, projection: 20, team: "DET", positions: ["RB"], roster_positions: ["RB", "FLEX"] },
    { id: "wr1", name: "CeeDee Lamb", sport: "nfl", salary: 8100, projection: 21, team: "DAL", positions: ["WR"], roster_positions: ["WR", "FLEX"] },
    { id: "wr2", name: "A.J. Brown", sport: "nfl", salary: 7600, projection: 19, team: "PHI", positions: ["WR"], roster_positions: ["WR", "FLEX"] },
    { id: "wr3", name: "Rashee Rice", sport: "nfl", salary: 6800, projection: 18, team: "KC", positions: ["WR"], roster_positions: ["WR", "FLEX"] },
    { id: "te1", name: "Travis Kelce", sport: "nfl", salary: 6100, projection: 16, team: "KC", positions: ["TE"], roster_positions: ["TE", "FLEX"] },
    { id: "rb3", name: "James Cook", sport: "nfl", salary: 6500, projection: 17, team: "BUF", positions: ["RB"], roster_positions: ["RB", "FLEX"] },
    { id: "dst1", name: "49ers DST", sport: "nfl", salary: 3200, projection: 9, team: "SF", positions: ["DST"], roster_positions: ["DST"] },
  ];

  const makeLineup = (rank: number, qbId: string): Lineup => ({
    assignments: [
      { slot: "QB", score_multiplier: 1, player_id: qbId, player_name: qbId },
      { slot: "RB", score_multiplier: 1, player_id: "rb1", player_name: "Saquon Barkley" },
      { slot: "RB2", score_multiplier: 1, player_id: "rb2", player_name: "Jahmyr Gibbs" },
      { slot: "WR1", score_multiplier: 1, player_id: "wr1", player_name: "CeeDee Lamb" },
      { slot: "WR2", score_multiplier: 1, player_id: "wr2", player_name: "A.J. Brown" },
      { slot: "WR3", score_multiplier: 1, player_id: "wr3", player_name: "Rashee Rice" },
      { slot: "TE", score_multiplier: 1, player_id: "te1", player_name: "Travis Kelce" },
      { slot: "FLEX", score_multiplier: 1, player_id: "rb3", player_name: "James Cook" },
      { slot: "DST", score_multiplier: 1, player_id: "dst1", player_name: "49ers DST" },
    ],
    strategy: "maxProjection",
    solver_backend: "pulp",
    rank,
    total_salary: 49_500,
    total_projection: 170,
    total_ceiling: 190,
    teams: ["BUF", "KC"],
    games: ["KC@BUF"],
    unique_key: `lineup-${rank}`,
  });

  it("normalizes numbered slots into canonical buckets and sums QB/TE/DST <= 100%", () => {
    const lineups = [makeLineup(1, "qb1"), makeLineup(2, "qb2")];
    const byId = new Map(players.map((p) => [p.id, p]));
    const exp = computeExposure(lineups, byId);
    const buckets = slotBuckets(NFL_CLASSIC_SLOTS);

    expect(normalizeSlotLabel("RB2")).toBe("RB");
    expect(buckets.map((b) => b.slot)).toEqual(["QB", "RB", "WR", "TE", "FLEX", "DST"]);

    // QB column sums cleanly to 100%
    const qbMap = exp.bySlot.get("QB")!;
    const qbSum = [...qbMap.values()].reduce((s, v) => s + v, 0);
    expect(qbSum).toBeCloseTo(100, 6);

    // RB column contains only rb1 and rb2 (not wr1/te1/dst1), and FLEX has rb3
    expect([...exp.bySlot.get("RB")!.keys()].sort()).toEqual(["rb1", "rb2"]);
    expect([...exp.bySlot.get("WR")!.keys()].sort()).toEqual(["wr1", "wr2", "wr3"]);
    expect([...exp.bySlot.get("TE")!.keys()]).toEqual(["te1"]);
    expect([...exp.bySlot.get("FLEX")!.keys()]).toEqual(["rb3"]);
    expect([...exp.bySlot.get("DST")!.keys()]).toEqual(["dst1"]);
  });
});
