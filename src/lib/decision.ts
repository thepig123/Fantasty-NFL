import type { SleeperPlayer } from "./sleeper";

export type Position = "QB" | "RB" | "WR" | "TE";

const positionBase: Record<Position, number> = { RB: 94, WR: 92, TE: 72, QB: 68 };

export function playerPosition(player: SleeperPlayer): Position | undefined {
  const position = (player.fantasy_positions?.[0] ?? player.position) as Position | undefined;
  return position && position in positionBase ? position : undefined;
}

function draftStrategyAdjustment(
  position: Position,
  rosterPositions: string[],
  rosteredPositions: string[],
) {
  const pickNumberForYou = rosteredPositions.length + 1;
  const requiredQbs = rosterPositions.filter((p) => p === "QB").length;
  const hasSuperflex = rosterPositions.includes("SUPER_FLEX") || requiredQbs >= 2;
  const owned = rosteredPositions.filter((p) => p === position).length;

  if (hasSuperflex) {
    if (position === "QB") {
      if (pickNumberForYou <= 2) return 18;
      if (pickNumberForYou <= 5 && owned === 0) return 12;
      if (owned >= 2) return -18;
      return 5;
    }
    return position === "RB" || position === "WR" ? 3 : 0;
  }

  // Normal one-QB redraft strategy: RB/WR carry more opportunity-cost value early.
  if (position === "QB") {
    if (owned >= 1 && pickNumberForYou <= 10) return -30;
    if (pickNumberForYou === 1) return -28;
    if (pickNumberForYou === 2) return -22;
    if (pickNumberForYou === 3) return -14;
    if (pickNumberForYou === 4) return -8;
    if (pickNumberForYou >= 5 && pickNumberForYou <= 7 && owned === 0) return 4;
    if (pickNumberForYou >= 8 && owned === 0) return 10;
    return -4;
  }

  if (position === "TE") {
    if (owned >= 1 && pickNumberForYou <= 9) return -24;
    if (pickNumberForYou === 1) return -10;
    if (pickNumberForYou === 2) return -6;
    return 0;
  }

  if (position === "RB" || position === "WR") {
    if (pickNumberForYou === 1) return 8;
    if (pickNumberForYou === 2) return 6;
    if (pickNumberForYou <= 4) return 4;
    return 1;
  }

  return 0;
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
  const strategy = draftStrategyAdjustment(position, rosterPositions, rosteredPositions);
  const rawScore =
    projectionValue * 0.36 +
    need * 0.24 +
    scarcity * 0.16 +
    availabilityPressure * 0.12 +
    health * 0.08 +
    75 * 0.04 +
    strategy;
  const score = Math.max(1, Math.min(100, Math.round(rawScore)));
  const pickNumberForYou = rosteredPositions.length + 1;
  const hasSuperflex = rosterPositions.includes("SUPER_FLEX") || rosterPositions.filter((p) => p === "QB").length >= 2;

  let reason: string;
  if (!hasSuperflex && position === "QB" && pickNumberForYou <= 4) {
    reason = `Strong player, but QB is intentionally de-prioritized this early in a one-QB league. RB/WR usually gives better value here.`;
  } else if (hasSuperflex && position === "QB" && pickNumberForYou <= 5) {
    reason = `Your league allows extra QB value (Superflex/2QB), so quarterbacks are correctly treated as early-round priorities.`;
  } else if (need >= 90) {
    reason = `You still need ${position} depth${position === "RB" || position === "WR" ? " at a priority fantasy position" : ""}.`;
  } else if (projectionPercentile != null && projectionPercentile >= 85) {
    reason = `Strong projected value even though ${position} is not your biggest roster need.`;
  } else {
    reason = `Useful ${position} depth, but you are not forced into this position right now.`;
  }

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
      strategy,
    },
    reason,
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
