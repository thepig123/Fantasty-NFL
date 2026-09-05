import type { SleeperPlayer } from "./sleeper";

export type Position = "QB" | "RB" | "WR" | "TE";

const positionBase: Record<Position, number> = { RB: 88, WR: 90, TE: 80, QB: 80 };

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
  const qbOwned = rosteredPositions.filter((p) => p === "QB").length;
  const teOwned = rosteredPositions.filter((p) => p === "TE").length;
  const rbOwned = rosteredPositions.filter((p) => p === "RB").length;
  const wrOwned = rosteredPositions.filter((p) => p === "WR").length;

  if (hasSuperflex) {
    if (position === "QB") {
      if (pickNumberForYou <= 2) return 22;
      if (pickNumberForYou <= 5 && owned === 0) return 18;
      if (owned >= 2) return -18;
      return 10;
    }
    if (position === "RB" && rbOwned >= 4) return -24;
    if (position === "WR" && wrOwned >= 5) return -18;
    return position === "RB" || position === "WR" ? 2 : 0;
  }

  // Normal one-QB redraft: delay QB early, but make the first QB a priority in the middle rounds.
  if (position === "QB") {
    if (qbOwned >= 1 && pickNumberForYou <= 10) return -40;
    if (pickNumberForYou === 1) return -30;
    if (pickNumberForYou === 2) return -24;
    if (pickNumberForYou === 3) return -14;
    if (pickNumberForYou === 4) return -5;
    if (qbOwned === 0 && pickNumberForYou === 5) return 16;
    if (qbOwned === 0 && pickNumberForYou === 6) return 24;
    if (qbOwned === 0 && pickNumberForYou >= 7) return 34;
    return -5;
  }

  if (position === "TE") {
    if (teOwned >= 1 && pickNumberForYou <= 9) return -30;
    if (pickNumberForYou === 1) return -12;
    if (pickNumberForYou === 2) return -6;
    if (teOwned === 0 && pickNumberForYou >= 8) return 28;
    if (teOwned === 0 && pickNumberForYou >= 6) return 20;
    if (teOwned === 0 && pickNumberForYou >= 4) return 8;
    return 0;
  }

  // Once you have a usable core, stop flooding the board with the same position.
  if (position === "RB") {
    if (rbOwned >= 5) return -50;
    if (rbOwned >= 4) return -42;
    if (rbOwned >= 3) return -32;
    if (pickNumberForYou <= 2) return 6;
    if (pickNumberForYou <= 4) return 3;
    return 0;
  }

  if (position === "WR") {
    if (wrOwned >= 6) return -42;
    if (wrOwned >= 5) return -32;
    if (wrOwned >= 4) return -22;
    if (pickNumberForYou <= 2) return 7;
    if (pickNumberForYou <= 4) return 4;
    return 0;
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
  const flexSlots = rosterPositions.filter((p) => p.includes("FLEX") && p !== "SUPER_FLEX").length;
  const owned = rosteredPositions.filter((p) => p === position).length;

  // FLEX demand is shared. Do not let both RB and WR independently claim every FLEX spot.
  const sharedFlexDepth = Math.ceil(flexSlots / 2);
  const targetDepth = required + ((position === "RB" || position === "WR") ? Math.max(1, sharedFlexDepth) : 0);
  const need = targetDepth > owned ? 100 : Math.max(12, 68 - (owned - targetDepth + 1) * 20);

  const scarcity = position === "RB" ? 82 : position === "WR" ? 84 : position === "TE" ? 76 : 72;
  const experience = player.years_exp ?? 0;
  const agePenalty = player.age && player.age > 30 ? Math.min(20, (player.age - 30) * 3) : 0;
  const baseValue = Math.max(30, positionBase[position] - agePenalty + Math.min(5, experience));
  const projectionValue = projectionPercentile != null ? Math.max(0, Math.min(100, projectionPercentile)) : baseValue;
  const availabilityPressure = position === "RB" ? 74 : position === "WR" ? 76 : position === "TE" ? 72 : 72;
  const health = player.injury_status ? 58 : 90;
  const strategy = draftStrategyAdjustment(position, rosterPositions, rosteredPositions);
  const rawScore =
    projectionValue * 0.40 +
    need * 0.20 +
    scarcity * 0.12 +
    availabilityPressure * 0.08 +
    health * 0.08 +
    75 * 0.12 +
    strategy;
  const score = Math.max(1, Math.min(100, Math.round(rawScore)));
  const pickNumberForYou = rosteredPositions.length + 1;
  const hasSuperflex = rosterPositions.includes("SUPER_FLEX") || rosterPositions.filter((p) => p === "QB").length >= 2;

  let reason: string;
  if (!hasSuperflex && position === "QB" && pickNumberForYou <= 4) {
    reason = "Good player, but QB is intentionally de-prioritized this early in a one-QB league.";
  } else if (!hasSuperflex && position === "QB" && owned === 0 && pickNumberForYou >= 5) {
    reason = "You still need your first QB, so quarterback is now a real roster priority.";
  } else if (position === "TE" && owned === 0 && pickNumberForYou >= 4) {
    reason = "You still need your first TE, so tight end is gaining priority as the draft moves on.";
  } else if (hasSuperflex && position === "QB" && pickNumberForYou <= 5) {
    reason = "Your league is Superflex/2QB, so quarterbacks correctly carry early-round value.";
  } else if ((position === "RB" && owned >= 3) || (position === "WR" && owned >= 4)) {
    reason = `You already have ${owned} ${position}s. Another one is heavily de-prioritized unless the value is exceptional.`;
  } else if (need >= 90) {
    reason = `You still have a meaningful ${position} roster need.`;
  } else if (projectionPercentile != null && projectionPercentile >= 85) {
    reason = `Strong projected value even though ${position} is not your biggest roster need.`;
  } else {
    reason = `Useful ${position} option, but you are not forced into this position.`;
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
