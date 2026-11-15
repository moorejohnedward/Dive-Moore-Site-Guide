/* Dive Moore Conditions app. Site data lives in data/sites.js. */
/* ===== Data ===== */
const COMM = {db: null, user: null, me: null, canWrite: false, reports: [], notes: [], names: {}, unsub: null, ready: false};

/* ===== Helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const M2FT = 3.28084, C2F = c => c * 9 / 5 + 32;
const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = d => d == null ? "–" : DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const fmt = (v, d = 0) => v == null || isNaN(v) ? "–" : Number(v).toFixed(d);
const avg = a => { const f = a.filter(x => x != null && !isNaN(x)); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null; };
const circAvg = a => { const f = a.filter(x => x != null); if (!f.length) return null; let s = 0, c = 0; f.forEach(d => { s += Math.sin(d * Math.PI / 180); c += Math.cos(d * Math.PI / 180); }); return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360; };
const angDiff = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const hstTime = d => d.toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Pacific/Honolulu"}).replace(":", "");
const hstDay = d => d.toLocaleDateString("en-US", {weekday: "short", timeZone: "Pacific/Honolulu"});
const ymd = d => d.toLocaleDateString("en-CA", {timeZone: "Pacific/Honolulu"}).replace(/-/g, "");
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

/* ===== Live sources (all free, no key, browser-friendly) ===== */
const WAVE_MODELS = ["ecmwf_wam025", "ncep_gfswave025", "meteofrance_wave", "dwd_gwam"];
const WAVE_MODEL_NAMES = {ecmwf_wam025: "ECMWF WAM", ncep_gfswave025: "NOAA GFS-Wave", meteofrance_wave: "Météo-France MFWAM", dwd_gwam: "DWD GWAM"};
const WIND_MODELS = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless"];
const WIND_MODEL_NAMES = {gfs_seamless: "NOAA GFS", ecmwf_ifs025: "ECMWF IFS", icon_seamless: "DWD ICON"};

const state = {cached: null, obsWind: {}, marine: {}, nws: {}, cond: {}, tides: {}, temps: {}, alerts: [], live: false, when: null, sources: {}, filter: store("dm-region") || "All", pub: store("dm-pub") === "1", q: "", kind: "All", easy: false, me: null, geoErr: "", dest: store("dm-dest") || "", gf: +(store("dm-gf") || 70), dives: null};

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, {signal: ctl.signal}); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

function seaPoint(s) { // nudge 2 km seaward so the model grid treats the point as ocean
  const k = 0.018, rad = (s.faces || 270) * Math.PI / 180;
  return [ (s.lat + k * Math.cos(rad)).toFixed(4), (s.lon + k * Math.sin(rad) / Math.cos(s.lat * Math.PI / 180)).toFixed(4) ];
}

function hourIndex(times) {
  const now = new Date(); const key = now.toLocaleString("sv-SE", {timeZone: "Pacific/Honolulu"}).slice(0, 13).replace(" ", "T");
  const i = times.findIndex(t => t.startsWith(key)); return i < 0 ? 0 : i;
}

/* Sites within ~2.5 mi share one forecast point. The models' grids are coarser than that,
   and fewer points keep each request inside Open-Meteo's free-use limits. */
function gridPoints(pts, step = 0.04) {
  const key = p => Math.round(p[0] / step) + "," + Math.round(p[1] / step);
  const uniq = [], at = {}, idx = pts.map(p => { const k = key(p); if (!(k in at)) { at[k] = uniq.length; uniq.push(p); } return at[k]; });
  return {uniq, idx};
}
const coordQS = pts => `latitude=${pts.map(p => (+p[0]).toFixed(3)).join(",")}&longitude=${pts.map(p => (+p[1]).toFixed(3)).join(",")}`;

async function loadWaves() {
  const g = gridPoints(SITES.map(seaPoint));
  const base = `${coordQS(g.uniq)}&timezone=Pacific%2FHonolulu&forecast_days=4`;
  const waveVars = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height";
  const [w, oc] = await Promise.all([
    getJSON(`https://marine-api.open-meteo.com/v1/marine?${base}&hourly=${waveVars}&models=${WAVE_MODELS.join(",")}`),
    getJSON(`https://marine-api.open-meteo.com/v1/marine?${base}&hourly=sea_surface_temperature,ocean_current_velocity,ocean_current_direction`)
  ]);
  const W = Array.isArray(w) ? w : [w], O = Array.isArray(oc) ? oc : [oc];
  SITES.forEach((s, i) => {
    const h = W[g.idx[i]].hourly, o = O[g.idx[i]].hourly, n = hourIndex(h.time);
    const pick = (v, m) => h[`${v}_${m}`] || h[v];
    const per = WAVE_MODELS.map(m => ({m, sw: pick("swell_wave_height", m), sd: pick("swell_wave_direction", m), sp: pick("swell_wave_period", m), wh: pick("wave_height", m), ww: pick("wind_wave_height", m)})).filter(x => x.wh && x.wh[n] != null);
    const series = h.time.map((t, k) => avg(per.map(x => x.wh[k])));
    const c = state.cond[s.id] = state.cond[s.id] || {};
    Object.assign(c, {
      times: h.time, n,
      waveSeries: series,
      swellS: h.time.map((t, k) => avg(per.map(x => x.sw?.[k]))),
      swellDirS: h.time.map((t, k) => circAvg(per.map(x => x.sd?.[k]))),
      windWaveS: h.time.map((t, k) => avg(per.map(x => x.ww?.[k]))),
      wave: avg(per.map(x => x.wh[n])), waveRange: per.map(x => x.wh[n]),
      swell: avg(per.map(x => x.sw?.[n])), swellDir: circAvg(per.map(x => x.sd?.[n])), swellPer: avg(per.map(x => x.sp?.[n])),
      windWave: avg(per.map(x => x.ww?.[n])),
      waveModels: per.map(x => WAVE_MODEL_NAMES[x.m]),
      sst: o.sea_surface_temperature?.[hourIndex(o.time)],
      cur: o.ocean_current_velocity?.[hourIndex(o.time)], curDir: o.ocean_current_direction?.[hourIndex(o.time)]
    });
  });
  state.sources.waves = "Open-Meteo Marine (" + Object.values(WAVE_MODEL_NAMES).join(", ") + ")";
  state.sources.ocean = "Open-Meteo Marine · Météo-France SMOC currents & SST";
}

async function loadWind() {
  const g = gridPoints(SITES.map(s => [s.lat, s.lon]));
  const base = `${coordQS(g.uniq)}&timezone=Pacific%2FHonolulu&forecast_days=4&past_days=2&wind_speed_unit=kn`;
  const vars = "hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation";
  let r, models = WIND_MODELS;
  try { r = await getJSON(`https://api.open-meteo.com/v1/forecast?${base}&${vars}&models=${models.join(",")}`); }
  catch (e) { // busy or over the limit: try once more with a single model
    await new Promise(ok => setTimeout(ok, 2000)); models = ["gfs_seamless"];
    r = await getJSON(`https://api.open-meteo.com/v1/forecast?${base}&${vars}&models=gfs_seamless`);
  }
  const R = Array.isArray(r) ? r : [r];
  SITES.forEach((s, i) => {
    const h = R[g.idx[i]].hourly, n = hourIndex(h.time);
    const pick = (v, m) => h[`${v}_${m}`] || h[v];
    const per = models.map(m => ({m, ws: pick("wind_speed_10m", m), wd: pick("wind_direction_10m", m), wg: pick("wind_gusts_10m", m), pr: pick("precipitation", m)})).filter(x => x.ws && x.ws[n] != null);
    const c = state.cond[s.id] = state.cond[s.id] || {};
    let rain48 = 0; for (let k = Math.max(0, n - 48); k < n; k++) rain48 += avg(per.map(x => x.pr?.[k])) || 0;
    Object.assign(c, {
      wTimes: h.time, wn: n,
      windSeries: h.time.map((t, k) => avg(per.map(x => x.ws[k]))),
      windDirS: h.time.map((t, k) => circAvg(per.map(x => x.wd[k]))),
      wind: avg(per.map(x => x.ws[n])), windRange: per.map(x => x.ws[n]), windDir: circAvg(per.map(x => x.wd[n])), gust: avg(per.map(x => x.wg?.[n])),
      rain48, windModels: per.map(x => WIND_MODEL_NAMES[x.m])
    });
  });
  state.sources.wind = "Open-Meteo Forecast (" + models.map(m => WIND_MODEL_NAMES[m]).join(", ") + ")";
}

async function loadTides() {
  const now = new Date(), b = ymd(new Date(now - 864e5)), e = ymd(new Date(+now + 2 * 864e5));
  await Promise.all(Object.entries(TIDE_STATIONS).map(async ([key, st]) => {
    try {
      const r = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${st.id}&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&format=json&interval=hilo&begin_date=${b}&end_date=${e}&application=DiveMoore`);
      state.tides[key] = (r.predictions || []).map(p => ({t: new Date(p.t.replace(" ", "T") + ":00-10:00"), v: +p.v, type: p.type}));
    } catch (err) {}
    if (st.temp) try {
      const r = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${st.id}&product=water_temperature&date=latest&units=english&time_zone=lst_ldt&format=json&application=DiveMoore`);
      const d = r.data?.[0]; if (d && d.v !== "") state.temps[key] = {f: +d.v, t: new Date(d.t.replace(" ", "T") + ":00-10:00"), name: st.name};
    } catch (err) {}
    try { // measured wind at the harbor gauge (an observation, not a forecast)
      const r = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${st.id}&product=wind&date=latest&units=english&time_zone=lst_ldt&format=json&application=DiveMoore`);
      const d = r.data?.[0]; if (d && d.s !== "") state.obsWind[key] = {kt: +d.s, dir: +d.d, gust: +d.g, t: new Date(d.t.replace(" ", "T") + ":00-10:00"), name: st.name};
    } catch (err) {}
  }));
  if (Object.keys(state.tides).length) state.sources.tides = "NOAA CO-OPS tides, water temperature and measured wind";
}

/* NOAA NWS coastal waters forecasts: the official marine forecast for each patch of water */
const MARINE_ZONES = {PHZ121: "Alenuihaha Channel", PHZ122: "Big Island Windward Waters", PHZ123: "Big Island Leeward Waters", PHZ124: "Big Island Southeast Waters"};
const zoneFor = s => s.marineZone || (s.side === "east" ? (s.region === "Puna" ? "PHZ124" : "PHZ122") : s.lat > 20.1 ? "PHZ121" : "PHZ123");
async function loadMarine() {
  await Promise.all(Object.keys(MARINE_ZONES).map(async z => {
    try {
      const r = await getJSON(`https://api.weather.gov/zones/coastal/${z}/forecast`);
      const p = r.properties || {};
      state.marine[z] = {updated: p.updated, periods: (p.periods || []).slice(0, 4).map(x => ({name: x.name, text: x.detailedForecast}))};
    } catch (err) {}
  }));
  if (Object.keys(state.marine).length) state.sources.marine = "NOAA NWS coastal waters forecast";
}
/* NOAA NWS hourly forecast wind for one site, fetched when the site is opened */
async function loadNws(s) {
  if (state.nws[s.id] || !state.live) return;
  state.nws[s.id] = {loading: true};
  try {
    const pt = await getJSON(`https://api.weather.gov/points/${s.lat.toFixed(4)},${s.lon.toFixed(4)}`);
    const fc = await getJSON(pt.properties.forecastHourly);
    const MPH2KT = 0.868976, dirs = {N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5};
    const hrs = (fc.properties?.periods || []).slice(0, 24).map(x => ({t: new Date(x.startTime), kt: parseFloat(x.windSpeed) * MPH2KT, dir: dirs[x.windDirection] ?? null, short: x.shortForecast}));
    state.nws[s.id] = {hrs};
    state.sources.nws = "NOAA NWS hourly forecast";
  } catch (err) { state.nws[s.id] = {err: true}; }
  if (decodeURIComponent(location.hash.slice(1)) === s.id) render();
}

async function loadAlerts() {
  const r = await getJSON("https://api.weather.gov/alerts/active?area=HI");
  const words = /big island|hawaii county|kona|kohala|ka.?u|puna|hilo|hamakua|south point|leeward|windward waters|alenuihaha/i;
  state.alerts = (r.features || []).map(f => f.properties).filter(p => words.test(p.areaDesc || "") && /surf|marine|small craft|wind|gale|tsunami|flood|storm|hurricane|brown water/i.test(p.event || ""));
  state.sources.alerts = "National Weather Service Honolulu alerts";
}

async function loadAll() {
  $("#stamp").textContent = "Loading conditions…";
  const results = await Promise.allSettled([loadWaves(), loadWind(), loadTides(), loadAlerts(), loadMarine()]);
  state.nws = {};
  state.live = results[0].status === "fulfilled" || results[1].status === "fulfilled";
  state.cached = null; state.loaded = true;
  if (state.live) { state.when = new Date(); saveCache(); }
  else if (DEMO) { demoFill(); state.when = new Date(); }
  else if (loadCache()) state.cached = state.when;
  $("#stamp").innerHTML = state.live ? `Updated ${hstTime(state.when)} HST` : state.cached ? `Offline · last update ${hstDay(state.when)} ${hstTime(state.when)}` : DEMO ? "Example conditions" : "No connection";
  render();
}

/* ===== Offline: keep the last good download so the app still opens at the dive site ===== */
const DEMO = /[?&]demo=1/.test(location.search);
const CACHE_KEY = "dm-last-conditions", CACHE_MAX_H = 36;
function saveCache() {
  store(CACHE_KEY, JSON.stringify({when: state.when, obsWind: state.obsWind, marine: state.marine, cond: state.cond, tides: state.tides, temps: state.temps, alerts: state.alerts, sources: state.sources}));
}
function loadCache() {
  try {
    const c = JSON.parse(store(CACHE_KEY) || "null"); if (!c) return false;
    const when = new Date(c.when); if (Date.now() - when > CACHE_MAX_H * 36e5) return false;
    state.when = when; state.cond = c.cond || {}; state.marine = c.marine || {};
    state.obsWind = Object.fromEntries(Object.entries(c.obsWind || {}).map(([k, p]) => [k, {...p, t: new Date(p.t)}])); state.alerts = c.alerts || []; state.sources = c.sources || {};
    state.tides = Object.fromEntries(Object.entries(c.tides || {}).map(([k, a]) => [k, a.map(p => ({...p, t: new Date(p.t)}))]));
    state.temps = Object.fromEntries(Object.entries(c.temps || {}).map(([k, p]) => [k, {...p, t: new Date(p.t)}]));
    return true;
  } catch (e) { return false; }
}

/* ===== Example data for testing only (add ?demo=1 to the address) ===== */
function demoFill() {
  const now = new Date(); const times = [], wt = [];
  for (let k = -48; k < 96; k++) { const d = new Date(+now + k * 36e5); const s = d.toLocaleString("sv-SE", {timeZone: "Pacific/Honolulu"}).slice(0, 13).replace(" ", "T") + ":00"; wt.push(s); if (k >= 0) times.push(s); }
  SITES.forEach((s, i) => {
    const north = s.faces < 60 || s.faces > 300, east = s.faces >= 30 && s.faces <= 150;
    const base = east ? 1.4 : north ? 1.1 : 0.7;
    const waveSeries = times.map((t, k) => base + 0.35 * Math.sin(k / 9 + i) + (k > 40 ? 0.4 : 0));
    const windSeries = wt.map((t, k) => (east ? 15 : 8) + 4 * Math.sin(k / 6 + i / 2));
    state.cond[s.id] = {
      times, n: 0, waveSeries,
      swellS: waveSeries.map(v => v * .8), swellDirS: times.map(() => 320), windWaveS: times.map(() => east ? .6 : .2),
      windDirS: wt.map((t, k) => east ? 65 : (new Date(t + ":00-10:00").getHours() >= 12 ? 250 : 90)), wave: waveSeries[0], waveRange: [waveSeries[0] * .9, waveSeries[0] * 1.15],
      swell: waveSeries[0] * .8, swellDir: 320, swellPer: 13, windWave: east ? .6 : .2, waveModels: ["example"],
      sst: 26.4, cur: 0.25 + (i % 3) * 0.1, curDir: 300 + i * 7,
      wTimes: wt, wn: 48, windSeries, wind: windSeries[48], windRange: [windSeries[48] - 2, windSeries[48] + 3], windDir: east ? 65 : 250, gust: windSeries[48] * 1.4,
      rain48: east ? 14 : 1, windModels: ["example"]
    };
  });
  const mk = (h, v, type) => ({t: new Date(+now + h * 36e5), v, type});
  Object.keys(TIDE_STATIONS).forEach(k => state.tides[k] = [mk(-8, 0.2, "L"), mk(-2, 2.1, "H"), mk(4.3, 0.4, "L"), mk(10.4, 1.7, "H"), mk(16.6, 0.1, "L"), mk(22.8, 2.2, "H"), mk(29, 0.3, "L")]);
  state.alerts = []; state.sources = {};
}

/* ===== Interpretation ===== */
function assess(s) {
  if (s.closed) return {cls: "na", label: "Closed", why: s.closed};
  const c = state.cond[s.id]; if (!c || c.wave == null) return {cls: "na", label: "No data", why: "Conditions unavailable"};
  // How much of the swell reaches this site: full when swell comes straight at the shore, little when the island blocks it
  const exp = c.swellDir == null ? 1 : Math.max(0, Math.cos(angDiff(c.swellDir, s.faces) * Math.PI / 180));
  const surf = ((c.swell || 0) * (0.2 + 0.8 * exp) + (c.windWave || 0) * (angDiff(c.windDir ?? 0, s.faces) < 80 ? 1 : 0.3)) * M2FT;
  const onshore = c.windDir != null && angDiff(c.windDir, s.faces) < 60;
  const wind = c.wind ?? 0;
  const why = []; let score = 0;
  if (surf >= (s.type === "boat" ? 6 : 4)) { score = 2; why.push(`${fmt(surf, 1)} ft of swell reaching the site`); }
  else if (surf >= (s.type === "boat" ? 3.5 : 2)) { score = Math.max(score, 1); why.push(`${fmt(surf, 1)} ft of swell reaching the site`); }
  else why.push(`small surf at the site (${fmt(surf, 1)} ft)`);
  if (wind >= 25) { score = 2; why.push(`${fmt(wind)} kt wind`); }
  else if (wind >= 16 || (onshore && wind >= 12)) { score = Math.max(score, 1); why.push(`${fmt(wind)} kt ${onshore ? "onshore " : ""}wind`); }
  if (c.cur != null && c.cur * 1.944 >= 1.2) { score = Math.max(score, 1); why.push(`offshore current ${fmt(c.cur * 1.944, 1)} kt`); }
  const bad = state.alerts.find(a => /surf/i.test(a.event) && a.areaDesc && new RegExp(s.alertArea || "Kona", "i").test(a.areaDesc));
  if (bad) { score = 2; why.unshift(bad.event); }
  // Visibility estimate
  let vis = s.visBase * (1 - Math.min(0.55, surf * 0.09)) * (1 - Math.min(0.5, (c.rain48 || 0) / (s.runoff ? 30 : 70)));
  vis = Math.max(10, Math.round(vis / 5) * 5);
  return {cls: ["go", "warn", "stop"][score], label: ["Good", "Caution", "No-go"][score], why: why.join(" · "), surf, vis, onshore, exp, score};
}

function tideNow(key) {
  const T = state.tides[key]; if (!T || T.length < 2) return null;
  const now = Date.now(); const i = T.findIndex(p => +p.t > now); if (i <= 0) return null;
  const a = T[i - 1], b = T[i]; const f = (now - a.t) / (b.t - a.t);
  const v = a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
  return {v, rising: b.v > a.v, next: b, after: T[i + 1], prev: a};
}

function tideAt(key, t) {
  const T = state.tides[key]; if (!T) return null;
  const i = T.findIndex(p => +p.t > t); if (i <= 0) return null;
  const a = T[i - 1], b = T[i], f = (t - a.t) / (b.t - a.t);
  return {v: a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2, rising: b.v > a.v};
}

/* Best times: score every hour of the next 3 days for this site (0 = stay home, 100 = ideal) */
function plan(s) {
  const c = state.cond[s.id]; if (!c || !c.swellS || s.closed) return null;
  const night = s.prefer?.hours?.[0] >= 16;
  const out = [];
  const T = state.tides[s.tide] || [], tvals = T.map(p => p.v), tlo = Math.min(...tvals), thi = Math.max(...tvals);
  for (let k = c.n; k < c.times.length; k++) {
    const t = new Date(c.times[k] + ":00-10:00"), hr = +c.times[k].slice(11, 13);
    if (night ? (hr < 17 || hr > 20) : (hr < 6 || hr > 17)) continue;
    const wk = c.wTimes ? c.wTimes.indexOf(c.times[k]) : -1;
    const wind = wk >= 0 ? c.windSeries[wk] : c.wind, wdir = wk >= 0 ? c.windDirS?.[wk] : c.windDir;
    const sd = c.swellDirS[k], exp = sd == null ? 1 : Math.max(0, Math.cos(angDiff(sd, s.faces) * Math.PI / 180));
    const onshore = wdir != null && angDiff(wdir, s.faces) < 60;
    const surf = ((c.swellS[k] || 0) * (0.2 + 0.8 * exp) + (c.windWaveS[k] || 0) * (onshore ? 1 : 0.3)) * M2FT;
    let sc = 100;
    const lim = s.type === "boat" ? 3.5 : 2;
    sc -= Math.max(0, surf - 0.8) / lim * 45;
    sc -= Math.max(0, (wind ?? 0) - 8) * (onshore ? 3.2 : 2.2);
    const pref = s.prefer || {};
    if (pref.hours && !night) { if (hr < pref.hours[0] || hr > pref.hours[1]) sc -= 10; }
    const td = tideAt(s.tide, +t);
    if (td && T.length) {
      const rel = (td.v - tlo) / Math.max(.1, thi - tlo);
      if (pref.tide === "high") sc -= (1 - rel) * 18;
      if (pref.tide === "mid") sc -= Math.abs(rel - .5) * 14;
    }
    out.push({t, hr, day: c.times[k].slice(0, 10), sc: Math.max(0, Math.min(100, Math.round(sc))), surf, wind, td});
  }
  // best 2-hour windows, one per day
  const byDay = {};
  out.forEach((h, i) => { const nx = out[i + 1]; if (!nx || nx.day !== h.day || nx.hr !== h.hr + 1) return; const v = (h.sc + nx.sc) / 2; if (!byDay[h.day] || v > byDay[h.day].v) byDay[h.day] = {v, h, nx}; });
  return {hours: out, best: Object.values(byDay).sort((a, b) => b.v - a.v)};
}

function planHTML(s) {
  const p = plan(s); if (!p || !p.hours.length) return "";
  const days = [...new Set(p.hours.map(h => h.day))].slice(0, 4);
  const col = v => v >= 70 ? "var(--go)" : v >= 45 ? "var(--warn)" : "var(--stop)";
  const word = v => v >= 70 ? "Good" : v >= 45 ? "Fair" : "Poor";
  const top = p.best.slice(0, 3).map(b => `<li><b>${hstDay(b.h.t)} ${hstTime(b.h.t).replace(":00", "")}–${hstTime(new Date(+b.nx.t + 36e5)).replace(":00", "")}</b> · ${word(b.v)} (${Math.round(b.v)}/100) · surf ~${fmt(b.h.surf, 1)} ft, wind ${fmt(b.h.wind)} kt${b.h.td ? `, tide ${b.h.td.v.toFixed(1)} ft ${b.h.td.rising ? "rising" : "falling"}` : ""}</li>`).join("");
  const rows = days.map(d => {
    const hs = p.hours.filter(h => h.day === d);
    return `<div class="prow"><div class="pday">${hstDay(hs[0].t)}</div><div class="pcells">${hs.map(h => `<span title="${hstTime(h.t)} · ${h.sc}/100" style="background:${col(h.sc)};opacity:${.35 + h.sc / 160}"><em>${h.hr % 3 === 0 ? (h.hr > 12 ? h.hr - 12 : h.hr) : ""}</em></span>`).join("")}</div></div>`;
  }).join("");
  return `<section class="panel"><h3>Best times to dive</h3>
    <ul class="clean">${top || "<li>No good windows in the next 3 days.</li>"}</ul>
    <div class="plan" aria-hidden="true">${rows}</div>
    <div class="legend"><span><i style="background:var(--go)"></i>Good</span><span><i style="background:var(--warn)"></i>Fair</span><span><i style="background:var(--stop)"></i>Poor</span><span>Hourly, HST</span></div>
    <div class="note">${esc(s.prefer?.note || "")} Scores combine forecast swell at this site, wind and its direction, time of day and ${s.prefer?.tide && s.prefer.tide !== "any" ? `the ${s.prefer.tide} tide this entry needs` : "tide"}.</div></section>`;
}

/* ===== Rendering ===== */
function render() {
  const id = decodeURIComponent(location.hash.slice(1));
  const s = SITES.find(x => x.id === id);
  s ? renderSite(s) : renderList();
  const src = Object.values(state.sources);
  $("#srcfoot").textContent = src.length ? "Live sources: " + src.join(" · ") + "." : "";
}

function bannerHTML() {
  let h = "";
  if (!state.live && DEMO) h += `<div class="banner demo"><div><b>Showing example conditions (test mode).</b> Remove ?demo=1 from the address for live data.</div></div>`;
  else if (!state.live && state.cached) h += `<div class="banner demo"><div><b>You're offline.</b> Showing the last conditions downloaded ${esc(hstDay(state.cached))} ${esc(hstTime(state.cached))} HST. Conditions change fast: look at the water yourself.</div></div>`;
  else if (!state.live && state.loaded) h += `<div class="banner alert"><div><b>No live conditions.</b> The ocean and weather feeds couldn't be reached and there's no recent download on this device. Site details, maps and emergency info below still work.</div></div>`;
  state.alerts.forEach(a => h += `<div class="banner alert"><div><b>${esc(a.event)}</b> · ${esc((a.areaDesc || "").split(";").slice(0, 4).join(", "))}${a.ends ? ` · until ${esc(hstDay(new Date(a.ends)) + " " + hstTime(new Date(a.ends)))}` : ""} · <a href="https://www.weather.gov/hfo/" target="_blank" rel="noopener">NWS Honolulu</a></div></div>`);
  return h;
}

/* ===== Entry difficulty, distance ===== */
const ACCESS_WORDS = ["", "Easy", "Moderate", "Challenging", "Hard"];
function entryRating(s, a) {
  // Base access rating (1 easy … 4 hard, calm day) pushed up by today's surf/wind score
  if (s.type === "boat") return {n: 1, label: "Boat · mooring", cls: "go", why: "No shore entry; conditions at the mooring still apply."};
  const base = s.access || 2;
  const n = Math.min(4, base + (a.score || 0) + (a.score === 2 ? 1 : 0));
  const why = `${ACCESS_WORDS[base].toLowerCase()} entry on a calm day` + (a.score ? ` · ${a.score === 2 ? "much harder" : "harder"} in today's conditions` : " · conditions aren't adding to it");
  return {n, label: ACCESS_WORDS[n], cls: ["go", "go", "warn", "stop", "stop"][n], why};
}
function haversine(a, b) { const R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function distTo(s) { return state.me ? haversine(state.me, s) : null; }
function locate() {
  if (!navigator.geolocation) { state.geoErr = "Location isn't available in this browser."; renderList(); return; }
  state.geoErr = "Finding you…"; renderList();
  navigator.geolocation.getCurrentPosition(p => { state.me = {lat: p.coords.latitude, lon: p.coords.longitude}; state.geoErr = ""; render(); },
    err => { state.geoErr = err.code === 1 ? "Location permission was denied. Allow it in your browser to sort by distance." : "Couldn't get a location right now."; renderList(); }, {enableHighAccuracy: false, timeout: 12000, maximumAge: 300000});
}

/* ===== Altitude after diving: Bühlmann ZH-L16C with gradient factors ===== */
// Half-times (min) and a/b coefficients for nitrogen, ZH-L16C (Bühlmann 1995; Baker 1998 for gradient factors)
const ZHL16C = [[5, 1.1696, .5578], [8, 1.0, .6514], [12.5, .8618, .7222], [18.5, .7562, .7825], [27, .62, .8126], [38.3, .5043, .8434], [54.3, .441, .8693], [77, .4, .891], [109, .375, .9092], [146, .35, .9222], [187, .3295, .9319], [239, .3065, .9403], [305, .2835, .9477], [390, .261, .9544], [498, .248, .9602], [635, .2327, .9653]];
const FSW_ATM = 33, PH2O = 0.0627; // bar water vapour
function pAltBar(ft) { return 1.01325 * Math.pow(1 - 2.25577e-5 * ft * 0.3048, 5.25588); } // ISA barometric formula
// Simulate a dive series. dives: [{depth ft, time min, fo2, si min before this dive}]. Returns tissue N2 loadings (bar) at surface after last dive.
function tissueLoad(dives) {
  const Psurf = 1.01325;
  let p = ZHL16C.map(() => (Psurf - PH2O) * 0.79);
  const expose = (pi, t) => { p = p.map((pt, i) => pt + (pi - pt) * (1 - Math.pow(2, -t / ZHL16C[i][0]))); };
  for (const d of dives) {
    if (d.si > 0) expose((Psurf - PH2O) * 0.79, d.si);
    const Pamb = Psurf + d.depth / FSW_ATM * 1.01325, fn2 = 1 - (d.fo2 || .21);
    // descent/ascent at 60 ft/min approximated as half time at full depth
    expose((Pamb - PH2O) * fn2, d.time + d.depth / 60);
  }
  return p;
}
// Minutes at sea level until every compartment tolerates ambient pressure at altitude `ft` within gradient factor gf (%).
function waitForAltitude(p0, ft, gf) {
  const Psurf = 1.01325, Palt = pAltBar(ft), pin = (Psurf - PH2O) * 0.79, g = gf / 100;
  const ok = p => p.every((pt, i) => { const [, a, b] = ZHL16C[i]; const M = Palt / b + a; return pt <= Palt + g * (M - Palt); });
  let p = p0.slice(), t = 0;
  while (!ok(p) && t < 48 * 60) { p = p.map((pt, i) => pt + (pin - pt) * (1 - Math.pow(2, -10 / ZHL16C[i][0]))); t += 10; }
  return t;
}
function agencyFloor(dives, ft) {
  // DAN/PADI flying-after-diving (cabin 8,000 ft) and US Navy altitude guidance, applied here for driving above 2,000 ft.
  if (ft < 1000) return {min: 0, rule: "Below 1,000 ft: no published altitude wait."};
  if (ft < 2000) return {min: 60, rule: "Under 2,000 ft: DAN and the US Navy treat this as a minor change; a short surface interval is still a good idea."};
  const deco = dives.some(d => d.deco), multi = dives.length > 1;
  if (ft > 8000) return {min: 24 * 60, rule: "Above 8,000 ft (higher than an airliner cabin): wait 24 h after any dive. Mauna Kea is not a same-day activity."};
  if (deco) return {min: 24 * 60, rule: "Dives requiring decompression stops: DAN recommends substantially longer than 18 h; 24 h is the common conservative figure."};
  if (multi) return {min: 18 * 60, rule: "Multiple dives per day or multiple days of diving: DAN/PADI minimum 18 h before flying or climbing above 2,000 ft."};
  return {min: 12 * 60, rule: "Single no-stop dive: DAN/PADI minimum 12 h before flying or climbing above 2,000 ft."};
}
function hm(min) { if (min <= 0) return "none"; const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`; }
function defaultDives() { return [{depth: 60, time: 40, fo2: .21, si: 0}, {depth: 45, time: 40, fo2: .21, si: 60}]; }
function altitudeHTML(s) {
  const side = s.side || "west";
  const dests = (ALT.dest || []);
  const dest = dests.find(d => d.id === state.dest) || dests[0];
  const dives = state.dives || (state.dives = defaultDives());
  const routes = (dest.routes[side] || []).map(r => {
    const p = tissueLoad(dives), model = waitForAltitude(p, r.max, state.gf), floor = agencyFloor(dives, r.max), wait = Math.max(model, floor.min);
    const risk = r.max >= 8000 ? "stop" : r.max >= 2000 ? "warn" : "go";
    return {...r, wait, model, floor, risk};
  }).sort((a, b) => a.max - b.max);
  const diveRows = dives.map((d, i) => `<tr><td class="mono">${i + 1}</td><td><input type="number" class="num" data-dive="${i}" data-f="depth" value="${d.depth}" min="10" max="200" aria-label="Dive ${i + 1} depth ft"></td><td><input type="number" class="num" data-dive="${i}" data-f="time" value="${d.time}" min="5" max="180" aria-label="Dive ${i + 1} bottom time"></td><td><select class="num" data-dive="${i}" data-f="fo2" aria-label="Dive ${i + 1} gas">${[[.21, "Air"], [.32, "EAN32"], [.36, "EAN36"], [.40, "EAN40"]].map(([v, n]) => `<option value="${v}" ${Math.abs(d.fo2 - v) < .005 ? "selected" : ""}>${n}</option>`).join("")}</select></td><td>${i ? `<input type="number" class="num" data-dive="${i}" data-f="si" value="${d.si}" min="0" max="600" aria-label="Surface interval before dive ${i + 1}">` : "—"}</td><td><label class="note"><input type="checkbox" data-dive="${i}" data-f="deco" ${d.deco ? "checked" : ""}> deco</label></td><td>${dives.length > 1 ? `<button class="copy" type="button" data-rmdive="${i}">×</button>` : ""}</td></tr>`).join("");
  return `<section class="panel alt"><h3>Getting home: altitude after diving</h3>
    <p style="margin:0 0 10px">Driving uphill after a dive is the same problem as flying: lower pressure lets dissolved nitrogen come out faster than your tissues can clear it. The Big Island climbs fast. Pick where you're staying and this works out the highest point on each road from <b>${esc(s.name)}</b> and how long to wait at sea level first.</p>
    <div class="controls" style="margin:0 0 10px"><label for="dest" class="lbl" style="margin:0">Where are you staying or heading?</label>
      <select id="dest" class="num" style="min-width:min(100%,360px)">${dests.map(d => `<option value="${d.id}" ${d.id === dest.id ? "selected" : ""}>${esc(d.name)} · ${d.elev.toLocaleString()} ft</option>`).join("")}</select></div>
    <div class="lbl">Today's dives</div>
    <div class="chartbox"><table class="buoys dives"><thead><tr><th>#</th><th>Depth ft</th><th>Time min</th><th>Gas</th><th>SI before (min)</th><th></th><th></th></tr></thead><tbody>${diveRows}</tbody></table></div>
    <div class="controls" style="margin:6px 0 10px"><button class="chip" type="button" id="adddive">+ Add a dive</button>
      <label class="note">Gradient factor <input type="range" id="gf" min="50" max="85" step="5" value="${state.gf}" style="vertical-align:middle"> <b class="mono">GF ${state.gf}</b> <span class="note">(lower = more conservative)</span></label></div>
    <div class="lbl">Routes to ${esc(dest.name)}</div>
    <table class="buoys routes"><thead><tr><th>Route</th><th>High point</th><th>Wait at sea level</th><th>Why</th></tr></thead><tbody>
      ${routes.map(r => `<tr><td><b>${esc(r.name)}</b>${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</td><td class="mono">${r.max.toLocaleString()} ft</td><td><span class="pill ${r.risk}">${hm(r.wait)}</span></td><td class="note">${esc(r.floor.rule)}${r.model > r.floor.min ? ` The tissue model at GF ${state.gf} needs longer than that for ${r.max.toLocaleString()} ft, so the wait shown is the model's.` : ""}</td></tr>`).join("")}
    </tbody></table>
    ${routes.length > 1 ? `<div class="note" style="margin-top:8px"><b>Suggested:</b> take <b>${esc(routes[0].name)}</b> (high point ${routes[0].max.toLocaleString()} ft). It needs the shortest wait. If you can't wait that long, stay low: a coastal dinner, a nap by the water, then drive.</div>` : ""}
    <div class="note" style="margin-top:8px">How the wait is set: the longer of (a) the published agency minimum for that altitude (DAN and PADI flying-after-diving guidance, applied here to any road above 2,000 ft, and the U.S. Navy Diving Manual altitude tables) and (b) a Bühlmann ZH-L16C tissue model with gradient factors, run until every compartment tolerates the barometric pressure at the road's high point. The agency figure is always the floor; the model can only make the wait longer.</div>
    <div class="verdict warn" style="margin-top:8px"><b>Not medical advice.</b> This panel is a planning tool offered by Dive Moore LLC to help divers plan more safely. It is not medical advice, not a decompression table, and not a substitute for your training, your dive computer or a physician. No model predicts decompression sickness for one person on one day: hydration, exertion, cold, age, fitness and a PFO all change the risk. When in doubt wait longer, and never go up if you have any symptoms. Diving emergency: call 911, then DAN +1-919-684-9111 (24 h).</div>
    <div class="note">${esc(ALT.note || "")} Sources: ${(ALT.sources || []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join(" · ")}</div>
  </section>`;
}

/* ===== Community: live diver reports and site corrections (shared database) ===== */
async function commBoot() {
  try {
    if (!window.claude?.use) { COMM.ready = true; return; }
    const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
    COMM.db = db; COMM.user = user; COMM.ready = true;
    if (user) { COMM.me = await user.id(); const w = await user.can("data.write"); COMM.canWrite = w !== false; }
    if (!db) { render(); return; }
    const since = Date.now() - 7 * 864e5;
    db.collection("reports").orderBy("t", "desc").limit(300).onSnapshot(snap => { COMM.reports = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(r => r.t > since); resolveNames(); render(); }, () => {});
    db.collection("notes").orderBy("t", "desc").limit(500).onSnapshot(snap => { COMM.notes = snap.docs.map(d => ({id: d.id, ...d.data()})); resolveNames(); render(); }, () => {});
  } catch (e) { COMM.ready = true; }
}
async function resolveNames() {
  if (!COMM.user) return;
  const ids = [...new Set([...COMM.reports, ...COMM.notes].map(x => x.by).filter(Boolean))].filter(id => !(id in COMM.names));
  if (!ids.length) return;
  try { const ps = await COMM.user.profiles(ids); ids.forEach(id => COMM.names[id] = ps[id]?.name || ""); render(); } catch (e) { ids.forEach(id => COMM.names[id] = ""); }
}
function who(x) { return esc(x.name || COMM.names[x.by] || "A local diver"); }
function ago(t) { const m = Math.round((Date.now() - t) / 6e4); if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 36) return `${h} h ago`; return `${Math.round(h / 24)} d ago`; }
function latestReport(id) { const r = COMM.reports.filter(r => r.site === id && Date.now() - r.t < 24 * 36e5); return r[0]; }
const RCLS = {Good: "go", Caution: "warn", "No-go": "stop"};
function reportsHTML(s) {
  if (!COMM.db) return `<section class="panel comm"><h3>Diver reports</h3><p class="note" style="margin:0">Live diver reports and site corrections are coming to this version of the app. Until then, use the Dive Moore web version to post them.</p></section>`;
  const rs = COMM.reports.filter(r => r.site === s.id);
  const can = COMM.db && COMM.canWrite;
  const form = can ? `<form id="rform" class="cform" data-site="${esc(s.id)}">
      <div class="lbl">Report what you saw today</div>
      <div class="controls" style="margin:6px 0" role="group" aria-label="Conditions">${["Good", "Caution", "No-go"].map((k, i) => `<label class="chip rad"><input type="radio" name="rating" value="${k}" ${i === 0 ? "checked" : ""}> ${k}</label>`).join("")}</div>
      <div class="controls" style="margin:6px 0"><label class="note">Vis <input class="num" name="vis" type="number" min="5" max="200" placeholder="ft" aria-label="Visibility ft"> ft</label>
        <label class="note">Surf <input class="num" name="surf" type="number" min="0" max="30" step="0.5" placeholder="ft" aria-label="Surf ft"> ft</label>
        <label class="note">Water <input class="num" name="temp" type="number" min="60" max="90" placeholder="°F" aria-label="Water temp F"> °F</label>
        <label class="note"><input type="checkbox" name="dove" checked> I dove it</label></div>
      <input class="search" name="note" maxlength="280" placeholder="Entry, surge, current, what you saw… (optional)" aria-label="Notes">
      <div class="controls" style="margin:6px 0 0"><input class="search" name="name" maxlength="40" placeholder="Your name (optional)" style="max-width:220px" aria-label="Your name"><button class="chip" type="submit">Post report</button><span class="note" id="rmsg"></span></div>
    </form>` : `<div class="note">${COMM.db ? "You can read reports. Ask John for posting access to add your own." : COMM.ready ? "Sign in to claude.ai (or ask John for access) to see and post live reports." : "Connecting to live reports…"}</div>`;
  return `<section class="panel comm"><h3>Live diver reports · last 7 days</h3>
    <p class="note" style="margin:0 0 8px">What local divers actually saw in the water. These are personal observations by whoever posted them, not Dive Moore's assessment; conditions change by the hour.</p>
    ${rs.length ? `<ul class="clean reports">${rs.map(r => `<li><span class="pill ${RCLS[r.rating] || "na"}">${esc(r.rating || "")}</span> <b>${ago(r.t)}</b> · ${who(r)}${r.dove === false ? " (looked, didn't dive)" : ""}${r.vis ? ` · vis ${esc(r.vis)} ft` : ""}${r.surf != null && r.surf !== "" ? ` · surf ${esc(r.surf)} ft` : ""}${r.temp ? ` · ${esc(r.temp)}°F` : ""}${r.note ? `<div>${esc(r.note)}</div>` : ""}${COMM.me && (r.by === COMM.me || COMM.canWrite) ? `<button class="copy" type="button" data-del="reports/${esc(r.id)}">Delete</button>` : ""}</li>`).join("")}</ul>` : `<p class="note">No reports yet for this site.</p>`}
    ${form}
  </section>`;
}
function notesHTML(s) {
  if (!COMM.db) return "";
  const ns = COMM.notes.filter(n => n.site === s.id);
  const can = COMM.db && COMM.canWrite;
  return `<section class="panel comm"><h3>Local knowledge: corrections and tips</h3>
    <p class="note" style="margin:0 0 8px">The site write-ups were drafted from published descriptions, not from a survey. If something is wrong or missing (entry spot, GPS, parking, depth, hazards), say so here and John will fold it into the site page.</p>
    ${ns.length ? `<ul class="clean reports">${ns.map(n => `<li><b>${esc(n.field || "General")}</b> · ${who(n)} · ${ago(n.t)}<div>${esc(n.text)}</div>${COMM.me && (n.by === COMM.me || COMM.canWrite) ? `<button class="copy" type="button" data-del="notes/${esc(n.id)}">Delete</button>` : ""}</li>`).join("")}</ul>` : `<p class="note">No notes yet.</p>`}
    ${can ? `<form id="nform" class="cform" data-site="${esc(s.id)}">
      <div class="controls" style="margin:6px 0"><select class="num" name="field" aria-label="What is this about">${["General", "Entry / exit", "GPS / location", "Parking / access", "Depth / route", "Hazards", "Marine life", "Fees / rules"].map(f => `<option>${f}</option>`).join("")}</select>
        <input class="search" name="name" maxlength="40" placeholder="Your name (optional)" style="max-width:220px" aria-label="Your name"></div>
      <textarea class="search" name="text" rows="3" maxlength="800" placeholder="What should change, and what's right from your experience?" aria-label="Correction or tip" required></textarea>
      <div class="controls" style="margin:6px 0 0"><button class="chip" type="submit">Post note</button><span class="note" id="nmsg"></span></div>
    </form>` : `<div class="note">${COMM.db ? "Ask John for posting access to add a note." : ""}</div>`}
  </section>`;
}
async function commSubmit(form) {
  const fd = new FormData(form), site = form.dataset.site, isR = form.id === "rform", msg = $(isR ? "#rmsg" : "#nmsg");
  const num = k => { const v = fd.get(k); return v === "" || v == null ? null : +v; };
  const doc = isR ? {site, t: Date.now(), by: COMM.me, name: (fd.get("name") || "").trim().slice(0, 40), rating: fd.get("rating"), vis: num("vis"), surf: num("surf"), temp: num("temp"), dove: fd.get("dove") === "on", note: (fd.get("note") || "").trim().slice(0, 280)}
                 : {site, t: Date.now(), by: COMM.me, name: (fd.get("name") || "").trim().slice(0, 40), field: fd.get("field"), text: (fd.get("text") || "").trim().slice(0, 800)};
  if (!isR && !doc.text) return;
  if (doc.name) store("dm-name", doc.name);
  msg.textContent = "Posting…";
  try { await COMM.db.collection(isR ? "reports" : "notes").add(doc); msg.textContent = "Posted. Mahalo!"; form.reset(); }
  catch (e) { msg.textContent = e?.code === "not_granted" ? "You don't have posting access yet." : "Couldn't post right now."; }
}

function renderList() {
  const ORDER = ["North Kona", "Keauhou", "South Kona", "Kohala", "Hilo", "Puna"];
  const regions = ["All", ...[...new Set(SITES.map(s => s.region))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))];
  const q = state.q.trim().toLowerCase();
  state.kind = state.kind || "All";
  const shown = SITES.filter(s => (state.filter === "All" || s.region === state.filter) && (state.kind === "All" || (state.kind === "Shore" ? s.type === "shore" : s.type === "boat")) && (!q || [s.name, ...(s.aka || [])].join(" ").toLowerCase().includes(q)) && (!state.easy || s.type === "boat" || entryRating(s, assess(s)).n <= 2) && (!state.pub || !!s.county))
    .sort((a, b) => state.me ? distTo(a) - distTo(b) : (a.type === b.type ? 0 : a.type === "shore" ? -1 : 1) || regions.indexOf(a.region) - regions.indexOf(b.region));
  let html = bannerHTML();
  html += `<div class="controls" role="group" aria-label="Region">${regions.map(r => `<button class="chip" type="button" data-region="${esc(r)}" aria-pressed="${r === state.filter}">${esc(r)}</button>`).join("")}</div>
    <div class="controls" style="margin-top:0">${["All", "Shore", "Boat"].map(k => `<button class="chip" type="button" data-kind="${k}" aria-pressed="${k === state.kind}">${k === "Boat" ? "Boat · moorings" : k === "All" ? "Shore + boat" : "Shore"}</button>`).join("")}
    <button class="chip" type="button" id="easy" aria-pressed="${state.easy}">Easy entry today</button>
    <button class="chip" type="button" id="pubacc" aria-pressed="${state.pub}">County public access</button>
    <button class="chip" type="button" id="near" aria-pressed="${!!state.me}">${state.me ? "Sorted by distance ✓" : "Near me"}</button>
    <input class="search" id="q" type="search" placeholder="Search any site or buoy name" value="${esc(state.q)}" aria-label="Search dive sites"></div>
    ${state.geoErr ? `<div class="note" style="margin:0 0 6px">${esc(state.geoErr)}</div>` : ""}
    <div class="note" style="margin:0 0 6px">${shown.length} sites · ${SITES.filter(s => s.mooring).reduce((n, s) => n + s.buoys.length, 0)} state day-use moorings</div>`;
  html += `<div class="list">`;
  let last = "";
  shown.forEach(s => {
    const hdr = state.me ? "" : state.kind === "All" ? (s.type === "boat" ? "Boat dives · state moorings" : "Shore dives") + (state.filter === "All" ? " · " + s.region : "") : state.filter === "All" ? s.region : "";
    if (hdr && hdr !== last) { html += `<div class="region-h">${esc(hdr)}</div>`; last = hdr; }
    const a = assess(s), c = state.cond[s.id] || {}, er = entryRating(s, a), dm = distTo(s);
    html += `<button class="row" type="button" data-site="${esc(s.id)}">
      <div style="min-width:0"><div class="nm">${esc(s.name)}${s.verify ? ` <span class="tag new" title="Added from the county access list; entry details not yet confirmed on site">New</span>` : ""}${s.county ? ` <span class="tag pa" title="On the County of Hawaiʻi shoreline public access list">Public access</span>` : ""}</div>${s.aka?.length ? `<div class="aka">${esc(s.aka.join(" · "))}</div>` : ""}</div>
      <span class="pill ${a.cls}">${a.label}</span>
      <div class="meta"><span>Surf <b class="mono">${fmt(a.surf, 1)} ft</b></span><span>Wind <b class="mono">${fmt(c.wind)} kt ${compass(c.windDir)}</b></span><span>Vis <b class="mono">~${a.vis ?? "–"} ft</b></span><span>${s.mooring ? `Boat · ${s.buoys.length > 1 ? s.buoys.length + " moorings" : "mooring #" + s.buoys[0].n}` : esc(s.type === "boat" ? "Boat dive" : "Shore dive") + " · " + esc(s.depth)}</span>${s.type === "shore" ? `<span>Entry <b class="${er.cls === "stop" ? "bad" : ""}">${er.label}</b></span>` : ""}${dm != null ? `<span>${dm < 10 ? dm.toFixed(1) : Math.round(dm)} mi away</span>` : ""}${(() => { const r = latestReport(s.id); return r ? `<span class="rep ${RCLS[r.rating] || "na"}">Diver report ${ago(r.t)}: <b>${esc(r.rating)}</b></span>` : ""; })()}</div>
    </button>`;
  });
  if (!shown.length) html += `<p>No site matches “${esc(state.q)}”. Try a Hawaiian or local name.</p>`;
  html += `</div>`;
  $("#app").innerHTML = html;
  const qi = $("#q"); if (document.activeElement?.id !== "q" && state.q) {}
}

function spark(series, idx0, len, unit, color, w = 300, h = 70, labelsFrom) {
  const arr = series.slice(idx0, idx0 + len).map(v => v ?? null);
  const vals = arr.filter(v => v != null); if (!vals.length) return "";
  const max = Math.max(...vals) * 1.15 || 1;
  const x = k => 28 + k * (w - 36) / (arr.length - 1), y = v => h - 16 - (v / max) * (h - 26);
  let d = "", area = ""; arr.forEach((v, k) => { if (v == null) return; d += (d ? "L" : "M") + x(k).toFixed(1) + " " + y(v).toFixed(1); });
  area = d + `L${x(arr.length - 1)} ${h - 16}L${x(0)} ${h - 16}Z`;
  let ticks = "";
  if (labelsFrom) labelsFrom.slice(idx0, idx0 + len).forEach((t, k) => { if (t.endsWith("T00:00")) { ticks += `<line x1="${x(k)}" x2="${x(k)}" y1="6" y2="${h - 16}" stroke="var(--line)"/><text x="${x(k) + 3}" y="${h - 4}">${hstDay(new Date(t + ":00-10:00"))}</text>`; } });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${unit} next ${len} hours">
    <line x1="28" x2="${w - 8}" y1="${h - 16}" y2="${h - 16}" stroke="var(--line)"/>${ticks}
    <text x="0" y="${y(max / 1.15) + 3}">${fmt(max / 1.15, unit === "ft" ? 1 : 0)}</text><text x="0" y="${h - 13}">0</text>
    <path d="${area}" fill="${color}" opacity=".14"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>
    <circle cx="${x(0)}" cy="${y(arr[0] ?? 0)}" r="3.5" fill="${color}"/></svg>`;
}

function tideChart(key) {
  const T = state.tides[key]; if (!T || T.length < 3) return "";
  const now = Date.now(), t0 = now - 3 * 36e5, t1 = now + 27 * 36e5, w = 300, h = 90;
  const lo = Math.min(...T.map(p => p.v)) - .2, hi = Math.max(...T.map(p => p.v)) + .2;
  const X = t => 8 + (t - t0) / (t1 - t0) * (w - 16), Y = v => h - 18 - (v - lo) / (hi - lo) * (h - 34);
  let d = ""; for (let t = t0; t <= t1; t += 15 * 6e4) { const i = T.findIndex(p => +p.t > t); if (i <= 0) continue; const a = T[i - 1], b = T[i], f = (t - a.t) / (b.t - a.t); const v = a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2; d += (d ? "L" : "M") + X(t).toFixed(1) + " " + Y(v).toFixed(1); }
  let marks = T.filter(p => +p.t > t0 && +p.t < t1).map(p => `<circle cx="${X(+p.t)}" cy="${Y(p.v)}" r="2.5" fill="var(--chart)"/><text x="${X(+p.t)}" y="${p.type === "H" ? Y(p.v) - 6 : Y(p.v) + 13}" text-anchor="middle">${p.type} ${p.v.toFixed(1)}′ ${hstTime(p.t).replace(":00", "").replace(" ", "")}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Tide curve next 24 hours">
    <path d="${d}L${X(t1)} ${h - 18}L${X(t0)} ${h - 18}Z" fill="var(--chart)" opacity=".12"/><path d="${d}" fill="none" stroke="var(--chart)" stroke-width="2"/>
    <line x1="${X(now)}" x2="${X(now)}" y1="4" y2="${h - 18}" stroke="var(--flag)" stroke-dasharray="3 3"/><text x="${X(now) + 4}" y="${h - 5}" style="fill:var(--flag)">now</text>${marks}</svg>`;
}

/* Schematic site map: shore band, depth bands going seaward, entry/exit and landmarks */
function siteMap(s) {
  const m = s.map || {}; const W = 340, H = 230; const zones = m.zones || [];
  const shoreH = 46, band = (H - shoreH - 10) / Math.max(1, zones.length);
  const blues = ["#BFE6F1", "#8FD0E6", "#5CB3D2", "#2E8FB5", "#146C93", "#0B4F6C"];
  let g = `<rect x="0" y="0" width="${W}" height="${H}" fill="#0B4F6C"/>`;
  zones.forEach((z, k) => {
    const y0 = shoreH + k * band; const wig = 6 * Math.sin(k + 1);
    g += `<path d="M0 ${y0 + wig} C ${W * .3} ${y0 - 8}, ${W * .6} ${y0 + 12}, ${W} ${y0 - wig} L ${W} ${H} L 0 ${H} Z" fill="${blues[Math.min(k, 5)]}"/>`;
  });
  zones.forEach((z, k) => {
    const y0 = shoreH + k * band;
    g += `<text x="8" y="${y0 + band / 2 + 4}" style="fill:${k < 2 ? "#0B4F6C" : "#FFFFFF"};font-size:10.5px;font-family:var(--f-body)">${esc(z[0])}</text><text x="${W - 8}" y="${y0 + band / 2 + 4}" text-anchor="end" style="fill:${k < 2 ? "#0B4F6C" : "#FFFFFF"};font-size:10px">${esc(z[1])}</text>`;
  });
  g += `<path d="M0 0 H${W} V${shoreH - 6} C ${W * .7} ${shoreH + 6}, ${W * .35} ${shoreH - 14}, 0 ${shoreH} Z" fill="#3B3430"/>`;
  g += `<text x="8" y="16" style="fill:#F4EDE4;font-size:10px">${esc(m.shore || "Shore")}</text>`;
  (m.pois || []).forEach(p => { const x = p[1] * W, y = shoreH + p[2] * (H - shoreH); g += `<circle cx="${x}" cy="${y}" r="4" fill="#FFD166" stroke="#0B4F6C"/><text x="${x + 7}" y="${y + 3}" style="fill:${p[2] < 0.3 ? "#0B4F6C" : "#FFFFFF"};font-size:10px;font-family:var(--f-body)">${esc(p[0])}</text>`; });
  const pin = (x, label, col) => `<g><circle cx="${x * W}" cy="${shoreH - 2}" r="9" fill="${col}" stroke="#fff" stroke-width="2"/><text x="${x * W}" y="${shoreH + 2}" text-anchor="middle" style="fill:#fff;font-size:10px;font-weight:700">${label}</text></g>`;
  if (m.entry != null) g += pin(m.entry, "IN", "#1E8A4C");
  if (m.exit != null && m.exit !== m.entry) g += pin(m.exit, "OUT", "#D7261E");
  if (m.exit === m.entry && m.entry != null) g = g.replace(">IN<", ">IN/OUT<").replace('r="9"', 'r="14"');
  // compass
  const ang = ((m.up ?? (s.faces + 180)) + 360) % 360; // bearing pointing up the page (toward shore)
  g += `<g transform="translate(${W - 22} 20) rotate(${-ang})"><path d="M0 -11 L4 4 L0 1 L-4 4 Z" fill="#F4EDE4"/></g><text x="${W - 22}" y="${8}" text-anchor="middle" style="fill:#F4EDE4;font-size:9px" transform="rotate(${-ang} ${W - 22} 20)">N</text>`;
  return `<svg class="mapsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schematic map of ${esc(s.name)}">${g}</svg>`;
}

function cellBars(level) {
  const n = {strong: 4, good: 4, fair: 3, spotty: 2, weak: 1, none: 0}[level] ?? 0;
  return `<span class="cell" aria-hidden="true">${[5, 8, 11, 14].map((hh, k) => `<i class="${k < n ? "on" : ""}" style="height:${hh}px"></i>`).join("")}</span>`;
}

function renderSite(s) {
  loadNws(s);
  const a = assess(s), c = state.cond[s.id] || {}, td = tideNow(s.tide), st = TIDE_STATIONS[s.tide] || {};
  const tempKey = s.tempStation || s.tide; const ctemp = state.temps[tempKey];
  const er = EMERGENCY.hospitals?.[s.er] || {};
  const curKt = c.cur != null ? c.cur * 1.944 : null; // m/s to knots
  const range = arr => { const f = (arr || []).filter(v => v != null); return f.length > 1 ? `${fmt(Math.min(...f) * M2FT, 1)}–${fmt(Math.max(...f) * M2FT, 1)} ft across ${f.length} models` : ""; };
  const wr = c.windRange?.filter(v => v != null) || [];
  let h = bannerHTML();
  if (s.closed) {
    $("#app").innerHTML = h + `<button class="back" type="button" data-home>← All sites</button><div class="dhead"><h2>${esc(s.name)}</h2><span class="pill na" style="margin-top:8px">Closed</span></div>${s.aka?.length ? `<div class="names">Also called ${s.aka.map(n => `<span>${esc(n)}</span>`).join("")}</div>` : ""}<div class="verdict na">${esc(s.closed)}</div>`;
    window.scrollTo({top: 0}); return;
  }
  h += `<button class="back" type="button" data-home>← All sites</button>
  <div class="dhead"><h2>${esc(s.name)}</h2><span class="pill ${a.cls}" style="margin-top:8px">${a.label}</span></div>
  ${s.aka?.length ? `<div class="names">Also called ${s.aka.map(n => `<span>${esc(n)}</span>`).join("")}</div>` : ""}
  <div class="names" style="margin-top:4px">${esc(s.region)} · ${s.type === "boat" ? "Boat dive" : "Shore dive"} · ${esc(s.depth)} · ${esc(s.level)}${(() => { const d = distTo(s); return d != null ? ` · ${d < 10 ? d.toFixed(1) : Math.round(d)} mi from you` : ""; })()}</div>
  ${s.type === "shore" ? (() => { const er = entryRating(s, a); return `<div class="names" style="margin-top:4px">Entry today: <span class="pill ${er.cls}">${er.label}</span> <span class="note">${esc(er.why)}</span></div>`; })() : ""}
  <div class="verdict ${a.cls}"><b>${a.label} right now:</b> ${esc(a.why)}.</div>
  ${s.verify ? `<div class="verdict warn" style="margin-top:6px"><b>New site, not yet confirmed on site.</b> Added from the County of Hawaiʻi shoreline access list and published dive reports. Entry, route and map are a first draft: scout it before you dive it.</div>` : ""}
  ${s.county ? `<div class="names" style="margin-top:6px">County shoreline public access · ${esc(s.county.district)}${s.county.map ? " · " + esc(s.county.map) : ""}${s.county.name ? " · " + esc(s.county.name) : ""} · <a href="${esc(s.county.url)}" target="_blank" rel="noopener">county guide</a></div>` : ""}
  ${(() => { const r = latestReport(s.id); return r ? `<div class="verdict ${RCLS[r.rating] || "na"}" style="margin-top:6px"><b>Diver report ${ago(r.t)}:</b> ${esc(r.rating)}${r.vis ? `, vis ${esc(r.vis)} ft` : ""}${r.note ? ` · “${esc(r.note)}”` : ""} <span class="note">(${who(r)})</span></div>` : ""; })()}

  <div class="grid">
    <div class="tile"><div class="lbl">Swell</div><div class="v">${fmt(c.swell * M2FT, 1)}<small> ft</small></div>
      <div class="s">${fmt(c.swellPer)} s from ${compass(c.swellDir)} <span class="arrow" style="transform:rotate(${(c.swellDir ?? 0) + 180}deg)">↑</span><br>At this site ≈ <b>${fmt(a.surf, 1)} ft</b></div>
      <div class="src">${esc(range(c.waveRange) || (c.waveModels || []).join(", "))}</div></div>
    <div class="tile"><div class="lbl">Wind</div><div class="v">${fmt(c.wind)}<small> kt</small></div>
      <div class="s">From ${compass(c.windDir)} <span class="arrow" style="transform:rotate(${(c.windDir ?? 0) + 180}deg)">↑</span> · gusts ${fmt(c.gust)} kt<br>${a.onshore ? "Onshore at this site" : "Offshore or cross-shore"}</div>
      <div class="src">${wr.length > 1 ? `${fmt(Math.min(...wr))}–${fmt(Math.max(...wr))} kt across ${wr.length} models` : ""}</div>
      ${(() => { const n = state.nws[s.id]?.hrs?.[0]; return n ? `<div class="s" style="margin-top:4px">NOAA NWS forecast: <b>${fmt(n.kt)} kt ${compass(n.dir)}</b> · ${esc(n.short)}</div>` : ""; })()}
      ${(() => { const o = state.obsWind[s.tide]; return o && Date.now() - o.t < 3 * 36e5 ? `<div class="s" style="margin-top:4px">Measured at ${esc(o.name.split(",")[0])} ${hstTime(o.t)}: <b>${fmt(o.kt)} kt ${compass(o.dir)}</b>, gusts ${fmt(o.gust)}</div><div class="src">NOAA harbor gauge, may differ from the site</div>` : ""; })()}</div>
    <div class="tile"><div class="lbl">Current (offshore)</div><div class="v">${fmt(curKt, 1)}<small> kt</small></div>
      <div class="s">Setting toward ${compass(c.curDir)} <span class="arrow" style="transform:rotate(${c.curDir ?? 0}deg)">↑</span><br>${esc(s.currentNote || "Local currents can differ near points.")}</div>
      <div class="src">Model current, ~5 mi grid</div></div>
    <div class="tile"><div class="lbl">Tide</div><div class="v">${td ? fmt(td.v, 1) : "–"}<small> ft</small></div>
      <div class="s">${td ? `${td.rising ? "Rising" : "Falling"} · ${td.next.type === "H" ? "high" : "low"} ${td.next.v.toFixed(1)} ft at ${hstTime(td.next.t)}` : "No tide data"}</div>
      <div class="src">NOAA ${esc(st.name || "")} ${esc(st.id || "")}</div></div>
    <div class="tile"><div class="lbl">Water temp</div><div class="v">${ctemp ? fmt(ctemp.f) : fmt(c.sst != null ? C2F(c.sst) : null)}<small> °F</small></div>
      <div class="s">${ctemp ? `Measured at ${esc(ctemp.name)} ${hstTime(ctemp.t)}` : "Sea-surface model"}${c.sst != null && ctemp ? ` · model ${fmt(C2F(c.sst))}°F` : ""}</div>
      <div class="src">${ctemp ? "NOAA sensor" : "Open-Meteo SST"}</div></div>
    <div class="tile est"><div class="lbl">Visibility</div><div class="v">${a.vis ?? "–"}<small> ft</small></div>
      <div class="s">Typical here ${s.visBase} ft · 48 h rain ${fmt((c.rain48 || 0) / 25.4, 2)} in</div>
      <div class="src">Estimated from swell, rain and site history</div></div>
  </div>

  ${planHTML(s)}
  ${(() => { const z = zoneFor(s), m = state.marine[z]; if (!m?.periods?.length) return ""; return `<section class="panel"><h3>NOAA marine forecast · ${esc(MARINE_ZONES[z])}</h3>${m.periods.map(p => `<p style="margin:0 0 6px"><b>${esc(p.name)}:</b> ${esc(p.text)}</p>`).join("")}<div class="note">National Weather Service Honolulu coastal waters forecast${m.updated ? `, issued ${esc(hstDay(new Date(m.updated)))} ${esc(hstTime(new Date(m.updated)))} HST` : ""}. Covers open water, not the beach.</div></section>`; })()}
  <div class="two" style="margin-top:14px">
    <section class="panel" style="margin:0"><h3>Surf next 3 days</h3><div class="chartbox">${c.waveSeries ? spark(c.waveSeries.map(v => v == null ? null : v * M2FT), c.n, 72, "ft", "var(--chart)", 300, 70, c.times) : ""}</div><div class="note">Offshore wave height, ft (model average).</div></section>
    <section class="panel" style="margin:0"><h3>Wind next 3 days</h3><div class="chartbox">${c.windSeries ? spark(c.windSeries, c.wn, 72, "kt", "var(--flag)", 300, 70, c.wTimes) : ""}</div><div class="note">Sustained wind, knots.</div></section>
  </div>
  <section class="panel"><h3>Tide · ${esc(st.name || "")}</h3><div class="chartbox">${tideChart(s.tide)}</div><div class="note">Times in HST. Heights in feet above mean lower low water.</div></section>

  <div class="two">
    <section class="panel"><h3>Dive plan</h3>
      <dl class="kv"><dt>Entry</dt><dd>${esc(s.entry)}</dd><dt>Exit</dt><dd>${esc(s.exit)}</dd><dt>Route</dt><dd>${esc(s.route)}</dd></dl>
      ${s.hazards?.length ? `<div class="lbl" style="margin-top:12px">Hazards</div><ul class="clean">${s.hazards.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <div class="note">Headings are magnetic-ish guides from shore, not surveyed bearings. Confirm on site and in your dive briefing.</div>
    </section>
    <section class="panel"><h3>Underwater map</h3>${siteMap(s)}<div class="note">${esc(s.map?.note || "")} Schematic sketch, not to scale.</div></section>
  </div>
  ${s.mooring ? `<section class="panel"><h3>Day-use moorings</h3><div class="chartbox"><table class="buoys"><thead><tr><th>#</th><th>Buoy name</th><th>GPS</th><th></th></tr></thead><tbody>${s.buoys.map(b => `<tr><td class="mono">${b.n}</td><td>${esc(b.name)}</td><td class="mono">${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}</td><td><button class="copy" type="button" data-copy="${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}">Copy</button></td></tr>`).join("")}</tbody></table></div><div class="note">From the DLNR Division of Boating and Ocean Recreation day-use mooring list. Verify with your chartplotter; buoys can go missing after storms.</div></section>` : ""}
  <div class="two">
    <section class="panel"><h3>Getting there</h3>
      <dl class="kv"><dt>Driving</dt><dd>${esc(s.drive)}</dd><dt>Parking</dt><dd>${esc(s.parking)}</dd>
      <dt>Navigate</dt><dd><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">Google Maps</a> · <a href="https://maps.apple.com/?daddr=${s.lat},${s.lon}" target="_blank" rel="noopener">Apple Maps</a></dd></dl>
    </section>
    <section class="panel"><h3>Fees and rules</h3>
      <p style="margin:0 0 8px">${esc(s.fees || "No fee known.")}</p>
      ${s.restrictions?.length ? `<ul class="clean">${s.restrictions.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <div class="note">Rules change. Check posted signs and the managing agency before you go.</div>
    </section>
  </div>

  ${reportsHTML(s)}
  ${altitudeHTML(s)}

  <section class="panel"><h3>About the site</h3><p style="margin:0 0 10px">${esc(s.desc)}</p>
    ${s.highlights?.length ? `<div class="lbl">What you'll see</div><p style="margin:4px 0 0">${esc(s.highlights.join(" · "))}</p>` : ""}</section>

  <div class="two">
    <section class="panel"><h3>Amenities</h3><ul class="clean">${(s.amenities || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      ${s.fees ? `<div class="note">${esc(s.fees)}</div>` : ""}</section>
    <section class="panel"><h3>Location and signal</h3>
      <dl class="kv">
        <dt>GPS</dt><dd><span class="mono" id="gps">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</span><button class="copy" type="button" data-copy="${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}">Copy</button></dd>
        <dt>Cell service</dt><dd>${cellBars(s.cell?.level)}${esc(s.cell?.level || "unknown")}${s.cell?.note ? ` · ${esc(s.cell.note)}` : ""}</dd>
      </dl>
      ${s.gpsNote ? `<div class="note">${esc(s.gpsNote)}</div>` : ""}</section>
  </div>

  ${notesHTML(s)}
  <section class="panel emerg"><h3>Emergency</h3>
    <div class="callout">
      <div><div class="t">Life-threatening emergency</div><div class="big mono">911</div><div>Ask for Fire/Rescue and say it's a diving emergency. Give the site name and the GPS above.${s.cell?.level === "none" || s.cell?.level === "spotty" || s.cell?.level === "weak" ? ` <b>Signal is weak here:</b> ${esc(s.cell?.where || "move toward the road or parking lot to call.")}` : ""}</div></div>
      <div><div class="t">Nearest emergency room · ${esc(er.name || "")}</div><div>${esc(er.address || "")}</div><div class="mono">${esc(er.phone || "")}${er.phone ? `<button class="copy" type="button" data-copy="${esc(er.phone)}">Copy</button>` : ""}</div><div class="note">${esc((s.erDrive ? s.erDrive + " drive · " : "") + (er.note || ""))}</div></div>
      ${(EMERGENCY.contacts || []).map(k => `<div><div class="t">${esc(k.name)}</div><div class="mono">${esc(k.phone)}${k.phone ? `<button class="copy" type="button" data-copy="${esc(k.phone)}">Copy</button>` : ""}</div><div class="note">${esc(k.note || "")}</div></div>`).join("")}
    </div>
  </section>`;
  $("#app").innerHTML = h;
  const nm = store("dm-name"); if (nm) $$("input[name=name]").forEach(i => i.value = nm);
  window.scrollTo({top: 0});
}

/* ===== Events ===== */
document.addEventListener("click", e => {
  const site = e.target.closest("[data-site]"); if (site) { location.hash = site.dataset.site; return; }
  if (e.target.closest("[data-home]")) { history.length > 1 && location.hash ? (location.hash = "") : (location.hash = ""); return; }
  const kd = e.target.closest("[data-kind]"); if (kd) { state.kind = kd.dataset.kind; renderList(); return; }
  if (e.target.id === "easy") { state.easy = !state.easy; renderList(); return; }
  if (e.target.id === "near") { if (state.me) { state.me = null; renderList(); } else locate(); return; }
  if (e.target.id === "adddive") { state.dives.push({depth: 50, time: 40, fo2: .21, si: 60}); render(); return; }
  const rd = e.target.closest("[data-rmdive]"); if (rd) { state.dives.splice(+rd.dataset.rmdive, 1); render(); return; }
  const r = e.target.closest("[data-region]"); if (r) { state.filter = r.dataset.region; store("dm-region", state.filter); renderList(); return; }
  const cp = e.target.closest("[data-copy]"); if (cp) {
    const txt = cp.dataset.copy;
    navigator.clipboard?.writeText(txt).then(() => { cp.textContent = "Copied"; setTimeout(() => cp.textContent = "Copy", 1500); }).catch(() => { const sel = getSelection(), rg = document.createRange(); rg.selectNodeContents(cp.previousElementSibling || cp); sel.removeAllRanges(); sel.addRange(rg); });
  }
  if (e.target.id === "refresh") loadAll();
  if (e.target.id === "pubacc") { state.pub = !state.pub; store("dm-pub", state.pub ? "1" : ""); renderList(); }
});
document.addEventListener("submit", e => { const f = e.target.closest("#rform,#nform"); if (f) { e.preventDefault(); commSubmit(f); } });
document.addEventListener("click", async e => { const d = e.target.closest("[data-del]"); if (d && COMM.db && confirm("Delete this post?")) { try { await COMM.db.doc(d.dataset.del).delete(); } catch (err) {} } });
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "dest") { state.dest = el.value; store("dm-dest", el.value); render(); return; }
  if (el.id === "gf") { state.gf = +el.value; store("dm-gf", el.value); render(); return; }
  if (el.dataset.dive != null) { const d = state.dives[+el.dataset.dive]; if (el.dataset.f === "deco") d.deco = el.checked; else d[el.dataset.f] = +el.value; render(); }
});
document.addEventListener("input", e => { if (e.target.id === "q") { state.q = e.target.value; const pos = e.target.selectionStart; renderList(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); } });
addEventListener("hashchange", render);
render();
commBoot();
loadAll();
setInterval(loadAll, 30 * 60e3);
