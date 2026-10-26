/* Testes do domínio do Text Twist: geração, validação de palavra e vitória pela palavra que usa tudo. */
import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS, generatePuzzle, isValidWord, isSolved, wordsFrom, displayOf, uniqueWords, MIN_WORD, GEN, STORE_KEY } from "../games/texttwist/domain.js";
import { WORDS } from "../games/texttwist/words.js";
import { makeRng } from "../shared/rng.js";

const SEEDS = [1234, 98765, 4242, 777];

test("dicionário: só letras de 3 a 9, sem repetidas", () => {
  assert.equal(WORDS.length, 3000, `dicionário com ${WORDS.length} palavras`);
  const seen = new Set();
  for (const w of WORDS) {
    assert.match(w.norm, /^[A-Z]{3,9}$/, `${w.text} fora do padrão`);
    assert.ok(!seen.has(w.norm), `${w.norm} repetida`);
    seen.add(w.norm);
    assert.equal(w.norm, w.text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase(), `${w.text} normaliza errado`);
  }
  assert.equal(STORE_KEY, "texttwist.wins");
  assert.ok(GEN >= 1);
  assert.deepEqual(LEVELS.map(l => l.n), [6, 7, 8, 9]);
});

test("dicionário: sem nomes próprios, siglas e estrangeirismos óbvios", () => {
  const norms = new Set(WORDS.map(w => w.norm));
  const proibidas = [
    "PAULO", "MARIA", "CRISTO", "LONDRES", "FLAMENGO", "GREMIO", "PALIO", "FUSCA",
    "SIENA", "MARTE", "ATLANTICO", "COREIA", "AMORIM", "ABREU", "VIEIRA",
    "MARKETING", "SOFTWARE", "BLOG", "LOGIN", "PRA", "PRO", "DUM", "MAGAZINE",
    "MASTER", "SINGLE", "FOX", "ABC", "SIC", "CHAT", "CHIP", "CORE", "MISS", "COLOR",
    "AIDS", "BIT", "PRÉ", "PÓS", "AUTO", "VICE", "OUT", "TOP", "FACE", "MIN", "SET",
    "POP", "BIG", "BOX", "QUI", "CIA", "SUS", "SPA", "JEANS", "RESORT", "ALUGUER",
    "FACTO", "EQUIPA", "REGISTO", "GOLO", "SECTOR", "PAN", "PER", "BIO", "NEO", "TEC",
    "MAX", "SUB", "MANILA",
  ];
  for (const bad of proibidas) assert.ok(!norms.has(bad), `${bad} não deveria estar no dicionário`);
});

test("dicionário: cobertura suficiente para todos os níveis", () => {
  const porTamanho = {};
  for (const w of WORDS) porTamanho[w.norm.length] = (porTamanho[w.norm.length] || 0) + 1;
  for (const n of [6, 7, 8, 9]) assert.ok(porTamanho[n] >= 300, `poucas palavras de ${n} letras: ${porTamanho[n]}`);
});

test("cada nível gera fase com letras da palavra e palavras suficientes", () => {
  for (const [i, level] of LEVELS.entries()) {
    const p = generatePuzzle(makeRng(SEEDS[i]), level);
    assert.equal(p.letters.length, level.n);
    assert.match(p.letters.join(""), /^[A-Z]+$/);
    assert.ok(p.words.length >= level.minWords, `${level.name}: só ${p.words.length} palavras`);
    /* toda palavra listada é formável com as letras e está no dicionário */
    for (const w of p.words) assert.ok(isValidWord(p, w), `${w} não vale em ${level.name}`);
    /* existe pelo menos uma palavra que usa todas as letras */
    assert.ok(p.words.some(w => w.length === level.n), `${level.name}: sem palavra de ${level.n} letras`);
    assert.ok(isSolved(p, p.words.slice(0, 1).concat(p.words.filter(w => w.length === level.n))), `${level.name}: a chave não vence`);
  }
});

test("gerador: todos os níveis têm fases suficientes em várias seeds", () => {
  for (const level of LEVELS) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const p = generatePuzzle(makeRng(seed), level);
      assert.ok(p.words.length >= level.minWords, `${level.name} seed ${seed}: só ${p.words.length} palavras`);
      assert.ok(p.words.some(w => w.length === level.n), `${level.name} seed ${seed}: sem palavra de ${level.n} letras`);
    }
  }
});

test("a mesma seed devolve a mesma fase (determinismo)", () => {
  const a = generatePuzzle(makeRng(2024), LEVELS[0]);
  const b = generatePuzzle(makeRng(2024), LEVELS[0]);
  assert.deepEqual(a, b);
});

test("isValidWord recusa palavra curta, fora do dicionário e com letra que não existe", () => {
  const p = generatePuzzle(makeRng(99), LEVELS[0]);
  const key = p.words.find(w => w.length === p.n);
  assert.ok(isValidWord(p, key));
  assert.ok(isValidWord(p, key.toLowerCase()), "aceita minúscula");
  assert.ok(!isValidWord(p, "A"), "curta demais");
  assert.ok(!isValidWord(p, "ZZZZZZ"), "fora do dicionário/letras");
  assert.ok(!isValidWord(p, "QWERTYUI"), "não cabe nas letras");
  assert.ok(!isValidWord(p, ""), "vazia");
});

test("isSolved exige a palavra que usa todas as letras", () => {
  const p = generatePuzzle(makeRng(7), LEVELS[1]);
  const short = p.words.filter(w => w.length < p.n);
  const key = p.words.find(w => w.length === p.n);
  assert.ok(short.length > 0);
  assert.ok(!isSolved(p, []), "lista vazia");
  assert.ok(!isSolved(p, short), "só palavras curtas não vencem");
  assert.ok(isSolved(p, [key]), "a chave sozinha vence");
  assert.ok(isSolved(p, [...short, key]), "com outras palavras também");
  assert.ok(!isSolved(p, [key, "ZZZZZZ"]), "palavra inválida derruba a lista");
  assert.ok(isSolved(p, [key, key]), "repetida ainda vence (é a mesma palavra)");
});

test("uniqueWords remove repetidas pela forma normalizada", () => {
  assert.deepEqual(uniqueWords(["casa", "CASA", "Coração", "CORACAO", "sol"]), ["casa", "Coração", "sol"]);
  assert.deepEqual(uniqueWords([]), []);
  assert.deepEqual(uniqueWords(null), []);
  assert.deepEqual(uniqueWords(["casa", null, "casa"]), ["casa", null]);
});

test("wordsFrom devolve exatamente as palavras formáveis com as letras", () => {
  const p = generatePuzzle(makeRng(31), LEVELS[0]);
  const words = wordsFrom([...p.letters]);
  assert.deepEqual(new Set(words), new Set(p.words));
  for (const w of words) assert.ok(w.length <= p.n && w.length >= MIN_WORD);
  assert.equal(displayOf(p.words[0]).length, p.words[0].length);
});
