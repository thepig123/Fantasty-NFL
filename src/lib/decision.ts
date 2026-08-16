import type { SleeperPlayer } from "./sleeper";

export type Position = "QB" | "RB" | "WR" | "TE";

const positionBase: Record<Position, number> = { RB: 94, WR: 92, TE: 72, QB: 68 };

export function draftScore(player: SleeperPlayer, rosterPositions: string[], rosteredPositions: string[]) {
  const position = (player.fantasy_positions?.[0] ?? player.position) as Position | undefined;
  if (!position || !(position in positionBase)) return null;

  const required = rosterPositions.filter((p) => p === position).length;
  const owned = rosteredPositions.filter((p) => p === position).length;
  const need = required > owned ? 100 : Math.max(30, 80 - (owned - required + 1) * 15);
  const scarcity = position === "RB" ? 90 : position === "WR" ? 86 : position === "TE" ? 66 : 55;
  const experience = player.years_exp ?? 0;
  const agePenalty = player.age && player.age > 30 ? Math.min(18, (player.age - 30) * 3) : 0;
  const value = Math.max(35, positionBase[position] - agePenalty + Math.min(6, experience));
  const availabilityPressure = position === "RB" || position === "WR" ? 85 : 55;
  const score = Math.round(value * 0.34 + need * 0.26 + scarcity * 0.18 + availabilityPressure * 0.16 + 75 * 0.06);

  return {
    score,
    position,
    parts: { value: Math.round(value), need, scarcity, availabilityPressure },
    reason: need >= 90
      ? `You still need a starting ${position}. ${position === "RB" || position === "WR" ? "This is a priority position." : "Fill the position if the value is right."}`
      : `Useful ${position} depth, but you are not forced into this position right now.`,
  };
}

export function waiverScore(player: SleeperPlayer, trendCount: number) {
  const position = (player.fantasy_positions?.[0] ?? player.position) as Position | undefined;
  if (!position || !(position in positionBase)) return null;
  const trend = Math.min(100, Math.round(Math.log10(Math.max(1, trendCount)) * 32));
  const positionalValue = position === "RB" ? 95 : position === "WR" ? 90 : position === "TE" ? 72 : 65;
  return Math.round(trend * 0.65 + positionalValue * 0.35);
}