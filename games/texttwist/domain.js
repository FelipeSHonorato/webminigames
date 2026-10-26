/* Regras e gerador do Text Twist: código puro, sem DOM (testável no Node e reutilizado pela Edge Function).

   Regras: o jogador recebe N letras e forma palavras de 3 a N letras usando só essas letras (cada uma
   no máximo tantas vezes quanto aparece). A fase termina quando ele encontra uma palavra que usa
   TODAS as letras — o "twist". Palavras repetidas ou fora do dicionário não contam.

   O dicionário (words.js) é o mesmo no navegador e no servidor, então a validação é a mesma nos dois:
   `isSolved` recebe a lista de palavras enviada e confere cada uma (`isValidWord`) e a condição de vitória. */

import { WORDS, normalize } from "./words.js";

export const LEVELS = [
  { name: "Fácil",   n: 6, seconds: 120, minWords: 8 },
  { name: "Médio",   n: 7, seconds: 150, minWords: 8 },
  { name: "Difícil", n: 8, seconds: 180, minWords: 9 },
  { name: "Genius",  n: 9, seconds: 210, minWords: 10 },
];

/** Versão do gerador: gravada na fase salva. AUMENTE ao mudar o sorteio ou o dicionário. */
export const GEN = 2;
export const STORE_KEY = "texttwist.wins";
export const MIN_WORD = 3;

const KNOWN = new Map(WORDS.map(w => [w.norm, w.text]));
const bagOf = s => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1); return m; };
const fitsIn = (s, bag) => {
  const m = new Map(bag);
  for (const ch of s) { const c = m.get(ch) ?? 0; if (!c) return false; m.set(ch, c - 1); }
  return true;
};
const shuffle = (rng, arr) => {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};

/** Forma de exibição (com acento) de uma palavra normalizada. */
export const displayOf = norm => KNOWN.get(norm) ?? norm;

/** Todas as palavras que dá para formar com essas letras (inclui a de N letras). */
export function wordsFrom(letters) {
  const bag = bagOf(letters.join(""));
  return WORDS
    .filter(w => w.norm.length >= MIN_WORD && w.norm.length <= letters.length && fitsIn(w.norm, bag))
    .map(w => w.norm);
}

/** A palavra enviada vale? (está no dicionário, cabe no tamanho e usa só as letras disponíveis) */
export function isValidWord(puzzle, word) {
  const norm = normalize(String(word ?? ""));
  if (norm.length < MIN_WORD || norm.length > puzzle.n) return false;
  if (!KNOWN.has(norm)) return false;
  return fitsIn(norm, bagOf(puzzle.letters.join("")));
}

/** Lista sem palavras repetidas (comparação pela forma normalizada), preservando a primeira grafia. */
export function uniqueWords(words) {
  if (!Array.isArray(words)) return [];
  const seen = new Set(), out = [];
  for (const word of words) {
    const norm = normalize(String(word ?? ""));
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(word);
  }
  return out;
}

/** Todas as palavras da lista valem? (sem exigir a que usa todas as letras — é o fim de rodada por tempo) */
export function isValidList(puzzle, words) {
  const unique = uniqueWords(words);
  if (!unique.length) return false;
  for (const w of unique) if (!isValidWord(puzzle, w)) return false;
  return true;
}

/** Vitória: a lista é válida e inclui alguma palavra que usa TODAS as letras. */
export function isSolved(puzzle, words) {
  if (!isValidList(puzzle, words)) return false;
  return words.some(w => normalize(w).length === puzzle.n);
}

/** Fase nova: letras sorteadas de uma palavra que renda pelo menos `minWords` palavras. */
export function generatePuzzle(rng, level) {
  const n = level.n;
  const pool = shuffle(rng, WORDS.filter(w => w.norm.length === n).map(w => w.norm));
  let best = null;
  for (const key of pool.slice(0, 400)) {
    const words = wordsFrom([...key]);
    if (!best || words.length > best.words.length) best = { key, words };
    if (words.length >= level.minWords) return { n, letters: shuffle(rng, [...key]), words };
  }
  return { n, letters: shuffle(rng, [...best.key]), words: best.words };
}
