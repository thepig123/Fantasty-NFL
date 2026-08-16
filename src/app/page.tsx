"use client";

import { useMemo, useState } from "react";
import { sleeper, type SleeperDraft, type SleeperDraftPick, type SleeperLeague, type SleeperPlayer, type SleeperRoster, type SleeperUser } from "@/lib/sleeper";
import { draftScore, waiverScore } from "@/lib/decision";

type Tab = "dashboard" | "draft" | "team" | "waivers" | "players";
type PlayerMap = Record<string, SleeperPlayer>;

export default function Home() {
  const [username, setUsername] = useState("");
  const [user, setUser] = useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [league, setLeague] = useState<SleeperLeague | null>(null);
  const [rosters, setRosters] = useState<SleeperRoster[]>([]);
  const [drafts, setDrafts] = useState<SleeperDraft[]>([]);
  const [picks, setPicks] = useState<SleeperDraftPick[]>([]);
  const [players, setPlayers] = useState<PlayerMap>({});
  const [trending, setTrending] = useState<Array<{ player_id: string; count: number }>>([]);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const myRoster = useMemo(() => rosters.find((r) => r.owner_id === user?.user_id) ?? null, [rosters, user]);
  const rosteredIds = useMemo(() => new Set(rosters.flatMap((r) => r.players ?? [])), [rosters]);
  const draftedIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);

  const myRosterPositions = useMemo(() => {
    return (myRoster?.players ?? []).map((id) => players[id]?.fantasy_positions?.[0] ?? players[id]?.position).filter(Boolean) as string[];
  }, [myRoster, players]);

  const recommendations = useMemo(() => {
    if (!league) return [];
    return Object.values(players)
      .filter((p) => !draftedIds.has(p.player_id) && ["QB", "RB", "WR", "TE"].includes(p.fantasy_positions?.[0] ?? p.position ?? ""))
      .map((p) => ({ player: p, rating: draftScore(p, league.roster_positions, myRosterPositions) }))
      .filter((x): x is { player: SleeperPlayer; rating: NonNullable<ReturnType<typeof draftScore>> } => Boolean(x.rating))
      .sort((a, b) => b.rating.score - a.rating.score)
      .slice(0, 20);
  }, [players, draftedIds, league, myRosterPositions]);

  const waiverTargets = useMemo(() => {
    return trending
      .filter((t) => !rosteredIds.has(t.player_id))
      .map((t) => ({ trend: t, player: players[t.player_id], score: players[t.player_id] ? waiverScore(players[t.player_id], t.count) : null }))
      .filter((x) => x.player && x.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 20);
  }, [trending, rosteredIds, players]);

  async function loadAccount() {
    if (!username.trim()) return;
    setLoading(true); setError("");
    try {
      const u = await sleeper.user(username.trim());
      const ls = await sleeper.leagues(u.user_id, "2026");
      setUser(u); setLeagues(ls); setLeague(null);
      if (!ls.length) setError("No 2026 Sleeper NFL leagues were found for this account.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Sleeper account");
    } finally { setLoading(false); }
  }

  async function selectLeague(selected: SleeperLeague) {
    setLoading(true); setError("");
    try {
      const [rs, ds, psResponse, trends] = await Promise.all([
        sleeper.rosters(selected.league_id),
        sleeper.drafts(selected.league_id),
        fetch("/api/players"),
        sleeper.trending("add"),
      ]);
      const playerData = await psResponse.json() as PlayerMap;
      const activeDraft = ds.find((d) => d.status === "drafting") ?? ds[0];
      const draftPicks = activeDraft ? await sleeper.picks(activeDraft.draft_id) : [];
      setLeague(selected); setRosters(rs); setDrafts(ds); setPicks(draftPicks); setPlayers(playerData); setTrending(trends); setTab("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load league");
    } finally { setLoading(false); }
  }

  const activeDraft = drafts.find((d) => d.status === "drafting") ?? drafts[0];

  if (!league) {
    return <main className="shell">
      <section className="card setup">
        <div className="brand"><h1>🏈 Fantasy NFL Copilot</h1><p className="muted">Turn Sleeper into a simple decision dashboard.</p></div>
        <div className="row" style={{ marginTop: 24 }}>
          <input className="input" placeholder="Sleeper username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadAccount()} />
          <button className="btn" onClick={loadAccount} disabled={loading}>{loading ? "Loading…" : "Find my leagues"}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {user && <div style={{ marginTop: 22 }}><p><strong>{user.display_name}</strong> · pick a 2026 league</p><div className="list">{leagues.map((l) => <button key={l.league_id} className="item" style={{ color: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => selectLeague(l)}><span><strong>{l.name}</strong><span className="muted tiny">{l.total_rosters} teams · {l.status}</span></span><span>→</span></button>)}</div></div>}
      </section>
    </main>;
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><h1>🏈 Fantasy Copilot</h1><div className="muted"><span className="leagueName">{league.name}</span> · {league.total_rosters} teams · {league.season}</div></div>
      <button className="btn secondary" onClick={() => setLeague(null)}>Change league</button>
    </header>

    <nav className="nav">{(["dashboard", "draft", "team", "waivers", "players"] as Tab[]).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
    {error && <p className="error">{error}</p>}

    {tab === "dashboard" && <Dashboard league={league} myRoster={myRoster} activeDraft={activeDraft} picks={picks} players={players} recommendations={recommendations} waiverTargets={waiverTargets} />}
    {tab === "draft" && <DraftView activeDraft={activeDraft} picks={picks} recommendations={recommendations} />}
    {tab === "team" && <TeamView roster={myRoster} players={players} league={league} />}
    {tab === "waivers" && <WaiverView targets={waiverTargets} />}
    {tab === "players" && <PlayersView players={players} query={query} setQuery={setQuery} rosteredIds={rosteredIds} />}
  </main>;
}

function Dashboard({ league, myRoster, activeDraft, picks, players, recommendations, waiverTargets }: any) {
  const rosterCount = myRoster?.players?.length ?? 0;
  const top = recommendations[0];
  const starterIssues = (myRoster?.starters ?? []).filter((id: string) => players[id]?.injury_status).length;
  return <div className="grid">
    <section className="card span4"><div className="muted tiny">ROSTER</div><div className="metric">{rosterCount}</div><div className="muted">players currently on your team</div></section>
    <section className="card span4"><div className="muted tiny">DRAFT</div><div className="metric">{activeDraft?.status ?? "none"}</div><div className="muted">{picks.length} picks recorded</div></section>
    <section className="card span4"><div className="muted tiny">STARTER ALERTS</div><div className={`metric ${starterIssues ? "warning" : "positive"}`}>{starterIssues}</div><div className="muted">injury flags in your starters</div></section>
    <section className="card span8"><h2 className="sectionTitle">What should I do?</h2><div className="actions">
      {top ? <div className="action good"><strong>Draft watch: {nameOf(top.player)}</strong><div className="muted">Top current heuristic draft score: {top.rating.score}/100. {top.rating.reason}</div></div> : <div className="action">Load player data to see draft suggestions.</div>}
      {waiverTargets[0] ? <div className="action warn"><strong>Trending waiver: {nameOf(waiverTargets[0].player)}</strong><div className="muted">Available in your league and trending on Sleeper. Waiver score {waiverTargets[0].score}/100.</div></div> : null}
      <div className="action"><strong>League format detected</strong><div className="muted">{league.roster_positions.join(" · ")}</div></div>
    </div></section>
    <section className="card span4"><h2 className="sectionTitle">Scoring snapshot</h2><div className="list">{Object.entries(league.scoring_settings).slice(0, 8).map(([k,v]) => <div className="item" key={k}><span>{k}</span><strong>{String(v)}</strong></div>)}</div></section>
  </div>;
}

function DraftView({ activeDraft, picks, recommendations }: any) {
  if (!activeDraft) return <div className="card empty">No Sleeper draft exists for this league yet. This screen will light up automatically once one is created.</div>;
  const top = recommendations[0];
  return <div className="grid">
    <section className="card span8 heroRecommendation"><div className="pill">TOP RECOMMENDATION</div>{top ? <><h2 style={{ fontSize: 32, marginBottom: 4 }}>{nameOf(top.player)}</h2><div className="muted">{top.rating.position} · {top.player.team ?? "FA"}</div><div className="metric positive">{top.rating.score}/100</div><p>{top.rating.reason}</p><div className="bars">{Object.entries(top.rating.parts).map(([label,value]) => <div className="barLine" key={label}><span>{pretty(label)}</span><div className="bar"><div style={{ width: `${value}%` }} /></div><strong>{String(value)}</strong></div>)}</div></> : <p>No eligible recommendation yet.</p>}</section>
    <section className="card span4"><h2 className="sectionTitle">Draft status</h2><div className="metric">{activeDraft.status}</div><div className="muted">{picks.length} picks made · {activeDraft.settings.rounds ?? "?"} rounds</div></section>
    <section className="card span6"><h2 className="sectionTitle">Next best options</h2><div className="list">{recommendations.slice(1, 9).map((r: any, i: number) => <div className="item" key={r.player.player_id}><span><strong>#{i+2} {nameOf(r.player)}</strong><span className="muted tiny">{r.rating.position} · {r.player.team ?? "FA"}</span></span><span className="score">{r.rating.score}</span></div>)}</div></section>
    <section className="card span6"><h2 className="sectionTitle">Recent picks</h2><div className="list">{picks.slice(-10).reverse().map((p: SleeperDraftPick) => <div className="item" key={`${p.pick_no}-${p.player_id}`}><span><strong>#{p.pick_no} {p.metadata?.first_name} {p.metadata?.last_name}</strong><span className="muted tiny">{p.metadata?.position} · {p.metadata?.team}</span></span><span>R{p.round}</span></div>)}</div></section>
  </div>;
}

function TeamView({ roster, players, league }: { roster: SleeperRoster | null; players: PlayerMap; league: SleeperLeague }) {
  if (!roster) return <div className="card empty">I could not match this Sleeper account to a roster in the league.</div>;
  const starterIds = new Set(roster.starters ?? []);
  const starters = (roster.players ?? []).filter((id) => starterIds.has(id));
  const bench = (roster.players ?? []).filter((id) => !starterIds.has(id));
  const renderPlayer = (id: string) => <div className="item" key={id}><span><strong>{nameOf(players[id])}</strong><span className="playerMeta"><span className="muted tiny">{players[id]?.position ?? "?"} · {players[id]?.team ?? "FA"}</span>{players[id]?.injury_status && <span className="tag danger">{players[id].injury_status}</span>}</span></span></div>;
  return <div className="grid"><section className="card span12"><h2 className="sectionTitle">Roster construction</h2><div className="muted">Required slots: {league.roster_positions.join(" · ")}</div></section><section className="card span6"><h2 className="sectionTitle">Starters</h2><div className="list">{starters.length ? starters.map(renderPlayer) : <div className="empty">No starters yet.</div>}</div></section><section className="card span6"><h2 className="sectionTitle">Bench</h2><div className="list">{bench.length ? bench.map(renderPlayer) : <div className="empty">No bench players yet.</div>}</div></section></div>;
}

function WaiverView({ targets }: any) {
  return <div className="grid"><section className="card span12"><h2 className="sectionTitle">Waiver radar</h2><p className="muted">Players not rostered in your league who are trending as adds across Sleeper. This is a discovery score, not yet a full projection model.</p><div className="list">{targets.length ? targets.map((x: any, i: number) => <div className="item" key={x.player.player_id}><span><strong>#{i+1} {nameOf(x.player)}</strong><span className="muted tiny">{x.player.position} · {x.player.team ?? "FA"} · {x.trend.count} adds in trend window</span></span><span className="score">{x.score}</span></div>) : <div className="empty">No waiver candidates loaded.</div>}</div></section></div>;
}

function PlayersView({ players, query, setQuery, rosteredIds }: { players: PlayerMap; query: string; setQuery: (s:string)=>void; rosteredIds: Set<string> }) {
  const filtered = Object.values(players).filter((p) => ["QB","RB","WR","TE"].includes(p.position ?? "") && nameOf(p).toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  return <section className="card"><h2 className="sectionTitle">Player explorer</h2><input className="input search" placeholder="Search NFL players…" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="list">{filtered.map((p) => <div className="item" key={p.player_id}><span><strong>{nameOf(p)}</strong><span className="playerMeta"><span className="muted tiny">{p.position} · {p.team ?? "FA"}</span>{p.injury_status && <span className="tag danger">{p.injury_status}</span>}</span></span><span className="pill">{rosteredIds.has(p.player_id) ? "ROSTERED" : "AVAILABLE"}</span></div>)}</div></section>;
}

function nameOf(p?: SleeperPlayer) { return p?.full_name || `${p?.first_name ?? "Unknown"} ${p?.last_name ?? "player"}`.trim(); }
function pretty(s: string) { return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()); }
