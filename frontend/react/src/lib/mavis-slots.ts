/**
 * Roster slot metadata and exposure bucket helpers (UI-only, no solver logic).
 */
import type { ContestType, Sport } from "@/types";

export interface RosterSlot {
  label: string;
  /** null = accepts any position. */
  accepts: string[] | null;
  /** Score multiplier for this slot (Showdown CPT = 1.5). */
  multiplier?: number;
}

export const NBA_CLASSIC_SLOTS: RosterSlot[] = [
  { label: "PG", accepts: ["PG"] },
  { label: "SG", accepts: ["SG"] },
  { label: "SF", accepts: ["SF"] },
  { label: "PF", accepts: ["PF"] },
  { label: "C", accepts: ["C"] },
  { label: "G", accepts: ["PG", "SG"] },
  { label: "F", accepts: ["SF", "PF"] },
  { label: "UTIL", accepts: null },
];

export const NBA_SHOWDOWN_SLOTS: RosterSlot[] = [
  { label: "CPT", accepts: null, multiplier: 1.5 },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
];

export const NFL_CLASSIC_SLOTS: RosterSlot[] = [
  { label: "QB", accepts: ["QB"] },
  { label: "RB", accepts: ["RB", "FB"] },
  { label: "RB", accepts: ["RB", "FB"] },
  { label: "WR", accepts: ["WR"] },
  { label: "WR", accepts: ["WR"] },
  { label: "WR", accepts: ["WR"] },
  { label: "TE", accepts: ["TE"] },
  { label: "FLEX", accepts: ["RB", "FB", "WR", "TE"] },
  { label: "DST", accepts: ["DST", "D"] },
];

export const NFL_SHOWDOWN_SLOTS: RosterSlot[] = [
  { label: "CPT", accepts: null, multiplier: 1.5 },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
  { label: "FLEX", accepts: null },
];

export function slotsForSport(sport: Sport, contestType: ContestType): RosterSlot[] {
  if (sport === "nba") {
    return contestType === "showdown" ? NBA_SHOWDOWN_SLOTS : NBA_CLASSIC_SLOTS;
  }
  if (sport === "nfl") {
    return contestType === "showdown" ? NFL_SHOWDOWN_SLOTS : NFL_CLASSIC_SLOTS;
  }
  return [{ label: "FLEX", accepts: null }];
}

/** Normalize backend/legacy slot strings (e.g. "RB1", "WR2", "D") to canonical bucket labels. */
export function normalizeSlotLabel(slot: string): string {
  const upper = (slot || "").trim().toUpperCase();
  if (upper === "D" || upper === "DEF") return "DST";
  const stripped = upper.replace(/\d+$/, "");
  return stripped || upper;
}

/** Human titles for the exposure buckets, one per distinct slot label. */
export function slotBuckets(slots: RosterSlot[]): { slot: string; title: string }[] {
  const title: Record<string, string> = {
    QB: "Quarterback Slot",
    RB: "Running Back Slot",
    WR: "Wide Receiver Slot",
    TE: "Tight End Slot",
    FLEX: "Flex Slot",
    DST: "Defense / Special Teams",
    PG: "Point Guard Slot",
    SG: "Shooting Guard Slot",
    SF: "Small Forward Slot",
    PF: "Power Forward Slot",
    C: "Center Slot",
    G: "Guard Slot",
    F: "Forward Slot",
    UTIL: "Utility Slot",
    CPT: "Captain",
  };
  const seen = new Set<string>();
  const out: { slot: string; title: string }[] = [];
  for (const s of slots) {
    const label = normalizeSlotLabel(s.label);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ slot: label, title: title[label] ?? `${label} Slot` });
  }
  return out;
}
