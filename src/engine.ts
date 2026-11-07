import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { ask, chat, type RunCtx } from "./claude.ts";
import type { Brief, Persona, Post, Report, SimEvent, SimInput, Simulation } from "./types.ts";
import { allocate, chunk, clamp, countStances, emptyUsage, mapLimit, newId } from "./util.ts";

const CONCURRENCY = 6; // parallel Claude calls; also the size of each "wave" within a round
const FEED_WINDOW = 30; // most recent posts a persona sees

const StanceZ = z.enum(["yes", "maybe", "no"]);

const BriefZ = z.object({
  title: z.string().describe("Short product name"),
  summary: z.string().describe("3-5 sentence neutral description of what is being sold and how it works"),
  pricing: z.string().describe("Price / business model, or 'not stated'"),
  targetCustomers: z.string(),
  segments: z
    .array(z.object({ name: z.string(), description: z.string(), share: z.number().describe("Relative weight 1-100") }))
    .describe("3-6 realistic customer segments, including skeptics and non-target people who would still see it"),
});

const PersonasZ = z.object({
  personas: z.array(
    z.object({
      name: z.string(),
      age: z.number(),
      occupation: z.string(),
      location: z.string(),
      bio: z.string().describe("2-3 sentences of life context relevant to this purchase"),
      personality: z.string().describe("How they talk and argue online, e.g. 'dry, skeptical, cites numbers'"),
      values: z.array(z.string()).describe("3 things they care about"),
      budget: z.enum(["tight", "moderate", "comfortable"]),
      stance: StanceZ.describe("Gut reaction before discussing it with anyone"),
      sentiment: z.number().describe("-1 (hostile) to 1 (enthusiastic)"),
    }),
  ),
});

const TurnZ = z.object({
  action: z.enum(["post", "reply", "lurk"]),
  replyTo: z.string().describe("Post id being replied to, or empty string"),
  content: z.string().describe("The post text, 1-3 sentences, in your own voice. Empty if lurking."),
  likes: z.array(z.string()).describe("Ids of posts you agree with (0-3)"),
  stance: StanceZ.describe("Would you buy it right now?"),
  sentiment: z.number().describe("-1 to 1"),
  thought: z.string().describe("Private note to yourself: what moved you this round, if anything"),
});

const ReportZ = z.object({
  verdict: z.string().describe("One blunt sentence"),
  intentScore: z.number().describe("0-100 overall purchase intent"),
  summary: z.string().describe("One paragraph on how the crowd reacted and why"),
  segments: z.array(z.object({ name: z.string(), reaction: z.string(), buyRate: z.number().describe("0-100") })),
  objections: z.array(z.object({ point: z.string(), frequency: z.enum(["many", "some", "few"]), quote: z.string().describe("Verbatim from a post") })),
  praise: z.array(z.object({ point: z.string(), frequency: z.enum(["many", "some", "few"]), quote: z.string().describe("Verbatim from a post") })),
  holes: z.array(z.string()).describe("Weaknesses in the idea the founder probably hasn't considered"),
  recommendations: z.array(z.string()).describe("Concrete changes that would most improve adoption"),
  mindChanges: z.array(z.object({ name: z.string(), from: StanceZ, to: StanceZ, why: z.string() })),
});

const WORLD = `You are part of Murmur, a market simulation. You role-play realistic, varied members of the public reacting to a product on a social network.
Be honest and specific. Real people are often indifferent, price-sensitive, distracted, or skeptical; do not flatter the founder.`;

export function briefText(b: Brief) {
  return `PRODUCT: ${b.title}\n${b.summary}\nPricing: ${b.pricing}\nTarget customers: ${b.targetCustomers}`;
}

function personaText(p: Persona) {
  return `You are ${p.name}, ${p.age}, ${p.occupation} in ${p.location} (${p.segment}). ${p.bio}
Personality: ${p.personality}. You care about: ${p.values.join(", ")}. Budget: ${p.budget}.`;
}

function feedText(sim: Simulation) {
  const name = (id: string) => (id === "founder" ? "Founder" : sim.personas.find((p) => p.id === id)?.name ?? "someone");
  return sim.posts
    .slice(-FEED_WINDOW)
    .map((p) => `[${p.id}] ${name(p.authorId)}${p.replyTo ? ` (replying to ${p.replyTo})` : ""}: ${p.content} (${p.likes.length} likes)`)
    .join("\n");
}

async function makeBrief(input: SimInput, ctx: RunCtx): Promise<Brief> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.deck) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.deck.data } });
  content.push({
    type: "text",
    text: `Turn this startup idea${input.deck ? " and the attached pitch deck" : ""} into a neutral product brief and realistic customer segments.
${input.audience ? `The founder says the intended audience is: ${input.audience}\n` : ""}
IDEA:
${input.idea || "(see deck)"}`,
  });
  const b = await ask({ system: "You are a sharp, neutral market analyst.", content, schema: BriefZ, effort: "medium", ctx });
  if (!b.segments.length) b.segments = [{ name: "General public", description: "Broad audience", share: 1 }];
  return b;
}

async function makePersonas(brief: Brief, count: number, ctx: RunCtx): Promise<Persona[]> {
  // Batches of ≤8 per call, each pinned to one segment, so people stay distinct and the crowd mirrors the segment mix.
  const counts = allocate(count, brief.segments.map((s) => s.share));
  const jobs = brief.segments.flatMap((segment, i) => chunk(Array.from({ length: counts[i] }), 8).map((c) => ({ segment, n: c.length })));
  const batches = await mapLimit(jobs, CONCURRENCY, async ({ segment, n }) => {
    const { personas } = await ask({
      system: WORLD,
      content: `${briefText(brief)}

Create exactly ${n} distinct people from the segment "${segment.name}" (${segment.description}).
Vary age, gender, income, geography, temperament and tech comfort. Include at least one skeptic when n > 2.
Use realistic, culturally varied names.`,
      schema: PersonasZ,
      ctx,
    });
    return personas.slice(0, n).map(
      (p): Persona => ({ ...p, id: newId("p"), segment: segment.name, initialStance: p.stance, sentiment: clamp(p.sentiment, -1, 1), memory: [] }),
    );
  });
  return batches.flat();
}

async function takeTurn(sim: Simulation, p: Persona, round: number, totalRounds: number, ctx: RunCtx) {
  return ask({
    system: `${WORLD}\n\n${personaText(p)}`,
    content: `${briefText(sim.brief!)}

Round ${round} of ${totalRounds} on the feed. Your current stance: would you buy? ${p.stance}.
Your private notes so far: ${p.memory.join(" | ") || "(none)"}

FEED (newest last):
${feedText(sim)}

Decide what you do now. Post your own take, reply to someone you agree or disagree with, or lurk.
Change your stance only if something in the feed genuinely moved you. Stay in character.`,
    schema: TurnZ,
    ctx,
  });
}

async function makeReport(sim: Simulation, ctx: RunCtx): Promise<Report> {
  const people = sim.personas
    .map((p) => `- ${p.name} (${p.segment}, ${p.occupation}, budget ${p.budget}): ${p.initialStance} -> ${p.stance}. Notes: ${p.memory.join(" | ")}`)
    .join("\n");
  const posts = sim.posts.map((p) => `[${p.id}] ${sim.personas.find((x) => x.id === p.authorId)?.name ?? "Founder"}: ${p.content}`).join("\n");
  const c = countStances(sim.personas);
  const r = await ask({
    system: "You are a candid market-research analyst writing for a founder. Ground every claim in the simulated data.",
    content: `${briefText(sim.brief!)}

Final stances: ${c.yes} would buy, ${c.maybe} maybe, ${c.no} would not (of ${sim.personas.length}).

PEOPLE:
${people}

ALL POSTS:
${posts}

Write the report. Quotes must be copied verbatim from posts.`,
    schema: ReportZ,
    effort: "medium",
    ctx,
  });
  return { ...r, intentScore: clamp(r.intentScore, 0, 100), segments: r.segments.map((s) => ({ ...s, buyRate: clamp(s.buyRate, 0, 100) })) };
}

/** `signal` = "finish early": before the discussion it stops the run; during it, remaining turns are dropped and the report is written from what exists. */
export async function runSimulation(sim: Simulation, input: SimInput, emit: (e: SimEvent) => void, signal: AbortSignal) {
  const stage = (s: Simulation["stage"]) => {
    sim.stage = s;
    emit({ type: "stage", stage: s, round: sim.round });
  };
  sim.usage = emptyUsage();
  const ctx: RunCtx = { usage: sim.usage, signal, onUsage: () => emit({ type: "usage", usage: sim.usage! }) };
  try {
    stage("brief");
    sim.brief = await makeBrief(input, ctx);
    emit({ type: "brief", brief: sim.brief });

    stage("personas");
    sim.personas = await makePersonas(sim.brief, input.personaCount, ctx);
    if (!sim.personas.length) throw new Error("No personas were generated.");
    emit({ type: "personas", personas: sim.personas });
    sim.history.push({ round: 0, ...countStances(sim.personas) });
    emit({ type: "history", history: sim.history });

    const launch: Post = { id: "post_launch", round: 0, authorId: "founder", replyTo: null, content: `Launching: ${sim.brief.title}. ${sim.brief.summary} Pricing: ${sim.brief.pricing}`, sentiment: 1, likes: [] };
    sim.posts.push(launch);
    emit({ type: "post", post: launch });

    for (let round = 1; round <= input.rounds && !signal.aborted; round++) {
      sim.round = round;
      stage("simulating");
      // Shuffled waves: later waves see and react to what earlier waves posted this round.
      const order = [...sim.personas].sort(() => Math.random() - 0.5);
      for (const wave of chunk(order, CONCURRENCY)) {
        if (signal.aborted) break;
        await Promise.all(
          wave.map(async (p) => {
            let t;
            try {
              t = await takeTurn(sim, p, round, input.rounds, ctx);
            } catch (err) {
              if (signal.aborted) return;
              console.warn(`[murmur] ${p.name} skipped round ${round}:`, (err as Error).message);
              return; // one failed persona shouldn't sink the whole run
            }
            p.stance = t.stance;
            p.sentiment = clamp(t.sentiment, -1, 1);
            if (t.thought) p.memory.push(`R${round}: ${t.thought}`);
            emit({ type: "persona", persona: p });
            for (const id of t.likes.slice(0, 3)) {
              const post = sim.posts.find((x) => x.id === id);
              if (post && post.authorId !== p.id && !post.likes.includes(p.id)) {
                post.likes.push(p.id);
                emit({ type: "like", postId: id, personaId: p.id });
              }
            }
            if (t.action !== "lurk" && t.content.trim()) {
              const replyTo = t.action === "reply" && sim.posts.some((x) => x.id === t.replyTo) ? t.replyTo : null;
              const post: Post = { id: newId("post"), round, authorId: p.id, replyTo, content: t.content.trim(), sentiment: p.sentiment, likes: [] };
              sim.posts.push(post);
              emit({ type: "post", post });
            }
          }),
        );
      }
      sim.history.push({ round, ...countStances(sim.personas) });
      emit({ type: "history", history: sim.history });
    }

    if (sim.posts.length < 2) throw new Error("Stopped before anyone posted, so there is nothing to report.");
    stage("report");
    sim.report = await makeReport(sim, { ...ctx, signal: undefined }); // finishing early must still produce the report
    emit({ type: "report", report: sim.report });
    stage("done");
  } catch (err) {
    sim.error = signal.aborted && sim.stage !== "report" && !(err as Error).message.startsWith("Stopped") ? "Stopped by you." : (err as Error).message;
    emit({ type: "error", error: sim.error });
    stage("error");
  }
}

export async function interview(sim: Simulation, persona: Persona, messages: { role: "user" | "assistant"; content: string }[]) {
  const theirPosts = sim.posts.filter((p) => p.authorId === persona.id).map((p) => `- ${p.content}`).join("\n");
  const system = `${WORLD}

${personaText(persona)}
You first reacted "${persona.initialStance}" and now your answer to "would you buy it?" is "${persona.stance}".
Your private notes: ${persona.memory.join(" | ") || "(none)"}
What you posted:
${theirPosts || "(you only lurked)"}

${briefText(sim.brief!)}

The founder is now interviewing you one-on-one. Answer in character, conversationally and candidly, in 1-3 short paragraphs.
Explain your real reasons, including what would change your mind. Never break character or mention being an AI simulation.`;
  sim.usage ??= emptyUsage();
  return chat(system, messages, { usage: sim.usage });
}
