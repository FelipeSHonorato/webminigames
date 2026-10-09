import { COINS_PER_DAY } from "./coins.js";

const COIN = `<svg class="coin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.2" fill="#f2b134" stroke="#b9770e" stroke-width="1.6"/><circle cx="12" cy="12" r="7.4" fill="none" stroke="#b9770e" stroke-opacity=".55" stroke-width="1.2"/><polygon points="12.00,7.30 13.18,10.38 16.47,10.55 13.90,12.62 14.76,15.80 12.00,14.00 9.24,15.80 10.10,12.62 7.53,10.55 10.82,10.38" fill="#b9770e" fill-opacity=".85"/><path d="M6.4 8.2A7 7 0 0 1 10 5.6" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** "5h 12min" / "42min" */
export function fmtDuration(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, "0")}min` : `${min}min`;
}

/** Ícone do coin seguido da quantidade: [moeda] x 2 */
export function coinBadge({ coins, max = COINS_PER_DAY, nextRefillAt }) {
  const badge = document.createElement("span");
  badge.className = "coins" + (coins ? "" : " empty");
  badge.insertAdjacentHTML("beforeend", COIN);        // ícone estático
  const n = document.createElement("span");
  n.textContent = `x ${coins}`;
  badge.append(n);
  const text = `${coins} ${coins === 1 ? "coin disponível" : "coins disponíveis"}. Cada fase concluída usa 1 coin; a cada 24 h o saldo volta a ${max} por jogo (sem acumular).`
    + (coins < max ? ` Próxima recarga em ${fmtDuration(nextRefillAt - Date.now())}.` : "");
  badge.title = text;
  badge.setAttribute("aria-label", text);
  return badge;
}
