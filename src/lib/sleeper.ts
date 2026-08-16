export const SLEEPER_BASE = "https://api.sleeper.app/v1";

export type SleeperUser = { user_id: string; username: string; display_name: string; avatar?: string };
export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
};
export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings: Record<string, number>;
};
export type SleeperDraft = {
  draft_id: string;
  league_id: string;
  status: "pre_draft" | "drafting" | "complete";
  type: string;
  settings: { rounds?: number; teams?: number; pick_timer?: number };
  slot_to_roster_id?: Record<string, number>;
};
export type SleeperDraftPick = {
  player_id: string;
  roster_id: number;
  round: number;
  pick_no: number;
  draft_slot: number;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string };
};
export type SleeperPlayer = {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string | null;
  status?: string;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  practice_participation?: string | null;
  depth_chart_position?: number | null;
  years_exp?: number;
  age?: number;
  number?: number | null;
  college?: string | null;
};
export type SleeperMatchup = {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  custom_points?: number | null;
  starters: string[];
  players: string[];
  starters_points?: number[];
};
export type SleeperTransaction = {
  transaction_id: string;
  type: "waiver" | "free_agent" | "trade" | string;
  status: string;
  roster_ids: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  waiver_budget?: Array<{ sender: number; receiver: number; amount: number }>;
  created?: number;
};
export type NflState = {
  week: number;
  display_week: number;
  season: string;
  season_type: string;
  leg: number;
  league_season?: string;
  previous_season?: string;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sleeper API ${res.status}: ${path}`);
  return res.json();
}

export const sleeper = {
  user: (username: string) => get<SleeperUser>(`/user/${encodeURIComponent(username)}`),
  leagues: (userId: string, season = "2026") => get<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`),
  rosters: (leagueId: string) => get<SleeperRoster[]>(`/league/${leagueId}/rosters`),
  drafts: (leagueId: string) => get<SleeperDraft[]>(`/league/${leagueId}/drafts`),
  picks: (draftId: string) => get<SleeperDraftPick[]>(`/draft/${draftId}/picks`),
  matchups: (leagueId: string, week: number) => get<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`),
  transactions: (leagueId: string, week: number) => get<SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`),
  state: () => get<NflState>(`/state/nfl`),
  trending: (type: "add" | "drop" = "add") => get<Array<{ player_id: string; count: number }>>(`/players/nfl/trending/${type}?lookback_hours=24&limit=100`),
};