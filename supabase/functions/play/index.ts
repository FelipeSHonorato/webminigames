// Edge Function "play": serve a fase (com seed secreta), valida o tabuleiro e só então pontua.
// O navegador chama isto no lugar de new_run/submit_win. A escrita no banco usa a chave service_role;
// as funções open_phase/use_hint/finalize_win não têm EXECUTE para anon/authenticated.
//
// Deploy:  supabase functions deploy play
// Segredo: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   (URL e ANON_KEY são injetadas automaticamente)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicView, validate, hint, hasHints, snapshot, validateSnapshot, hintSnapshot, GAMES as BOARD_GAMES } from "./_shared/board.js";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const GAME_IDS = new Set(["arrows", "canos", "cruzadas", "patches", "sopa", "sudoku", "zip"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

/** Cenário diário compartilhado: gera uma única vez por (dia, jogo, nível, slot) e depois só lê o snapshot. */
async function scenarioBySeed(svc: any, game: string, day: string, level: number, slot: number, seed: number) {
  const key = { day, game_id: game, level, slot };
  const select = "public_view, full_puzzle";
  let { data, error } = await svc.from("daily_scenarios").select(select).match(key).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;

  const built = snapshot(game, seed, level);
  ({ error } = await svc.from("daily_scenarios").upsert({
    ...key, seed, gen: built.gen, public_view: built.publicView, full_puzzle: built.fullPuzzle,
  }, { onConflict: "day,game_id,level,slot", ignoreDuplicates: true }));
  if (error) throw new Error(error.message);

  ({ data, error } = await svc.from("daily_scenarios").select(select).match(key).single());
  if (error) throw new Error(error.message);
  return data;
}

const scenarioFor = (svc: any, game: string, run: any) =>
  scenarioBySeed(svc, game, run.day, Number(run.level), Number(run.slot), Number(run.seed));

/** Prepara o dia inteiro de um jogo: todos os níveis e slots, com a seed determinística do servidor.
    A Edge roda isto em segundo plano no primeiro acesso e o cron chama `daily_generate` à meia-noite. */
async function generateDayScenarios(svc: any, day: string, game: string, slots: number) {
  const levels = Number(BOARD_GAMES[game as keyof typeof BOARD_GAMES]?.LEVELS?.length ?? 4);
  let total = 0;
  for (let level = 0; level < levels; level++) {
    for (let slot = 1; slot <= slots; slot++) {
      const { data: seed, error } = await svc.rpc("daily_seed", { p_day: day, p_game: game, p_level: level, p_slot: slot });
      if (error) throw new Error(error.message);
      await scenarioBySeed(svc, game, day, level, slot, Number(seed));
      total++;
    }
  }
  return total;
}

async function scenarioSlots(svc: any) {
  const { data } = await svc.from("settings").select("value").eq("key", "coins_per_day").maybeSingle();
  const n = Number(data?.value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 2;
}

const spDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = body?.action, game = body?.game;

  const cronSecret = Deno.env.get("DAILY_CRON_KEY") ?? "";
  const cronKey = req.headers.get("x-daily-cron-key") ?? "";
  const isCron = action === "daily_generate" && Boolean(cronSecret) && cronKey === cronSecret;

  const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
  let uid = "";
  if (!isCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "not_authenticated" }, 401);
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);
    uid = user.id;
  }

  try {
    if (action === "daily_generate") {
      if (!isCron) return json({ error: "forbidden" }, 403);
      const day = typeof body?.day === "string" ? body.day : spDay();
      const slots = Number.isInteger(body?.slots) ? Math.min(10, Math.max(1, body.slots)) : await scenarioSlots(svc);
      let scenarios = 0;
      for (const id of GAME_IDS) scenarios += await generateDayScenarios(svc, day, id, slots);
      return json({ day, slots, games: GAME_IDS.size, scenarios });
    }

    if (!GAME_IDS.has(game)) return json({ error: "unknown_game" }, 400);
    if (action === "open") {
      const { data: level, error: le } = await svc.rpc("level_for", { p_uid: uid, p_game: game });
      if (le) return json({ error: le.message }, 400);
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const view = publicView(game, seed, Number(level));                 // sem await entre gerar e guardar (isolate)
      const { data, error } = await svc.rpc("open_phase", { p_uid: uid, p_game: game, p_seed: seed, p_puzzle: view });
      if (error) return json({ error: error.message }, error.message === "no_coins" ? 409 : 400);
      return json({ level: data.level, hints: data.hints, puzzle: data.puzzle, coins: data.coins });
    }

    if (action === "hint") {
      if (!hasHints(game)) return json({ error: "no_hints" }, 400);
      const { data: phase, error: pe } = await svc.from("phase_runs").select("seed, level, hints").eq("user_id", uid).eq("game_id", game).maybeSingle();
      if (pe) return json({ error: pe.message }, 400);
      if (!phase) return json({ error: "no_phase" }, 409);
      const h = hint(game, Number(phase.seed), phase.level, phase.hints, body?.state);
      if (!h) return json({ error: "no_hint" }, 409);
      const { data, error } = await svc.rpc("use_hint", { p_uid: uid, p_game: game });
      if (error) return json({ error: error.message }, 409);
      return json({ ...h, hints: data.hints });
    }

    if (action === "finish") {
      const { data: phase, error: pe } = await svc.from("phase_runs").select("seed, level, hints").eq("user_id", uid).eq("game_id", game).maybeSingle();
      if (pe) return json({ error: pe.message }, 400);
      if (!phase) return json({ error: "no_phase" }, 409);
      if (!validate(game, Number(phase.seed), phase.level, body?.state)) return json({ error: "invalid" }, 422);
      const { data, error } = await svc.rpc("finalize_win", { p_uid: uid, p_game: game, p_op: body?.op ?? null });
      if (error) return json({ error: error.message, retryable: error.message === "too_fast" }, error.message === "too_fast" ? 409 : 400);
      return json(data);
    }

    /* ---- Desafio diário: mesmo cenário do dia para todos (por nível); o tempo fica nos troféus. A seed do dia
       (derivada de dia/jogo/nível/slot no banco) também nunca vai ao cliente; só o puzzle público. ---- */
    if (action !== "daily_open" && action !== "daily_hint" && action !== "daily_finish") return json({ error: "unknown_action" }, 400);
    const slot = body?.slot;                                        // o limite real (tickets) é decidido no banco (daily_open)
    const day = typeof body?.day === "string" ? body.day : null;    // tickets atrasados mandam o dia original
    if (!Number.isInteger(slot) || slot < 1 || slot > 10) return json({ error: "bad_slot" }, 400);

    if (action === "daily_open") {
      const { data, error } = await svc.rpc("daily_open", { p_uid: uid, p_game: game, p_slot: slot, p_day: day });
      if (error) return json({ error: error.message }, error.message === "no_coins" ? 409 : 400);
      const scenario = await scenarioFor(svc, game, data);
      const job = generateDayScenarios(svc, data.day, game, Number(data.slots))
        .catch(e => console.error("[WebMiniGames] pré-geração do dia falhou:", e));
      const wait = (globalThis as any).EdgeRuntime?.waitUntil;
      if (wait) wait.call((globalThis as any).EdgeRuntime, job);
      return json({ day: data.day, level: data.level, slot: data.slot, slots: data.slots, startedAt: data.startedAt, puzzle: scenario.public_view, coins: data.coins, resumed: data.resumed });
    }

    if (action === "daily_hint") {
      if (!hasHints(game)) return json({ error: "no_hints" }, 400);
      const { data: run, error: re } = await svc.rpc("daily_run", { p_uid: uid, p_game: game, p_slot: slot, p_day: day });
      if (re) return json({ error: re.message }, 400);
      if (!run) return json({ error: "no_phase" }, 409);
      const scenario = await scenarioFor(svc, game, run);
      const h = hintSnapshot(game, scenario.full_puzzle, Number(run.level), run.hints, body?.state);
      if (!h) return json({ error: "no_hint" }, 409);
      const { data, error } = await svc.rpc("daily_hint", { p_uid: uid, p_game: game, p_slot: slot, p_day: day });
      if (error) return json({ error: error.message }, 409);
      return json({ ...h, hints: data.hints });
    }

    if (action === "daily_finish") {
      const { data: run, error: re } = await svc.rpc("daily_run", { p_uid: uid, p_game: game, p_slot: slot, p_day: day });
      if (re) return json({ error: re.message }, 400);
      if (!run) return json({ error: "no_phase" }, 409);
      const scenario = await scenarioFor(svc, game, run);
      if (!validateSnapshot(game, scenario.full_puzzle, body?.state)) return json({ error: "invalid" }, 422);
      const { data, error } = await svc.rpc("daily_finish", { p_uid: uid, p_game: game, p_slot: slot, p_op: body?.op ?? null, p_day: day });
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "server_error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
