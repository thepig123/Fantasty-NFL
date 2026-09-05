"use client";

import { useEffect, useMemo, useState } from "react";
import {
  sleeper,
  type NflState,
  type SleeperDraft,
  type SleeperDraftPick,
  type SleeperLeague,
  type SleeperLeagueUser,
  type SleeperMatchup,
  type SleeperPlayer,
  type SleeperRoster,
  type SleeperTransaction,
  type SleeperUser,
} from "@/lib/sleeper";
import { draftScore, lineupDecision, playerPosition, waiverScore } from "@/lib/decision";
import { projectedPoints, scoringKey } from "@/lib/fantasy";

type Tab = "home" | "draft" | "lineup" | "waivers" | "trades" | "players" | "league" | "help";
type PlayerMap = Record<string, SleeperPlayer>;
type ProjectionRow = { playerId: string; stats: Record<string, number>; source: string };
type ProjectionMap = Record<string, ProjectionRow>;
type IntelligencePayload = { weekly: ProjectionMap; season: ProjectionMap; weekNumber: number; source: string };
type Recommendation = { player: SleeperPlayer; rating: NonNullable<ReturnType<typeof draftScore>>; seasonProjection: number | undefined };

const fantasyPositions = ["QB", "RB", "WR", "TE"];

export default function Home() {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [members, setMembers] = useState<SleeperLeagueUser[]>([]);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [league, setLeague] = useState<SleeperLeague | null>(null);
  const [rosters, setRosters] = useState<SleeperRoster[]>([]);
  const [drafts, setDrafts] = useState<SleeperDraft[]>([]);
  const [picks, setPicks] = useState<SleeperDraftPick[]>([]);
  const [players, setPlayers] = useState<PlayerMap>({});
  const [trendingAdds, setTrendingAdds] = useState<Array<{ player_id: string; count: number }>>([]);
  const [trendingDrops, setTrendingDrops] = useState<Array<{ player_id: string; count: number }>>([]);
  const [nflState, setNflState] = useState<NflState | null>(null);
  const [matchups, setMatchups] = useState<SleeperMatchup[]>([]);
  const [transactions, setTransactions] = useState<SleeperTransaction[]>([]);
  const [intelligence, setIntelligence] = useState<IntelligencePayload>({ weekly: {}, season: {}, weekNumber: 1, source: "none" });
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tradeGive, setTradeGive] = useState("");
  const [tradeReceive, setTradeReceive] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("fantasy-copilot-username");
    if (saved) setUsername(saved);
  }, []);

  const myRoster = useMemo(() => rosters.find((r) => r.owner_id === user?.user_id) ?? null, [rosters, user]);
  const rosteredIds = useMemo(() => new Set(rosters.flatMap((r) => r.players ?? [])), [rosters]);
  const draftedIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);
  const scoring = useMemo(() => scoringKey(league?.scoring_settings ?? {}), [league]);

  const weeklyProjection = (id: string) => projectedPoints(intelligence.weekly[id]?.stats, scoring);
  const seasonProjection = (id: string) => projectedPoints(intelligence.season[id]?.stats, scoring);

  const seasonProjectionValues = useMemo(() => Object.values(intelligence.season)
    .map((row) => projectedPoints(row.stats, scoring))
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b), [intelligence.season, scoring]);

  const weeklyProjectionValues = useMemo(() => Object.values(intelligence.weekly)
    .map((row) => projectedPoints(row.stats, scoring))
    .filter((x): x is number => typeof x === "number")
    .sort((a, b) => a - b), [intelligence.weekly, scoring]);

  function percentile(value: number | undefined, values: number[]) {
    if (value == null || !values.length) return undefined;
    let count = 0;
    for (const v of values) if (v <= value) count++;
    return Math.round((count / values.length) * 100);
  }

  const myDraftPositions = useMemo(() => (myRoster?.players ?? []).map((id) => playerPosition(players[id])).filter(Boolean) as string[], [myRoster, players]);

  const recommendations = useMemo<Recommendation[]>(() => {
    if (!league) return [];
    return Object.values(players)
      .filter((p) => !draftedIds.has(p.player_id) && fantasyPositions.includes(playerPosition(p) ?? "") && p.status !== "Inactive")
      .flatMap((player): Recommendation[] => {
        const projection = seasonProjection(player.player_id);
        const rating = draftScore(player, league.roster_positions, myDraftPositions, projection, percentile(projection, seasonProjectionValues));
        return rating ? [{ player, rating, seasonProjection: projection }] : [];
      })
      .sort((a, b) => b.rating.score - a.rating.score || (b.seasonProjection ?? 0) - (a.seasonProjection ?? 0))
      .slice(0, 50);
  }, [players, draftedIds, league, myDraftPositions, seasonProjectionValues, intelligence.season, scoring]);

  const waiverTargets = useMemo(() => trendingAdds
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
    .slice(0, 30), [trendingAdds, rosteredIds, players, weeklyProjectionValues, intelligence.weekly, scoring]);

  const lineupMoves = useMemo(() => {
    if (!league || !myRoster?.players?.length || !myRoster.starters?.length) return [];
    const starterSet = new Set(myRoster.starters);
    const benchIds = myRoster.players.filter((id) => !starterSet.has(id));
    const moves: Array<NonNullable<ReturnType<typeof lineupDecision>> & { slot: string }> = [];

    myRoster.starters.forEach((starterId, index) => {
      const starter = players[starterId];
      if (!starter) return;
      const slot = league.roster_positions[index] ?? starter.position ?? "FLEX";
      const eligible = benchIds
        .map((id) => players[id])
        .filter((candidate): candidate is SleeperPlayer => Boolean(candidate))
        .filter((candidate) => eligibleForSlot(candidate, slot))
        .map((candidate) => ({ player: candidate, projection: weeklyProjection(candidate.player_id) }))
        .filter((candidate) => candidate.projection != null)
        .sort((a, b) => (b.projection ?? 0) - (a.projection ?? 0));
      if (!eligible[0]) return;
      const decision = lineupDecision({ player: starter, projection: weeklyProjection(starterId) }, eligible[0]);
      if (decision) moves.push({ ...decision, slot });
    });
    return moves.sort((a, b) => b.delta - a.delta);
  }, [league, myRoster, players, intelligence.weekly, scoring]);

  const activeDraft = drafts.find((d) => d.status === "drafting") ?? drafts[0];
  const currentWeek = nflState?.display_week || nflState?.week || 1;
  const selectedPlayer = selectedPlayerId ? players[selectedPlayerId] : null;
  const injuries = (myRoster?.players ?? []).map((id) => players[id]).filter((p): p is SleeperPlayer => Boolean(p?.injury_status));

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
      const [rs, us, ds, playerResponse, adds, drops, state] = await Promise.all([
        sleeper.rosters(selected.league_id), sleeper.users(selected.league_id), sleeper.drafts(selected.league_id), fetch("/api/players"), sleeper.trending("add"), sleeper.trending("drop"), sleeper.state(),
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
      setLeague(selected); setRosters(rs); setMembers(us); setDrafts(ds); setPicks(draftPicks); setPlayers(playerData); setTrendingAdds(adds); setTrendingDrops(drops); setNflState(state); setMatchups(matchupData); setTransactions(transactionData); setIntelligence(intel); setLastUpdated(new Date());
      if (!preserveTab) setTab("home");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load league"); }
    finally { setLoading(false); }
  }

  if (!league) return <main className="shell"><section className="card setup"><div className="eyebrow">FANTASY FOOTBALL, WITHOUT HAVING TO FOLLOW THE NFL</div><div className="brand"><h1>Fantasy Copilot</h1><p className="muted lead">Connect your Sleeper account. Each week, the site tells you what deserves attention and what can be left alone.</p></div><div className="row setupRow"><input className="input" placeholder="Sleeper username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadAccount()} /><button className="btn" onClick={loadAccount} disabled={loading}>{loading ? "Loading…" : "Connect Sleeper"}</button></div>{error && <p className="error">{error}</p>}{user && <div className="leaguePicker"><p><strong>{user.display_name}</strong> · choose your league</p><div className="list">{leagues.map((l) => <button key={l.league_id} className="item clickable" onClick={() => selectLeague(l)}><span><strong>{l.name}</strong><span className="muted tiny">{l.total_rosters} teams · {l.status}</span></span><span>Open →</span></button>)}</div></div>}<div className="setupHints"><span>Weekly lineup</span><span>Waivers</span><span>Trades</span><span>Injury checks</span></div></section></main>;

  return <main className="shell">
    <header className="topbar"><div className="brand"><h1>Fantasy Copilot</h1><div className="muted"><span className="leagueName">{league.name}</span> · Week {currentWeek} · {formatScoring(scoring)}</div></div><div className="row"><button className="btn secondary" onClick={() => selectLeague(league, true)} disabled={loading}>{loading ? "Refreshing…" : "Refresh data"}</button><button className="btn ghost" onClick={() => setLeague(null)}>Change league</button></div></header>
    <nav className="nav">{(["home", "lineup", "waivers", "trades", "players", "league", "draft", "help"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{tabLabel(t)}</button>)}</nav>
    {error && <p className="error">{error}</p>}{lastUpdated && <div className="syncLine"><span className="statusDot" /> Synced {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {Object.keys(intelligence.weekly).length ? "weekly projections loaded" : "projection data limited"}</div>}

    {tab === "home" && <HomeView roster={myRoster} players={players} lineupMoves={lineupMoves} waiverTargets={waiverTargets} injuries={injuries} setTab={setTab} currentWeek={currentWeek} weeklyProjection={weeklyProjection} matchups={matchups} rosters={rosters} />}
    {tab === "lineup" && <LineupView league={league} roster={myRoster} players={players} moves={lineupMoves} weeklyProjection={weeklyProjection} currentWeek={currentWeek} />}
    {tab === "waivers" && <WaiverView targets={waiverTargets} drops={trendingDrops} roster={myRoster} players={players} weeklyProjection={weeklyProjection} onPlayer={setSelectedPlayerId} />}
    {tab === "trades" && <TradeView myRoster={myRoster} rosters={rosters} members={members} players={players} seasonProjection={seasonProjection} tradeGive={tradeGive} tradeReceive={tradeReceive} setTradeGive={setTradeGive} setTradeReceive={setTradeReceive} transactions={transactions} />}
    {tab === "players" && <PlayersView players={players} query={query} setQuery={setQuery} rosteredIds={rosteredIds} weeklyProjection={weeklyProjection} seasonProjection={seasonProjection} onPlayer={setSelectedPlayerId} />}
    {tab === "league" && <LeagueView league={league} rosters={rosters} members={members} matchupData={matchups} transactions={transactions} players={players} myRoster={myRoster} weeklyProjection={weeklyProjection} currentWeek={currentWeek} />}
    {tab === "draft" && <DraftView activeDraft={activeDraft} realPicks={picks} recommendations={recommendations} />}
    {tab === "help" && <HelpView setTab={setTab} />}
    {selectedPlayer && <PlayerDrawer player={selectedPlayer} rostered={rosteredIds.has(selectedPlayer.player_id)} weekly={weeklyProjection(selectedPlayer.player_id)} season={seasonProjection(selectedPlayer.player_id)} onClose={() => setSelectedPlayerId(null)} />}
  </main>;
}

function HomeView({ roster, players, lineupMoves, waiverTargets, injuries, setTab, currentWeek, weeklyProjection, matchups, rosters }: any) {
  const myMatch = matchups.find((m: SleeperMatchup) => m.roster_id === roster?.roster_id);
  const opponent = myMatch?.matchup_id != null ? matchups.find((m: SleeperMatchup) => m.matchup_id === myMatch.matchup_id && m.roster_id !== roster?.roster_id) : null;
  const opponentRoster = opponent ? rosters.find((r: SleeperRoster) => r.roster_id === opponent.roster_id) : null;
  const mine = sumProjected(roster?.starters ?? [], weeklyProjection);
  const theirs = sumProjected(opponentRoster?.starters ?? [], weeklyProjection);

  return <div className="pageStack">
    <section className="welcome card"><div><div className="eyebrow">YOUR WEEKLY ROUTINE</div><h2>Open this page once or twice a week. Follow the steps in order.</h2><p className="muted lead">You do not need to research NFL news yourself. Start here, handle anything flagged, then make the actual changes in Sleeper.</p></div><button className="btn" onClick={() => setTab("help")}>How this works</button></section>

    <section className="workflow">
      <WorkflowStep number="1" title="Check your lineup" text={lineupMoves.length ? `${lineupMoves.length} possible improvement${lineupMoves.length > 1 ? "s" : ""} found.` : "No obvious lineup swap found."} status={lineupMoves.length ? "attention" : "good"} button="Open lineup" onClick={() => setTab("lineup")} />
      <WorkflowStep number="2" title="Check injuries" text={injuries.length ? `${injuries.length} player${injuries.length > 1 ? "s" : ""} on your roster have an injury flag.` : "No injury flags on your roster."} status={injuries.length ? "attention" : "good"} button="Review lineup" onClick={() => setTab("lineup")} />
      <WorkflowStep number="3" title="Scan waivers" text={waiverTargets[0] ? `${nameOf(waiverTargets[0].player)} is the top available player on the radar.` : "Nothing notable is showing on waivers."} status={waiverTargets[0] ? "neutral" : "good"} button="Open waivers" onClick={() => setTab("waivers")} />
      <WorkflowStep number="4" title="Consider trades only if useful" text="You do not need to trade every week. Use the analyzer if someone sends you an offer or you want to improve a weak position." status="neutral" button="Trade analyzer" onClick={() => setTab("trades")} />
    </section>

    <div className="grid">
      <MetricCard title={`WEEK ${currentWeek} MATCHUP`} value={mine != null ? mine.toFixed(1) : "—"} detail={theirs != null ? `Opponent ${theirs.toFixed(1)} · ${mine! >= theirs ? "you project ahead" : "you project behind"}` : "Opponent projection will appear when available."} tone={mine != null && theirs != null ? (mine >= theirs ? "positive" : "warning") : ""} />
      <MetricCard title="LINEUP CHANGES" value={String(lineupMoves.length)} detail={lineupMoves[0] ? `Best move: +${lineupMoves[0].delta} projected points` : "Nothing obvious to change"} tone={lineupMoves.length ? "warning" : "positive"} />
      <MetricCard title="INJURY FLAGS" value={String(injuries.length)} detail={injuries[0] ? injuries.slice(0, 2).map(nameOf).join(", ") : "Your roster is clear"} tone={injuries.length ? "warning" : "positive"} />
    </div>

    <section className="card"><div className="eyebrow">IF YOU ONLY DO ONE THING</div><h2 className="sectionTitle">{lineupMoves[0] ? `Start ${nameOf(lineupMoves[0].in)} over ${nameOf(lineupMoves[0].out)}` : injuries[0] ? `Check ${nameOf(injuries[0])} before kickoff` : waiverTargets[0] ? `Look at ${nameOf(waiverTargets[0].player)} on waivers` : "Your team looks fine for now"}</h2><p className="muted">{lineupMoves[0] ? `The projection difference is +${lineupMoves[0].delta} points. Make the change inside Sleeper.` : injuries[0] ? `${nameOf(injuries[0])} is currently listed ${injuries[0].injury_status}.` : waiverTargets[0] ? "They are available in your league and currently getting attention across Sleeper." : "Come back closer to kickoff and refresh the data."}</p></section>
  </div>;
}

function WorkflowStep({ number, title, text, status, button, onClick }: any) {
  return <section className={`workflowStep ${status}`}><div className="stepNumber">{number}</div><div className="stepBody"><h3>{title}</h3><p>{text}</p></div><button className="textButton" onClick={onClick}>{button} →</button></section>;
}

function MetricCard({ title, value, detail, tone = "" }: { title: string; value: string; detail: string; tone?: string }) {
  return <section className="card span4"><div className="eyebrow">{title}</div><div className={`metric ${tone}`}>{value}</div><div className="muted tiny">{detail}</div></section>;
}

function LineupView({ league, roster, players, moves, weeklyProjection, currentWeek }: any) {
  if (!roster?.players?.length) return <section className="card emptyState"><h2>Your team is empty</h2><p>Once the draft is finished, your Sleeper roster will appear here automatically.</p></section>;
  const starters = roster.starters ?? [];
  const starterSet = new Set(starters);
  const bench = roster.players.filter((id: string) => !starterSet.has(id));
  const injuries = roster.players.map((id: string) => players[id]).filter((p: SleeperPlayer | undefined) => p?.injury_status);

  return <div className="grid">
    <section className="card span12 pageIntro"><div><div className="eyebrow">WEEK {currentWeek}</div><h2>Set your lineup</h2><p className="muted">Do this after waivers clear and again before the first games begin. The app recommends changes; you make them in Sleeper.</p></div></section>
    {moves.length > 0 ? <section className="card span12 recommendationPanel"><div className="eyebrow">RECOMMENDED CHANGES</div><div className="actions">{moves.map((move: any) => <div className="lineupMove" key={`${move.in.player_id}-${move.out.player_id}`}><div className="swap"><span className="benchBadge">BENCH</span><strong>{nameOf(move.out)}</strong><span className="arrow">→</span><span className="startBadge">START</span><strong>{nameOf(move.in)}</strong></div><div className="positive">+{move.delta} projected pts · {move.confidence}</div></div>)}</div></section> : <section className="card span12 calm"><strong>No obvious lineup changes.</strong><span className="muted"> Your current starters are not clearly worse than the bench based on the available projections.</span></section>}
    {injuries.length > 0 && <section className="card span12 injuryPanel"><div className="eyebrow">CHECK BEFORE KICKOFF</div><div className="list">{injuries.map((p: SleeperPlayer) => <div className="item" key={p.player_id}><span><strong>{nameOf(p)}</strong><span className="muted tiny">{p.position} · {p.team ?? "FA"}{p.injury_body_part ? ` · ${p.injury_body_part}` : ""}</span></span><span className="tag danger">{p.injury_status}</span></div>)}</div></section>}
    <section className="card span7"><div className="eyebrow">STARTING LINEUP</div><div className="list">{starters.map((id: string, index: number) => <PlayerLine key={id} player={players[id]} slot={league.roster_positions[index] ?? players[id]?.position} projection={weeklyProjection(id)} />)}</div></section>
    <section className="card span5"><div className="eyebrow">BENCH</div><div className="list">{bench.map((id: string) => <PlayerLine key={id} player={players[id]} slot="BN" projection={weeklyProjection(id)} />)}</div></section>
  </div>;
}

function PlayerLine({ player, slot, projection }: { player?: SleeperPlayer; slot: string; projection?: number }) {
  return <div className="item"><span className="playerRow"><span className="slotBadge">{slot}</span><span><strong>{nameOf(player)}</strong><span className="muted tiny">{player?.position ?? "?"} · {player?.team ?? "FA"}{player?.injury_status ? ` · ${player.injury_status}` : ""}</span></span></span><span className="projection"><strong>{projection != null ? projection.toFixed(1) : "—"}</strong><span className="muted tiny">projected</span></span></div>;
}

function WaiverView({ targets, drops, roster, players, weeklyProjection, onPlayer }: any) {
  const benchIds = roster?.players?.filter((id: string) => !(roster?.starters ?? []).includes(id)) ?? [];
  const worstBench = [...benchIds].sort((a, b) => (weeklyProjection(a) ?? -1) - (weeklyProjection(b) ?? -1));
  return <div className="grid"><section className="card span12 pageIntro"><div><div className="eyebrow">WAIVERS</div><h2>Find useful players nobody owns</h2><p className="muted">Check this early in the week. If a player looks like a clear upgrade, add them in Sleeper and drop the suggested weaker bench option.</p></div></section><section className="card span8"><div className="list">{targets.length ? targets.map((x: any, i: number) => { const samePosDrop = worstBench.map((id: string) => players[id]).find((p: SleeperPlayer | undefined) => p && playerPosition(p) === playerPosition(x.player)); return <button className="item clickable" key={x.player.player_id} onClick={() => onPlayer(x.player.player_id)}><span><strong>#{i + 1} {nameOf(x.player)}</strong><span className="muted tiny">{x.player.position} · {x.player.team ?? "FA"}{x.projection != null ? ` · ${x.projection.toFixed(1)} projected` : ""}{samePosDrop ? ` · possible drop: ${nameOf(samePosDrop)}` : ""}</span></span><span className="score">{x.score}</span></button>; }) : <div className="empty">No notable available players are showing right now.</div>}</div></section><section className="card span4"><div className="eyebrow">TRENDING DROPS</div><p className="muted tiny">Useful mainly as a warning signal. Do not automatically copy other managers.</p><div className="list compact">{drops.slice(0, 12).map((d: any) => <div className="item" key={d.player_id}><span><strong>{nameOf(players[d.player_id])}</strong><span className="muted tiny">{players[d.player_id]?.position ?? "?"}</span></span><span>{d.count}</span></div>)}</div></section></div>;
}

function TradeView({ myRoster, rosters, members, players, seasonProjection, tradeGive, tradeReceive, setTradeGive, setTradeReceive, transactions }: any) {
  const mine: SleeperPlayer[] = (myRoster?.players ?? []).map((id: string) => players[id]).filter((p: SleeperPlayer | undefined): p is SleeperPlayer => Boolean(p));
  const otherPlayers = rosters.filter((r: SleeperRoster) => r.roster_id !== myRoster?.roster_id).flatMap((r: SleeperRoster) => (r.players ?? []).map((id) => ({ player: players[id], roster: r }))).filter((x: any) => x.player);
  const givePlayer = players[tradeGive];
  const receiveEntry = otherPlayers.find((x: any) => x.player.player_id === tradeReceive);
  const receivePlayer = receiveEntry?.player as SleeperPlayer | undefined;
  const giveValue = givePlayer ? tradeValue(givePlayer, seasonProjection(givePlayer.player_id)) : undefined;
  const receiveValue = receivePlayer ? tradeValue(receivePlayer, seasonProjection(receivePlayer.player_id)) : undefined;
  const delta = giveValue != null && receiveValue != null ? receiveValue - giveValue : undefined;

  return <div className="grid">
    <section className="card span12 pageIntro"><div><div className="eyebrow">TRADE ANALYZER</div><h2>Use this when someone offers you a trade</h2><p className="muted">Select the player you would give away and the player you would receive. The score is a quick sanity check, not a guarantee. A close result means the trade is probably about team need rather than raw value.</p></div></section>
    <section className="card span7"><div className="tradeGrid"><label><span>You give</span><select className="select" value={tradeGive} onChange={(e) => setTradeGive(e.target.value)}><option value="">Choose one of your players</option>{mine.sort((a: SleeperPlayer,b: SleeperPlayer) => tradeValue(b, seasonProjection(b.player_id)) - tradeValue(a, seasonProjection(a.player_id))).map((p: SleeperPlayer) => <option key={p.player_id} value={p.player_id}>{nameOf(p)} · {p.position}</option>)}</select></label><div className="tradeArrow">⇄</div><label><span>You receive</span><select className="select" value={tradeReceive} onChange={(e) => setTradeReceive(e.target.value)}><option value="">Choose a player on another team</option>{otherPlayers.sort((a:any,b:any) => tradeValue(b.player, seasonProjection(b.player.player_id)) - tradeValue(a.player, seasonProjection(a.player.player_id))).map((x:any) => <option key={x.player.player_id} value={x.player.player_id}>{nameOf(x.player)} · {x.player.position} · {ownerName(x.roster, members)}</option>)}</select></label></div>
      {givePlayer && receivePlayer ? <div className={`tradeResult ${delta != null && delta > 8 ? "win" : delta != null && delta < -8 ? "lose" : "even"}`}><div><div className="eyebrow">QUICK VERDICT</div><h3>{delta != null && delta > 8 ? "This looks favorable" : delta != null && delta < -8 ? "You may be giving up too much" : "This looks fairly close"}</h3><p className="muted">{nameOf(givePlayer)}: {giveValue} value · {nameOf(receivePlayer)}: {receiveValue} value{delta != null ? ` · difference ${delta > 0 ? "+" : ""}${delta}` : ""}</p></div></div> : <div className="empty">Choose both players to compare the trade.</div>}
      <div className="tradeNotes"><strong>Before accepting:</strong><span> Prefer upgrades to your starting lineup over small bench upgrades.</span><span> Do not trade away healthy RB/WR depth unless you gain something meaningful.</span><span> Re-check injuries before accepting.</span></div>
    </section>
    <section className="card span5"><div className="eyebrow">RECENT LEAGUE TRADES</div><p className="muted tiny">Completed trades from the current Sleeper week.</p><div className="list compact">{transactions.filter((t: SleeperTransaction) => t.type === "trade").slice(0, 12).map((t: SleeperTransaction) => <div className="item" key={t.transaction_id}><span><strong>{t.roster_ids.map((id) => ownerName(rosters.find((r: SleeperRoster) => r.roster_id === id), members)).join(" ↔ ")}</strong><span className="muted tiny">{transactionSummary(t, players)}</span></span></div>)}</div>{!transactions.some((t: SleeperTransaction) => t.type === "trade") && <div className="empty">No trades recorded this week.</div>}</section>
  </div>;
}

function PlayersView({ players, query, setQuery, rosteredIds, weeklyProjection, seasonProjection, onPlayer }: any) {
  const list = Object.values(players) as SleeperPlayer[];
  const filtered = list.filter((p) => fantasyPositions.includes(playerPosition(p) ?? "") && p.status !== "Inactive" && nameOf(p).toLowerCase().includes(query.toLowerCase())).sort((a,b) => (seasonProjection(b.player_id) ?? 0) - (seasonProjection(a.player_id) ?? 0)).slice(0,150);
  return <section className="card"><div className="eyebrow">PLAYERS</div><h2 className="sectionTitle">Look up anyone</h2><p className="muted">Useful when someone mentions a player or includes them in a trade offer.</p><input className="input search" placeholder="Search player name…" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="tableHeader playerTable"><span>Player</span><span>Week</span><span>Season</span><span>Status</span></div><div className="list">{filtered.map((p) => <button className="item clickable playerTable" key={p.player_id} onClick={() => onPlayer(p.player_id)}><span><strong>{nameOf(p)}</strong><span className="muted tiny">{p.position} · {p.team ?? "FA"}</span></span><strong>{weeklyProjection(p.player_id)?.toFixed(1) ?? "—"}</strong><strong>{seasonProjection(p.player_id)?.toFixed(0) ?? "—"}</strong><span className="pill">{rosteredIds.has(p.player_id) ? "ROSTERED" : "AVAILABLE"}</span></button>)}</div></section>;
}

function LeagueView({ league, rosters, members, matchupData, transactions, players, myRoster, weeklyProjection, currentWeek }: any) {
  return <div className="grid"><section className="card span5"><div className="eyebrow">YOUR LEAGUE</div><h2 className="sectionTitle">Format</h2><div className="list compact"><div className="item"><span>Teams</span><strong>{league.total_rosters}</strong></div><div className="item"><span>Scoring</span><strong>{formatScoring(scoringKey(league.scoring_settings))}</strong></div><div className="item"><span>Roster slots</span><strong>{league.roster_positions.length}</strong></div><div className="item"><span>Status</span><strong>{league.status}</strong></div></div></section><section className="card span7"><div className="eyebrow">WEEK {currentWeek} MATCHUPS</div><div className="list">{pairMatchups(matchupData).map((pair, i) => <div className={`matchup ${pair.some((m) => m.roster_id === myRoster?.roster_id) ? "myMatchup" : ""}`} key={i}>{pair.map((m) => { const roster = rosters.find((r: SleeperRoster) => r.roster_id === m.roster_id); return <div className="matchTeam" key={m.roster_id}><strong>{ownerName(roster, members)}{m.roster_id === myRoster?.roster_id ? " (You)" : ""}</strong><span>{m.points ?? 0} pts</span><span className="muted tiny">{sumProjected(roster?.starters ?? [], weeklyProjection)?.toFixed(1) ?? "—"} projected</span></div>; })}</div>)}</div>{!matchupData.length && <div className="empty">Matchups are not available yet.</div>}</section><section className="card span12"><div className="eyebrow">RECENT ACTIVITY</div><div className="list compact">{transactions.slice(0,20).map((t: SleeperTransaction) => <div className="item" key={t.transaction_id}><span><strong>{pretty(t.type)}</strong><span className="muted tiny">{transactionSummary(t, players)}</span></span><span className="pill">{t.status}</span></div>)}</div>{!transactions.length && <div className="empty">No league activity this week.</div>}</section></div>;
}

function DraftView({ activeDraft, realPicks, recommendations }: any) {
  const [positionFilter, setPositionFilter] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");

  if (!activeDraft || activeDraft.status === "pre_draft") return <section className="card emptyState"><h2>Nothing you need to do here yet</h2><p>Come back to this tab on draft day. The site will show recommended available players once the Sleeper draft starts.</p></section>;

  const positionOrder = ["QB", "RB", "WR", "TE"];
  const positionLeaders = positionOrder
    .map((position) => recommendations.find((r: Recommendation) => r.rating.position === position))
    .filter((r): r is Recommendation => Boolean(r))
    .sort((a, b) => b.rating.score - a.rating.score || (b.seasonProjection ?? 0) - (a.seasonProjection ?? 0));
  const top = positionLeaders[0] ?? recommendations[0];
  const alternatives = positionLeaders.filter((r) => r.player.player_id !== top?.player.player_id);
  const nextOverall = recommendations.filter((r: Recommendation) => r.player.player_id !== top?.player.player_id).slice(0, 10);
  const filteredOptions = positionFilter === "ALL"
    ? nextOverall
    : recommendations.filter((r: Recommendation) => r.rating.position === positionFilter).slice(0, 10);

  return <div className="grid">
    <section className="card span12 pageIntro"><div><div className="eyebrow">DRAFT DAY ONLY</div><h2>{activeDraft.status === "drafting" ? "Your live draft helper" : "Draft complete"}</h2><p className="muted">Live picks sync automatically. Use the overall ranking for your default choice, or filter by position when you want to inspect a specific role.</p></div></section>
    {activeDraft.status === "drafting" && <>
      <section className="card span7 heroRecommendation"><div className="eyebrow">BEST PICK RIGHT NOW</div>{top ? <><h2>{nameOf(top.player)}</h2><p className="muted">{top.rating.position} · {top.player.team ?? "FA"} · score {top.rating.score}/100</p><p>{top.rating.reason}</p></> : <div className="empty">No recommendation loaded.</div>}</section>
      <section className="card span5"><div className="eyebrow">BEST BY POSITION</div><div className="list compact">{alternatives.map((r: Recommendation) => <div className="item" key={r.player.player_id}><span><strong>{r.rating.position}: {nameOf(r.player)}</strong><span className="muted tiny">{r.player.team ?? "FA"}{r.seasonProjection != null ? ` · ${r.seasonProjection.toFixed(0)} season projection` : ""}</span></span><span className="score">{r.rating.score}</span></div>)}</div>{!alternatives.length && <div className="empty">No other position leaders available.</div>}</section>
      <section className="card span12">
        <div className="eyebrow">{positionFilter === "ALL" ? "NEXT 10 BEST PICKS" : `BEST ${positionFilter} OPTIONS`}</div>
        <div className="row" style={{ margin: "12px 0 16px", flexWrap: "wrap" }}>
          {(["ALL", "QB", "RB", "WR", "TE"] as const).map((position) => <button key={position} className={positionFilter === position ? "btn" : "btn ghost"} aria-pressed={positionFilter === position} onClick={() => setPositionFilter(position)}>{position}</button>)}
        </div>
        <div className="list compact">{filteredOptions.map((r: Recommendation, i: number) => <div className="item" key={r.player.player_id}><span><strong>#{i + 1} {nameOf(r.player)}</strong><span className="muted tiny">{r.rating.position} · {r.player.team ?? "FA"}{r.seasonProjection != null ? ` · ${r.seasonProjection.toFixed(0)} season projection` : ""}</span></span><span className="score">{r.rating.score}</span></div>)}</div>
        {!filteredOptions.length && <div className="empty">No available {positionFilter === "ALL" ? "players" : positionFilter + "s"} are currently ranked.</div>}
      </section>
    </>}
    <section className="card span12"><div className="eyebrow">RECENT PICKS</div><div className="list compact">{realPicks.slice(-15).reverse().map((p:SleeperDraftPick) => <div className="item" key={`${p.pick_no}-${p.player_id}`}><span><strong>#{p.pick_no} {p.metadata?.first_name} {p.metadata?.last_name}</strong><span className="muted tiny">{p.metadata?.position} · {p.metadata?.team}</span></span><span>R{p.round}</span></div>)}</div></section>
  </div>;
}

function HelpView({ setTab }: { setTab: (tab: Tab) => void }) {
  return <div className="pageStack"><section className="card helpHero"><div className="eyebrow">START HERE</div><h2>You can manage the whole season with the same simple routine</h2><p className="muted lead">Fantasy points come from how your players perform in real NFL games. Your job is mostly choosing starters, replacing weak/injured players, and occasionally evaluating trades.</p></section><section className="card"><div className="eyebrow">EVERY WEEK</div><div className="guideSteps"><GuideStep number="1" title="Early in the week: open Waivers" text="See if an available player is a clear improvement over your bench. You do not need to add someone just because they are trending." action="Open Waivers" onClick={() => setTab("waivers")} /><GuideStep number="2" title="After waivers: open Lineup" text="Use the recommended start/sit changes. A player on your bench can score points only if you move them into a starting slot in Sleeper." action="Open Lineup" onClick={() => setTab("lineup")} /><GuideStep number="3" title="Before games: check injury flags" text="Questionable means re-check. Out means bench them. The Home and Lineup pages surface these automatically." action="Open Home" onClick={() => setTab("home")} /><GuideStep number="4" title="If you get a trade offer: use Trades" text="Compare the players before accepting. Favor upgrades to your actual starting lineup, not tiny bench improvements." action="Open Trades" onClick={() => setTab("trades")} /><GuideStep number="5" title="Make the actual changes in Sleeper" text="This app is your decision dashboard. Sleeper is still where you submit lineup changes, waiver claims and trades." /></div></section><section className="grid"><GuideCard title="RB / Running Back" body="One of the key fantasy positions. Good RBs are valuable because reliable workload can be scarce." /><GuideCard title="WR / Wide Receiver" body="Another core position. Usually you start several WR/RB players, so depth here matters a lot." /><GuideCard title="QB / Quarterback" body="Scores lots of points, but in a normal one-QB league you usually do not need several of them." /><GuideCard title="FLEX" body="A lineup slot that can usually be filled by an RB, WR or TE. Think of it as one extra starter." /><GuideCard title="Waivers" body="Players currently not owned by anyone in your league. This is where surprise breakout players appear." /><GuideCard title="Projection" body="An estimate, not a promise. A 1-point difference is small; a 5+ point difference is much more meaningful." /><GuideCard title="Questionable" body="The player might still play. Check again closer to kickoff instead of immediately benching them." /><GuideCard title="Bye week" body="The player's NFL team does not play that week, so they cannot score fantasy points." /><GuideCard title="Trade" body="You exchange players with another manager. You do not need to trade unless it improves your team." /></section></div>;
}

function GuideStep({ number, title, text, action, onClick }: any) { return <div className="guideStep"><div className="stepNumber">{number}</div><div><h3>{title}</h3><p className="muted">{text}</p>{action && <button className="textButton" onClick={onClick}>{action} →</button>}</div></div>; }
function GuideCard({ title, body }: { title: string; body: string }) { return <section className="card span4"><h3>{title}</h3><p className="muted">{body}</p></section>; }

function PlayerDrawer({ player, rostered, weekly, season, onClose }: { player: SleeperPlayer; rostered: boolean; weekly?: number; season?: number; onClose: () => void }) {
  return <div className="drawerBackdrop" onClick={onClose}><aside className="drawer" onClick={(e) => e.stopPropagation()}><button className="closeButton" onClick={onClose}>×</button><div className="eyebrow">PLAYER</div><h2>{nameOf(player)}</h2><div className="muted">{player.position} · {player.team ?? "Free agent"} · Age {player.age ?? "?"}</div><div className="drawerStats"><div><span>This week</span><strong>{weekly?.toFixed(1) ?? "—"}</strong></div><div><span>Season</span><strong>{season?.toFixed(1) ?? "—"}</strong></div><div><span>League status</span><strong>{rostered ? "Rostered" : "Available"}</strong></div><div><span>Health</span><strong>{player.injury_status ?? "No flag"}</strong></div></div><h3>What this means</h3><p className="muted">{plainEnglish(player, weekly)}</p></aside></div>;
}

function eligibleForSlot(player: SleeperPlayer, slot: string) { const pos = playerPosition(player); if (!pos) return false; if (slot === pos) return true; if (slot === "FLEX") return ["RB","WR","TE"].includes(pos); if (slot === "SUPER_FLEX") return ["QB","RB","WR","TE"].includes(pos); if (slot === "REC_FLEX") return ["WR","TE"].includes(pos); return false; }
function sumProjected(ids: string[], fn: (id: string) => number | undefined) { const vals = ids.map(fn).filter((x): x is number => typeof x === "number"); return vals.length ? vals.reduce((a,b) => a+b,0) : undefined; }
function pairMatchups(rows: SleeperMatchup[]) { const groups = new Map<number,SleeperMatchup[]>(); rows.forEach((m) => { if (m.matchup_id != null) groups.set(m.matchup_id,[...(groups.get(m.matchup_id) ?? []),m]); }); return Array.from(groups.values()); }
function ownerName(roster: SleeperRoster | undefined, members: SleeperLeagueUser[]) { if (!roster?.owner_id) return `Roster ${roster?.roster_id ?? "?"}`; const m = members.find((u) => u.user_id === roster.owner_id); return m?.metadata?.team_name || m?.display_name || `Roster ${roster.roster_id}`; }
function transactionSummary(t: SleeperTransaction, players: PlayerMap) { const adds = Object.keys(t.adds ?? {}).map((id) => nameOf(players[id])); const drops = Object.keys(t.drops ?? {}).map((id) => nameOf(players[id])); if (adds.length && drops.length) return `Added ${adds.join(", ")} · dropped ${drops.join(", ")}`; if (adds.length) return `Added ${adds.join(", ")}`; if (drops.length) return `Dropped ${drops.join(", ")}`; return `Roster${t.roster_ids.length > 1 ? "s" : ""} ${t.roster_ids.join(", ")}`; }
function tradeValue(player: SleeperPlayer, season?: number) { const pos = playerPosition(player); const base = pos === "RB" ? 18 : pos === "WR" ? 17 : pos === "TE" ? 12 : 10; const projection = season != null ? Math.min(70, season / 5) : 28; const health = player.injury_status === "Out" ? -12 : player.injury_status ? -5 : 0; const age = player.age && player.age > 30 ? -(player.age - 30) * 2 : 0; return Math.max(1, Math.round(base + projection + health + age)); }
function plainEnglish(player: SleeperPlayer, weekly?: number) { if (player.injury_status === "Out") return "Do not start this player while they are ruled out."; if (player.injury_status) return "There is an injury flag. Re-check their status close to kickoff."; if (weekly != null && weekly >= 18) return "A strong weekly projection. Usually a player you want in your lineup."; if (weekly != null && weekly >= 12) return "A usable weekly option. Compare them with your other choices at the same position."; return "No major warning. Use projections and roster need rather than name recognition."; }
function formatScoring(key: string) { if (key === "ppr") return "Full PPR"; if (key === "half_ppr") return "Half PPR"; return "Standard"; }
function tabLabel(tab: Tab) { const labels: Record<Tab,string> = { home:"Home", draft:"Draft", lineup:"Lineup", waivers:"Waivers", trades:"Trades", players:"Players", league:"League", help:"How to use" }; return labels[tab]; }
function nameOf(p?: SleeperPlayer) { return p?.full_name || `${p?.first_name ?? "Unknown"} ${p?.last_name ?? "player"}`.trim(); }
function pretty(s: string) { return s.replace(/_/g," ").replace(/([A-Z])/g," $1").replace(/^./,(c) => c.toUpperCase()); }
