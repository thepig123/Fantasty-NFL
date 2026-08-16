import { NextRequest, NextResponse } from "next/server";

const SLEEPER_STATS_BASE = "https://api.sleeper.com";

function normalizeProjectionRows(payload: unknown) {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.entries(payload as Record<string, unknown>).map(([player_id, value]) => {
          if (value && typeof value === "object") return { player_id, ...(value as Record<string, unknown>) };
          return { player_id };
        })
      : [];

  const normalized: Record<string, { playerId: string; stats: Record<string, number>; source: string }> = {};
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const playerId = String(row.player_id ?? (row.player as Record<string, unknown> | undefined)?.player_id ?? "");
    if (!playerId) continue;
    const rawStats = (row.stats && typeof row.stats === "object" ? row.stats : row) as Record<string, unknown>;
    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawStats)) {
      if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
    }
    normalized[playerId] = { playerId, stats, source: "sleeper" };
  }
  return normalized;
}

async function fetchSleeperProjection(url: string) {
  const response = await fetch(url, { next: { revalidate: 1800 } });
  if (!response.ok) return {};
  return normalizeProjectionRows(await response.json());
}

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") ?? "2026";
  const week = request.nextUrl.searchParams.get("week") ?? "1";

  const positions = "position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF";
  const weeklyUrl = `${SLEEPER_STATS_BASE}/projections/nfl/${season}/${week}?season_type=regular&${positions}&order_by=pts_ppr`;
  const seasonUrl = `${SLEEPER_STATS_BASE}/projections/nfl/${season}?season_type=regular&${positions}&order_by=pts_ppr`;

  const [weekly, seasonLong] = await Promise.all([
    fetchSleeperProjection(weeklyUrl).catch(() => ({})),
    fetchSleeperProjection(seasonUrl).catch(() => ({})),
  ]);

  return NextResponse.json(
    { weekly, season: seasonLong, seasonNumber: season, weekNumber: Number(week), source: "Sleeper projection feed when available" },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
  );
}