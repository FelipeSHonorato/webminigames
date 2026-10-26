# Créditos e licenças de terceiros

O código deste repositório é MIT (veja [LICENSE](LICENSE)). Os itens abaixo foram usados
para montar e filtrar o vocabulário do Text Twist (`games/texttwist/words.js` e a cópia em
`supabase/functions/play/_shared/texttwist/words.js`).

## fserb/pt-br — licença MIT

Fonte principal das palavras: lista ICF e listas auxiliares (`lexico`, `negativas`,
`municipios-br`, `paises`, `estados-br`, `continentes`).

<https://github.com/fserb/pt-br>

```text
Copyright 2021 Fernando Serboncini

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## pythonprobr/palavras — licença MPL-2.0

Usado como dicionário de validação (as palavras incluídas no jogo continuam vindo da
lista ICF acima). Licença: <https://github.com/pythonprobr/palavras/blob/master/LICENSE>.

## stopwords-iso/stopwords-pt — licença MIT

Usado para excluir palavras funcionais do vocabulário do jogo.

<https://github.com/stopwords-iso/stopwords-pt>

```text
The MIT License (MIT)

Copyright (c) 2016 Gene Diaz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Nomes e municípios (dados públicos do IBGE)

A lista de nomes usada para excluir nomes próprios foi extraída dos dados públicos do
Censo 2010 do IBGE (gist `pimatco/65fb8376d660c0ce54c88518840c2b84`). Os municípios,
estados, países e continentes vêm das listas do repositório `fserb/pt-br`.
