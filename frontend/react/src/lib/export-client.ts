/**
 * Lineup export via Django REST API (`/api/export/csv/`, `/api/export/excel/`).
 */
import { fetchApiExportBlob } from "@/lib/mavis-api";
import type { Lineup, Player } from "@/types";

let _exportPlayers: Player[] = [];

export function setExportPlayers(players: Player[]): void {
  _exportPlayers = players;
}

export function getExportPlayers(): Player[] {
  return _exportPlayers;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportLineupsCsv(lineups: Lineup[]): Promise<void> {
  if (lineups.length === 0) return;
  const blob = await fetchApiExportBlob("csv", lineups);
  triggerDownload(blob, "lineups.csv");
}

export async function exportLineupsXlsx(lineups: Lineup[]): Promise<void> {
  if (lineups.length === 0) return;
  const blob = await fetchApiExportBlob("excel", lineups);
  triggerDownload(blob, "lineups.xlsx");
}
