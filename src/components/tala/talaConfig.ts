// ---------------------------------------------------------------------------
// TALA — central configuration.
//
// TALA is the site's AI concierge. Its brain runs on the Cloudflare
// TallaAgent Durable Object — the browser only ever calls
// ${VITE_TALA_WORKER_URL}/api/talla/chat through src/lib/talaClient.ts.
// Supabase stays the operational database / auth, not the conversational
// brain. Voice is fully in-browser and free: Kokoro-82M (open source) for
// speech out, Web Speech API for speech in.
// ---------------------------------------------------------------------------

/**
 * OpenRouter's hosted text-to-speech endpoint — same key/billing as the chat
 * brain, no separate provider account needed. Optional upgrade from the free
 * in-browser Kokoro voice: real hosted models (MiniMax, GPT-4o Mini TTS,
 * Voxtral, etc.) with no local model download, so no first-load speech lag.
 */
export const OPENROUTER_TTS_ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";

/**
 * Free model ids surfaced in Admin → TALA as the preferred-model picker.
 * Model selection is executed server-side by the Cloudflare TallaAgent.
 */
export const TALA_FREE_MODELS = [
  "openai/gpt-oss-20b",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "cohere/north-mini-code:free",
] as const;

/** localStorage keys (device-local preferences, never synced). */
export const TALA_STORAGE = {
  /** Dev-only OpenRouter key for building without the edge function deployed. */
  devApiKey: "tala.devOpenRouterKey",
  voiceEnabled: "tala.voiceEnabled",
  voiceId: "tala.voiceId",
} as const;

/**
 * Kokoro-82M voices (open source, Apache-2.0). All run in-browser via
 * kokoro-js — no API, no cost. Grades are Kokoro's own published quality
 * ratings (see node_modules/kokoro-js/README.md). `af_heart` is graded A,
 * the highest of any voice in the set, and is the default.
 */
export const TALA_KOKORO_VOICES = [
  // American female
  { id: "af_heart", label: "Heart — American female (grade A, default)", gender: "female", accent: "american" },
  { id: "af_bella", label: "Bella — American female (grade A-)", gender: "female", accent: "american" },
  { id: "af_nicole", label: "Nicole — American female (grade B-)", gender: "female", accent: "american" },
  { id: "af_kore", label: "Kore — American female (grade C+)", gender: "female", accent: "american" },
  { id: "af_sarah", label: "Sarah — American female (grade C+)", gender: "female", accent: "american" },
  { id: "af_aoede", label: "Aoede — American female (grade C+)", gender: "female", accent: "american" },
  { id: "af_alloy", label: "Alloy — American female (grade C)", gender: "female", accent: "american" },
  { id: "af_nova", label: "Nova — American female (grade C)", gender: "female", accent: "american" },
  { id: "af_sky", label: "Sky — American female (grade C-)", gender: "female", accent: "american" },
  { id: "af_jessica", label: "Jessica — American female (grade D)", gender: "female", accent: "american" },
  { id: "af_river", label: "River — American female (grade D)", gender: "female", accent: "american" },
  // British female
  { id: "bf_emma", label: "Emma — British female (grade B-)", gender: "female", accent: "british" },
  { id: "bf_isabella", label: "Isabella — British female (grade C)", gender: "female", accent: "british" },
  { id: "bf_alice", label: "Alice — British female (grade D)", gender: "female", accent: "british" },
  { id: "bf_lily", label: "Lily — British female (grade D)", gender: "female", accent: "british" },
  // American male
  { id: "am_fenrir", label: "Fenrir — American male (grade C+)", gender: "male", accent: "american" },
  { id: "am_michael", label: "Michael — American male (grade C+)", gender: "male", accent: "american" },
  { id: "am_puck", label: "Puck — American male (grade C+)", gender: "male", accent: "american" },
  // British male
  { id: "bm_fable", label: "Fable — British male (grade C)", gender: "male", accent: "british" },
  { id: "bm_george", label: "George — British male (grade C)", gender: "male", accent: "british" },
] as const;

export type TalaKokoroVoice = (typeof TALA_KOKORO_VOICES)[number];

export const TALA_DEFAULT_VOICE = "af_heart";

/** Hugging Face model id for the in-browser TTS engine. ~80 MB, cached after first load. */
export const TALA_KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Hard cap on conversation turns sent to the model (cost + context control). */
export const TALA_MAX_HISTORY = 16;

export interface TalaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
