export type Projection = {
  playerId: string;
  weeklyPoints?: number;
  seasonPoints?: number;
  source: "sleeper" | "fantasypros" | "fallback";
  stats?: Record<string, number>;
};

export type PlayerIntelligence = {
  playerId: string;
  weeklyProjection?: number;
  seasonProjection?: number;
  rank?: number;
  positionalRank?: number;
  adp?: number;
  tier?: number;
  source: string;
};

export function scoringKey(scoring: Record<string, number>) {
  const reception = scoring.rec ?? 0;
  if (reception >= 0.75) return "ppr";
  if (reception >= 0.25) return "half_ppr";
  return "std";
}

export function projectedPoints(stats: Record<string, unknown> | undefined, format: "ppr" | "half_ppr" | "std") {
  if (!stats) return undefined;
  const key = format === "ppr" ? "pts_ppr" : format === "half_ppr" ? "pts_half_ppr" : "pts_std";
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function confidenceLabel(delta: number) {
  if (delta >= 5) return "High";
  if (delta >= 2) return "Medium";
  return "Close call";
}

export function round1(value: number | undefined) {
  return typeof value === "number" ? Math.round(value * 10) / 10 : undefined;
}