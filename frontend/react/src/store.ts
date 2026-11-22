/**
 * Centralized Zustand store for UI state shared across pages.
 *
 * Holds the player's working slate (the list of players currently
 * displayed), the optimizer settings, and the most recent optimize
 * result. Persisted to localStorage so the customer doesn't lose
 * work on a tab refresh.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  type Lineup,
  type NbaSettings,
  DEFAULT_NBA_SETTINGS,
  type Player,
  type Sport,
} from "@/types";
import { fetchLivePool, type LiveGame } from "@/lib/espn-live";
import { parseDraftables } from "@/lib/dk-draftables";
import { fetchApiPlayers, fetchApiSlates } from "@/lib/mavis-api";
import {
  dkLiveSupported,
  fetchLiveDkRoster,
  type LiveDkSlateInfo,
} from "@/lib/dk-live";
import dkShowdownJaxBal from "@/assets/dk-showdown-jax-bal.json";
import {
  buildGolfSample,
  buildMmaSample,
  buildNbaSample,
  buildNflSample,
  sampleHeadshotCache,
  type SamplePlayer,
} from "@/lib/mavis-sample";
import { seedHeadshotCache, prefetchHeadshots } from "@/components/PlayerAvatar";

/**
 * The bundled DraftKings slate — real published prices and DraftKings own
 * projections, but from an earlier game week. It is the fallback the app
 * opens with, and it is labelled "bundled-dk" so it is never mistaken for
 * the slate on the board. The live DraftKings slate replaces it as soon as
 * the API answers.
 */
const DK_SEED_NFL: Player[] = parseDraftables(
  JSON.stringify(dkShowdownJaxBal),
  "nfl",
).map((p) => ({ ...p, salary_source: "dk" as const }));

/** Sample-shape player → wire-shape player (snake_case) with photo kept. */
function toWire(p: SamplePlayer): Player {
  return {
    id: p.id,
    name: p.name,
    sport: p.sport,
    salary: p.salary,
    projection: p.projection,
    user_projection: null,
    team: p.team,
    opponent: p.opponent,
    game_info: p.gameInfo,
    positions: p.positions,
    roster_positions: p.rosterPositions,
    correlation_group: p.correlationGroup,
    opponent_id: p.opponentId,
    bout: p.bout,
    photo_url: p.photoUrl ?? null,
    jersey: null,
  };
}

function gamesFromPlayers(players: Player[]): LiveGame[] {
  const seen = new Map<string, LiveGame>();
  for (const p of players) {
    const key = p.correlation_group || p.game_info;
    if (!key) continue;
    const label = key.includes("@") ? key.split(" ")[0].replace("@", " @ ") : key;
    if (!seen.has(label)) {
      seen.set(label, {
        id: label,
        label,
        startTime: p.game_time ?? null,
        state: "pre",
        detail: p.game_info ?? "",
      });
    }
  }
  return [...seen.values()];
}

export type LiveStatus = "idle" | "loading" | "live" | "empty" | "offline";
export type ApiStatus = "idle" | "loading" | "ready" | "error";

/**
 * Where the roster currently on screen came from.
 *
 * "sample" means the live feed failed and we fell back to the bundled sample
 * slate. The UI must say so loudly — a customer who enters a lineup built from
 * sample data has been told a lie by the product.
 */
export type RosterSource = "live" | "sample" | "imported" | "dk" | "bundled-dk";

interface AppState {
  // Working set
  players: Record<string /* sport */, Player[]>;
  setPlayers: (sport: string, players: Player[]) => void;
  updatePlayer: (sport: string, playerId: string, patch: Partial<Player>) => void;
  bulkResetPlayers: (sport: string) => void;
  loadSample: (sport: "nba" | "nfl" | "mma" | "golf") => void;
  /** Resolve ESPN headshots for the current roster in the background. */
  prefetchRosterPhotos: (sport: string) => void;

  // Live feed state
  /** "idle" | "loading" | "live" | "empty" | "offline" per sport. */
  liveStatus: Record<string, LiveStatus>;
  /** Where the roster on screen came from — drives the sample-data banner. */
  rosterSource: Record<string, RosterSource>;
  liveGames: Record<string, LiveGame[]>;
  liveWarnings: Record<string, string[]>;
  /** Which DraftKings board is on screen, and when it was pulled. */
  liveSlate: Record<string, LiveDkSlateInfo | undefined>;
  lastSyncedAt: Record<string, string | null>;
  /** Pull the live slate from ESPN and swap it into the pool. */
  loadLive: (sport: Sport) => Promise<void>;

  // Django backend API state
  apiStatus: Record<string, ApiStatus>;
  apiError: Record<string, string | null>;
  loadFromApi: (sport: Sport) => Promise<boolean>;

  // Settings per sport
  nbaSettings: NbaSettings;
  updateNbaSettings: (patch: Partial<NbaSettings>) => void;

  // Last optimization result
  lastResult: Lineup[] | null;
  setLastResult: (lineups: Lineup[] | null) => void;
  clearLineups: () => void;

  // Slate ID per sport — what the customer is currently looking at
  activeSlateIdBySport: Record<string, string | undefined>;
  setActiveSlateId: (sport: string, slateId: string | undefined) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      players: { nba: [], nfl: DK_SEED_NFL, mma: [], golf: [] },
      setPlayers: (sport, players) =>
        set((s) => ({
          players: { ...s.players, [sport]: players },
          rosterSource: { ...s.rosterSource, [sport]: "imported" },
        })),
      updatePlayer: (sport, playerId, patch) =>
        set((s) => ({
          players: {
            ...s.players,
            [sport]: (s.players[sport] ?? []).map((p) =>
              p.id === playerId ? { ...p, ...patch } : p,
            ),
          },
        })),
      bulkResetPlayers: (sport) =>
        set((s) => ({ players: { ...s.players, [sport]: [] } })),

      loadSample: (sport) => {
        seedHeadshotCache(sampleHeadshotCache());
        const setRoster = (roster: Player[]) => {
          set((s) => ({
            players: { ...s.players, [sport]: roster },
            rosterSource: { ...s.rosterSource, [sport]: "sample" as RosterSource },
          }));
        };
        if (sport === "nba") {
          const roster = buildNbaSample().map(toWire);
          setRoster(roster);
          void prefetchHeadshots(roster.map((p) => p.name));
        } else if (sport === "nfl") {
          setRoster(buildNflSample().map(toWire));
        } else if (sport === "mma") {
          const roster = buildMmaSample().map(toWire);
          setRoster(roster);
          void prefetchHeadshots(roster.map((p) => p.name));
        } else {
          const roster = buildGolfSample().map(toWire);
          setRoster(roster);
          void prefetchHeadshots(roster.map((p) => p.name));
        }
      },

      /** Enrich any roster (e.g. imported CSV) with ESPN headshots. */
      prefetchRosterPhotos: (sport) => {
        const roster = get().players[sport] ?? [];
        void prefetchHeadshots(roster.map((p) => p.name));
      },

      liveStatus: {},
      rosterSource: { nfl: "bundled-dk" },
      liveGames: {},
      liveWarnings: {},
      liveSlate: {},
      lastSyncedAt: {},
      apiStatus: {},
      apiError: {},

      loadFromApi: async (sport) => {
        set((s) => ({
          apiStatus: { ...s.apiStatus, [sport]: "loading" },
          apiError: { ...s.apiError, [sport]: null },
        }));
        let browserWarning: string | null = null;

        // The live DraftKings slate, pulled by this browser.
        //
        // DraftKings answers a browser request and refuses our datacenter
        // edge, so the page asks DraftKings for the slate itself and hands
        // the pool to the optimizer API. Every number in that pool is
        // DraftKings' own.
        if (dkLiveSupported(sport)) {
          try {
            const live = await fetchLiveDkRoster(sport);
            if (live.players.length > 0) {
              set((s) => ({
                players: { ...s.players, [sport]: live.players },
                rosterSource: { ...s.rosterSource, [sport]: "dk" as RosterSource },
                liveWarnings: { ...s.liveWarnings, [sport]: live.warnings },
                liveGames: { ...s.liveGames, [sport]: gamesFromPlayers(live.players) },
                liveSlate: { ...s.liveSlate, [sport]: live.slate },
                lastSyncedAt: { ...s.lastSyncedAt, [sport]: live.slate.fetchedAt },
                apiStatus: { ...s.apiStatus, [sport]: "ready" },
                apiError: { ...s.apiError, [sport]: null },
              }));
              get().setActiveSlateId(
                sport,
                `dk-${sport}-${live.slate.draftGroupId}`,
              );
              void prefetchHeadshots(live.players.map((p) => p.name));
              return true;
            }
          } catch (err) {
            browserWarning =
              "The live DraftKings slate could not be loaded in this browser: " +
              (err instanceof Error ? err.message : String(err));
          }
        }

        try {
          const slates = await fetchApiSlates(sport);
          const preferred = slates.find((sl) => sl.is_active) ?? slates[0];
          const {
            players: apiPlayers,
            warnings: apiWarnings,
            dataSource,
          } = await fetchApiPlayers(sport, preferred?.id);
          if (preferred?.id !== undefined) {
            get().setActiveSlateId(sport, String(preferred.id));
          }
          const apiIsLive =
            (dataSource ?? preferred?.data_source) === "draftkings-live";
          if (!apiIsLive) {
            // The API could not reach DraftKings and answered with its
            // sample. If the roster already on screen carries real
            // DraftKings prices it stays: a made-up sample is no
            // improvement, and the banner already says which slate it is.
            const current = get().rosterSource[sport];
            if (current === "bundled-dk" || current === "dk") {
              set((s) => ({
                liveWarnings: {
                  ...s.liveWarnings,
                  [sport]: browserWarning
                    ? [browserWarning, ...apiWarnings]
                    : apiWarnings,
                },
                apiStatus: { ...s.apiStatus, [sport]: "ready" },
                apiError: { ...s.apiError, [sport]: null },
              }));
              return false;
            }
          }
          if (apiPlayers.length > 0) {
            // A roster is only called a DraftKings slate when the API says
            // the data came from DraftKings live. Anything else is a sample
            // and is labelled as one.
            const isLiveDk =
              (dataSource ?? preferred?.data_source) === "draftkings-live";
            const withSport = apiPlayers.map((p) => ({
              ...p,
              sport,
              salary_source: (p.salary_source ??
                (isLiveDk && p.salary > 0 ? "dk" : "none")) as Player["salary_source"],
            }));
            set((s) => ({
              players: { ...s.players, [sport]: withSport },
              rosterSource: {
                ...s.rosterSource,
                [sport]: (isLiveDk ? "dk" : "sample") as RosterSource,
              },
              liveWarnings: {
                ...s.liveWarnings,
                [sport]: browserWarning
                  ? [browserWarning, ...apiWarnings]
                  : apiWarnings,
              },
              liveGames: {
                ...s.liveGames,
                [sport]:
                  s.liveGames[sport]?.length
                    ? s.liveGames[sport]
                    : gamesFromPlayers(withSport),
              },
              apiStatus: { ...s.apiStatus, [sport]: "ready" },
              apiError: { ...s.apiError, [sport]: null },
            }));
            void prefetchHeadshots(withSport.map((p) => p.name));
            return true;
          }
          set((s) => ({
            apiStatus: { ...s.apiStatus, [sport]: "ready" },
            apiError: { ...s.apiError, [sport]: null },
          }));
          return false;
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.message
              : "Optimizer backend API is unreachable.";
          set((s) => ({
            apiStatus: { ...s.apiStatus, [sport]: "error" },
            apiError: { ...s.apiError, [sport]: msg },
          }));
          return false;
        }
      },

      /**
       * Pull the live slate from ESPN and swap it into the pool.
       *
       * The pool is replaced wholesale so projections and salaries always
       * match the live feed, but the user's own decisions (locks, excludes,
       * likes, hand-edited projections) are carried across.
       */
      loadLive: async (sport) => {
        set((s) => ({ liveStatus: { ...s.liveStatus, [sport]: "loading" } }));
        try {
          const pool = await fetchLivePool(sport);
          const previous = get().players[sport] ?? [];
          const priorById = new Map(previous.map((p) => [p.id, p]));
          const merged = pool.players.map((p) => {
            const prior = priorById.get(p.id);
            if (!prior) return p;
            return {
              ...p,
              is_locked: prior.is_locked,
              is_excluded: prior.is_excluded,
              is_liked: prior.is_liked,
              user_projection: prior.user_projection ?? p.user_projection ?? null,
            };
          });
          set((s) => ({
            players: { ...s.players, [sport]: merged },
            rosterSource: { ...s.rosterSource, [sport]: "live" as RosterSource },
            liveStatus: {
              ...s.liveStatus,
              [sport]: merged.length > 0 ? "live" : "empty",
            },
            liveGames: { ...s.liveGames, [sport]: pool.games },
            liveWarnings: { ...s.liveWarnings, [sport]: pool.warnings },
            lastSyncedAt: { ...s.lastSyncedAt, [sport]: pool.fetchedAt },
          }));
        } catch (err) {
          // Live feed unreachable — keep whatever the user has and say so.
          const message =
            err instanceof Error ? err.message : "The live feed could not be reached.";
          set((s) => ({
            liveStatus: { ...s.liveStatus, [sport]: "offline" },
            liveWarnings: { ...s.liveWarnings, [sport]: [message] },
          }));
          if ((get().players[sport] ?? []).length === 0) {
            get().loadSample(sport);
          }
        }
      },

      nbaSettings: DEFAULT_NBA_SETTINGS,
      updateNbaSettings: (patch) =>
        set((s) => ({ nbaSettings: { ...s.nbaSettings, ...patch } })),

      lastResult: null,
      setLastResult: (lineups) => set({ lastResult: lineups }),
      clearLineups: () => set({ lastResult: null }),

      activeSlateIdBySport: {},
      setActiveSlateId: (sport, slateId) =>
        set((s) => ({
          activeSlateIdBySport: { ...s.activeSlateIdBySport, [sport]: slateId },
        })),
    }),
    {
      name: "fantasy-grinder-app",
      version: 6,
      partialize: (s) => ({
        players: s.players,
        nbaSettings: s.nbaSettings,
        activeSlateIdBySport: s.activeSlateIdBySport,
      }),
      // v2 → v3: MCC/Golf fields expanded (32 fighters, 32 golfers); drop
      // persisted rosters so every visitor regenerates the new pools.
      // v3 → v4: NFL added; drop persisted rosters again so the live slate
      // is always the source of truth.
      // v4 → v5: the NFL pool starts from the bundled DraftKings slate.
      // v5 → v6: the salary field now holds only published DraftKings
      // prices. A roster persisted under v5 may still carry a modelled
      // price in that field, so persisted rosters are dropped and
      // regenerated rather than silently reinterpreted.
      migrate: (persisted: unknown, version: number) => {
        if (version < 6) {
          return {
            players: { nba: [], nfl: [], mma: [], golf: [] },
            nbaSettings: {
              ...DEFAULT_NBA_SETTINGS,
            },
            activeSlateIdBySport: {},
          } as never;
        }
        return persisted as never;
      },
    },
  ),
);
