import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = path => readFileSync(new URL(path, import.meta.url), "utf8");
const color = (text, name) => {
  const m = text.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\\b`, "i"));
  assert.ok(m, `token --${name} ausente`);
  return m[1].length === 4 ? `#${[...m[1].slice(1)].map(c => c + c).join("")}` : m[1];
};
const luminance = hex => {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + .05) / (y + .05);
};

test("tema claro do site: texto sobre o accent passa em AA", () => {
  const root = css("../css/site.css");
  const ratio = contrast(color(root, "accent"), color(root, "accent-fg"));
  assert.ok(ratio >= 4.5, `contraste ${ratio.toFixed(2)}:1`);
});

for (const game of ["arrows", "canos", "cruzadas", "patches", "queens", "sopa", "sudoku", "tango", "zip"]) {
  test(`tema claro de ${game}: accent e caminho legíveis sobre o fundo`, () => {
    const style = css(`../games/${game}/style.css`);
    const bg = color(style, "bg");
    assert.ok(contrast(color(style, "accent"), "#ffffff") >= 4.5, "accent com texto branco");
    assert.ok(contrast(color(style, "accent"), bg) >= 4.5, "accent sobre o fundo");
    if (game === "zip") assert.ok(contrast(color(style, "path"), bg) >= 4.5, "caminho sobre o fundo");
  });
}
