/**
 * The live DraftKings slate mapping.
 *
 * These are the rules the app depends on to turn DraftKings' own payload
 * into a roster: one entry per player, the projection id read from the
 * payload rather than assumed, and the board picked from the contests
 * DraftKings is actually running.
 */
import { describe, expect, it } from "vitest";

import {
  boardLabelFromNames,
  choosePrimaryEntryPerPlayer,
  pickClassicBoards,
  projectionAttributeId,
  rosterPositionsFor,
} from "@/lib/dk-live";

const LOBBY = {
  lobby: {
    contests: [
      {
        draftGroupId: 1,
        gameTypeName: "Classic",
        contestStartTime: "2030-01-01T18:00:00.000Z",
        name: "NFL $10 Double Up",
        entries: 500,
      },
      {
        draftGroupId: 1,
        gameTypeName: "Classic",
        contestStartTime: "2030-01-01T18:00:00.000Z",
        name: "NFL $20 Double Up (Sun-Mon)",
        entries: 300,
      },
      {
        draftGroupId: 2,
        gameTypeName: "Showdown",
        contestStartTime: "2030-01-01T18:00:00.000Z",
        name: "NFL Showdown",
        entries: 900,
      },
      {
        draftGroupId: 3,
        gameTypeName: "Classic",
        contestStartTime: "2020-01-01T18:00:00.000Z",
        name: "A contest that already locked",
        entries: 900,
      },
    ],
  },
};

const NOW = Date.parse("2029-01-01T00:00:00.000Z");

describe("pickClassicBoards", () => {
  it("keeps only open Classic boards", () => {
    const boards = pickClassicBoards(LOBBY, NOW);
    expect(boards.map((b) => b.draftGroupId)).toEqual(["1"]);
  });

  it("counts the contests and entries on the board", () => {
    const [board] = pickClassicBoards(LOBBY, NOW);
    expect(board.contests).toBe(2);
    expect(board.entries).toBe(800);
  });

  it("names the board the way DraftKings names it", () => {
    const [board] = pickClassicBoards(LOBBY, NOW);
    expect(board.label).toBe("Sun-Mon");
  });
});

describe("boardLabelFromNames", () => {
  it("calls a board with no window in its names Main", () => {
    expect(boardLabelFromNames(["NFL $10 Double Up", "NFL $5 50-50"], 2)).toBe(
      "Main",
    );
  });

  it("uses a window only when the contests really carry it", () => {
    expect(boardLabelFromNames(["NFL $10 Double Up (Early Only)"], 10)).toBe(
      "Main",
    );
  });
});

describe("projectionAttributeId", () => {
  it("reads the id from DraftKings' own draftStats", () => {
    expect(
      projectionAttributeId(
        { draftStats: [{ id: 219, abbr: "FPPG", name: "Fantasy Points Per Game" }] },
        "nba",
      ),
    ).toBe(219);
  });

  it("falls back to the known id when the payload omits draftStats", () => {
    expect(projectionAttributeId({}, "nfl")).toBe(90);
  });
});

describe("choosePrimaryEntryPerPlayer", () => {
  it("keeps one entry per player and prefers the position slot over FLEX", () => {
    const entries = [
      { draftableId: 1, playerId: 10, position: "RB", rosterSlotId: 67, salary: 5000 },
      { draftableId: 2, playerId: 10, position: "RB", rosterSlotId: 70, salary: 5000 },
      { draftableId: 3, playerId: 11, position: "QB", rosterSlotId: 66, salary: 6000 },
    ];
    const chosen = choosePrimaryEntryPerPlayer(entries);
    expect(chosen).toHaveLength(2);
    expect(chosen.find((e) => e.playerId === 10)?.rosterSlotId).toBe(67);
  });
});

describe("rosterPositionsFor", () => {
  it("lets an NFL running back fill the flex slot", () => {
    expect(rosterPositionsFor("RB", "nfl")).toEqual(["RB", "FLEX"]);
  });

  it("keeps an NFL quarterback in the quarterback slot only", () => {
    expect(rosterPositionsFor("QB", "nfl")).toEqual(["QB"]);
  });

  it("lets an NBA guard fill guard and utility slots", () => {
    expect(rosterPositionsFor("PG", "nba")).toEqual(["PG", "G", "UTIL"]);
  });
});
