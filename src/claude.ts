import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { Usage } from "./types.ts";
import { addUsage } from "./util.ts";

// Credentials come from the user's own environment: ANTHROPIC_API_KEY, or an `ant auth login` profile.
// Nothing is ever hard-coded or sent anywhere except the Anthropic API.
export const client = new Anthropic({ maxRetries: 4 });
export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

type Effort = "low" | "medium" | "high";
type Content = string | Anthropic.Beta.BetaContentBlockParam[];

// If a safety classifier declines a request, the API retries it on its default fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/** Per-run context: where to record token usage, and a signal to abort in-flight calls. */
export interface RunCtx {
  usage?: Usage;
  signal?: AbortSignal;
  onUsage?: () => void;
}

const track = (ctx: RunCtx | undefined, res: Anthropic.Beta.BetaMessage) => {
  if (ctx?.usage) addUsage(ctx.usage, res.model, res.usage);
  ctx?.onUsage?.();
};

/** One structured call: returns data validated against `schema`, or throws. */
export async function ask<S extends z.ZodType>(opts: { system: string; content: Content; schema: S; effort?: Effort; maxTokens?: number; ctx?: RunCtx }): Promise<z.infer<S>> {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
    ...FALLBACK,
  }, { signal: opts.ctx?.signal });
  track(opts.ctx, res);
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (res.parsed_output == null) throw new Error(`Unparseable model output (stop_reason: ${res.stop_reason}).`);
  return res.parsed_output as z.infer<S>;
}

/** Free-text multi-turn chat, used for persona interviews. */
export async function chat(system: string, messages: Anthropic.Beta.BetaMessageParam[], ctx?: RunCtx): Promise<string> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages,
    output_config: { effort: "low" },
    ...FALLBACK,
  });
  track(ctx, res);
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}
