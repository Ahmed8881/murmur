// Murmur frontend. No framework, no build step.
// All model-generated text is inserted as text nodes (never innerHTML) so a persona can't inject markup.

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

/** Tiny DOM builder: h("div", { class: "x", onclick }, child, "text", ...) */
function h(tag, attrs = {}, ...kids) {
  const el = attrs.svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "svg" || v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const STANCE_LABEL = { yes: "Would buy", maybe: "Maybe", no: "Wouldn't" };
const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function avatar(p, size = "", onclick) {
  if (!p) return h("span", { class: `avatar founder ${size}`, "aria-hidden": "true" }, "★");
  return h(onclick ? "button" : "span", {
    class: `avatar ${p.stance} ${size}`,
    style: { "--hue": hue(p.id) },
    title: `${p.name} · ${STANCE_LABEL[p.stance]}`,
    "aria-label": onclick ? `Interview ${p.name}` : null,
    onclick,
  }, initials(p.name));
}
const badge = (stance) => h("span", { class: `badge ${stance}` }, STANCE_LABEL[stance]);

/* ---------------- Router ---------------- */

let state = null; // current simulation
let source = null; // EventSource
let tab = "feed";
let filter = "all";

function route() {
  source?.close();
  closeInterview();
  const m = location.hash.match(/^#\/sim\/([\w-]+)/);
  $("view-new").hidden = !!m;
  $("view-sim").hidden = !m;
  if (m) openSim(m[1]);
  else loadHistory();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ---------------- Compose ---------------- */

let deck = null;

function updateEstimate() {
  const n = +$("count").value, r = +$("rounds").value;
  $("count-out").value = n;
  $("rounds-out").value = r;
  $("estimate").textContent = `≈ ${1 + Math.ceil(n / 8) + n * r + 1}`;
}
$("count").addEventListener("input", updateEstimate);
$("rounds").addEventListener("input", updateEstimate);

function setDeck(file) {
  const err = $("form-error");
  err.hidden = true;
  if (!file) return;
  if (file.type !== "application/pdf") return showFormError("Pitch decks must be PDF files.");
  if (file.size > 24 * 1024 * 1024) return showFormError("That PDF is over 24 MB. Try compressing it.");
  const reader = new FileReader();
  reader.onload = () => {
    deck = { name: file.name, data: String(reader.result).split(",")[1] };
    $("drop").classList.add("has");
    $("drop-text").replaceChildren(h("strong", {}, file.name), ` · ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    $("deck-clear").hidden = false;
  };
  reader.readAsDataURL(file);
}
function clearDeck(e) {
  e?.stopPropagation();
  deck = null;
  $("deck").value = "";
  $("drop").classList.remove("has");
  $("drop-text").replaceChildren(h("strong", {}, "Attach a pitch deck"), " (PDF, optional)");
  $("deck-clear").hidden = true;
}
const drop = $("drop");
drop.addEventListener("click", () => $("deck").click());
drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), $("deck").click()));
drop.addEventListener("dragover", (e) => (e.preventDefault(), drop.classList.add("over")));
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => (e.preventDefault(), drop.classList.remove("over"), setDeck(e.dataTransfer.files[0])));
$("deck").addEventListener("change", (e) => setDeck(e.target.files[0]));
$("deck-clear").addEventListener("click", clearDeck);

function showFormError(msg) {
  $("form-error").textContent = msg;
  $("form-error").hidden = false;
}

$("new-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const idea = $("idea").value.trim();
  if (idea.length < 20 && !deck) return showFormError("Describe your idea in at least 20 characters, or attach a PDF deck.");
  $("form-error").hidden = true;
  const btn = $("run");
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    const { id } = await api("/api/simulations", {
      idea,
      audience: $("audience").value.trim(),
      personaCount: +$("count").value,
      rounds: +$("rounds").value,
      deck,
    });
    clearDeck();
    location.hash = `#/sim/${id}`;
  } catch (err) {
    showFormError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run simulation";
  }
});

async function loadHistory() {
  const list = $("history");
  try {
    const sims = await api("/api/simulations");
    list.replaceChildren(
      ...(sims.length
        ? sims.map((s) =>
            h("li", {}, h("a", { href: `#/sim/${s.id}` },
              h("span", {}, s.title || "Untitled"),
              h("span", { class: "meta" }, `${s.people} people · ${s.score != null ? `${s.score}/100` : s.stage}${s.costUsd != null ? ` · ${fmtUsd(s.costUsd)}` : ""} · ${new Date(s.createdAt).toLocaleDateString()}`))))
        : [h("li", { class: "history-empty" }, "Nothing yet. Your simulations will show up here.")]),
    );
  } catch {
    list.replaceChildren();
  }
}

/* ---------------- Simulation view ---------------- */

const STEPS = [["brief", "Brief"], ["personas", "People"], ["simulating", "Feed"], ["report", "Report"]];

function openSim(id) {
  state = null;
  $("sim-title").textContent = "Loading…";
  $("feed").replaceChildren();
  $("people").replaceChildren();
  $("report").replaceChildren();
  delete $("report").dataset.done;
  source = new EventSource(`/api/simulations/${id}/events`);
  source.onmessage = (m) => apply(JSON.parse(m.data));
  source.onerror = () => {
    if (state && ["done", "error"].includes(state.stage)) source.close();
  };
}

function apply(e) {
  if (e.type === "snapshot") state = e.sim;
  if (!state) return;
  switch (e.type) {
    case "stage": state.stage = e.stage; state.round = e.round; break;
    case "brief": state.brief = e.brief; break;
    case "personas": state.personas = e.personas; break;
    case "persona": { const i = state.personas.findIndex((p) => p.id === e.persona.id); if (i >= 0) state.personas[i] = e.persona; break; }
    case "post": state.posts.push(e.post); break;
    case "like": state.posts.find((p) => p.id === e.postId)?.likes.push(e.personaId); break;
    case "history": state.history = e.history; break;
    case "report": state.report = e.report; break;
    case "usage": state.usage = e.usage; break;
    case "error": state.error = e.error; break;
  }
  if (["done", "error"].includes(state.stage)) source?.close();
  scheduleRender();
}

let raf = 0;
const scheduleRender = () => (raf ||= requestAnimationFrame(() => ((raf = 0), render())));

function render() {
  const s = state;
  $("sim-title").textContent = s.brief?.title || s.input.idea.slice(0, 80) || s.input.deckName || "Your idea";
  $("sim-eyebrow").textContent =
    s.stage === "done" ? `${s.personas.length} people · ${s.input.rounds} rounds`
    : s.stage === "error" ? "Simulation stopped"
    : s.stage === "simulating" ? `Round ${s.round} of ${s.input.rounds}`
    : "Simulation running";
  $("sim-error").hidden = !s.error;
  $("sim-error").textContent = s.error ? `Something went wrong: ${s.error}` : "";

  const at = STEPS.findIndex(([k]) => k === s.stage);
  $("stepper").replaceChildren(...STEPS.map(([k, label], i) =>
    h("li", { class: s.stage === "done" || i < at ? "done" : i === at ? "active" : "", "aria-current": i === at ? "step" : null }, label)));

  renderPulse();
  if (tab === "feed") renderFeed();
  if (tab === "people") renderPeople();
  if (tab === "report") renderReport();
  $("feed-count").textContent = Math.max(0, s.posts.length - 1) || "";
  $("report-dot").hidden = !s.report || tab === "report";
}

function counts() {
  const c = { yes: 0, maybe: 0, no: 0 };
  for (const p of state.personas) c[p.stance]++;
  return c;
}

function renderPulse() {
  const c = counts(), total = state.personas.length || 1;
  $("pulse-numbers").replaceChildren(...["yes", "maybe", "no"].map((k) =>
    h("div", { class: `num ${k}` }, h("b", {}, state.personas.length ? `${Math.round((c[k] / total) * 100)}%` : "–"), h("span", {}, STANCE_LABEL[k]))));
  $("pulse-bar").replaceChildren(...["yes", "maybe", "no"].map((k) => h("i", { class: k, style: { "flex-grow": c[k] } })));
  renderChart();
  $("crowd").replaceChildren(...state.personas.map((p) => avatar(p, "", () => openInterview(p.id))));
  if (!state.personas.length) $("crowd").replaceChildren(h("p", { class: "muted" }, "Assembling the crowd…"));
  renderUsage();
}

const fmtUsd = (n) => (n == null ? "–" : n < 0.01 ? "<$0.01" : `${n.toFixed(2)}`);
const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function renderUsage() {
  const u = state.usage;
  const row = (k, v, cls) => [h("dt", {}, k), h("dd", { class: cls }, v)];
  $("usage").replaceChildren(...(u
    ? [...row("Cost", fmtUsd(u.costUsd), "cost"), ...row("Calls", u.calls), ...row("Tokens in", fmtTok(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens)), ...row("Tokens out", fmtTok(u.outputTokens))]
    : [h("dd", { class: "muted" }, "Not recorded for this run.")]));
  $("usage").title = u?.costUsd == null && u ? "Cost unknown for this model; token counts are exact." : "Estimated from token counts at list prices.";
}

function renderChart() {
  const hist = state.history;
  if (hist.length < 2) return $("pulse-chart").replaceChildren(h("p", { class: "empty" }, "Shows how opinions shift after each round."));
  const W = 280, H = 90, n = hist.length - 1;
  const x = (i) => (i / n) * W;
  const pts = (fn) => hist.map((r, i) => `${x(i)},${H - fn(r) * H}`).join(" ");
  const tot = (r) => r.yes + r.maybe + r.no || 1;
  const yes = (r) => r.yes / tot(r), ym = (r) => (r.yes + r.maybe) / tot(r);
  const area = (top, bottom, color) => h("polygon", {
    svg: true, fill: color, "fill-opacity": "0.85",
    points: `${pts(top)} ${hist.map((r, i) => `${x(i)},${H - bottom(r) * H}`).reverse().join(" ")}`,
  });
  const css = getComputedStyle(document.documentElement);
  $("pulse-chart").replaceChildren(
    h("svg", { svg: true, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": `Would-buy share went from ${Math.round(yes(hist[0]) * 100)}% to ${Math.round(yes(hist[n]) * 100)}%` },
      area(() => 1, ym, css.getPropertyValue("--no")),
      area(ym, yes, css.getPropertyValue("--maybe")),
      area(yes, () => 0, css.getPropertyValue("--yes"))),
  );
}

const byId = (id) => state.personas.find((p) => p.id === id);

function postEl(post, reply) {
  const p = byId(post.authorId);
  const parent = post.replyTo && state.posts.find((x) => x.id === post.replyTo);
  const parentName = parent && (byId(parent.authorId)?.name || "Founder");
  return h("div", { class: `post ${reply ? "reply" : ""} ${post.authorId === "founder" ? "launch" : ""}` },
    avatar(p, "", p && (() => openInterview(p.id))),
    h("div", {},
      h("div", { class: "post-head" },
        p ? h("button", { class: "post-name", onclick: () => openInterview(p.id) }, p.name) : h("strong", {}, "Founder"),
        h("span", { class: "post-meta" }, p ? `${p.occupation} · ${p.location}` : "Launch post"),
      ),
      parentName && reply ? h("div", { class: "post-meta" }, `replying to ${parentName}`) : null,
      h("p", { class: "post-body" }, post.content),
      h("div", { class: "post-foot" },
        post.round ? h("span", {}, `Round ${post.round}`) : null,
        h("span", {}, `♥ ${post.likes.length}`),
        p ? badge(p.stance) : null,
      ),
    ),
  );
}

function renderFeed() {
  const feed = $("feed");
  if (!state.posts.length) {
    return feed.replaceChildren(h("li", { class: "empty-state" }, h("div", { class: "spinner" }),
      state.stage === "brief" ? "Reading your idea…" : "Creating people with real lives and opinions…"));
  }
  // Group replies under their root post; newest threads first.
  const rootOf = (post) => { let r = post; while (r.replyTo) r = state.posts.find((x) => x.id === r.replyTo) || { replyTo: null, id: r.replyTo }; return r.id; };
  const threads = new Map();
  for (const post of state.posts) {
    const root = rootOf(post);
    if (!threads.has(root)) threads.set(root, []);
    threads.get(root).push(post);
  }
  const show = (post) => filter === "all" || byId(post.authorId)?.stance === filter;
  const items = [...threads.values()]
    .filter((t) => t.some(show))
    .sort((a, b) => (b[0].authorId === "founder") - (a[0].authorId === "founder") || state.posts.indexOf(b.at(-1)) - state.posts.indexOf(a.at(-1)))
    .map((t) => h("li", { class: "thread" }, t.map((post, i) => postEl(post, i > 0))));
  feed.replaceChildren(...(items.length ? items : [h("li", { class: "empty-state" }, "No posts from this group yet.")]));
}

function renderPeople() {
  const order = { yes: 0, maybe: 1, no: 2 };
  const people = [...state.personas].sort((a, b) => order[a.stance] - order[b.stance]);
  $("people").replaceChildren(...people.map((p) =>
    h("article", { class: "card person" },
      h("div", { class: "person-top" }, avatar(p, "lg"),
        h("div", {}, h("h3", {}, p.name), h("p", {}, `${p.age} · ${p.occupation}`))),
      h("p", {}, p.bio),
      h("div", { class: "row" }, badge(p.stance),
        h("span", { class: "shift" }, p.initialStance === p.stance ? "held position" : `was ${STANCE_LABEL[p.initialStance].toLowerCase()}`)),
      h("div", { class: "meter", title: `Sentiment ${p.sentiment.toFixed(2)}` }, h("i", { style: { left: `${((p.sentiment + 1) / 2) * 100}%` } })),
      h("div", { class: "row" }, h("span", { class: "shift" }, `${p.segment} · ${p.location}`),
        h("button", { class: "btn ghost sm", onclick: () => openInterview(p.id) }, "Interview")),
    )));
  if (!people.length) $("people").replaceChildren(h("p", { class: "empty-state" }, "People appear here once they're created."));
}

function renderReport() {
  const r = state.report, root = $("report");
  if (!r) {
    return root.replaceChildren(h("div", { class: "empty-state" }, state.stage === "error" ? "No report: the simulation stopped early." : [h("div", { class: "spinner" }),
      state.stage === "report" ? "Analysing the conversation…" : "The report is written once the crowd has finished talking."]));
  }
  if (root.dataset.done === state.id) return; // static once written
  root.dataset.done = state.id;
  const C = 2 * Math.PI * 56;
  const quotes = (items) => h("ul", {}, items.map((o) => h("li", { class: "quote-item" }, h("b", {}, o.point, h("span", { class: "freq" }, o.frequency)), o.quote && h("q", {}, o.quote))));
  const c = counts();
  root.replaceChildren(h("div", { class: "report" },
    h("section", { class: "card verdict" },
      h("div", { class: "score" },
        h("svg", { svg: true, viewBox: "0 0 132 132" },
          h("circle", { svg: true, class: "track", cx: 66, cy: 66, r: 56 }),
          h("circle", { svg: true, class: "val", cx: 66, cy: 66, r: 56, "stroke-dasharray": C, "stroke-dashoffset": C * (1 - r.intentScore / 100) })),
        h("div", {}, h("b", {}, r.intentScore), h("small", {}, "intent / 100"))),
      h("div", {}, h("h2", {}, r.verdict), h("p", {}, r.summary),
        h("p", { class: "muted" }, `${c.yes} would buy · ${c.maybe} maybe · ${c.no} wouldn't`))),
    h("div", { class: "r-grid" },
      h("section", { class: "card r-card" }, h("h3", { class: "section-title" }, "Why they'd pass"), quotes(r.objections)),
      h("section", { class: "card r-card" }, h("h3", { class: "section-title" }, "What landed"), quotes(r.praise))),
    h("section", { class: "card r-card" }, h("h3", { class: "section-title" }, "By segment"),
      r.segments.map((s) => h("div", { class: "seg" },
        h("div", {}, h("b", {}, s.name), h("p", {}, s.reaction)),
        h("div", { class: "bar" }, h("i", { style: { width: `${s.buyRate}%` } })),
        h("span", { class: "pct" }, `${Math.round(s.buyRate)}%`)))),
    h("div", { class: "r-grid" },
      h("section", { class: "card r-card" }, h("h3", { class: "section-title" }, "Holes in the idea"), h("ul", {}, r.holes.map((x) => h("li", {}, x)))),
      h("section", { class: "card r-card" }, h("h3", { class: "section-title" }, "What to change"), h("ol", {}, r.recommendations.map((x) => h("li", {}, x))))),
    r.mindChanges.length ? h("section", { class: "card r-card" }, h("h3", { class: "section-title" }, "Who changed their mind"),
      h("ul", {}, r.mindChanges.map((m) => h("li", {}, h("b", {}, m.name), ` ${STANCE_LABEL[m.from]} → ${STANCE_LABEL[m.to]}. `, m.why)))) : null,
    h("div", { class: "report-actions" },
      h("button", { class: "btn primary", onclick: () => openInterview(state.personas.find((p) => p.stance === "no")?.id || state.personas[0].id) }, "Interview a skeptic"),
      h("button", { class: "btn ghost", onclick: download }, "Download JSON"),
      h("a", { class: "btn ghost", href: "#/" }, "New simulation")),
  ));
}

function download() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  h("a", { href: url, download: `murmur-${state.id}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const b of document.querySelectorAll("[role=tab]")) {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    for (const t of document.querySelectorAll("[role=tab]")) t.setAttribute("aria-selected", t === b);
    for (const k of ["feed", "people", "report"]) $(`tab-${k}`).hidden = k !== tab;
    if (state) render();
  });
}
for (const c of document.querySelectorAll("[data-filter]")) {
  c.addEventListener("click", () => {
    filter = c.dataset.filter;
    for (const x of document.querySelectorAll("[data-filter]")) x.setAttribute("aria-pressed", x === c);
    if (state) renderFeed();
  });
}

/* ---------------- Interview ---------------- */

let iv = null; // { personaId, messages }
let lastFocus = null;
const SUGGEST = ["Would you actually pay for this?", "What would change your mind?", "What's the biggest red flag?", "What do you use today instead?"];

function openInterview(personaId) {
  const p = byId(personaId);
  if (!p) return;
  if (!state.brief) return;
  lastFocus = document.activeElement;
  iv = { personaId, messages: [] };
  $("iv-avatar").replaceChildren(avatar(p, "lg"));
  $("iv-name").textContent = p.name;
  $("iv-meta").textContent = `${p.age} · ${p.occupation} · ${p.location}`;
  $("iv-profile").replaceChildren(
    h("p", {}, p.bio),
    h("div", { class: "row" }, badge(p.stance), h("span", { class: "shift" }, ` started as ${STANCE_LABEL[p.initialStance].toLowerCase()} · ${p.segment}`)),
  );
  $("iv-log").replaceChildren(h("li", { class: "msg assistant typing" }, `Ask ${p.name.split(" ")[0]} anything about the idea.`));
  $("iv-suggest").replaceChildren(...SUGGEST.map((q) => h("button", { class: "chip", type: "button", onclick: () => ask(q) }, q)));
  $("scrim").hidden = $("drawer").hidden = false;
  $("iv-input").focus();
}

function closeInterview() {
  if ($("drawer").hidden) return;
  $("scrim").hidden = $("drawer").hidden = true;
  iv = null;
  lastFocus?.focus?.();
}
$("iv-close").addEventListener("click", closeInterview);
$("scrim").addEventListener("click", closeInterview);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeInterview());

async function ask(text) {
  if (!iv || !text.trim() || iv.busy) return;
  const session = iv;
  session.busy = true;
  session.messages.push({ role: "user", content: text.trim() });
  $("iv-suggest").replaceChildren();
  const log = $("iv-log");
  if (session.messages.length === 1) log.replaceChildren();
  log.append(h("li", { class: "msg user" }, text.trim()));
  const typing = h("li", { class: "msg assistant typing" }, "Thinking…");
  log.append(typing);
  log.scrollTop = log.scrollHeight;
  try {
    const { reply, usage } = await api(`/api/simulations/${state.id}/personas/${session.personaId}/interview`, { messages: session.messages });
    session.messages.push({ role: "assistant", content: reply });
    if (usage) (state.usage = usage), renderUsage();
    typing.replaceWith(h("li", { class: "msg assistant" }, reply));
  } catch (err) {
    session.messages.pop();
    typing.replaceWith(h("li", { class: "msg assistant typing" }, `Couldn't answer: ${err.message}`));
  } finally {
    session.busy = false;
    log.scrollTop = log.scrollHeight;
  }
}
$("iv-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("iv-input");
  ask(input.value);
  input.value = "";
});
$("iv-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("iv-form").requestSubmit();
  }
});

/* ---------------- Boot ---------------- */

api("/api/health")
  .then(({ model, credentials }) => {
    const s = $("status");
    s.textContent = credentials ? model : `${model} · no key in .env`;
    s.className = `status ${credentials ? "ok" : "warn"}`;
    s.title = credentials ? "Using your Anthropic credentials" : "No ANTHROPIC_API_KEY found. An `ant auth login` profile also works; see README.";
  })
  .catch(() => {});
updateEstimate();
route();
