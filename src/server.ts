import "./env.ts";
import express from "express";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MODEL } from "./claude.ts";
import { interview, runSimulation } from "./engine.ts";
import type { SimEvent, Simulation } from "./types.ts";
import { newId } from "./util.ts";

const PORT = Number(process.env.PORT) || 3000;
// Local-only by default: anyone who can reach this server can spend your Claude credits.
const HOST = process.env.HOST || "127.0.0.1";
const MAX_RUNNING = 2;
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

const sims = new Map<string, Simulation>();
const listeners = new Map<string, Set<express.Response>>();

mkdirSync(DATA_DIR, { recursive: true });
for (const f of readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))) {
  try {
    const s: Simulation = JSON.parse(readFileSync(DATA_DIR + f, "utf8"));
    sims.set(s.id, s);
  } catch {}
}
const save = (s: Simulation) => writeFileSync(`${DATA_DIR}${s.id}.json`, JSON.stringify(s));

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  next();
});
app.use(express.json({ limit: "35mb" })); // room for a base64 pitch deck
app.use(express.static(fileURLToPath(new URL("../public/", import.meta.url))));

const CreateZ = z
  .object({
    idea: z.string().trim().max(20_000).default(""),
    audience: z.string().trim().max(500).default(""),
    personaCount: z.number().int().min(4).max(60),
    rounds: z.number().int().min(1).max(5),
    deck: z
      .object({ name: z.string().max(200), data: z.string().max(34_000_000).regex(/^[A-Za-z0-9+/=]+$/) })
      .nullable()
      .default(null),
  })
  .refine((v) => v.idea.length >= 20 || v.deck, { message: "Describe your idea in at least 20 characters or attach a PDF deck." });

const InterviewZ = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40)
    .refine((m) => m[0].role === "user" && m.at(-1)!.role === "user", { message: "Conversation must start and end with a user message." }),
});

const bad = (res: express.Response, status: number, error: string) => res.status(status).json({ error });

app.get("/api/health", (_req, res) => {
  res.json({ model: MODEL, credentials: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) });
});

app.get("/api/simulations", (_req, res) => {
  res.json(
    [...sims.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, createdAt: s.createdAt, stage: s.stage, title: s.brief?.title ?? s.input.idea.slice(0, 60), people: s.personas.length, score: s.report?.intentScore ?? null })),
  );
});

app.post("/api/simulations", (req, res) => {
  const parsed = CreateZ.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, parsed.error.issues[0].message);
  if ([...sims.values()].filter((s) => !["done", "error"].includes(s.stage)).length >= MAX_RUNNING)
    return bad(res, 429, `Only ${MAX_RUNNING} simulations can run at once. Wait for one to finish.`);

  const { deck, ...rest } = parsed.data;
  const sim: Simulation = {
    id: newId("sim"),
    createdAt: new Date().toISOString(),
    stage: "queued",
    round: 0,
    input: { ...rest, deckName: deck?.name ?? null },
    brief: null,
    personas: [],
    posts: [],
    history: [],
    report: null,
    error: null,
  };
  sims.set(sim.id, sim);
  const emit = (e: SimEvent) => {
    for (const r of listeners.get(sim.id) ?? []) r.write(`data: ${JSON.stringify(e)}\n\n`);
    if (e.type === "stage" && (e.stage === "done" || e.stage === "error")) save(sim);
  };
  runSimulation(sim, parsed.data, emit);
  res.status(201).json({ id: sim.id });
});

app.get("/api/simulations/:id", (req, res) => {
  const sim = sims.get(req.params.id);
  sim ? res.json(sim) : bad(res, 404, "Simulation not found.");
});

app.get("/api/simulations/:id/events", (req, res) => {
  const sim = sims.get(req.params.id);
  if (!sim) return bad(res, 404, "Simulation not found.");
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "snapshot", sim })}\n\n`);
  const set = listeners.get(sim.id) ?? new Set();
  listeners.set(sim.id, set.add(res));
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    set.delete(res);
  });
});

app.post("/api/simulations/:id/personas/:pid/interview", async (req, res) => {
  const sim = sims.get(req.params.id);
  const persona = sim?.personas.find((p) => p.id === req.params.pid);
  if (!sim || !persona || !sim.brief) return bad(res, 404, "Person not found.");
  const parsed = InterviewZ.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, parsed.error.issues[0].message);
  try {
    res.json({ reply: await interview(sim, persona, parsed.data.messages) });
  } catch (err) {
    console.error("[murmur] interview failed:", err);
    bad(res, 502, (err as Error).message);
  }
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Murmur running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (model: ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
    console.log("  No ANTHROPIC_API_KEY found. Add it to .env, or run `ant auth login`. See README → Setup.\n");
});
