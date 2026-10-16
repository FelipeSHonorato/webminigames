import { Cloud } from "./cloud.js";

// Importado como PRIMEIRA linha de cada página (as de js/ e os ui.js dos jogos): o `await` abaixo faz o resto do módulo
// esperar os dados da conta chegarem do Supabase, então os jogos continuam lendo coins, fase e nível de forma síncrona.
// Sem Supabase configurado (shared/backend/config.js vazio), não faz nada.
await Cloud.start();

if (Cloud.degraded && typeof document !== "undefined") {
  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.textContent = "Sem conexão com o servidor: seu progresso não será salvo na nuvem agora. Recarregue a página quando a internet voltar.";
  bar.style.cssText = "position:sticky;top:0;z-index:99999;padding:8px 16px;background:#b3261e;color:#fff;font:600 14px system-ui,sans-serif;text-align:center";
  document.body.prepend(bar);
}
