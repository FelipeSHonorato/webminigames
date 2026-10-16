# vendor/

Bibliotecas de terceiros que o site carrega **do próprio repositório** (sem CDN: funciona igual em qualquer hospedagem e não depende de serviço externo).

## supabase-js.mjs
- Pacote: [`@supabase/supabase-js`](https://www.npmjs.com/package/@supabase/supabase-js) **2.117.3**, licença MIT.
- É o bundle `dist/umd/supabase.js` do pacote, com um comentário no topo e a linha final `export const createClient = supabase.createClient;` (o bundle declara `var supabase`, que num módulo fica local).
- Só é carregado quando o Supabase está configurado (`shared/backend/config.js`).

### Atualizar para uma versão nova
```bash
mkdir /tmp/sb && cd /tmp/sb && npm init -y && npm i @supabase/supabase-js@VERSAO
{ echo "/* @supabase/supabase-js VERSAO (licença MIT, © Supabase). Bundle UMD oficial do pacote npm + a linha final de export ESM.
   Para atualizar, veja vendor/README.md. Não edite à mão. */"; cat node_modules/@supabase/supabase-js/dist/umd/supabase.js; echo; echo "export const createClient = supabase.createClient;"; } > SEU_REPO/vendor/supabase-js.mjs
```
Depois rode `npm test`, teste o login e a página de um jogo, e atualize o número da versão neste arquivo e no comentário do topo.
