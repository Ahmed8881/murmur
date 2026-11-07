import { test } from "node:test";
import assert from "node:assert/strict";
import type { SimEvent, Simulation } from "../src/types.ts";

process.env.ANTHROPIC_API_KEY ||= "test-key-not-used";
const { client } = await import("../src/claude.ts");
const { runSimulation } = await import("../src/engine.ts");

// Fake Claude: answers each pipeline step from the prompt text, so the engine runs end to end offline.
let calls = 0;
let onTurn: () => void = () => {};
const text = (p: any) => {
  const c = p.messages[0].content;
  return typeof c === "string" ? c : c.map((b: any) => b.text ?? "").join("");
};
(client.beta.messages as any).parse = async (p: any, opts?: { signal?: AbortSignal }) => {
  calls++;
  if (opts?.signal?.aborted) throw new Error("Request was aborted.");
  const t = text(p);
  let out: unknown;
  if (t.includes("neutral product brief")) {
    out = { title: "Widget", summary: "A widget.", pricing: "$5", targetCustomers: "people", segments: [{ name: "A", description: "a", share: 60 }, { name: "B", description: "b", share: 40 }] };
  } else if (t.includes("distinct people")) {
    const n = Number(t.match(/exactly (\d+)/)![1]);
    out = { personas: Array.from({ length: n }, (_, i) => ({ name: `P ${calls}-${i}`, age: 30, occupation: "x", location: "y", bio: "b", personality: "p", values: ["v"], budget: "tight", stance: "maybe", sentiment: 0 })) };
  } else if (t.includes("Decide what you do now")) {
    onTurn();
    out = { action: "post", replyTo: "", content: "I would buy it", likes: ["post_launch"], stance: "yes", sentiment: 0.5, thought: "liked it" };
  } else if (t.includes("Write the report")) {
    out = { verdict: "ok", intentScore: 140, summary: "s", segments: [{ name: "A", reaction: "r", buyRate: 50 }], objections: [], praise: [], holes: [], recommendations: [], mindChanges: [] };
  } else if (t.includes("gut reaction on first seeing")) {
    const ids = [...t.matchAll(/\[(p_[\w-]+)\]/g)].map((m) => m[1]);
    out = { reactions: ids.slice(1).map((id) => ({ id, stance: "no", sentiment: -2 })) }; // first person deliberately missing
  } else if (t.includes("A researcher asks you")) {
    out = { answer: "About $5." };
  } else throw new Error("unexpected prompt: " + t.slice(0, 80));
  return { stop_reason: "end_turn", parsed_output: out, model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 10 } };
};

const newSim = (): Simulation => ({ id: "sim_t", createdAt: "", stage: "queued", round: 0, input: { idea: "a widget idea", audience: "", personaCount: 5, rounds: 2, deckName: null }, brief: null, personas: [], posts: [], history: [], report: null, error: null });
const input = { idea: "a widget idea", audience: "", personaCount: 5, rounds: 2, deck: null };

test("full run: personas, posts, history, clamped report, usage", async () => {
  calls = 0;
  onTurn = () => {};
  const sim = newSim();
  const events: SimEvent[] = [];
  await runSimulation(sim, input, (e) => events.push(e), new AbortController().signal);
  assert.equal(sim.error, null);
  assert.equal(sim.stage, "done");
  assert.equal(sim.personas.length, 5);
  assert.deepEqual(sim.personas.map((p) => p.segment).sort(), ["A", "A", "A", "B", "B"]);
  assert.equal(sim.posts.length, 1 + 5 * 2);
  assert.deepEqual(sim.history.map((h) => h.yes), [0, 5, 5]);
  assert.equal(sim.report!.intentScore, 100);
  assert.equal(sim.posts[0].likes.length, 5);
  assert.equal(sim.usage!.calls, calls);
  assert.ok(events.some((e) => e.type === "usage"));
});

test("finish early: stops the rounds but still writes the report", async () => {
  const sim = newSim();
  const ctrl = new AbortController();
  let turns = 0;
  onTurn = () => ++turns === 3 && ctrl.abort();
  await runSimulation(sim, { ...input, personaCount: 12 }, () => {}, ctrl.signal);
  assert.equal(sim.stage, "done", sim.error ?? "");
  assert.ok(sim.report);
  assert.ok(turns < 12 * 2, `expected fewer turns, got ${turns}`);
});

test("stop before discussion: errors without a report", async () => {
  const sim = newSim();
  const ctrl = new AbortController();
  ctrl.abort();
  await runSimulation(sim, input, () => {}, ctrl.signal);
  assert.equal(sim.stage, "error");
  assert.equal(sim.error, "Stopped by you.");
  assert.equal(sim.report, null);
});

test("pollCrowd asks everyone and stores the poll", async () => {
  const { pollCrowd } = await import("../src/engine.ts");
  onTurn = () => {};
  const sim = newSim();
  await runSimulation(sim, input, () => {}, new AbortController().signal);
  const before = sim.usage!.calls;
  const poll = await pollCrowd(sim, "What would you pay?");
  assert.equal(poll.answers.length, 5);
  assert.equal(sim.polls!.length, 1);
  assert.equal(sim.usage!.calls, before + 5);
});

test("variant run reuses the same people with fresh memory and new first impressions", async () => {
  onTurn = () => {};
  const original = newSim();
  await runSimulation(original, input, () => {}, new AbortController().signal);
  const calls0 = calls;
  const variant = newSim();
  await runSimulation(variant, { ...input, idea: "a cheaper widget idea", crowd: original.personas }, () => {}, new AbortController().signal);
  assert.equal(variant.stage, "done", variant.error ?? "");
  assert.deepEqual(variant.personas.map((p) => p.id), original.personas.map((p) => p.id));
  assert.equal(variant.personas[0].initialStance, "maybe"); // missing reaction falls back
  assert.equal(variant.personas[1].initialStance, "no");
  assert.equal(variant.personas[1].sentiment >= -1, true);
  assert.ok(original.personas[0].memory.length > 0, "original keeps its memory");
  assert.equal(calls - calls0, 1 + 1 + 5 * 2 + 1); // brief + impressions + turns + report
});
