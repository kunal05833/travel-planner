import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { api } from "./api";
import "./styles.css";

const INTERESTS = ["Food", "Sightseeing", "Adventure", "Culture", "Nature", "Shopping", "Nightlife", "Relaxation"];
const TYPE_LABEL = { attraction: "See", food: "Eat", stay: "Stay", transport: "Move" };
const money = (n, c = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n || 0);

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("list");
  const [tripId, setTripId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return <p className="center">Loading…</p>;
  if (!session) return <Auth />;
  const open = (id) => { setTripId(id); setView("trip"); };

  return (
    <div className="app">
      <header>
        <h1 onClick={() => setView("list")}>Wayfare</h1>
        <nav>
          <button onClick={() => setView("new")}>Plan a trip</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Log out</button>
        </nav>
      </header>
      <main>
        {view === "list" && <Dashboard open={open} onNew={() => setView("new")} />}
        {view === "new" && <TripForm done={open} />}
        {view === "trip" && <Itinerary id={tripId} back={() => setView("list")} />}
      </main>
    </div>
  );
}

function Auth() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setErr("");
    const days = (new Date(f.end_date) - new Date(f.start_date)) / 86400000 + 1;
    if (days < 1) return setErr("End date must be on or after the start date.");
    if (days > 14) return setErr("Trips can be at most 14 days long.");
    setBusy(true);
    let trip;
    try {
      trip = await api("/api/trips", "POST", { ...f, budget: +f.budget, group_size: +f.group_size });
      await api(`/api/trips/${trip.id}/generate`, "POST");
      done(trip.id);
    } catch (e) {
      if (trip) await api(`/api/trips/${trip.id}`, "DELETE").catch(() => {});
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <div className="auth-hero">
        <h1>Wayfare</h1>
        <p>Tell us where, when and how you like to travel. Get a day-by-day plan in seconds.</p>
      </div>
      <form onSubmit={submit} className="card">
        <h2>{mode === "login" ? "Log in" : "Create your account"}</h2>
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {msg && <p className="err">{msg}</p>}
        <button>{mode === "login" ? "Log in" : "Sign up"}</button>
        <button type="button" className="link" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ open, onNew }) {
  const [trips, setTrips] = useState(null);
  const [err, setErr] = useState("");
  const load = () => api("/api/trips").then(setTrips).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (id) => {
    if (!confirm("Delete this trip and its itinerary?")) return;
    await api(`/api/trips/${id}`, "DELETE"); load();
  };
  if (err) return <p className="err">{err}</p>;
  if (!trips) return <p>Loading trips…</p>;
  if (!trips.length)
    return (<div className="empty"><h2>No trips yet</h2><p>Plan your first trip and the itinerary appears here.</p><button onClick={onNew}>Plan a trip</button></div>);
  return (
    <>
      <h2>Your trips</h2>
      <div className="grid">
        {trips.map((t) => (
          <div key={t.id} className="card trip">
            <h3>{t.destination}</h3>
            <p className="muted">{t.start_date} to {t.end_date}</p>
            <p>{t.group_size} traveller{t.group_size > 1 ? "s" : ""} · budget {money(t.budget, t.currency)}</p>
            <div className="row">
              <button onClick={() => open(t.id)}>Open itinerary</button>
              <button className="ghost" onClick={() => remove(t.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TripForm({ done }) {
  const [f, setF] = useState({
    destination: "", start_date: "", end_date: "", budget: 20000, currency: "INR",
    group_size: 1, travel_style: "balanced", pace: "moderate", stay_type: "mid-range", interests: ["Food", "Sightseeing"],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (i) => setF({ ...f, interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i] });

  const submit = async (e) => {
    e.preventDefault(); setErr("");
    if (f.end_date < f.start_date) return setErr("End date must be on or after the start date.");
    setBusy(true);
    try {
      const trip = await api("/api/trips", "POST", { ...f, budget: +f.budget, group_size: +f.group_size });
      await api(`/api/trips/${trip.id}/generate`, "POST");
      done(trip.id);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="card form">
      <h2>Plan a trip</h2>
      <label>Destination<input required placeholder="e.g. Goa, India" value={f.destination} onChange={set("destination")} /></label>
      <div className="cols">
        <label>Start date<input type="date" required value={f.start_date} onChange={set("start_date")} /></label>
        <label>End date<input type="date" required value={f.end_date} onChange={set("end_date")} /></label>
      </div>
      <div className="cols">
        <label>Total budget<input type="number" min="1" required value={f.budget} onChange={set("budget")} /></label>
        <label>Currency
          <select value={f.currency} onChange={set("currency")}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select>
        </label>
        <label>Travellers<input type="number" min="1" max="50" value={f.group_size} onChange={set("group_size")} /></label>
      </div>
      <div className="cols">
        <label>Travel style
          <select value={f.travel_style} onChange={set("travel_style")}>
            <option value="budget">Budget</option><option value="balanced">Balanced</option><option value="luxury">Luxury</option><option value="romantic">Romantic</option><option value="adventure">Adventure</option>
          </select>
        </label>
        <label>Pace
          <select value={f.pace} onChange={set("pace")}><option value="relaxed">Relaxed</option><option value="moderate">Moderate</option><option value="packed">Packed</option></select>
        </label>
        <label>Stay
          <select value={f.stay_type} onChange={set("stay_type")}><option value="hostel">Hostel</option><option value="mid-range">Mid-range</option><option value="premium">Premium</option></select>
        </label>
      </div>
      <fieldset><legend>Interests</legend>
        <div className="chips">
          {INTERESTS.map((i) => (
            <button type="button" key={i} className={"chip" + (f.interests.includes(i) ? " on" : "")} onClick={() => toggle(i)}>{i}</button>
          ))}
        </div>
      </fieldset>
      {err && <p className="err">{err}</p>}
      <button disabled={busy}>{busy ? "Building your itinerary…" : "Generate itinerary"}</button>
    </form>
  );
}

function Itinerary({ id, back }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const load = () => api(`/api/trips/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (!data) return err ? <p className="err">{err}</p> : <p>Loading itinerary…</p>;

  const { trip, days } = data;
  const total = days.reduce((s, d) => s + Number(d.estimated_cost || 0), 0);
  const over = total > trip.budget;

  const edit = (di, fn) => {
    const copy = structuredClone(days); fn(copy[di]);
    copy[di].estimated_cost = copy[di].activities.reduce((s, a) => s + Number(a.cost || 0), 0);
    setData({ trip, days: copy });
  };
  const run = async (key, fn, ok) => {
    setBusy(key); setErr(""); setNote("");
    try { await fn(); await load(); setNote(ok); } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  return (
    <>
      <button className="link" onClick={back}>Back to trips</button>
      <div className="summary">
        <div>
          <h2>{trip.destination}</h2>
          <p className="muted">{trip.start_date} to {trip.end_date} · {trip.group_size} traveller{trip.group_size > 1 ? "s" : ""}</p>
        </div>
        <div className={"cost" + (over ? " over" : "")}>
          <strong>{money(total, trip.currency)}</strong>
          <span>of {money(trip.budget, trip.currency)} budget{over ? " – over budget" : ""}</span>
        </div>
      </div>
      <div className="row">
        <button disabled={!!busy} onClick={() => confirm("Replace the whole itinerary?") && run("all", () => api(`/api/trips/${id}/generate`, "POST"), "Itinerary regenerated.")}>
          {busy === "all" ? "Regenerating…" : "Regenerate all days"}
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      {note && <p className="ok">{note}</p>}
      {!days.length && <div className="empty"><p>No itinerary yet. Generate one to get started.</p></div>}

      {days.map((d, di) => (
        <section key={d.id} className="card day">
          <div className="day-head">
            <div>
              <h3>Day {d.day_number}</h3>
              <input className="title-input" value={d.title} placeholder="Day theme" onChange={(e) => edit(di, (x) => (x.title = e.target.value))} />
            </div>
            <strong>{money(d.estimated_cost, trip.currency)}</strong>
          </div>
          <ul>
            {d.activities.map((a, ai) => (
              <li key={ai} className={"act " + a.type}>
                <input className="time" value={a.time} onChange={(e) => edit(di, (x) => (x.activities[ai].time = e.target.value))} />
                <div className="act-body">
                  <div className="act-top">
                    <span className="tag">{TYPE_LABEL[a.type] || "See"}</span>
                    <input className="name" value={a.name} onChange={(e) => edit(di, (x) => (x.activities[ai].name = e.target.value))} />
                  </div>
                  <input className="desc" value={a.description} onChange={(e) => edit(di, (x) => (x.activities[ai].description = e.target.value))} />
                </div>
                <input className="num" type="number" min="0" value={a.cost} onChange={(e) => edit(di, (x) => (x.activities[ai].cost = +e.target.value))} />
                <button className="ghost small" aria-label="Remove activity" onClick={() => edit(di, (x) => x.activities.splice(ai, 1))}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="ghost" onClick={() => edit(di, (x) => x.activities.push({ time: "", type: "attraction", name: "New activity", description: "", cost: 0 }))}>Add activity</button>
            <button disabled={!!busy} onClick={() => run("s" + d.day_number, () => api(`/api/trips/${id}/days/${d.day_number}`, "PUT", { title: d.title, activities: d.activities }), `Day ${d.day_number} saved.`)}>
              {busy === "s" + d.day_number ? "Saving…" : "Save day"}
            </button>
            <button className="ghost" disabled={!!busy} onClick={() => run("r" + d.day_number, () => api(`/api/trips/${id}/days/${d.day_number}/regenerate`, "POST"), `Day ${d.day_number} regenerated.`)}>
              {busy === "r" + d.day_number ? "Regenerating…" : "Regenerate day"}
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
