"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sleeper,
  type NflState,
  type SleeperDraft,
  type SleeperDraftPick,
  type SleeperLeague,
  type SleeperMatchup,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperTransaction,
  type SleeperUser,
} from "@/lib/sleeper";
import { draftScore, lineupDecision, playerPosition, waiverScore } from "@/lib/decision";
import { projectedPoints, scoringKey } from "@/lib/fantasy";

type Tab = "dashboard" | "draft" | "lineup" | "waivers" | "players" | "league" | "guide";
type PlayerMap = Record<string, SleeperPlayer>;
type ProjectionRow = { playerId: string; stats: Record<string, number>; source: string };
type ProjectionMap = Record<string, ProjectionRow>;
type IntelligencePayload = { weekly: ProjectionMap; season: ProjectionMap; weekNumber: number; source: string };
type PracticePick = { playerId: string; mine: boolean };

type Recommendation = {
  player: SleeperPlayer;
  rating: NonNullable<ReturnType<typeof draftScore>>;
  seasonProjection: number | undefined;
};

const fantasyPositions = ["QB", "RB", "WR", "TE"];

export default function Home() {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [league, setLeague] = useState<SleeperLeague | null>(null);
  const [rosters, setRosters] = useState<SleeperRoster[]>([]);
  const [drafts, setDrafts] = useState<SleeperDraft[]>([]);
  const [picks, setPicks] = useState<SleeperDraftPick[]>([]);
  const [practicePicks, setPracticePicks] = useState<PracticePick[]>([]);
  const [players, setPlayers] = useState<PlayerMap>({});
  const [trendingAdds, setTrendingAdds] = useState<Array<{ player_id: string; count: number }>>([]);
  const [trendingDrops, setTrendingDrops] = useState<Array<{ player_id: string; count: number }>>([]);
  const [nflState, setNflState] = useState<NflState | null>(null);
  const [matchups, setMatchups] = useState<SleeperMatchup[]>([]);
  const [transactions, setTransactions] = useState<SleeperTransaction[]>([]);
  const [intelligence, setIntelligence] = useState<IntelligencePayload>({ weekly: {}, season: {}, weekNumber: 1, source: "none" });
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("fantasy-copilot-username");
    if (saved) setUsername(saved);
  }, []);

  const myRoster = useMemo(() => rosters.find((r) => r.owner_id === user?.user_id) ?? null, [rosters, user]);
  const rosteredIds = useMemo(() => new Set(rosters.flatMap((r) => r.players ?? [])), [rosters]);
  const realDraftedIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);
  const practiceTakenIds = useMemo(() => new Set(practicePicks.map((p) => p.playerId)), [practicePicks]);
  const draftBlockedIds = useMemo(() => new Set([...realDraftedIds, ...practiceTakenIds]), [realDraftedIds, practiceTakenIds]);
  const scoring = useMemo(() => scoringKey(league?.scoring_settings ?? {}), [league]);

  const weeklyProjection = (id: string) => projectedPoints(intelligence.weekly[id]?.stats, scoring);
  const seasonProjection = (id: string) => projectedPoints(intelligence.season[id]?.stats, scoring);

  const seasonProjectionValues = useMemo(() => {
    return Object.values(intelligence.season)
      .map((row) => projectedPoints(row.stats, scoring))
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
  }, [intelligence.season, scoring]);

  const weeklyProjectionValues = useMemo(() => {
    return Object.values(intelligence.weekly)
      .map((row) => projectedPoints(row.stats, scoring))
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
  }, [intelligence.weekly, scoring]);

  function percentile(value: number | undefined, values: number[]) {
    if (value == null || !values.length) return undefined;
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (values[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return Math.round((lo / values.length) * 100);
  }

  const myDraftPositions = useMemo(() => {
    const real = (myRoster?.players ?? []).map((id) => playerPosition(players[id])).filter(Boolean) as string[];
    const practiceMine = practicePicks.filter((p) => p.mine).map((p) => playerPosition(players[p.playerId])).filter(Boolean) as string[];
    return [...real, ...practiceMine];
  }, [myRoster, players, practicePicks]);

  const recommendations = useMemo<Recommendation[]>(() => {
    if (!league) return [];
    return Object.values(players)
      .filter((p) => !draftBlockedIds.has(p.player_id) && fantasyPositions.includes(playerPosition(p) ?? "") && p.status !== "Inactive")
      .flatMap((player): Recommendation[] => {
        const projection = seasonProjection(player.player_id);
        const rating = draftScore(player, league.roster_positions, myDraftPositions, projection, percentile(projection, seasonProjectionValues));
        return rating ? [{ player, rating, seasonProjection: projection }] : [];
      })
      .sort((a, b) => b.rating.score - a.rating.score || (b.seasonProjection ?? 0) - (a.seasonProjection ?? 0))
      .slice(0, 80);
  }, [players, draftBlockedIds, league, myDraftPositions, seasonProjectionValues, intelligence.season, scoring]);

  const waiverTargets = useMemo(() => {
    return trendingAdds
      .filter((t) => !rosteredIds.has(t.player_id))
      .map((trend) => {
        const player = players[trend.player_id];
        if (!player) return null;
        const projection = weeklyProjection(player.player_id);
        const score = waiverScore(player, trend.count, projection, percentile(projection, weeklyProjectionValues));
        return score == null ? null : { trend, player, score, projection };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
  }, [trendingAdds, rosteredIds, players, weeklyProjectionValues, intelligence.weekly, scoring]);

  const lineupMoves = useMemo(() => {
    if (!league || !myRoster?.players?.length || !myRoster.starters?.length) return [];
    const starterSet = new Set(myRoster.starters);
    const benchIds = myRoster.players.filter((id) => !starterSet.has(id));
    const moves: Array<ReturnType<typeof lineupDecision> & { slot: string }> = [];

    myRoster.starters.forEach((starterId, index) => {
      const starter = players[starterId];
      if (!starter) return;
      const slot = league.roster_positions[index] ?? starter.position ?? "FLEX";
      const eligible = benchIds
        .map((id) => players[id])
        .filter(Boolean)
        .filter((candidate) => eligibleForSlot(candidate, slot))
        .map((candidate) => ({ player: candidate, projection: weeklyProjection(candidate.player_id) }))
        .filter((candidate) => candidate.projection != null)
        .sort((a, b) => (b.projection ?? 0) - (a.projection ?? 0));
      if (!eligible[0]) return;
      const decision = lineupDecision({ player: starter, projection: weeklyProjection(starterId) }, eligible[0]);
      if (decision) moves.push({ ...decision, slot });
    });

    return moves.filter(Boolean).sort((a, b) => (b?.delta ?? 0) - (a?.delta ?? 0));
  }, [league, myRoster, players, intelligence.weekly, scoring]);

  const activeDraft = drafts.find((d) => d.status === "drafting") ?? drafts[0];
  const practiceMode = !activeDraft || activeDraft.status !== "drafting";
  const currentWeek = nflState?.display_week || nflState?.week || 1;
  const selectedPlayer = selectedPlayerId ? players[selectedPlayerId] : null;

  async function loadAccount() {
    if (!username.trim()) return;
    setLoading(true); setError("");
    try {
      const u = await sleeper.user(username.trim());
      const ls = await sleeper.leagues(u.user_id, "2026");
      setUser(u); setLeagues(ls); setLeague(null);
      window.localStorage.setItem("fantasy-copilot-username", username.trim());
      if (!ls.length) setError("No 2026 Sleeper NFL leagues were found for this account.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Sleeper account"); }
    finally { setLoading(false); }
  }

  async function selectLeague(selected: SleeperLeague, preserveTab = false) {
    setLoading(true); setError("");
    try {
      const [rs, ds, playerResponse, adds, drops, state] = await Promise.all([
        sleeper.rosters(selected.league_id), sleeper.drafts(selected.league_id), fetch("/api/players"), sleeper.trending("add"), sleeper.trending("drop"), sleeper.state(),
      ]);
      if (!playerResponse.ok) throw new Error("Could not load the Sleeper player database.");
      const playerData = await playerResponse.json() as PlayerMap;
      const week = state.display_week || state.week || 1;
      const draft = ds.find((d) => d.status === "drafting") ?? ds[0];
      const [draftPicks, matchupData, transactionData, intelResponse] = await Promise.all([
        draft ? sleeper.picks(draft.draft_id) : Promise.resolve([]),
        sleeper.matchups(selected.league_id, week).catch(() => []),
        sleeper.transactions(selected.league_id, week).catch(() => []),
        fetch(`/api/intelligence?season=${selected.season}&week=${week}`),
      ]);
      const intel = intelResponse.ok ? await intelResponse.json() as IntelligencePayload : { weekly: {}, season: {}, weekNumber: week, source: "unavailable" };
      setLeague(selected); setRosters(rs); setDrafts(ds); setPicks(draftPicks); setPlayers(playerData); setTrendingAdds(adds); setTrendingDrops(drops); setNflState(state); setMatchups(matchupData); setTransactions(transactionData); setIntelligence(intel); setLastUpdated(new Date());
      if (!preserveTab) { setPracticePicks([]); setTab("dashboard"); }
      window.localStorage.setItem("fantasy-copilot-league", selected.league_id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load league"); }
    finally { setLoading(false); }
  }

  function mockPick(playerId: string, mine = true) { setPracticePicks((old) => [...old, { playerId, mine }]); }
  function simulateOtherManagers() {
    const amount = Math.max(1, (league?.total_rosters ?? 10) - 1);
    setPracticePicks((old) => [...old, ...recommendations.slice(0, amount).map((r) => ({ playerId: r.player.player_id, mine: false }))]);
  }

  if (!league) return <main className="shell"><section className="card setup"><div className="eyebrow">NFL FANTASY WITHOUT THE NFL HOMEWORK</div><div className="brand"><h1>🏈 Fantasy Copilot</h1><p className="muted">Connect Sleeper once. The app turns your league into simple decisions.</p></div><div className="row setupRow"><input className="input" placeholder="Sleeper username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadAccount()} /><button className="btn" onClick={loadAccount} disabled={loading}>{loading ? "Loading…" : "Find my leagues"}</button></div>{error && <p className="error">{error}</p>}{user && <div className="leaguePicker"><p><strong>{user.display_name}</strong> · choose your 2026 league</p><div className="list">{leagues.map((l) => <button key={l.league_id} className="item clickable" onClick={() => selectLeague(l)}><span><strong>{l.name}</strong><span className="muted tiny">{l.total_rosters} teams · {l.status}</span></span><span>Open →</span></button>)}</div></div>}<div className="setupHints"><span>✓ Draft helper</span><span>✓ Start/sit advice</span><span>✓ Waiver radar</span><span>✓ Injury alerts</span></div></section></main>;

  return <main className="shell">
    <header className="topbar"><div className="brand"><h1>🏈 Fantasy Copilot</h1><div className="muted"><span className="leagueName">{league.name}</span> · Week {currentWeek} · {formatScoring(scoring)}</div></div><div className="row"><button className="btn secondary" onClick={() => selectLeague(league, true)} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh"}</button><button className="btn secondary" onClick={() => setLeague(null)}>Change league</button></div></header>
    <nav className="nav">{(["dashboard", "draft", "lineup", "waivers", "players", "league", "guide"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{tabLabel(t)}</button>)}</nav>
    {error && <p className="error">{error}</p>}{lastUpdated && <div className="syncLine"><span className="statusDot" /> Synced with Sleeper {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Projection feed: {Object.keys(intelligence.weekly).length ? "available" : "limited"}</div>}
    {tab === "dashboard" && <Dashboard league={league} roster={myRoster} activeDraft={activeDraft} players={players} recommendations={recommendations} waiverTargets={waiverTargets} lineupMoves={lineupMoves} matchups={matchups} rosters={rosters} currentWeek={currentWeek} weeklyProjection={weeklyProjection} setTab={setTab} practiceMode={practiceMode} />}
    {tab === "draft" && <DraftView league={league} activeDraft={activeDraft} realPicks={picks} practiceMode={practiceMode} practicePicks={practicePicks} players={players} recommendations={recommendations} onPick={mockPick} onUndo={() => setPracticePicks((old) => old.slice(0, -1))} onReset={() => setPracticePicks([])} onSimulateOthers={simulateOtherManagers} />}
    {tab === "lineup" && <LineupView league={league} roster={myRoster} players={players} moves={lineupMoves} weeklyProjection={weeklyProjection} currentWeek={currentWeek} />}
    {tab === "waivers" && <WaiverView targets={waiverTargets} drops={trendingDrops} roster={myRoster} players={players} weeklyProjection={weeklyProjection} onPlayer={setSelectedPlayerId} />}
    {tab === "players" && <PlayersView players={players} query={query} setQuery={setQuery} rosteredIds={rosteredIds} weeklyProjection={weeklyProjection} seasonProjection={seasonProjection} onPlayer={setSelectedPlayerId} />}
    {tab === "league" && <LeagueView league={league} rosters={rosters} matchupData={matchups} transactions={transactions} players={players} myRoster={myRoster} weeklyProjection={weeklyProjection} currentWeek={currentWeek} />}
    {tab === "guide" && <GuideView />}
    {selectedPlayer && <PlayerDrawer player={selectedPlayer} rostered={rosteredIds.has(selectedPlayer.player_id)} weekly={weeklyProjection(selectedPlayer.player_id)} season={seasonProjection(selectedPlayer.player_id)} onClose={() => setSelectedPlayerId(null)} />}
  </main>;
}

function Dashboard({ league, roster, activeDraft, players, recommendations, waiverTargets, lineupMoves, matchups, rosters, currentWeek, weeklyProjection, setTab, practiceMode }: any) {
  const injuries = (roster?.players ?? []).map((id: string) => players[id]).filter((p: SleeperPlayer | undefined) => p?.injury_status);
  const myMatch = matchups.find((m: SleeperMatchup) => m.roster_id === roster?.roster_id);
  const opponent = myMatch?.matchup_id != null ? matchups.find((m: SleeperMatchup) => m.matchup_id === myMatch.matchup_id && m.roster_id !== roster?.roster_id) : null;
  const myProjected = sumProjected(roster?.starters ?? [], weeklyProjection);
  const opponentRoster = opponent ? rosters.find((r: SleeperRoster) => r.roster_id === opponent.roster_id) : null;
  const opponentProjected = sumProjected(opponentRoster?.starters ?? [], weeklyProjection);
  const top = recommendations[0];
  return <><section className="decisionHero card"><div><div className="eyebrow">WHAT SHOULD I DO?</div><h2>{lineupMoves[0] ? `Make ${lineupMoves.length} lineup change${lineupMoves.length > 1 ? "s" : ""}` : injuries.length ? `Check ${injuries.length} injury flag${injuries.length > 1 ? "s" : ""}` : practiceMode ? "Practice your draft" : "You are mostly set"}</h2><p className="muted">{lineupMoves[0] ? `${nameOf(lineupMoves[0].in)} projects ${lineupMoves[0].delta} points above ${nameOf(lineupMoves[0].out)}.` : injuries[0] ? `${nameOf(injuries[0])} is currently listed ${injuries[0].injury_status}.` : practiceMode ? "Build a mock roster and let the dashboard react to every pick." : "No obvious high-priority move is showing right now."}</p></div><button className="btn" onClick={() => setTab(lineupMoves[0] || injuries.length ? "lineup" : practiceMode ? "draft" : "waivers")}>Open recommendation →</button></section><div className="grid">
    <MetricCard title={`WEEK ${currentWeek} PROJECTION`} value={myProjected != null ? myProjected.toFixed(1) : "—"} detail={opponentProjected != null ? `Opponent: ${opponentProjected.toFixed(1)} · ${myProjected! >= opponentProjected ? "projected ahead" : "projected behind"}` : "Projection data will fill this automatically."} tone={myProjected != null && opponentProjected != null ? (myProjected >= opponentProjected ? "positive" : "warning") : ""} />
    <MetricCard title="LINEUP ACTIONS" value={String(lineupMoves.length)} detail={lineupMoves.length ? "Potential start/sit upgrades found" : "No clear swap detected"} tone={lineupMoves.length ? "warning" : "positive"} />
    <MetricCard title="INJURY FLAGS" value={String(injuries.length)} detail={injuries.length ? injuries.slice(0, 2).map(nameOf).join(", ") : "No flagged players on your roster"} tone={injuries.length ? "warning" : "positive"} />
    <section className="card span8"><div className="sectionHeader"><div><div className="eyebrow">ACTION QUEUE</div><h2 className="sectionTitle">Things worth your attention</h2></div></div><div className="actions">{lineupMoves.slice(0, 2).map((move: any) => <button className="action good clickable" key={`${move.in.player_id}-${move.out.player_id}`} onClick={() => setTab("lineup")}><strong>Start {nameOf(move.in)} over {nameOf(move.out)}</strong><div className="muted">+{move.delta} projected points · {move.confidence} confidence</div></button>)}{injuries.slice(0, 2).map((p: SleeperPlayer) => <button className="action warn clickable" key={p.player_id} onClick={() => setTab("lineup")}><strong>Monitor {nameOf(p)}</strong><div className="muted">{p.injury_status}{p.injury_body_part ? ` · ${p.injury_body_part}` : ""}{p.practice_participation ? ` · ${p.practice_participation}` : ""}</div></button>)}{practiceMode && top && <button className="action clickable" onClick={() => setTab("draft")}><strong>Practice draft recommendation: {nameOf(top.player)}</strong><div className="muted">Current decision score {top.rating.score}/100. Use the mock draft before the real draft starts.</div></button>}{waiverTargets[0] && <button className="action clickable" onClick={() => setTab("waivers")}><strong>Waiver radar: {nameOf(waiverTargets[0].player)}</strong><div className="muted">Trending add and currently unrostered in your league.</div></button>}</div></section>
    <section className="card span4"><div className="eyebrow">LEAGUE FORMAT</div><h2 className="sectionTitle">What matters here</h2><div className="list compact"><div className="item"><span>Teams</span><strong>{league.total_rosters}</strong></div><div className="item"><span>Scoring</span><strong>{formatScoring(scoringKey(league.scoring_settings))}</strong></div><div className="item"><span>Starters</span><strong>{league.roster_positions.filter((p: string) => p !== "BN").length}</strong></div><div className="item"><span>Draft</span><strong>{activeDraft?.status ?? "not created"}</strong></div></div></section>
  </div></>;
}

function MetricCard({ title, value, detail, tone = "" }: { title: string; value: string; detail: string; tone?: string }) { return <section className="card span4"><div className="eyebrow">{title}</div><div className={`metric ${tone}`}>{value}</div><div className="muted tiny">{detail}</div></section>; }

function DraftView({ league, realPicks, practiceMode, practicePicks, players, recommendations, onPick, onUndo, onReset, onSimulateOthers }: any) {
  const top = recommendations[0]; const mine = practicePicks.filter((p: PracticePick) => p.mine); const pickNumber = practicePicks.length + 1;
  return <div className="grid"><section className="card span12 draftToolbar"><div><div className="pill">{practiceMode ? "PRACTICE MODE" : "LIVE SLEEPER DRAFT"}</div><h2>{practiceMode ? `Overall mock pick #${pickNumber}` : `${realPicks.length} picks completed`}</h2><p className="muted">{practiceMode ? "Pick for yourself, then simulate the other managers. Recommendations recalculate as the board changes." : "Refresh periodically during the draft. Sleeper picks are removed automatically."}</p></div>{practiceMode && <div className="row"><button className="btn" onClick={onSimulateOthers}>Simulate other managers</button><button className="btn secondary" onClick={onUndo} disabled={!practicePicks.length}>Undo</button><button className="btn secondary" onClick={onReset} disabled={!practicePicks.length}>Reset</button></div>}</section>
    <section className="card span8 heroRecommendation"><div className="eyebrow">BEST PICK RIGHT NOW</div>{top ? <><div className="recommendationTitle"><div><h2>{nameOf(top.player)}</h2><div className="muted">{top.rating.position} · {top.player.team ?? "FA"}{top.seasonProjection != null ? ` · ${top.seasonProjection.toFixed(1)} projected season pts` : ""}</div></div><div className="bigScore">{top.rating.score}</div></div><p>{top.rating.reason}</p><div className="bars">{Object.entries(top.rating.parts).map(([label, value]) => <div className="barLine" key={label}><span>{pretty(label)}</span><div className="bar"><div style={{ width: `${value}%` }} /></div><strong>{String(value)}</strong></div>)}</div>{practiceMode && <button className="btn draftButton" onClick={() => onPick(top.player.player_id, true)}>Draft {nameOf(top.player)}</button>}</> : <div className="empty">No eligible player recommendation available.</div>}</section>
    <section className="card span4"><div className="eyebrow">YOUR MOCK ROSTER</div><h2 className="sectionTitle">{mine.length} players</h2><div className="positionCounts">{fantasyPositions.map((pos) => <span key={pos}><strong>{mine.filter((pick: PracticePick) => playerPosition(players[pick.playerId]) === pos).length}</strong>{pos}</span>)}</div><div className="list compact">{mine.slice(-8).reverse().map((pick: PracticePick, i: number) => <div className="item" key={`${pick.playerId}-${i}`}><span>{nameOf(players[pick.playerId])}</span><strong>{playerPosition(players[pick.playerId])}</strong></div>)}</div><p className="muted tiny note">Target roster: {league.roster_positions.join(" · ")}</p></section>
    <section className="card span7"><div className="eyebrow">SHORTLIST</div><h2 className="sectionTitle">Next best picks</h2><div className="list">{recommendations.slice(1, 15).map((r: Recommendation, i: number) => <button className="item clickable" key={r.player.player_id} onClick={() => practiceMode && onPick(r.player.player_id, true)}><span><strong>#{i + 2} {nameOf(r.player)}</strong><span className="muted tiny">{r.rating.position} · {r.player.team ?? "FA"}{r.seasonProjection != null ? ` · ${r.seasonProjection.toFixed(1)} proj.` : ""}</span></span><span className="score">{r.rating.score}</span></button>)}</div></section>
    <section className="card span5"><div className="eyebrow">BOARD ACTIVITY</div><h2 className="sectionTitle">{practiceMode ? "Recent simulated picks" : "Recent Sleeper picks"}</h2><div className="list compact">{practiceMode ? practicePicks.slice(-12).reverse().map((pick: PracticePick, i: number) => <div className="item" key={`${pick.playerId}-${i}`}><span><strong>{nameOf(players[pick.playerId])}</strong><span className="muted tiny">{pick.mine ? "YOU" : "OTHER MANAGER"} · {playerPosition(players[pick.playerId])}</span></span></div>) : realPicks.slice(-12).reverse().map((p: SleeperDraftPick) => <div className="item" key={`${p.pick_no}-${p.player_id}`}><span><strong>#{p.pick_no} {p.metadata?.first_name} {p.metadata?.last_name}</strong><span className="muted tiny">{p.metadata?.position} · {p.metadata?.team}</span></span><span>R{p.round}</span></div>)}</div>{practiceMode && !practicePicks.length && <div className="empty">Make your first mock pick above.</div>}</section></div>;
}

function LineupView({ league, roster, players, moves, weeklyProjection, currentWeek }: any) {
  if (!roster?.players?.length) return <section className="card emptyState"><h2>No roster yet</h2><p>Your real lineup page becomes useful immediately after the draft. Until then, use Draft → Practice Mode.</p></section>;
  const starters = roster.starters ?? []; const starterSet = new Set(starters); const bench = roster.players.filter((id: string) => !starterSet.has(id)); const injuries = roster.players.map((id: string) => players[id]).filter((p: SleeperPlayer | undefined) => p?.injury_status);
  return <div className="grid"><section className="card span12"><div className="eyebrow">WEEK {currentWeek}</div><h2 className="sectionTitle">Start / sit assistant</h2><p className="muted">Sleeper is read-only, so this dashboard recommends changes; you make the final lineup change inside Sleeper.</p></section>{moves.length > 0 && <section className="card span12 recommendationPanel"><div className="eyebrow">RECOMMENDED CHANGES</div><div className="actions">{moves.map((move: any) => <div className="lineupMove" key={`${move.in.player_id}-${move.out.player_id}`}><div className="swap"><span className="benchBadge">BENCH</span><strong>{nameOf(move.out)}</strong><span className="arrow">→</span><span className="startBadge">START</span><strong>{nameOf(move.in)}</strong></div><div className="positive">+{move.delta} projected pts · {move.confidence}</div></div>)}</div></section>}{injuries.length > 0 && <section className="card span12 injuryPanel"><div className="eyebrow">INJURY WATCH</div><div className="list">{injuries.map((p: SleeperPlayer) => <div className="item" key={p.player_id}><span><strong>{nameOf(p)}</strong><span className="muted tiny">{p.position} · {p.team ?? "FA"} · {p.injury_body_part ?? "injury"}</span></span><span className="tag danger">{p.injury_status}</span></div>)}</div></section>}<section className="card span7"><div className="eyebrow">STARTERS</div><div className="list">{starters.map((id: string, index: number) => <PlayerLine key={id} player={players[id]} slot={league.roster_positions[index] ?? players[id]?.position} projection={weeklyProjection(id)} />)}</div></section><section className="card span5"><div className="eyebrow">BENCH</div><div className="list">{bench.map((id: string) => <PlayerLine key={id} player={players[id]} slot="BN" projection={weeklyProjection(id)} />)}</div></section></div>;
}

function PlayerLine({ player, slot, projection }: { player?: SleeperPlayer; slot: string; projection?: number }) { return <div className="item"><span className="playerRow"><span className="slotBadge">{slot}</span><span><strong>{nameOf(player)}</strong><span className="muted tiny">{player?.position ?? "?"} · {player?.team ?? "FA"}{player?.injury_status ? ` · ${player.injury_status}` : ""}</span></span></span><span><strong>{projection != null ? projection.toFixed(1) : "—"}</strong><span className="muted tiny">proj.</span></span></div>; }

function WaiverView({ targets, drops, roster, players, weeklyProjection, onPlayer }: any) {
  const benchIds = roster?.players?.filter((id: string) => !(roster?.starters ?? []).includes(id)) ?? []; const worstBench = [...benchIds].sort((a, b) => (weeklyProjection(a) ?? -1) - (weeklyProjection(b) ?? -1));
  return <div className="grid"><section className="card span12"><div className="eyebrow">WAIVER WIRE</div><h2 className="sectionTitle">Available players getting attention</h2><p className="muted">Higher scores combine Sleeper add trends, fantasy position value, health and projections when available. You still add/drop players inside Sleeper.</p></section><section className="card span8"><div className="list">{targets.length ? targets.map((x: any, i: number) => { const samePosDrop = worstBench.map((id: string) => players[id]).find((p: SleeperPlayer | undefined) => p && playerPosition(p) === playerPosition(x.player)); return <button className="item clickable" key={x.player.player_id} onClick={() => onPlayer(x.player.player_id)}><span><strong>#{i + 1} {nameOf(x.player)}</strong><span className="muted tiny">{x.player.position} · {x.player.team ?? "FA"} · {x.trend.count} trending adds{x.projection != null ? ` · ${x.projection.toFixed(1)} week proj.` : ""}{samePosDrop ? ` · possible drop: ${nameOf(samePosDrop)}` : ""}</span></span><span className="score">{x.score}</span></button>; }) : <div className="empty">No waiver candidates loaded yet.</div>}</div></section><section className="card span4"><div className="eyebrow">TRENDING DOWN</div><h2 className="sectionTitle">Players people are dropping</h2><div className="list compact">{drops.slice(0, 15).map((d: any) => <div className="item" key={d.player_id}><span><strong>{nameOf(players[d.player_id])}</strong><span className="muted tiny">{players[d.player_id]?.position ?? "?"}</span></span><span>{d.count}</span></div>)}</div></section></div>;
}

function PlayersView({ players, query, setQuery, rosteredIds, weeklyProjection, seasonProjection, onPlayer }: { players: PlayerMap; query: string; setQuery: (value: string) => void; rosteredIds: Set<string>; weeklyProjection: (id: string) => number | undefined; seasonProjection: (id: string) => number | undefined; onPlayer: (id: string) => void }) {
  const filtered = Object.values(players).filter((p) => fantasyPositions.includes(playerPosition(p) ?? "") && p.status !== "Inactive" && nameOf(p).toLowerCase().includes(query.toLowerCase())).sort((a, b) => (seasonProjection(b.player_id) ?? 0) - (seasonProjection(a.player_id) ?? 0)).slice(0, 150);
  return <section className="card"><div className="eyebrow">PLAYER EXPLORER</div><h2 className="sectionTitle">Search anyone</h2><input className="input search" placeholder="Search NFL players…" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="tableHeader playerTable"><span>Player</span><span>Week</span><span>Season</span><span>Status</span></div><div className="list">{filtered.map((p) => <button className="item clickable playerTable" key={p.player_id} onClick={() => onPlayer(p.player_id)}><span><strong>{nameOf(p)}</strong><span className="muted tiny">{p.position} · {p.team ?? "FA"}</span></span><strong>{weeklyProjection(p.player_id)?.toFixed(1) ?? "—"}</strong><strong>{seasonProjection(p.player_id)?.toFixed(0) ?? "—"}</strong><span className="pill">{rosteredIds.has(p.player_id) ? "ROSTERED" : "AVAILABLE"}</span></button>)}</div></section>;
}

function LeagueView({ league, rosters, matchupData, transactions, players, myRoster, weeklyProjection, currentWeek }: any) {
  const matchupRows = matchupData.filter((m: SleeperMatchup) => m.matchup_id != null).sort((a: SleeperMatchup, b: SleeperMatchup) => (a.matchup_id ?? 0) - (b.matchup_id ?? 0));
  return <div className="grid"><section className="card span5"><div className="eyebrow">SETTINGS</div><h2 className="sectionTitle">League format</h2><div className="list compact"><div className="item"><span>Teams</span><strong>{league.total_rosters}</strong></div><div className="item"><span>Scoring</span><strong>{formatScoring(scoringKey(league.scoring_settings))}</strong></div><div className="item"><span>Roster</span><strong>{league.roster_positions.length} slots</strong></div><div className="item"><span>Status</span><strong>{league.status}</strong></div></div><h3>Roster slots</h3><div className="tagCloud">{league.roster_positions.map((p: string, i: number) => <span className="pill" key={`${p}-${i}`}>{p}</span>)}</div></section><section className="card span7"><div className="eyebrow">SCORING</div><h2 className="sectionTitle">Rules that affect your points</h2><div className="scoringGrid">{Object.entries(league.scoring_settings).sort((a: any, b: any) => a[0].localeCompare(b[0])).map(([key, value]: any) => <div className="item" key={key}><span>{pretty(key)}</span><strong>{value}</strong></div>)}</div></section><section className="card span7"><div className="eyebrow">WEEK {currentWeek} MATCHUPS</div><h2 className="sectionTitle">League scoreboard</h2><div className="list">{pairMatchups(matchupRows).map((pair, i) => <div className={`matchup ${pair.some((m) => m.roster_id === myRoster?.roster_id) ? "myMatchup" : ""}`} key={i}>{pair.map((m) => { const roster = rosters.find((r: SleeperRoster) => r.roster_id === m.roster_id); return <div className="matchTeam" key={m.roster_id}><strong>Roster {m.roster_id}{m.roster_id === myRoster?.roster_id ? " (YOU)" : ""}</strong><span>{m.points ?? 0} pts</span><span className="muted tiny">{sumProjected(roster?.starters ?? [], weeklyProjection)?.toFixed(1) ?? "—"} projected</span></div>; })}</div>)}</div>{!matchupRows.length && <div className="empty">Matchups will appear once Sleeper generates them.</div>}</section><section className="card span5"><div className="eyebrow">RECENT ACTIVITY</div><h2 className="sectionTitle">Transactions</h2><div className="list compact">{transactions.slice(0, 20).map((t: SleeperTransaction) => <div className="item" key={t.transaction_id}><span><strong>{pretty(t.type)}</strong><span className="muted tiny">{transactionSummary(t, players)}</span></span><span className="pill">{t.status}</span></div>)}</div>{!transactions.length && <div className="empty">No transactions this week.</div>}</section></div>;
}

function GuideView() { return <div className="grid guideGrid"><section className="card span12"><div className="eyebrow">ZERO-NFL-KNOWLEDGE GUIDE</div><h2>Only learn the things that change your fantasy decisions</h2><p className="muted">You do not need to understand formations, defensive schemes or most NFL rules to manage a fantasy team.</p></section><GuideCard title="WR — Wide Receiver" body="Catches passes. Usually one of your most important fantasy positions. Targets = how often the quarterback throws toward them." /><GuideCard title="RB — Running Back" body="Runs the ball and often catches short passes. Valuable because reliable high-volume RBs are scarce." /><GuideCard title="QB — Quarterback" body="Touches the ball constantly and scores lots of raw fantasy points, but in normal one-QB leagues there are many usable options, so you often do not need to draft one early." /><GuideCard title="TE — Tight End" body="A hybrid receiver/blocker. Fantasy production is top-heavy: a few are great, many are similar." /><GuideCard title="FLEX" body="A lineup slot that can usually hold RB/WR/TE. This is why depth at RB and WR matters." /><GuideCard title="Bye week" body="That NFL team does not play that week. The player scores zero, so move them out of your starting lineup." /><GuideCard title="Waivers" body="The pool of players nobody in your league currently owns. Injuries and role changes can suddenly make an unknown player very valuable." /><GuideCard title="Questionable / Doubtful / Out" body="Injury designations. Out means do not start them. Questionable means check closer to kickoff." /><GuideCard title="Projection" body="Estimated fantasy points. Useful, not guaranteed. A 1-point difference is basically a coin flip; 5+ points is much more meaningful." /></div>; }
function GuideCard({ title, body }: { title: string; body: string }) { return <section className="card span4"><h3>{title}</h3><p className="muted">{body}</p></section>; }
function PlayerDrawer({ player, rostered, weekly, season, onClose }: { player: SleeperPlayer; rostered: boolean; weekly?: number; season?: number; onClose: () => void }) { return <div className="drawerBackdrop" onClick={onClose}><aside className="drawer" onClick={(e) => e.stopPropagation()}><button className="closeButton" onClick={onClose}>×</button><div className="eyebrow">PLAYER DETAILS</div><h2>{nameOf(player)}</h2><div className="muted">{player.position} · {player.team ?? "Free agent"} · Age {player.age ?? "?"}</div><div className="drawerStats"><div><span>Week projection</span><strong>{weekly?.toFixed(1) ?? "—"}</strong></div><div><span>Season projection</span><strong>{season?.toFixed(1) ?? "—"}</strong></div><div><span>League status</span><strong>{rostered ? "Rostered" : "Available"}</strong></div><div><span>Health</span><strong>{player.injury_status ?? "No flag"}</strong></div></div><h3>Plain English</h3><p className="muted">{plainEnglish(player, weekly)}</p>{player.injury_notes && <div className="action warn"><strong>Injury note</strong><div className="muted">{player.injury_notes}</div></div>}</aside></div>; }
function eligibleForSlot(player: SleeperPlayer, slot: string) { const pos = playerPosition(player); if (!pos) return false; if (slot === pos) return true; if (slot === "FLEX") return ["RB", "WR", "TE"].includes(pos); if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(pos); if (slot === "REC_FLEX") return ["WR", "TE"].includes(pos); return false; }
function sumProjected(ids: string[], getProjection: (id: string) => number | undefined) { const values = ids.map(getProjection).filter((x): x is number => typeof x === "number"); if (!values.length) return undefined; return values.reduce((sum, value) => sum + value, 0); }
function pairMatchups(rows: SleeperMatchup[]) { const groups = new Map<number, SleeperMatchup[]>(); rows.forEach((m) => { if (m.matchup_id != null) groups.set(m.matchup_id, [...(groups.get(m.matchup_id) ?? []), m]); }); return Array.from(groups.values()); }
function transactionSummary(t: SleeperTransaction, players: PlayerMap) { const adds = Object.keys(t.adds ?? {}).map((id) => nameOf(players[id])); const drops = Object.keys(t.drops ?? {}).map((id) => nameOf(players[id])); if (t.type === "trade") return `Between roster${t.roster_ids.length > 1 ? "s" : ""} ${t.roster_ids.join(" & ")}`; if (adds.length && drops.length) return `Added ${adds.join(", ")} · dropped ${drops.join(", ")}`; if (adds.length) return `Added ${adds.join(", ")}`; if (drops.length) return `Dropped ${drops.join(", ")}`; return `Roster ${t.roster_ids.join(", ")}`; }
function plainEnglish(player: SleeperPlayer, weekly?: number) { const pos = playerPosition(player); if (player.injury_status === "Out") return "Do not start this player while they are ruled out."; if (player.injury_status) return "There is an injury flag. Re-check their status close to kickoff before relying on them."; if (weekly != null && weekly >= 18) return `A strong weekly projection for a ${pos ?? "player"}. Usually someone you want in the lineup unless your alternatives are elite.`; if (weekly != null && weekly >= 12) return `A usable weekly option. Compare them against your other ${pos ?? "same-position"} choices before kickoff.`; return "No major warning detected. Use projection, roster need and availability rather than name recognition."; }
function formatScoring(key: string) { if (key === "ppr") return "Full PPR"; if (key === "half_ppr") return "Half PPR"; return "Standard"; }
function tabLabel(tab: Tab) { const labels: Record<Tab, string> = { dashboard: "Dashboard", draft: "Draft", lineup: "Lineup", waivers: "Waivers", players: "Players", league: "League", guide: "NFL 101" }; return labels[tab]; }
function nameOf(p?: SleeperPlayer) { return p?.full_name || `${p?.first_name ?? "Unknown"} ${p?.last_name ?? "player"}`.trim(); }
function pretty(s: string) { return s.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()); }
