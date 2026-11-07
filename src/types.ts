export type Stance = "yes" | "maybe" | "no";
export type StanceCount = Record<Stance, number>;
export type Stage = "queued" | "brief" | "personas" | "simulating" | "report" | "done" | "error";

export interface Segment {
  name: string;
  description: string;
  share: number;
}

export interface Brief {
  title: string;
  summary: string;
  pricing: string;
  targetCustomers: string;
  segments: Segment[];
}

export interface Persona {
  id: string;
  name: string;
  age: number;
  occupation: string;
  location: string;
  segment: string;
  bio: string;
  personality: string;
  values: string[];
  budget: "tight" | "moderate" | "comfortable";
  stance: Stance;
  initialStance: Stance;
  sentiment: number;
  /** Private notes the persona accumulates between rounds. */
  memory: string[];
}

export interface Post {
  id: string;
  round: number;
  authorId: string; // "founder" for the launch post
  replyTo: string | null;
  content: string;
  sentiment: number;
  likes: string[];
}

export interface Report {
  verdict: string;
  intentScore: number;
  summary: string;
  segments: { name: string; reaction: string; buyRate: number }[];
  objections: { point: string; frequency: "many" | "some" | "few"; quote: string }[];
  praise: { point: string; frequency: "many" | "some" | "few"; quote: string }[];
  holes: string[];
  recommendations: string[];
  mindChanges: { name: string; from: Stance; to: Stance; why: string }[];
}

export interface SimInput {
  idea: string;
  audience: string;
  personaCount: number;
  rounds: number;
  deck?: { name: string; data: string } | null; // base64 PDF
}

export interface Simulation {
  id: string;
  createdAt: string;
  stage: Stage;
  round: number;
  input: Omit<SimInput, "deck"> & { deckName: string | null };
  brief: Brief | null;
  personas: Persona[];
  posts: Post[];
  history: ({ round: number } & StanceCount)[];
  report: Report | null;
  error: string | null;
}

export type SimEvent =
  | { type: "stage"; stage: Stage; round: number }
  | { type: "brief"; brief: Brief }
  | { type: "personas"; personas: Persona[] }
  | { type: "post"; post: Post }
  | { type: "like"; postId: string; personaId: string }
  | { type: "persona"; persona: Persona }
  | { type: "history"; history: Simulation["history"] }
  | { type: "report"; report: Report }
  | { type: "error"; error: string };
