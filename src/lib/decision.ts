import type { SleeperPlayer } from "./sleeper";

export type Position = "QB" | "RB" | "WR" | "TE";

const positionBase: Record<Position, number> = { RB: 94, WR: 92, TE: 72, QB: 68 };

export function playerPosition(player: SleeperPlayer): Position | undefined {
  const position = (player.fantasy_positions?.[0] ?? player.position) as Position | undefined;
  return position && position in positionBase ? position : undefined;
}

export function draftScore(
  player: SleeperPlayer,
  rosterPositions: string[],
  rosteredPositions: string[],
  seasonProjection?: number,
  projectionPercentile?: number,
) {
  const position = playerPosition(player);
  if (!position) return null;

  const required = rosterPositions.filter((p) => p === position).length;
  const flexSlots = rosterPositions.filter((p) => p.includes("FLEX")).length;
  const owned = rosteredPositions.filter((p) => p === position).length;
  const targetDepth = required + ((position === "RB" || position === "WR") ? Math.max(1, flexSlots) : 0);
  const need = targetDepth > owned ? 100 : Math.max(25, 78 - (owned - targetDepth + 1) * 16);
  const scarcity = position === "RB" ? 92 : position === "WR" ? 88 : position === "TE" ? 68 : 52;
  const experience = player.years_exp ?? 0;
  const agePenalty = player.age && player.age > 30 ? Math.min(20, (player.age - 30) * 3) : 0;
  const baseValue = Math.max(30, positionBase[position] - agePenalty + Math.min(5, experience));
  const projectionValue = projectionPercentile != null ? Math.max(0, Math.min(100, projectionPercentile)) : baseValue;
  const availabilityPressure = position === "RB" || position === "WR" ? 86 : position === "TE" ? 62 : 48;
  const health = player.injury_status ? 58 : 90;
  const score = Math.round(
    projectionValue * 0.36 +
    need * 0.24 +
    scarcity * 0.16 +
    availabilityPressure * 0.12 +
    health * 0.08 +
    75 * 0.04,
  );

  return {
    score,
    position,
    projectedSeason: seasonProjection,
    parts: {
      playerValue: Math.round(projectionValue),
      rosterNeed: Math.round(need),
      scarcity: Math.round(scarcity),
      availabilityPressure: Math.round(availabilityPressure),
      health: Math.round(health),
    },
    reason: need >= 90
      ? `You still need ${position} depth${position === "RB" || position === "WR" ? " at a priority fantasy position" : ""}.`
      : projectionPercentile != null && projectionPercentile >= 85
        ? `Strong projected value even though ${position} is not your biggest roster need.`
        : `Useful ${position} depth, but you are not forced into this position right now.`,
  };
}

export function waiverScore(player: SleeperPlayer, trendCount: number, weeklyProjection?: number, projectionPercentile?: number) {
  const position = playerPosition(player);
  if (!position) return null;
  const trend = Math.min(100, Math.round(Math.log10(Math.max(1, trendCount)) * 32));
  const positionalValue = position === "RB" ? 95 : position === "WR" ? 90 : position === "TE" ? 72 : 65;
  const projection = projectionPercentile ?? 50;
  const health = player.injury_status ? 50 : 90;
  return Math.round(trend * 0.35 + positionalValue * 0.20 + projection * 0.35 + health * 0.10);
}

export function lineupDecision(
  starter: { player: SleeperPlayer; projection?: number },
  bench: { player: SleeperPlayer; projection?: number },
) {
  if (starter.projection == null || bench.projection == null) return null;
  const delta = bench.projection - starter.projection;
  if (delta <= 0.5) return null;
  return {
    out: starter.player,
    in: bench.player,
    delta: Math.round(delta * 10) / 10,
    confidence: delta >= 5 ? "High" : delta >= 2 ? "Medium" : "Close call",
  };
}