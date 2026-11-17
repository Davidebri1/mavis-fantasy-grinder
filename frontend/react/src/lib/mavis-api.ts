/// <reference types="vite/client" />
/**
 * HTTP client for the Mavis Django REST API (`VITE_API_URL`).
 */
import type { Lineup, Player, Sport } from "@/types";

export interface ApiSlate {
  id: number | string;
  sport: Sport;
  name: string;
  slate_date?: string;
  slate_time?: string;
  file_name?: string;
  is_active?: boolean;
  player_count?: number;
}

const PRODUCTION_DEFAULT_API_URL =
  "https://mavis-fantasy-grinder-api.ebridavid.workers.dev";

/** Resolve API base URL ending with `/api` without trailing slash. */
export function resolveApiBase(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";
  if (raw) {
    const trimmed = raw.replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return `${PRODUCTION_DEFAULT_API_URL}/api`;
  }
  return "/api";
}

export function apiUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${resolveApiBase()}${clean}`;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = 120_000,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Optimizer backend unreachable (${resolveApiBase()}): ${detail}`,
    );
  }

  if (!res.ok) {
    let msg = `API error (${res.status})`;
    try {
      const body = (await res.json()) as Record<string, unknown>;
      if (typeof body.message === "string" && body.message) msg = body.message;
      else if (typeof body.detail === "string" && body.detail) msg = body.detail;
      else msg = `${msg}: ${JSON.stringify(body)}`;
    } catch {
      const txt = await res.text().catch(() => "");
      if (txt) msg = `${msg}: ${txt.slice(0, 200)}`;
    }
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

export async function fetchApiHealth(): Promise<{ status: string }> {
  return apiRequest<{ status: string }>("/health/", { method: "GET" }, 10_000);
}

export async function fetchApiSlates(sport?: Sport): Promise<ApiSlate[]> {
  const qs = sport ? `?sport=${encodeURIComponent(sport)}` : "";
  const data = await apiRequest<ApiSlate[] | { results?: ApiSlate[] }>(
    `/slates/${qs}`,
    { method: "GET" },
    15_000,
  );
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function fetchApiPlayers(
  sport: Sport,
  slateId?: string | number,
): Promise<Player[]> {
  const params = new URLSearchParams({ sport });
  if (slateId !== undefined && slateId !== "") {
    params.set("slate_id", String(slateId));
  }
  const data = await apiRequest<Player[] | { results?: Player[] }>(
    `/players/?${params.toString()}`,
    { method: "GET" },
    15_000,
  );
  return Array.isArray(data) ? data : (data.results ?? []);
}

export interface ApiOptimizeResponse {
  lineups: Lineup[];
  strategy: string;
  solver_backend: string;
  top_score: number;
  elapsed_ms: number;
  warnings: string[];
}

export async function fetchApiExportBlob(
  format: "csv" | "excel",
  lineups: Lineup[],
): Promise<Blob> {
  const res = await fetch(apiUrl(`/export/${format}/`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineups }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`Export failed (${res.status})`);
  }
  return res.blob();
}
