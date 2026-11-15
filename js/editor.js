/* Site editor for Dive Moore Conditions.
   Loads data/sites.js, lets you edit sites in a form with a map pin,
   and saves the file back to GitHub through the GitHub contents API. */
"use strict";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
const ORDER = ["SITES", "EMERGENCY", "TIDE_STATIONS", "ALT"];
const BOUNDS = {lat: [18.8, 20.4], lon: [-156.2, -154.7]}; // Big Island and nearby water

const ed = {data: null, orig: {}, deleted: [], sha: null, sel: null, map: null, pin: null, others: null, readOnly: true};
const conn = () => ({repo: store("dm-ed-repo") || "moorejohnedward/Dive-Moore-Site-Guide", branch: store("dm-ed-branch") || "main", token: store("dm-ed-token") || ""});

/* ---------- sites.js <-> data ---------- */
function parseSitesJs(text) {
  const out = {};
  for (const m of text.matchAll(/^const (\w+) = ([\s\S]*?);$/gm)) out[m[1]] = JSON.parse(m[2]);
  if (!Array.isArray(out.SITES)) throw new Error("Couldn't find the SITES list in data/sites.js");
  return out;
}
function writeSitesJs(d) {
  let s = "/* Dive site data for Dive Moore Conditions. Edit with editor.html or by hand; the app reads these constants. */\n";
  s += "const SITES = [\n" + d.SITES.map(x => JSON.stringify(x)).join(",\n") + "\n];\n";
  for (const k of ORDER.slice(1)) if (d[k] !== undefined) s += `const ${k} = ${JSON.stringify(d[k])};\n`;
  return s;
}
const b64encode = str => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

/* ---------- GitHub ---------- */
async function gh(path, opts = {}) {
  const c = conn();
  const r = await fetch(`https://api.github.com/repos/${c.repo}/${path}`, {...opts, headers: {"Accept": "application/vnd.github+json", "Authorization": `Bearer ${c.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {})}});
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.message || `GitHub answered ${r.status}`); e.status = r.status; throw e; }
  return body;
}

async function load() {
  const c = conn();
  let text;
  try {
    if (c.token) {
      const f = await gh(`contents/data/sites.js?ref=${encodeURIComponent(c.branch)}`);
      text = b64decode(f.content); ed.sha = f.sha; ed.readOnly = false;
      status(`Connected to ${c.repo} · ${c.branch}`);
    } else {
      text = await (await fetch("data/sites.js?fresh=" + Date.now(), {cache: "no-store"})).text();
      ed.readOnly = true; status("Read-only: connect GitHub to save");
    }
  } catch (e) {
    toast(`Couldn't load from GitHub: ${e.message}. Opened the copy on this site read-only instead.`, true);
    text = await (await fetch("data/sites.js?fresh=" + Date.now(), {cache: "no-store"})).text();
    ed.readOnly = true; status("Read-only: GitHub connection failed");
  }
  ed.data = parseSitesJs(text);
  ed.orig = Object.fromEntries(ed.data.SITES.map(s => [s.id, JSON.stringify(s)]));
  ed.deleted = [];
  renderList(); if (ed.sel) select(ed.sel); updateSave();
}

async function save() {
  if (ed.readOnly) return openSettings();
  const errs = validateAll(); if (errs.length) return toast("Fix these first: " + errs.join(" · "), true);
  const changed = changedIds(), c = conn();
  const names = [...changed.map(id => site(id)?.name || id), ...ed.deleted.map(id => `removed ${id}`)];
  const msg = names.length ? `Update dive sites: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}` : "Update dive sites";
  $("#saveBtn").disabled = true; status("Saving…");
  try {
    const r = await gh("contents/data/sites.js", {method: "PUT", body: JSON.stringify({message: msg + "\n\nSaved from the Dive Moore site editor.", content: b64encode(writeSitesJs(ed.data)), sha: ed.sha, branch: c.branch})});
    ed.sha = r.content.sha;
    ed.orig = Object.fromEntries(ed.data.SITES.map(s => [s.id, JSON.stringify(s)])); ed.deleted = [];
    renderList(); updateSave();
    status(`Saved ${new Date().toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).replace(":", "")}`);
    toast("Saved to GitHub. The live app updates in about a minute; phones pick it up the next time they open it.");
  } catch (e) {
    status("Save failed");
    toast(e.status === 409 ? "Someone else changed sites.js since you opened it. Reload the editor, then make your change again." : e.status === 401 || e.status === 403 ? "GitHub refused the token. Check that it has Contents: Read and write on this repo." : `Save failed: ${e.message}`, true);
  } finally { updateSave(); }
}

function download() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([writeSitesJs(ed.data)], {type: "text/javascript"}));
  a.download = "sites.js"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- helpers ---------- */
const site = id => ed.data.SITES.find(s => s.id === id);
const changedIds = () => ed.data.SITES.filter(s => ed.orig[s.id] !== JSON.stringify(s)).map(s => s.id);
const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯʻʼ']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function status(t) { $("#status").textContent = t; }
function toast(t, err) { const d = document.createElement("div"); d.className = "toast" + (err ? " err" : ""); d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), err ? 9000 : 5000); }
function updateSave() {
  const n = changedIds().length + ed.deleted.length;
  $("#saveBtn").disabled = ed.readOnly ? false : n === 0;
  $("#saveBtn").textContent = ed.readOnly ? "Connect to save" : n ? `Save ${n} change${n > 1 ? "s" : ""} to GitHub` : "Saved";
}
function getPath(o, p) { return p.split(".").reduce((x, k) => x?.[k], o); }
function setPath(o, p, v) {
  const ks = p.split("."); let x = o;
  ks.slice(0, -1).forEach(k => { if (x[k] == null || typeof x[k] !== "object") x[k] = {}; x = x[k]; });
  const last = ks[ks.length - 1];
  if (v === "" || v == null || (Array.isArray(v) && !v.length)) delete x[last]; else x[last] = v;
  if (ks.length > 1 && !Object.keys(x).length) setPath(o, ks.slice(0, -1).join("."), null);
}

/* ---------- list ---------- */
function renderList() {
  const q = $("#search").value.trim().toLowerCase(), onlyV = $("#onlyVerify").checked, onlyC = $("#onlyChanged").checked;
  const ch = new Set(changedIds());
  const rows = ed.data.SITES
    .filter(s => (!q || [s.name, s.id, ...(s.aka || [])].join(" ").toLowerCase().includes(q)) && (!onlyV || s.verify) && (!onlyC || ch.has(s.id)))
    .sort((a, b) => a.region.localeCompare(b.region) || (a.type === b.type ? 0 : a.type === "shore" ? -1 : 1) || a.name.localeCompare(b.name));
  $("#list").innerHTML = rows.map(s => `<button class="item" type="button" role="option" data-id="${esc(s.id)}" aria-selected="${s.id === ed.sel}">
      <div class="nm">${esc(s.name)}${s.verify ? '<span class="dot v">Confirm</span>' : ""}${ch.has(s.id) ? '<span class="dot c">Changed</span>' : ""}</div>
      <div class="sub">${esc(s.region)} · ${s.type === "boat" ? "Boat" : "Shore"}${s.closed ? " · Closed" : ""}</div></button>`).join("")
    || `<p class="note" style="padding:8px">No sites match.</p>`;
}

/* ---------- form ---------- */
const REGIONS = ["North Kona", "Keauhou", "South Kona", "Kohala", "Hilo", "Puna", "Kaʻū"];
const F = [
  ["Basics", [
    ["name", "Name", "text", "span2"], ["id", "ID (in the web address)", "text"], ["region", "Region", "select", "", REGIONS],
    ["type", "Type", "select", "", ["shore", "boat"]], ["level", "Level", "text"], ["depth", "Depth", "text", "", null, "e.g. 10–45 ft"],
    ["visBase", "Typical vis (ft)", "num"], ["access", "Entry difficulty on a calm day", "select", "", [["1", "1 · Easy"], ["2", "2 · Moderate"], ["3", "3 · Challenging"], ["4", "4 · Hard"]]],
    ["aka", "Also called (one per line)", "list", "span2"],
    ["verify", "Needs confirming on site", "check"], ["closed", "Closed: reason (leave empty if open)", "text", "full"]
  ]],
  ["Location", "MAP"],
  ["About", [["desc", "Description", "textarea", "full"], ["highlights", "Highlights (one per line)", "list", "span2"], ["hazards", "Hazards (one per line)", "list", "span2"], ["restrictions", "Rules and restrictions (one per line)", "list", "full"]]],
  ["Entry and dive", [["entry", "Entry", "textarea", "span2"], ["exit", "Exit", "textarea", "span2"], ["route", "Route", "textarea", "full"],
    ["prefer.tide", "Best tide", "select", "", ["", "low", "mid", "high", "any"]], ["prefer.hours.0", "Best from (hour, 0–23)", "num"], ["prefer.hours.1", "Best until (hour, 0–23)", "num"], ["prefer.note", "Best-time note", "textarea", "full"],
    ["currentNote", "Current note", "text", "full"]]],
  ["Getting there", [["drive", "Driving", "textarea", "span2"], ["parking", "Parking", "textarea", "span2"], ["fees", "Fees and hours", "text", "full"], ["amenities", "Amenities (one per line)", "list", "span2"],
    ["cell.level", "Cell signal", "select", "", ["", "strong", "good", "fair", "spotty", "none"]], ["cell.note", "Cell note", "text"], ["cell.where", "Where to get signal", "text", "span2"]]],
  ["Safety and data", [["er", "Nearest ER", "select", "", null, null, "ER"], ["erDrive", "Drive to ER", "text"], ["tide", "Tide station", "select", "", null, null, "TIDE"],
    ["alertArea", "NWS alert area match", "text", "", null, "e.g. Kona or Kohala"], ["faces", "Shore faces (degrees, 270 = west)", "num"], ["side", "Side of island", "select", "", ["west", "east"]], ["runoff", "Murky after rain", "check"]]],
  ["County public access", [["county.district", "District", "text"], ["county.map", "County map", "text", "span2"], ["county.name", "Access name", "text"], ["county.url", "County guide link", "text", "span2"]]],
  ["Underwater sketch", [["map.note", "Sketch note", "text", "full"]]]
];

function field([key, label, type, cls = "", opts, ph, dyn]) {
  const s = site(ed.sel); const v = getPath(s, key);
  if (dyn === "ER") opts = Object.entries(ed.data.EMERGENCY?.hospitals || {}).map(([k, h]) => [k, h.name]);
  if (dyn === "TIDE") opts = Object.entries(ed.data.TIDE_STATIONS || {}).map(([k, t]) => [k, `${t.name} ${t.id}`]);
  const at = `data-key="${esc(key)}" data-type="${type}"`;
  if (type === "check") return `<label class="check ${cls}"><input type="checkbox" ${at} ${v ? "checked" : ""}> ${esc(label)}</label>`;
  let input;
  if (type === "select") input = `<select ${at}>${(opts || []).map(o => { const [val, txt] = Array.isArray(o) ? o : [o, o || "–"]; return `<option value="${esc(val)}" ${String(v ?? "") === String(val) ? "selected" : ""}>${esc(txt)}</option>`; }).join("")}</select>`;
  else if (type === "textarea") input = `<textarea ${at}>${esc(v)}</textarea>`;
  else if (type === "list") input = `<textarea class="list" ${at}>${esc((v || []).join("\n"))}</textarea>`;
  else input = `<input ${at} type="${type === "num" ? "number" : "text"}" value="${esc(v)}" ${ph ? `placeholder="${esc(ph)}"` : ""} ${type === "num" ? 'step="any"' : ""}>`;
  return `<label class="${cls}">${esc(label)}${input}</label>`;
}

function select(id) {
  ed.sel = id; const s = site(id);
  if (!s) { $("#form").innerHTML = `<p class="empty">Pick a site on the left to edit it.</p>`; renderList(); return; }
  let h = `<h2>${esc(s.name)}</h2><p class="hint">Changes are kept here until you press <b>Save to GitHub</b>. <a href="./#${encodeURIComponent(s.id)}" target="_blank" rel="noopener">See this site in the app</a></p>`;
  F.forEach(([title, fields]) => {
    h += `<fieldset><legend>${esc(title)}</legend>`;
    if (fields === "MAP") h += `<div class="maprow">${field(["lat", "Latitude", "num"])}${field(["lon", "Longitude", "num"])}<span class="note">Drag the pin or click the map to move the site. Put it where you enter the water.</span></div><div id="map"></div>`;
    else h += `<div class="grid">${fields.map(field).join("")}</div>`;
    h += `</fieldset>`;
  });
  h += `<div class="actions"><button class="btn" type="button" id="revertBtn" ${ed.orig[s.id] ? "" : "disabled"}>Undo changes to this site</button><span class="grow"></span><button class="btn danger" type="button" id="delBtn">Delete site</button></div>`;
  $("#form").innerHTML = h; $("#form").scrollTop = 0;
  renderList(); drawMap(s);
}

function onInput(e) {
  const el = e.target.closest("[data-key]"); if (!el || !ed.sel) return;
  const s = site(ed.sel), key = el.dataset.key, type = el.dataset.type;
  let v;
  if (type === "check") v = el.checked || null;
  else if (type === "num") v = el.value === "" ? null : Number(el.value);
  else if (type === "list") v = el.value.split("\n").map(x => x.trim()).filter(Boolean);
  else if (key === "access") v = el.value ? Number(el.value) : null;
  else v = el.value;
  if (key.startsWith("prefer.hours.")) { // keep [from, until] as a pair
    const hrs = (s.prefer?.hours || [7, 10]).slice(); hrs[+key.slice(-1)] = v ?? hrs[+key.slice(-1)];
    setPath(s, "prefer.hours", hrs);
  } else if (key === "id") {
    const nid = slug(String(v));
    if (!nid || (nid !== s.id && site(nid))) { el.setCustomValidity("Must be unique"); el.reportValidity(); return; }
    el.setCustomValidity("");
    if (ed.orig[s.id] && !ed.orig[nid]) { ed.orig[nid] = ed.orig[s.id]; delete ed.orig[s.id]; }
    s.id = nid; ed.sel = nid;
  } else setPath(s, key, v);
  if (key === "lat" || key === "lon") movePin(false);
  if (key === "name") $("#form h2").textContent = s.name || "(no name)";
  renderList(); updateSave();
}

/* ---------- map ---------- */
function drawMap(s) {
  if (ed.map) { ed.map.remove(); ed.map = null; }
  if (!window.L) { $("#map").innerHTML = `<p class="note" style="padding:10px">The map couldn't load. You can still type the latitude and longitude.</p>`; return; }
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {maxZoom: 19, attribution: "Imagery © Esri"});
  const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19, attribution: "© OpenStreetMap"});
  ed.map = L.map("map", {layers: [sat]}).setView([s.lat || 19.6, s.lon || -155.99], s.lat ? 16 : 9);
  L.control.layers({"Satellite": sat, "Street map": street}).addTo(ed.map);
  ed.others = L.layerGroup(ed.data.SITES.filter(x => x.id !== s.id && x.lat).map(x => L.circleMarker([x.lat, x.lon], {radius: 5, color: "#fff", weight: 1, fillColor: x.type === "boat" ? "#2E86AB" : "#0B4F6C", fillOpacity: .9}).bindTooltip(x.name))).addTo(ed.map);
  ed.pin = L.marker([s.lat || 19.6, s.lon || -155.99], {draggable: true, title: s.name}).addTo(ed.map);
  ed.pin.on("dragend", () => setLatLon(ed.pin.getLatLng()));
  ed.map.on("click", e => { ed.pin.setLatLng(e.latlng); setLatLon(e.latlng); });
}
function setLatLon(ll) {
  const s = site(ed.sel); s.lat = +ll.lat.toFixed(5); s.lon = +ll.lng.toFixed(5);
  $('[data-key="lat"]').value = s.lat; $('[data-key="lon"]').value = s.lon;
  renderList(); updateSave();
}
function movePin(pan = true) { const s = site(ed.sel); if (ed.pin && s.lat && s.lon) { ed.pin.setLatLng([s.lat, s.lon]); if (pan) ed.map.panTo([s.lat, s.lon]); } }

/* ---------- add / delete / revert ---------- */
function addSite() {
  let name = "New site", id = slug(name), n = 2; while (site(id)) id = slug(name) + "-" + n++;
  ed.data.SITES.push({id, name, aka: [], region: "North Kona", type: "shore", lat: 19.64, lon: -156.0, faces: 270, depth: "", level: "", visBase: 60, tide: "kawaihae", er: "kona", erDrive: "", alertArea: "Kona", access: 2, side: "west", desc: "", highlights: [], entry: "", exit: "", hazards: [], amenities: [], fees: "", parking: "", drive: "", cell: {level: "good", note: "estimated"}, route: "", prefer: {tide: "any", hours: [7, 10], note: ""}, map: {shore: "", zones: [], pois: [], entry: 0.5, exit: 0.5, note: "Sketch; confirm on site."}, verify: true});
  $("#search").value = ""; select(id); updateSave(); $('[data-key="name"]').select();
}
let delArmed = null;
function delSite(btn) {
  if (delArmed !== ed.sel) { delArmed = ed.sel; btn.textContent = "Click again to delete"; setTimeout(() => { if (btn.isConnected) btn.textContent = "Delete site"; delArmed = null; }, 4000); return; }
  const id = ed.sel; ed.data.SITES = ed.data.SITES.filter(s => s.id !== id);
  if (ed.orig[id]) ed.deleted.push(id); delete ed.orig[id]; delArmed = null;
  select(null); updateSave(); toast(`Deleted ${id}. It's gone from GitHub once you save.`);
}
function revert() {
  const s = site(ed.sel); if (!ed.orig[s.id]) return;
  Object.keys(s).forEach(k => delete s[k]); Object.assign(s, JSON.parse(ed.orig[s.id]));
  select(s.id); updateSave();
}

/* ---------- validation ---------- */
function validateAll() {
  const errs = [], ids = new Set();
  ed.data.SITES.forEach(s => {
    if (!s.name) errs.push(`a site has no name (${s.id})`);
    if (ids.has(s.id)) errs.push(`two sites share the ID ${s.id}`); ids.add(s.id);
    if (!(s.lat >= BOUNDS.lat[0] && s.lat <= BOUNDS.lat[1] && s.lon >= BOUNDS.lon[0] && s.lon <= BOUNDS.lon[1])) errs.push(`${s.name}: location is off the Big Island`);
    if (!["shore", "boat"].includes(s.type)) errs.push(`${s.name}: type must be shore or boat`);
  });
  return errs;
}

/* ---------- settings ---------- */
function openSettings() { const c = conn(); $("#repo").value = c.repo; $("#branch").value = c.branch; $("#token").value = ""; $("#token").placeholder = c.token ? "Token saved · paste a new one to replace it" : "github_pat_…"; $("#settings").showModal(); }
$("#settings").addEventListener("close", () => {
  const v = $("#settings").returnValue;
  if (v === "forget") { store("dm-ed-token", null); load(); toast("Token removed from this browser."); }
  if (v === "ok") { store("dm-ed-repo", $("#repo").value.trim()); store("dm-ed-branch", $("#branch").value.trim() || "main"); if ($("#token").value.trim()) store("dm-ed-token", $("#token").value.trim()); load(); }
});

/* ---------- wiring ---------- */
$("#list").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) select(b.dataset.id); });
$("#form").addEventListener("input", onInput);
$("#form").addEventListener("change", onInput);
$("#form").addEventListener("click", e => { if (e.target.id === "delBtn") delSite(e.target); if (e.target.id === "revertBtn") revert(); });
["#search", "#onlyVerify", "#onlyChanged"].forEach(s => $(s).addEventListener("input", renderList));
$("#addBtn").addEventListener("click", addSite);
$("#saveBtn").addEventListener("click", save);
$("#downloadBtn").addEventListener("click", download);
$("#settingsBtn").addEventListener("click", openSettings);
addEventListener("beforeunload", e => { if (changedIds().length || ed.deleted.length) { e.preventDefault(); e.returnValue = ""; } });
const want = decodeURIComponent(location.hash.slice(1)); if (want) ed.sel = want;
load();
