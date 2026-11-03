// Edge Function "play": serve a fase (com seed secreta), valida o tabuleiro e só então pontua.
// O navegador chama isto no lugar de new_run/submit_win. A escrita no banco usa a chave service_role;
// as funções open_phase/use_hint/finalize_win não têm EXECUTE para anon/authenticated.
//
// Deploy:  supabase functions deploy play
// Segredo: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   (URL e ANON_KEY são injetadas automaticamente)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicView, validate, hint, hasHints, snapshot, validateSnapshot, validatePartial, countWords, hintSnapshot, duelOf, GAMES as BOARD_GAMES, SOLO_GAMES } from "./_shared/board.js";
import { canMate, findMove, fromFen, newGame, playMove, positionKey, squareName, toFen } from "./_shared/chess/domain.js";
import { findMove as findDamaMove, fromPosition, newGame as newDamaGame, playMove as playDamaMove, positionKey as damaPositionKey, toPosition } from "./_shared/dama/domain.js";
import { autoRoll as autoRollGamao, findMove as findGamaoMove, newGame as newGamaoGame, playMove as playGamaoMove, positionKey as gamaoPositionKey, revive as reviveGamao, rollOpening as rollGamaoOpening, serialize as serializeGamao } from "./_shared/gamao/domain.js";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* A lista de jogos SOLO sai do próprio board: um jogo novo em `_shared/` passa a ser aceito sem editar aqui.
   (Uma lista fixa já esqueceu Queens, Tango e Text Twist e a Edge respondia `unknown_game` para eles.)
   O xadrez fica de fora: ele não tem fase nem desafio diário, só duelo. */
const GAME_IDS = new Set(Object.keys(SOLO_GAMES));
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

/* ====================================================================================================
   Duelos 1×1
   ----------------------------------------------------------------------------------------------------
   Só entram aqui jogos que declaram `DUEL = { rule, maxSeconds, progressOf }` no domínio (jogos
   criados PARA o modo duelo — nenhum jogo antigo é convertido). A Edge é a autoridade:
     * gera o cenário com seed secreta e guarda public_view/full_puzzle no Postgres;
     * valida o tabuleiro antes de chamar duel_finish (o cliente nunca decide vitória);
     * quem decide o vencedor é o Postgres (duel_finish/duel_settle), não a Edge.
   ==================================================================================================== */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const isDuelCode = (v: unknown) => typeof v === "string" && CODE_RE.test(v.trim().toUpperCase());

/** Erros de duelo viram 4xx com significado (o cliente mostra a mensagem certa). */
const duelStatus = (msg: string) =>
  msg === "not_member" || msg === "not_creator" ? 403
    : msg === "duel_not_found" ? 404
      : msg === "too_many_open" || msg === "duel_full" || msg === "bad_status"
        || msg === "expired" || msg === "not_started" || msg === "not_your_turn"
        || msg === "stale" || msg === "closed_room" || msg === "opponent_away" ? 409
        : msg === "invalid_move" ? 422
        : 400;

const duelRow = async (svc: any, id: string) => {
  const { data, error } = await svc.from("duels")
    .select("id, game_id, level, rule, max_seconds, full_puzzle, status")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

/** Linha do xadrez (estado + relógios). O relógio e o vencedor continuam no Postgres. */
const chessRow = async (svc: any, id: string) => {
  const { data, error } = await svc.from("chess_games")
    .select("duel_id, fen, turn, version, keys, moves, last_move, white_id, black_id, white_ms, black_ms, last_at, result, reason, white_can_mate, black_can_mate")
    .eq("duel_id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

/** Linha da dama (estado + relógios). O relógio e o vencedor continuam no Postgres. */
const damaRow = async (svc: any, id: string) => {
  const { data, error } = await svc.from("dama_games")
    .select("duel_id, position, turn, version, keys, moves, last_move, white_id, black_id, white_ms, black_ms, last_at, result, reason")
    .eq("duel_id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

/** Linha do gamão (estado + relógios). O relógio e o vencedor continuam no Postgres. */
const gamaoRow = async (svc: any, id: string) => {
  const { data, error } = await svc.from("gamao_games")
    .select("duel_id, state, turn, version, keys, moves, last_move, white_id, black_id, white_ms, black_ms, last_at, result, reason")
    .eq("duel_id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

/** Número em [0,1) com a mesma fonte criptográfica dos outros sorteios da Edge (dados do gamão). */
const randomUnit = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

const duelMeta = async (svc: any, id: string) => {
  const { data, error } = await svc.from("duels")
    .select("id, code, game_id, kind, status, starts_at, max_seconds, winner_id")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

/** Presença na sala de espera: o Postgres carimba `last_seen_at` do jogador (só com a sala `waiting`).
    O criador usa isso para não aceitar um desafiante que já fechou a página. Falhar aqui nunca derruba a consulta. */
const touchPresence = async (svc: any, uid: string, duelId: string) => {
  try { await svc.rpc("duel_touch", { p_uid: uid, p_duel: duelId }); } catch { /* presença é só um aviso */ }
};

const DUEL_ACTIONS = new Set([
  "duel_create", "duel_join", "duel_join_open", "duel_ready", "duel_start", "duel_state", "duel_finish", "duel_leave", "duel_list",
  "duel_invites", "duel_decline", "duel_mine",
  "chess_create", "chess_start", "chess_state", "chess_move", "chess_resign",
  "dama_create", "dama_start", "dama_state", "dama_move", "dama_resign",
  "gamao_create", "gamao_start", "gamao_state", "gamao_move", "gamao_resign",
]);

async function handleDuel(svc: any, uid: string, action: string, body: any) {
  if (!DUEL_ACTIONS.has(action)) return json({ error: "unknown_action" }, 400);

  /* Criar sala de xadrez: ritmo e cor vêm do cliente, mas o servidor valida contra o contrato DUEL.
     O estado inicial (FEN + chave de repetição) vem do MESMO domínio testado no Node. */
  if (action === "chess_create") {
    const duel = duelOf("chess");
    if (!duel || duel.kind !== "turn") return json({ error: "not_duel_game" }, 400);
    const minutes = Number(body?.minutes);
    if (!duel.times.includes(minutes)) return json({ error: "bad_minutes" }, 400);
    const color = body?.color;
    if (color !== "w" && color !== "b") return json({ error: "bad_color" }, 400);
    const open = body?.open !== false;                       // sala aberta por padrão (entra pela lista)

    const start = newGame();
    const { data, error } = await svc.rpc("chess_create", {
      p_uid: uid, p_minutes: minutes, p_color: color,
      p_fen: toFen(start.state), p_key: start.keys[0], p_open: open,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Criar sala de dama: mesmo contrato de turnos do xadrez, com o estado inicial do domínio. */
  if (action === "dama_create") {
    const duel = duelOf("dama");
    if (!duel || duel.kind !== "turn") return json({ error: "not_duel_game" }, 400);
    const minutes = Number(body?.minutes);
    if (!duel.times.includes(minutes)) return json({ error: "bad_minutes" }, 400);
    const color = body?.color;
    if (color !== "w" && color !== "b") return json({ error: "bad_color" }, 400);
    const open = body?.open !== false;                       // sala aberta por padrão (entra pela lista)

    const start = newDamaGame();   // NÃO use `newGame`: esse nome é o do XADREZ (import acima) e gravaria um tabuleiro de xadrez
    const { data, error } = await svc.rpc("dama_create", {
      p_uid: uid, p_minutes: minutes, p_color: color,
      p_position: toPosition(start.state), p_key: start.keys[0], p_open: open,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Criar sala de gamão: mesmo contrato de turnos, com a abertura sorteada no servidor. */
  if (action === "gamao_create") {
    const duel = duelOf("gamao");
    if (!duel || duel.kind !== "turn") return json({ error: "not_duel_game" }, 400);
    const minutes = Number(body?.minutes);
    if (!duel.times.includes(minutes)) return json({ error: "bad_minutes" }, 400);
    const color = body?.color;
    if (color !== "w" && color !== "b") return json({ error: "bad_color" }, 400);
    const open = body?.open !== false;                       // sala aberta por padrão (entra pela lista)

    const start = newGamaoGame(rollGamaoOpening(randomUnit));
    const { data, error } = await svc.rpc("gamao_create", {
      p_uid: uid, p_minutes: minutes, p_color: color,
      p_state: serializeGamao(start.state), p_key: start.keys[0], p_open: open,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Criar sala de corrida: o jogo precisa declarar DUEL de corrida; seed e regra vêm do servidor. */
  if (action === "duel_create") {
    const game = body?.game;
    const duel = duelOf(game);
    if (!duel) return json({ error: "not_duel_game" }, 400);
    if (duel.kind === "turn") return json({ error: "use_chess_create" }, 400);

    const levels = Number((BOARD_GAMES as any)[game]?.LEVELS?.length ?? 0);
    const level = Number.isInteger(body?.level) ? body.level : 0;
    if (level < 0 || level >= levels) return json({ error: "bad_level" }, 400);

    const maxSeconds = Math.min(3600, Math.max(30, Number(duel.maxSeconds) || 300));
    const rule = duel.rule;                                  // 'first' | 'words' — validado no board
    const open = body?.open !== false;                       // sala aberta por padrão (entra pela lista)
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const built = snapshot(game, seed, level);               // sem await entre gerar e guardar (isolate)
    const { data, error } = await svc.rpc("duel_create", {
      p_uid: uid, p_game: game, p_level: level, p_seed: seed, p_gen: built.gen,
      p_public: built.publicView, p_full: built.fullPuzzle, p_rule: rule, p_max_seconds: maxSeconds,
      p_open: open,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json({ ...data, gameId: game, rule });
  }

  /* Entrar por código: o cliente pode não saber o jogo ainda, então não exige `game`. */
  if (action === "duel_join") {
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!isDuelCode(code)) return json({ error: "bad_code" }, 400);
    const { data, error } = await svc.rpc("duel_join", { p_uid: uid, p_code: code });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Salas abertas (esperando desafiante), de todos os jogos de duelo. Só devolve o que a lista precisa:
     nada de código de convite, seed nem puzzle (a tabela continua fechada ao navegador). */
  if (action === "duel_list") {
    const { data, error } = await svc.rpc("duel_open_rooms", { p_uid: uid, p_limit: 30 });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json({ rooms: data ?? [] });
  }

  /* Entrar pelo id da sala aberta: o jogador clicou no card da lista, sem digitar código. */
  if (action === "duel_join_open") {
    const room = body?.duel;
    if (!isUuid(room)) return json({ error: "bad_duel" }, 400);
    const { data, error } = await svc.rpc("duel_join_open", { p_uid: uid, p_duel: room });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Salas MINHAS com desafiante esperando: o site inteiro usa isto para avisar o criador.
     Só o criador consulta, então pode vir com o código do convite. */
  if (action === "duel_invites") {
    const { data, error } = await svc.rpc("duel_invites", { p_uid: uid });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json({ invites: data ?? [] });
  }

  /* Duelo ativo do usuário num jogo (sala esperando ou partida em andamento): a página do jogo retoma
     a sala em vez de oferecer "criar sala" de novo. */
  if (action === "duel_mine") {
    const game = typeof body?.game === "string" ? body.game : "";
    if (!/^[a-z0-9_-]{1,32}$/.test(game)) return json({ error: "bad_game" }, 400);
    const { data, error } = await svc.rpc("duel_mine", { p_uid: uid, p_game: game });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data ?? { duel: null });
  }

  const duelId = body?.duel;
  if (!isUuid(duelId)) return json({ error: "bad_duel" }, 400);

  /* Estado / largada / desistência do xadrez: o Postgres é a autoridade dos relógios e do resultado. */
  if (action === "chess_state" || action === "chess_start" || action === "chess_resign") {
    const { data, error } = await svc.rpc(action, { p_uid: uid, p_duel: duelId });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    if (action === "chess_state" && data?.status === "waiting") await touchPresence(svc, uid, duelId);
    return json(data);
  }

  /* Lance: a Edge valida com o domínio puro; o Postgres confere a vez, o relógio e a versão antes de gravar. */
  if (action === "chess_move") {
    const meta = await duelMeta(svc, duelId);
    if (!meta) return json({ error: "duel_not_found" }, 404);
    if (meta.kind !== "turn" || meta.game_id !== "chess") return json({ error: "not_chess_duel" }, 400);
    if (meta.status !== "running") return json({ error: "bad_status" }, 409);

    const row = await chessRow(svc, duelId);
    if (!row) return json({ error: "duel_not_found" }, 404);

    const state = fromFen(row.fen);
    const move = findMove(state, body?.move);
    if (!move) return json({ error: "invalid_move" }, 422);

    const game = {
      state,
      keys: Array.isArray(row.keys) && row.keys.length ? row.keys : [positionKey(state)],
      moves: Array.isArray(row.moves) ? row.moves : [],
      last: row.last_move ?? null,
      result: { over: false, winner: null, reason: null },
    };
    const next = playMove(game, move);
    const result = next.result.over ? next.result : null;
    const resultText = result ? (result.winner === "w" ? "white" : result.winner === "b" ? "black" : "draw") : null;
    const played = next.moves.at(-1);
    const last = next.last ? {
      from: squareName(next.last.from), to: squareName(next.last.to),
      uci: played.uci, san: played.san,
    } : null;

    const { data, error } = await svc.rpc("chess_move", {
      p_uid: uid, p_duel: duelId, p_version: row.version,
      p_fen: toFen(next.state), p_turn: next.state.turn,
      p_keys: next.keys, p_moves: next.moves, p_last: last,
      p_result: resultText, p_reason: result?.reason ?? null,
      p_white_can_mate: canMate(next.state.board, "w"),
      p_black_can_mate: canMate(next.state.board, "b"),
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Estado / largada / desistência da dama: o Postgres é a autoridade dos relógios e do resultado. */
  if (action === "dama_state" || action === "dama_start" || action === "dama_resign") {
    const { data, error } = await svc.rpc(action, { p_uid: uid, p_duel: duelId });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    if (action === "dama_state" && data?.status === "waiting") await touchPresence(svc, uid, duelId);
    return json(data);
  }

  /* Lance da dama: a Edge valida com o domínio puro; o Postgres confere vez, relógio e versão. */
  if (action === "dama_move") {
    const meta = await duelMeta(svc, duelId);
    if (!meta) return json({ error: "duel_not_found" }, 404);
    if (meta.kind !== "turn" || meta.game_id !== "dama") return json({ error: "not_dama_duel" }, 400);
    if (meta.status !== "running") return json({ error: "bad_status" }, 409);

    const row = await damaRow(svc, duelId);
    if (!row) return json({ error: "duel_not_found" }, 404);

    const state = fromPosition(row.position, row.turn);
    const move = findDamaMove(state, body?.move);
    if (!move) return json({ error: "invalid_move" }, 422);

    const game = {
      state,
      keys: Array.isArray(row.keys) && row.keys.length ? row.keys : [damaPositionKey(state)],
      moves: Array.isArray(row.moves) ? row.moves : [],
      last: row.last_move ?? null,
      result: { over: false, winner: null, reason: null },
    };
    const next = playDamaMove(game, move);
    const result = next.result.over ? next.result : null;
    const resultText = result ? (result.winner === "w" ? "white" : result.winner === "b" ? "black" : "draw") : null;

    const { data, error } = await svc.rpc("dama_move", {
      p_uid: uid, p_duel: duelId, p_version: row.version,
      p_position: toPosition(next.state), p_turn: next.state.turn,
      p_keys: next.keys, p_moves: next.moves, p_last: next.last,
      p_result: resultText, p_reason: result?.reason ?? null,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  /* Estado / largada / desistência do gamão: o Postgres é a autoridade dos relógios e do resultado. */
  if (action === "gamao_state" || action === "gamao_start" || action === "gamao_resign") {
    const { data, error } = await svc.rpc(action, { p_uid: uid, p_duel: duelId });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    if (action === "gamao_state" && data?.status === "waiting") await touchPresence(svc, uid, duelId);
    return json(data);
  }

  /* Lance do gamão: a Edge valida com o domínio puro e já rola os dados do próximo jogador.
     O Postgres confere vez, relógio e versão antes de gravar. */
  if (action === "gamao_move") {
    const meta = await duelMeta(svc, duelId);
    if (!meta) return json({ error: "duel_not_found" }, 404);
    if (meta.kind !== "turn" || meta.game_id !== "gamao") return json({ error: "not_gamao_duel" }, 400);
    if (meta.status !== "running") return json({ error: "bad_status" }, 409);

    const row = await gamaoRow(svc, duelId);
    if (!row) return json({ error: "duel_not_found" }, 404);

    const state = reviveGamao(row.state);
    const move = findGamaoMove(state, body?.move);
    if (!move) return json({ error: "invalid_move" }, 422);

    const game = {
      state,
      keys: Array.isArray(row.keys) && row.keys.length ? row.keys : [gamaoPositionKey(state)],
      moves: Array.isArray(row.moves) ? row.moves : [],
      last: row.last_move ?? null,
      result: { over: false, winner: null, reason: null },
    };
    const next = playGamaoMove(game, move);
    const result = next.result.over ? next.result : null;
    const resultText = result ? (result.winner === "w" ? "white" : "black") : null;

    const after = result ? next.state : autoRollGamao(next.state, randomUnit);
    const keys = [...next.keys, gamaoPositionKey(after)];

    const { data, error } = await svc.rpc("gamao_move", {
      p_uid: uid, p_duel: duelId, p_version: row.version,
      p_state: serializeGamao(after), p_turn: after.turn,
      p_keys: keys, p_moves: next.moves, p_last: next.last,
      p_result: resultText, p_reason: result?.reason ?? null,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  if (action === "duel_ready" || action === "duel_start" || action === "duel_state" || action === "duel_leave"
      || action === "duel_decline") {
    const { data, error } = await svc.rpc(action, { p_uid: uid, p_duel: duelId });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    if (action === "duel_state" && data?.status === "waiting") await touchPresence(svc, uid, duelId);
    return json(data);
  }

  /* Finalizar: valida o tabuleiro contra o full_puzzle guardado antes de avisar o Postgres. */
  if (action === "duel_finish") {
    const row = await duelRow(svc, duelId);
    if (!row) return json({ error: "duel_not_found" }, 404);
    if (!duelOf(row.game_id)) return json({ error: "not_duel_game" }, 400);

    const state = body?.state;
    const won = validateSnapshot(row.game_id, row.full_puzzle, state);
    /* Na regra 'words' o fim de rodada sem a jogada-chave (timeout) também vale — só não é vitória. */
    if (!won && !(row.rule === "words" && validatePartial(row.game_id, row.full_puzzle, state))) {
      return json({ error: "invalid" }, 422);
    }

    const { data, error } = await svc.rpc("duel_finish", {
      p_uid: uid, p_duel: duelId, p_op: body?.op ?? null,
      p_words: row.rule === "words" ? countWords(row.game_id, state) : null,
    });
    if (error) return json({ error: error.message }, duelStatus(error.message));
    return json(data);
  }

  return json({ error: "unknown_action" }, 400);
}

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

    /* As ações de turnos começam com `chess_`/`dama_`/`gamao_`: sem isto elas caíam na checagem de jogo solo e voltavam `unknown_game`. */
    if (typeof action === "string" && (action.startsWith("duel_") || action.startsWith("chess_") || action.startsWith("dama_") || action.startsWith("gamao_"))) {
      return await handleDuel(svc, uid, action, body);
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
    if (action !== "daily_open" && action !== "daily_start" && action !== "daily_hint" && action !== "daily_finish") return json({ error: "unknown_action" }, 400);
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
      return json({ day: data.day, level: data.level, slot: data.slot, slots: data.slots, startedAt: data.startedAt, started: data.started, puzzle: scenario.public_view, coins: data.coins, resumed: data.resumed });
    }

    /* Primeiro movimento do cenário: começa o relógio do servidor (Text Twist só conta a partir daqui). */
    if (action === "daily_start") {
      const { data, error } = await svc.rpc("daily_start", { p_uid: uid, p_game: game, p_slot: slot, p_day: day });
      if (error) return json({ error: error.message }, error.message === "no_phase" ? 409 : 400);
      return json(data);
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
      /* Vitória = tabuleiro que cumpre a regra do jogo. Fim de rodada por tempo (Text Twist) também
         termina o cenário: a lista só precisa ser válida — e isso não pontua (p_won = false). */
      const won = validateSnapshot(game, scenario.full_puzzle, body?.state);
      if (!won && !validatePartial(game, scenario.full_puzzle, body?.state)) return json({ error: "invalid" }, 422);
      const words = countWords(game, body?.state);
      const { data, error } = await svc.rpc("daily_finish", {
        p_uid: uid, p_game: game, p_slot: slot, p_op: body?.op ?? null, p_day: day, p_words: words, p_won: won,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ...data, won });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "server_error", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
