/* Vocabulário das Palavras Cruzadas (pt-BR): "RESPOSTA|dica", uma por linha.
   A resposta vai sem acento e sem cedilha (só A-Z), como numa cruzadinha impressa. A dica não pode conter a própria resposta.
   Respostas curtas (2 e 3 letras) são essenciais: é com elas que a grade fecha bem. */
const RAW = `
DO|Primeira nota da escala musical
RE|Segunda nota da escala musical
MI|Terceira nota da escala musical
FA|Quarta nota da escala musical
LA|Sexta nota da escala musical
SI|Sétima nota da escala musical
EU|Pronome pessoal da primeira pessoa
TU|Pronome pessoal da segunda pessoa
EM|Preposição que indica lugar
AO|Contração de "a" com o artigo "o"
NO|Contração de "em" com o artigo "o"
UM|Número que vem depois do zero
OU|Conjunção que indica alternativa
OS|Artigo definido masculino plural
AS|Artigo definido feminino plural
PE|Parte do corpo usada para andar
RA|Anfíbio de patas longas que pula na lagoa
AI|Interjeição de dor
UI|Exclamação de dor ou de surpresa
OI|Cumprimento informal
IR|Contrário de vir
OH|Interjeição de admiração
RS|Sigla do estado de Porto Alegre
SP|Sigla do estado mais populoso do Brasil
RJ|Sigla do estado do Cristo Redentor
BA|Sigla do estado de Salvador
PA|Sigla do estado de Belém
MG|Sigla do estado de Belo Horizonte
PR|Sigla do estado de Curitiba
SC|Sigla do estado de Florianópolis
AM|Sigla do estado de Manaus
CE|Sigla do estado de Fortaleza
GO|Sigla do estado de Goiânia
MT|Sigla do estado de Cuiabá
MS|Sigla do estado de Campo Grande
ES|Sigla do estado de Vitória
DF|Sigla do Distrito Federal
TO|Sigla do estado de Palmas
AC|Sigla do estado de Rio Branco
RO|Sigla do estado de Porto Velho
RR|Sigla do estado de Boa Vista
AP|Sigla do estado de Macapá
PB|Sigla do estado de João Pessoa
RN|Sigla do estado de Natal
SE|Sigla do estado de Aracaju
AL|Sigla do estado de Maceió
MA|Sigla do estado de São Luís
PI|Sigla do estado de Teresina

SOL|Estrela que ilumina a Terra
LUA|Satélite natural da Terra
MAR|Grande extensão de água salgada
RIO|Curso de água que deságua no mar
UVA|Fruta usada para fazer vinho
OVO|Alimento que a galinha bota
PAO|Alimento básico feito de farinha e fermento
CAO|Animal doméstico que late
BOI|Animal bovino criado para dar carne
REI|Soberano de um reino
LEI|Norma criada pelo Legislativo
FIO|Cordão fino de linha ou de eletricidade
SAL|Tempero que deixa a comida salgada
DIA|Período entre o nascer e o pôr do sol
GOL|Ponto marcado no futebol
ASA|Parte da ave usada para voar
CEU|Espaço onde ficam as nuvens e as estrelas
PAI|Genitor
MAE|Genitora
TIO|Irmão do pai ou da mãe
AVO|Pai do pai ou da mãe
FOZ|Local onde o rio encontra o mar
ARO|Anel de metal ou madeira
OCA|Habitação indígena
UFA|Interjeição de alívio
OBA|Interjeição de alegria
PIA|Onde se lava a louça
LAR|Casa, moradia
CHA|Infusão quente de ervas
REU|Acusado em um processo
SER|Existir
TER|Possuir
VER|Enxergar
DAR|Presentear
IDA|Viagem de partida
VIA|Caminho; estrada
AVE|Animal que tem penas
ANO|Período de doze meses
MES|Cada uma das doze divisões do ano
SIM|Resposta afirmativa
NAO|Resposta negativa
BEM|Contrário de mal
MAL|Contrário de bem
ALA|Parte lateral de um edifício
ONU|Organização das Nações Unidas (sigla)
OAB|Ordem dos Advogados do Brasil (sigla)
USP|Universidade de São Paulo (sigla)
CPF|Documento do contribuinte com onze dígitos (sigla)
PIX|Pagamento instantâneo brasileiro
RUA|Via pública da cidade
COR|Característica visual, como o azul e o verde
MEL|Alimento doce feito pelas abelhas
FIM|Término
GIZ|Material usado para escrever na lousa
DOR|Sensação desagradável no corpo
RIR|Soltar gargalhadas
SUL|Ponto cardeal oposto ao norte
OPA|Interjeição de surpresa ou saudação
OLA|Cumprimento amigável
EVA|Primeira mulher, segundo a Bíblia
NOE|Personagem bíblico que construiu a arca
UAI|Interjeição típica de Minas Gerais
VOZ|Som produzido pela fala
LUZ|Claridade
PAZ|Ausência de guerra
CRU|Que não foi cozido
SAO|Termo que antecede o nome de muitos santos
DOM|Talento natural
RAP|Ritmo musical falado
POP|Estilo musical popular
SOM|Aquilo que se ouve
TOM|Grau de intensidade de uma cor
BOA|Feminino de bom
TAL|Pronome que indica algo já citado
SEU|Pronome possessivo da terceira pessoa
MEU|Pronome possessivo da primeira pessoa
NOS|Pronome oblíquo da primeira pessoa do plural
ELA|Pronome pessoal feminino da terceira pessoa
ELE|Pronome pessoal masculino da terceira pessoa
ALI|Naquele lugar
COM|Preposição que indica companhia
PRA|Forma popular de "para"
QUE|Pronome relativo muito usado
MAS|Conjunção que indica oposição
ATO|Cada parte de uma peça de teatro
RUM|Bebida destilada do caldo de cana
GIN|Bebida alcoólica aromatizada com zimbro
ETC|Abreviatura de "e outras coisas"
SRA|Abreviatura de senhora
DRA|Abreviatura de doutora
EGO|Parte da personalidade ligada à autoestima
IRA|Raiva intensa
ODE|Poema em homenagem a alguém
ELO|Argola de uma corrente
TEZ|Pele do rosto
VIL|Desprezível
NEM|Conjunção que indica negação
OVA|Ovos de peixe
MAO|Parte do corpo com cinco dedos
DEZ|Número depois do nove
MIL|Dez vezes cem
CEM|Dez vezes dez
PAR|Conjunto de dois
SEM|Preposição que indica falta
TRI|Três vezes campeão, no jargão esportivo

GATO|Felino doméstico que mia
RATO|Roedor que o gato persegue
PATO|Ave aquática que faz "quá"
VACA|Fêmea do boi
URSO|Mamífero que hiberna no inverno
LOBO|Canídeo que uiva para a lua
SAPO|Anfíbio que coaxa
ONCA|Felino pintado da Amazônia
TATU|Animal que se enrola como uma bola
FOCA|Mamífero marinho que aplaude nos circos
BOLA|Objeto usado em jogos como o futebol
PIPA|Brinquedo de papel que voa com o vento
CASA|Moradia
MESA|Móvel onde fazemos as refeições
SOFA|Móvel confortável da sala
CAMA|Móvel onde se dorme
ROSA|Flor cheia de espinhos
FLOR|Parte colorida e perfumada da planta
MATA|Floresta
RAIO|Descarga elétrica durante a tempestade
NEVE|Flocos brancos que caem em países frios
GELO|Água em estado sólido
FOGO|Combustão que produz chamas e calor
AGUA|Líquido essencial à vida
ILHA|Porção de terra cercada de água
LAGO|Grande extensão de água cercada de terra
VALE|Terreno baixo entre montanhas
RAIZ|Parte da planta que fica sob a terra
MACA|Fruta vermelha ligada a Adão e Eva
PERA|Fruta de formato semelhante a um sino
LIMA|Fruta cítrica pequena e verde
CAJU|Fruta cuja castanha é muito apreciada
COCO|Fruto de onde se tira água refrescante
FIGO|Fruta roxa da figueira
ALHO|Tempero que afasta os vampiros
BOLO|Doce assado de festa de aniversário
DOCE|Que tem gosto de açúcar
SUCO|Bebida de fruta espremida
SOPA|Prato líquido servido quente
CAFE|Bebida preta e quente que desperta de manhã
FACA|Talher que corta
COPO|Recipiente para beber água
TREM|Veículo que anda sobre trilhos
MOTO|Veículo de duas rodas com motor
ROMA|Capital da Itália
CUBA|Ilha caribenha cuja capital é Havana
PERU|País andino onde fica Machu Picchu
ASIA|Maior continente do mundo
NILO|Famoso rio do Egito
AMOR|Sentimento entre namorados
VIDA|Existência
NOME|Palavra pela qual alguém é chamado
LOGO|Daqui a pouco; marca de uma empresa
VEZ|Ocasião; turno
CASO|Ocorrência; situação
FATO|Acontecimento real
TEMA|Assunto de um texto
NOTA|Registro musical; cédula de dinheiro
TIME|Equipe esportiva
JOGO|Partida; brincadeira
CORO|Grupo de pessoas que cantam juntas
ROCK|Gênero musical de guitarras marcantes
CENA|Trecho de filme ou peça
ATOR|Quem interpreta personagens
ARTE|Expressão criativa, como a pintura e a escultura
OURO|Metal precioso de cor amarela
GRAO|Semente pequena de cereal
SEDE|Vontade de beber água
FOME|Vontade de comer
SONO|Vontade de dormir
SECA|Longo período sem chuva
FRIO|Baixa temperatura
OLHO|Órgão da visão
BOCA|Parte do rosto usada para comer e falar
DEDO|Cada um dos cinco que há na mão
OSSO|Peça do esqueleto
PELE|Órgão que cobre o corpo
UNHA|Parte rígida na ponta dos dedos
RISO|Ato de rir
CHAO|Superfície onde pisamos
TETO|Parte superior interna de uma casa
MURO|Parede que cerca um terreno
SALA|Cômodo onde recebemos visitas
ROLO|Cilindro, como o de papel higiênico
SACO|Embalagem de plástico ou papel
LATA|Recipiente de metal para bebidas
LIXO|Resíduos que jogamos fora
SELO|Etiqueta colada nas cartas
TELA|Superfície onde se projeta um filme
MAPA|Representação de uma região em papel
FOTO|Imagem registrada por câmera
ZERO|Número que representa o nada
DOIS|Número depois do um
TRES|Número depois do dois
SEIS|Número depois do cinco
OITO|Número depois do sete
NOVE|Número antes do dez
ONZE|Número depois do dez
ALTO|Que tem grande altura
CEDO|Antes da hora
HOJE|O dia de agora
BEBE|Criança recém-nascida
IRMA|Filha dos mesmos pais que outra pessoa
NORA|Esposa do filho
POVO|Conjunto de habitantes de um país
PAIS|Nação com território e governo
ERRO|Engano; falha
LUTA|Combate corpo a corpo
JUDO|Arte marcial japonesa
BOXE|Esporte de luvas e ringue
REMO|Esporte que usa pás dentro d'água
VELA|Peça do barco movida pelo vento
POLO|Extremidade da Terra
ARCO|Arma que dispara flechas
AZUL|Cor do céu limpo
ROXO|Cor da berinjela
FADA|Ser mágico com varinha de condão
ROBO|Máquina com aparência humana
JUIZ|Quem apita partidas de futebol
LOJA|Estabelecimento comercial
ONDA|Movimento da água do mar

CAMPO|Terreno aberto e gramado
PRAIA|Faixa de areia à beira-mar
TERRA|Planeta onde vivemos
MARTE|Planeta vermelho do Sistema Solar
VENUS|Planeta mais quente do Sistema Solar
URANO|Planeta que gira "deitado"
CLIMA|Condições do tempo de uma região
RELVA|Grama baixa de um gramado
SELVA|Floresta tropical densa
DUNAS|Montes de areia do deserto
GRUTA|Caverna natural
BREJO|Terreno alagadiço
ARARA|Ave colorida de bico forte
ZEBRA|Cavalo listrado da África
TIGRE|Felino listrado asiático
HIENA|Animal que parece rir na savana
PANDA|Urso preto e branco da China
KOALA|Marsupial australiano que come eucalipto
POLVO|Molusco de oito tentáculos
MOSCA|Inseto que zumbe perto do lixo
CORVO|Ave negra de mau agouro
PAVAO|Ave de cauda exuberante
GANSO|Ave doméstica parecida com o pato
PORCO|Animal que gosta de lama
CABRA|Fêmea do bode
BURRO|Animal de carga; pouco inteligente
COBRA|Réptil sem patas que rasteja
GRILO|Inseto que canta à noite
MANGA|Fruta alaranjada e suculenta
LIMAO|Fruta ácida usada na limonada
MELAO|Fruta de casca rendilhada e polpa doce
ARROZ|Grão básico do prato brasileiro
MILHO|Cereal da pipoca e da pamonha
LEITE|Líquido branco produzido pela vaca
TRIGO|Cereal usado para fazer farinha
AVEIA|Cereal de mingaus e granolas
PUDIM|Sobremesa de leite condensado com calda
TORTA|Massa recheada, doce ou salgada
PIZZA|Massa redonda italiana com queijo
PRATO|Louça onde se serve a comida
GARFO|Talher de dentes
CHAVE|Objeto que abre fechaduras
PREGO|Peça de metal batida com martelo
CARRO|Veículo de quatro rodas
NAVIO|Grande embarcação
BARCO|Pequena embarcação
AVIAO|Veículo que voa
PARIS|Capital da França
CHILE|País comprido da América do Sul
MORTE|Fim da vida
SORTE|Acaso favorável
IDEIA|Pensamento; sugestão
PROVA|Teste escolar
FORCA|Capacidade de fazer esforço físico
FESTA|Comemoração com música e convidados
DANCA|Movimento do corpo ao ritmo da música
CIRCO|Espetáculo com palhaços e malabaristas
OPERA|Espetáculo musical cantado
SAMBA|Ritmo brasileiro do Carnaval
BAILE|Festa dançante
FILME|Obra exibida no cinema
PRATA|Metal brilhante; medalha do segundo lugar
FERRO|Metal usado para passar roupa
COBRE|Metal avermelhado usado em fios
CHUVA|Água que cai das nuvens
CALOR|Sensação de temperatura alta
NARIZ|Órgão do olfato
PERNA|Membro usado para caminhar
DENTE|Peça da boca usada para mastigar
CHORO|Lágrimas; ritmo brasileiro
TOSSE|Reflexo comum no resfriado
GRIPE|Doença que causa febre e coriza
FEBRE|Temperatura do corpo acima do normal
PORTA|Entrada de um cômodo
LIVRO|Conjunto de páginas encadernadas
AREIA|Grãos finos de praia e deserto
PEDRA|Rocha pequena
NUVEM|Massa de vapor no céu
VENTO|Ar em movimento
MONTE|Pequena elevação de terreno
SERRA|Cadeia de montanhas
FOLHA|Parte verde da planta
FRUTO|Produto da árvore que contém sementes
AMORA|Fruta escura da amoreira
CINZA|Cor entre o branco e o preto
VERDE|Cor da grama
PRETO|Cor da noite
TEXTO|Conjunto de frases escritas
LETRA|Cada símbolo do alfabeto
FRASE|Conjunto de palavras com sentido
VERSO|Linha de um poema
RIMA|Repetição de sons no fim de versos
LAPIS|Instrumento de escrita de grafite
FOGAO|Eletrodoméstico para cozinhar
RADIO|Aparelho que transmite programas de áudio
JARRA|Recipiente com alça para servir líquidos
GENIO|Ser que sai da lâmpada mágica
HEROI|Personagem de grande coragem
VILAO|Personagem malvado
BRUXA|Mulher com poderes mágicos e vassoura
MAGIA|Arte de realizar truques e encantamentos
CORPO|Conjunto de partes do ser vivo
CORAL|Animal marinho que forma recifes
BALSA|Embarcação plana que atravessa rios
LEME|Peça que dirige o barco
PROA|Parte da frente do navio
POPA|Parte de trás do navio
CHEFE|Pessoa que comanda um grupo
LIDER|Pessoa que guia um grupo
REINO|Território governado por um rei
TRONO|Cadeira de um rei
CORTE|Séquito do rei; ato de cortar
FALAR|Dizer palavras em voz alta
ANDAR|Caminhar; pavimento de um prédio
PULAR|Saltar
NADAR|Mover-se na água
COMER|Ingerir alimentos
BEBER|Ingerir líquidos
SONHO|Imagens que vemos ao dormir
LEVAR|Transportar
TROCA|Ato de dar uma coisa em lugar de outra
VENDA|Ato de comercializar
PRECO|Valor de um produto
LUCRO|Ganho financeiro
BANCO|Instituição financeira; assento
MOEDA|Dinheiro em formato de disco metálico
HOTEL|Local de hospedagem de viajantes
ASTRO|Corpo celeste, como o Sol
GEADA|Camada de gelo fino sobre o solo em manhãs frias
FEIJAO|Grão que acompanha o arroz
BAIXO|Que tem pouca altura
LONGE|A grande distância
PERTO|A pouca distância
NUNCA|Em nenhum momento
TARDE|Período entre o meio-dia e a noite
NOITE|Período em que a lua aparece
ONTEM|O dia anterior a hoje
HOMEM|Ser humano adulto do sexo masculino
PRIMO|Filho do tio
NETO|Filho do filho
GENRO|Marido da filha
SOGRA|Mãe do marido ou da esposa
FORTE|Que tem muita força
CALMO|Tranquilo
BRAVO|Zangado; corajoso
LARGO|Que tem grande largura

BRASIL|País do Carnaval e do futebol
ESTADO|Unidade de uma federação, como São Paulo
CIDADE|Aglomerado urbano maior que uma vila
JARDIM|Terreno com plantas e flores
BOSQUE|Pequena floresta
COMETA|Astro com cauda brilhante
GIRAFA|Animal de pescoço muito comprido
TUCANO|Ave de grande bico colorido
ABELHA|Inseto que produz mel
CORUJA|Ave noturna de olhos grandes
CAVALO|Animal que o jóquei monta
OVELHA|Fêmea do carneiro, de quem vem a lã
BALEIA|Maior mamífero do mar
MACACO|Primata que gosta de banana
ARANHA|Aracnídeo que tece teias
LONTRA|Mamífero aquático de pelagem macia
JACARE|Réptil de bocarra comum no Pantanal
BANANA|Fruta amarela preferida dos macacos
CEREJA|Fruta pequena e vermelha que enfeita bolos
GOIABA|Fruta de polpa rosada usada em doces
TOMATE|Fruto vermelho usado em molhos
BATATA|Tubérculo frito ou cozido
CEBOLA|Bulbo que faz chorar ao ser cortado
QUEIJO|Derivado do leite, como a muçarela
PIPOCA|Milho estourado servido no cinema
FAROFA|Prato de farinha de mandioca torrada
PASTEL|Massa frita recheada, vendida em feiras
ALFACE|Folha verde de saladas
PEPINO|Legume verde e alongado de saladas
AMEIXA|Fruta roxa que, seca, vira passa
JANELA|Abertura na parede por onde entra a luz
PAREDE|Divisória vertical de uma casa
CANETA|Instrumento de escrever com tinta
QUADRO|Pintura emoldurada
TAPETE|Peça que cobre o chão
PANELA|Utensílio em que se cozinha
COLHER|Talher para tomar sopa
XICARA|Recipiente em que se serve café
CAMERA|Aparelho que registra fotos e vídeos
ESCADA|Série de degraus que liga andares
TOALHA|Peça que seca o corpo
ESCOVA|Objeto usado para pentear ou limpar os dentes
QUARTO|Cômodo onde se dorme
PORTAO|Grande porta de entrada de uma casa
PINTOR|Artista que usa tintas e pincéis
CANTOR|Artista que se apresenta com a voz
ATLETA|Praticante profissional de esporte
PILOTO|Quem conduz um avião
MEDICO|Profissional que atende pacientes
SANGUE|Líquido vermelho que circula no corpo
LINGUA|Órgão do paladar; idioma
BRACO|Membro superior do corpo
CABECA|Parte do corpo onde fica o cérebro
FIGADO|Órgão grande do abdômen
PULMAO|Órgão da respiração
SAUDE|Estado de bem-estar do corpo
VIAGEM|Deslocamento de um lugar a outro
FERIAS|Período de descanso do trabalho
ORBITA|Trajetória de um planeta ao redor do Sol
AURORA|Claridade que antecede o nascer do sol
OCEANO|Vasta extensão de água salgada entre continentes
VULCAO|Montanha que expele lava
TROVAO|Barulho forte que acompanha o raio
BRANCO|Cor da neve
DRAGAO|Criatura que cospe fogo
ESPADA|Arma de lâmina longa
ESCUDO|Proteção usada pelos guerreiros
CORRER|Andar muito depressa
DORMIR|Descansar de olhos fechados
COMPRA|Ato de adquirir um produto
GALAXIA|Conjunto de estrelas, como a Via Láctea
PLANETA|Corpo celeste que gira em torno do Sol
FOGUETE|Veículo que vai ao espaço
ECLIPSE|Fenômeno em que um astro cobre outro
DESERTO|Região seca e de poucas chuvas
NEBLINA|Nevoeiro que reduz a visibilidade
ORVALHO|Gotículas de água sobre as folhas ao amanhecer
TORNADO|Funil de vento que destrói o que encontra
FURACAO|Tempestade com ventos muito fortes
CAVERNA|Cavidade natural em uma rocha
FORMIGA|Inseto que carrega folhas nas costas
BESOURO|Inseto de carapaça dura
GALINHA|Ave que bota ovos
LAGARTO|Réptil de quatro patas e cauda longa
CIGARRA|Inseto que canta no verão
TUBARAO|Peixe predador de nadadeira dorsal pontuda
PIRANHA|Peixe de dentes afiados dos rios amazônicos
SARDINHA|Peixe pequeno vendido em lata
LARANJA|Fruta cítrica cujo suco se toma no café da manhã
MORANGO|Fruta vermelha com sementes na casca
ABACAXI|Fruta de coroa espinhosa e polpa ácida
ABACATE|Fruta verde usada em vitaminas e guacamole
CENOURA|Raiz alaranjada que coelhos adoram
SORVETE|Sobremesa gelada de casquinha ou pote
PAMONHA|Iguaria de milho verde cozida na palha
TAPIOCA|Beiju de goma de mandioca
COXINHA|Salgado de massa e frango em formato de gota
CADEIRA|Móvel de assento com encosto
TELHADO|Cobertura da casa
CADERNO|Conjunto de folhas para anotações escolares
MOCHILA|Bolsa levada nas costas
RELOGIO|Instrumento que marca as horas
ESPELHO|Superfície que reflete a imagem
CORTINA|Pano que cobre a janela
ARMARIO|Móvel onde se guarda roupa
TECLADO|Conjunto de teclas de um computador
VARANDA|Área aberta ligada à casa
GARAGEM|Local onde se guarda o carro
COZINHA|Cômodo onde se prepara a comida
SABONETE|Produto usado para lavar as mãos
VASSOURA|Utensílio usado para varrer o chão
TELEFONE|Aparelho usado para ligar para alguém
LAMPADA|Dispositivo que ilumina o ambiente
CHOCOLATE|Doce feito de cacau
BISCOITO|Alimento crocante e assado, doce ou salgado
MACARRAO|Massa italiana que vai ao molho
MANTEIGA|Gordura de leite passada no pão
MELANCIA|Fruta de casca verde e polpa vermelha
MANDIOCA|Raiz que também se chama aipim ou macaxeira
ABOBORA|Fruto alaranjado de sopas e doces
BORRACHA|Objeto usado para apagar o lápis
GELADEIRA|Eletrodoméstico que conserva os alimentos frios
CAPIVARA|Maior roedor do mundo
PREGUICA|Animal muito lento que vive nas árvores
TAMANDUA|Animal de focinho comprido que come formigas
BOMBEIRO|Profissional que apaga incêndios
DENTISTA|Profissional que cuida dos dentes
MOTORISTA|Quem dirige um veículo
PROFESSOR|Quem ensina na escola
ADVOGADO|Profissional que defende clientes na Justiça
PESCADOR|Quem vive da pesca
MECANICO|Profissional que conserta carros
EDUCACAO|Formação oferecida pelas escolas
GEOGRAFIA|Matéria que estuda mapas e paisagens
TELEVISAO|Aparelho que exibe novelas e jornais
COMPUTADOR|Máquina usada para trabalhar e navegar na internet
BIBLIOTECA|Lugar onde se empresta e se lê livros
ASTRONAUTA|Tripulante de uma nave espacial
MATEMATICA|Ciência dos números e das contas
TECNOLOGIA|Conjunto de técnicas e inovações modernas
ENGENHEIRO|Profissional que projeta pontes e prédios
JORNALISTA|Profissional que escreve reportagens
FOTOGRAFO|Profissional que registra imagens
CIENTISTA|Pessoa que faz pesquisas e experimentos
ENFERMEIRO|Profissional que cuida dos pacientes ao lado do médico
MARINHEIRO|Tripulante de um navio
AGRICULTOR|Quem cultiva a terra
COZINHEIRO|Quem prepara refeições
VETERINARIO|Médico de animais
PROGRAMADOR|Quem escreve códigos de computador
ELETRICISTA|Profissional que cuida da fiação
ENCANADOR|Profissional que conserta canos
CONSTRUCAO|Obra de um prédio ou de uma casa
COMUNICACAO|Troca de mensagens entre pessoas
MONTANHA|Grande elevação natural de terreno
CACHOEIRA|Queda d'água em um rio
HORIZONTE|Linha onde o céu parece encontrar a terra
SATELITE|Astro que gira em torno de um planeta
UNIVERSO|Conjunto de tudo o que existe no espaço
NATUREZA|Conjunto de plantas, animais e paisagens
FLORESTA|Grande área coberta de árvores
POUSADA|Pequena hospedaria
TURISTA|Pessoa que viaja a passeio
CEREBRO|Órgão que comanda o corpo
ESTOMAGO|Órgão onde a comida é digerida
REMEDIO|Medicamento usado para tratar doenças
`;

/** Remove acentos e cedilha e deixa em maiúsculas. */
export const normalize = w => w.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

/** Entradas lidas do texto acima (inclusive repetidas e inválidas): o teste confere o vocabulário por aqui. */
export const ENTRIES = RAW.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
  const i = l.indexOf("|");
  return { norm: normalize(l.slice(0, i)), clue: l.slice(i + 1).trim() };
});

/** [{ norm: "SOL", clue: "Estrela que ilumina a Terra" }, …], só as entradas completas e sem resposta repetida. */
export const WORDS = (() => {
  const seen = new Set(), out = [];
  for (const e of ENTRIES) if (e.clue && /^[A-Z]{2,}$/.test(e.norm) && !seen.has(e.norm)) { seen.add(e.norm); out.push(e); }
  return out;
})();
