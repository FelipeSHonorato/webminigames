/* Script clássico no <head>: guarda o que veio depois do # (e do ?) antes de a biblioteca do Supabase limpar o endereço. */
window.__authLink = location.hash + (location.hash ? "" : location.search);
