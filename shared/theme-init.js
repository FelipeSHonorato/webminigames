/* Script clássico no <head>: aplica o tema salvo antes da primeira pintura (sem "piscar"). */
(function () {
  try {
    var t = localStorage.getItem("wmg.theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* sem armazenamento: segue o tema do sistema */ }
})();
