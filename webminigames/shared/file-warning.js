/* Script clássico (não é módulo): roda até em file://, onde os navegadores bloqueiam módulos ES. */
(function () {
  if (location.protocol !== "file:") return;
  addEventListener("DOMContentLoaded", function () {
    var bar = document.createElement("div");
    bar.setAttribute("role", "alert");
    bar.style.cssText = "position:sticky;top:0;z-index:99;padding:12px 16px;background:#f2b134;color:#14213d;font:600 14px/1.4 system-ui,sans-serif";
    bar.innerHTML = "Os jogos não funcionam abrindo o arquivo direto no navegador. Rode um servidor local na pasta do projeto, por exemplo <code>npx serve .</code> ou <code>python -m http.server 8000</code>, e abra <code>http://localhost:8000</code>.";
    document.body.insertBefore(bar, document.body.firstChild);
  });
})();
