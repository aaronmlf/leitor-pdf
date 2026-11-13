# Plano de evolução do Leitor

Proposta para aprovação. A prioridade é fazer o usuário chegar à primeira leitura em voz alta, reencontrar o trecho com facilidade e poder levar a biblioteca para outro aparelho. A primeira entrega de formato novo é PDF com texto selecionável. OCR de digitalizações e reprodução nativa em segundo plano têm marcos próprios porque dependem de qualidade e desempenho em aparelho real.

O ponto de partida é o APK 1.0.1. A biblioteca importa EPUB e TXT, guarda os arquivos e as posições no aparelho e oferece marcadores por frase. O leitor tem voz do sistema, Piper com modelos baixáveis, controles por frase e velocidade. A versão web passou em testes de importação, retomada offline e geração de áudio Piper com Edresson. O teste físico do áudio Android continua sendo a próxima verificação.

## Diagnóstico da interface atual

| Área | O que foi observado | Efeito no uso |
| --- | --- | --- |
| Primeira abertura | Em 360 × 740, a ação de importação aparece no cabeçalho e o centro convida a arrastar arquivos. O livro de demonstração tem uma ação maior no centro. | Em uma tela de toque, a instrução central não orienta o gesto principal, que é escolher um arquivo. |
| Primeira reprodução | Quando o navegador não oferece vozes, o aviso ocupa várias linhas e o botão de reprodução fica desabilitado. A configuração de voz fica no ícone de engrenagem. | O usuário sabe que há um problema, mas precisa descobrir onde resolvê-lo. |
| Leitura visual | Em 1280 × 800, o texto já forma uma coluna confortável. No celular, títulos de capítulo longos ficam truncados. A posição exibe a frase destacada, sem um indicador do trecho no livro. | Há espaço para melhorar a navegação mantendo a área de leitura simples. |
| Acessibilidade | Frases têm evento de clique em `span`. A rolagem automática é sempre suave. No tema claro, o texto secundário sobre alguns painéis fica perto de 4,0:1 e o botão principal perto de 4,2:1. | Seleção por teclado, leitura com tecnologia assistiva, redução de movimento e contraste precisam de tratamento explícito. |
| Retomada e organização | A biblioteca ordena por data de importação. O leitor carrega todos os capítulos, grava a posição ao abrir e guarda capítulos e frases por índice. | Encontrar um livro ativo e preservar o ponto de leitura após reprocessar o texto ficam mais difíceis à medida que a biblioteca cresce. |
| Armazenamento e falhas | Há persistência local de livros, marcadores e cache, mas sem backup exportável. A primeira carga pode ficar em “Abrindo biblioteca…” se a abertura do banco falhar. | Uma reinstalação, troca de navegador ou falha de armazenamento pode interromper a leitura e dificultar a recuperação. |
| Áudio móvel | A notificação atual abre o aplicativo. O serviço gerencia foco e wake lock, e o WebView ainda gera o áudio e passa de frase. | Continuidade com a tela apagada e controle pelo fone precisam ser verificados separadamente. |

A revisão usou o build atual em Chromium com dimensões de celular e desktop, inspeção de código e cálculo de contraste. A emulação de tamanho de tela cobre a disposição visual. TalkBack, VoiceOver, WebView Android e telas bloqueadas entram na matriz de aparelhos. [Biblioteca](/mnt/500/Leitor_PDF/apps/web/src/components/Library.tsx:44) · [Leitor](/mnt/500/Leitor_PDF/apps/web/src/components/Reader.tsx:68) · [Estilos](/mnt/500/Leitor_PDF/apps/web/src/styles.css:18) · [Posição](/mnt/500/Leitor_PDF/apps/web/src/hooks/useReader.ts:341) · [Banco](/mnt/500/Leitor_PDF/packages/core/src/db.ts:21) · [Serviço de áudio](/mnt/500/Leitor_PDF/apps/web/android/app/src/main/java/br/leitor/app/PlaybackService.java:25)

## Ordem de entrega

| Etapa | Prioridade | Entrega | Dependência | Esforço relativo |
| --- | --- | --- | --- | --- |
| 0 | Imediata | Validar o APK em aparelho e registrar uma linha de base | APK 1.0.1 | Pequeno |
| 1 | Alta | Primeira leitura, acessibilidade e recuperação de falhas | Etapa 0 para ajustes específicos de Android | Médio |
| 2 | Alta | Retomada, navegação, busca e cópia de segurança | Modelo de posição e migração verificados | Médio a alto |
| 3 | Alta | PDF textual com navegação por página | Posição estável, tratamento de importação e corpus de teste | Alto |
| 4 | Média | Controles de escuta, vozes offline e gestão de espaço | Resultados de áudio da etapa 0 | Médio, ou alto se exigir player nativo |
| 5 | Posterior | OCR de PDF digitalizado | PDF textual e referência de desempenho em Android | Alto |

As etapas 2 e 3 podem avançar juntas depois que o contrato de posição estiver definido. O primeiro recorte que eu proponho aprovar é **etapas 1 a 3**, com os controles de mídia e OCR decididos pelos resultados em aparelho. Os esforços são relativos e dependem da amostra real de PDFs e dos aparelhos escolhidos.

## Etapa 0 — Validação do APK em aparelho

1. Instalar o 1.0.1 sobre o APK anterior e conferir biblioteca e posição. Em um perfil separado, fazer uma instalação limpa para testar o caminho da primeira leitura.
2. Abrir o EPUB de demonstração e importar um TXT próprio. Iniciar, pausar, mudar de frase e capítulo, salvar um marcador, fechar o app e voltar à mesma frase.
3. Comparar *faber*, *edresson* e *tugão* no mesmo trecho. Usar exemplos com números, datas, siglas, diálogo e frases longas. Registrar pronúncia, demora até o primeiro som e pausas entre frases. A escolha da voz permanece uma preferência do usuário.
4. Depois de baixar uma voz, fechar o app, ligar o modo avião e sintetizar um trecho ainda não ouvido. Testar também a reabertura da biblioteca offline.
5. Ler por 30 minutos com a tela apagada, incluindo pelo menos uma troca de capítulo. Repetir ao trocar de app e em economia de bateria. Fazer o teste em dois aparelhos quando disponíveis, incluindo um com menos memória ou gerenciamento de bateria mais restritivo.
6. Iniciar outro áudio, atender uma chamada e pausar pelo app. Conferir se a frase interrompida fica salva, se a retomada é manual e se o serviço libera notificação e wake lock após parar. Repetir com a permissão de notificação concedida e recusada no Android 13 ou posterior.

**Aceite.** Atualizar preserva dados. A voz já baixada gera áudio novo offline. A passagem entre capítulos funciona no teste de tela bloqueada, ou a falha fica reproduzida com modelo do aparelho, versão do Android/WebView, voz, condição de bateria e posição. Esse registro define a necessidade de mover o player para fora do WebView.

## Etapa 1 — Primeira leitura e acessibilidade

### Biblioteca e importação

- No celular, colocar **Importar livro** como ação principal do estado vazio, com os formatos aceitos abaixo. Manter **Experimentar com o livro de demonstração** como opção secundária. Em telas com mouse, mostrar a área de arraste quando houver arraste ou quando a biblioteca estiver vazia.
- Ao importar vários arquivos, mostrar o estado de cada um, com mensagens como “Concluído” e “Arquivo sem texto”. Oferecer **Tentar novamente** para o arquivo afetado e manter os itens que já foram importados. Para PDF, esse mesmo fluxo recebe progresso e cancelamento.
- Quando o banco falhar na primeira carga, exibir erro com **Tentar novamente**. Distinguir biblioteca vazia, biblioteca carregando e biblioteca indisponível. Ao confirmar exclusão, mostrar o título e informar que livro, posição e marcadores serão removidos.
- Rever o texto de privacidade junto com o seletor de voz. Explicar que os livros ficam no aparelho e que o processamento da voz depende do motor escolhido. O Piper baixado é a opção local e a Web Speech API distingue vozes locais e remotas. [Web Speech API](/mnt/500/Leitor_PDF/packages/voice/src/system.ts:79) · [Propriedade `localService`](https://webaudio.github.io/web-speech-api/#dom-speechsynthesisvoice-localservice)

### Leitor e primeira voz

- Usar a faixa acima do player para ações que dependem da reprodução. Com voz pronta, deixar **Ouvir** disponível. Sem voz, mostrar **Escolher voz**. Durante a primeira síntese, mostrar **Preparando áudio** com opção de parar. Em caso de falha, oferecer a ação aplicável, como tentar de novo, abrir vozes ou escolher uma voz já baixada.
- Abrir o painel com a voz em uso, as vozes disponíveis no aparelho e a opção de baixar Piper. Exibir idioma, tamanho e estado. A amostra deve poder ser parada. Depois de baixar, permitir selecionar e voltar ao texto no mesmo fluxo. Para a lista em português, manter *faber*, *edresson* e *tugão* acessíveis sem busca.
- Dar rótulos visíveis às ações menos óbvias, como **Sumário**, **Voz** e **Marcadores**, conforme o espaço. Quando um ícone for necessário, usar nome acessível, indicação do estado e foco devolvido ao botão ao fechar o painel. Preservar a posição do texto ao abrir e fechar.

### Controles de leitura

- No celular, fixar o player junto à margem inferior segura, com frase anterior, play/pause, próxima e velocidade. Abrir configurações em um painel único rolável, que caiba acima do teclado virtual. No desktop, usar a coluna atual de leitura e aproveitar a lateral para um painel opcional com sumário, busca e marcadores.
- Oferecer tema automático, claro, escuro e sépia, escala de texto e entrelinha. Guardar as preferências por aparelho. Ajustar o layout para que controles e texto se reorganizem a 200% de zoom.
- Criar **Acompanhar narração**. Com a função ativa, a frase é trazida à vista sem mover o foco. Se o usuário rolar para explorar outro trecho, oferecer **Voltar à frase atual** e respeitar a opção de reduzir movimento. O destaque deve usar um sinal visual adicional à cor.
- Dar ao texto uma forma de selecionar frase com teclado e leitor de tela. Usar navegação interna por parágrafo ou uma única parada de Tab no conjunto de frases, com setas e ação de ativar. O player continua acessível sem percorrer todas as frases do capítulo.

**Aceite.** Da instalação limpa, o usuário importa ou abre o exemplo e consegue iniciar em uma visita ao seletor de voz. Os controles principais têm área de toque de pelo menos 44 × 44 CSS px e texto comum tem contraste de pelo menos 4,5:1. Em 320 × 568, paisagem, desktop e zoom de 200%, as ações essenciais ficam alcançáveis sem rolagem horizontal. Testar teclado, TalkBack e VoiceOver nos fluxos de importar, ouvir, pausar, mudar de frase, marcar e ajustar voz. Validar a ordem de foco, redução de movimento e anúncios de erro que não repetem a cada frase. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Etapa 2 — Retomada, navegação, busca e backup

### Encontre o livro e o trecho

- Adicionar **Continuar lendo** no topo da biblioteca. Mostrar título, último capítulo ou página e posição aproximada, com ação para abrir diretamente no ponto salvo. Distinguir livro apenas aberto de atividade de leitura para que consultar um título não esconda o livro ativo.
- Incluir busca por título e autor e ordenação por atividade recente, título e data de importação. Filtro de formato passa a mostrar EPUB, TXT e PDF quando disponíveis. Duplicatas por conteúdo podem oferecer **Abrir existente** ou **Importar cópia** em uma entrega posterior.
- Substituir o seletor de capítulo por um sumário com itens acessíveis e página ou capítulo atual. Em EPUB, aproveitar a navegação declarada quando houver e usar a ordem dos capítulos como contingência. Em TXT, manter os capítulos identificados. Em PDF, oferecer salto para página física e mostrar rótulo impresso quando disponível. [Navegação EPUB 3.3](https://www.w3.org/TR/epub-33/#sec-nav)
- Dentro do livro, buscar texto sem distinção entre acentos e maiúsculas. Exibir contagem, trecho com contexto, página ou capítulo, resultado anterior e próximo. Digitar não altera a posição nem interrompe o áudio. Abrir um resultado muda o trecho selecionado e permite voltar ao ponto anterior. Para livros grandes, começar com varredura fora da thread da interface e introduzir índice persistente se as medições justificarem.
- Evoluir marcadores com rótulo editável, seleção rápida e tratamento de duplicatas na mesma posição. Depois de abrir um marcador ou resultado, manter um retorno de uma ação ao trecho de origem durante a sessão.

### Preserve posição e biblioteca

- Ampliar o registro de posição com identificação da unidade de origem, deslocamento no texto e um trecho de contexto. Para PDF, usar página física. Para EPUB, usar o recurso do capítulo. Para TXT, usar a seção identificada. Manter os índices atuais como caminho de compatibilidade para livros já importados.
- Registrar versão do parser quando o texto é derivado. Ao reprocessar, tentar primeiro o identificador e o deslocamento, depois o contexto textual. Quando o trecho não puder ser resolvido, conservar o marcador e oferecer o ponto mais próximo com aviso. O texto normalizado para fala pode variar sem mover a posição no texto exibido.
- Implementar **Exportar biblioteca** e **Restaurar biblioteca** com um ZIP versionado contendo originais, metadados, posições, marcadores e preferências portáveis. Antes de escrever, validar estrutura, versão, entradas e espaço e mostrar um resumo. Usar a identidade do livro e o hash do original na mesclagem. Em conflito, manter a posição mais recente e preservar marcadores distintos.
- Tratar índice de busca e cache de áudio como dados regeneráveis. Modelos de voz e pacotes OCR são geridos no aparelho. Expor falha de gravação da posição e oferecer tentativa novamente sem apagar o ponto salvo anteriormente. O navegador pode oferecer armazenamento persistente e estimativa de cota, conforme o ambiente. [Modelo atual](/mnt/500/Leitor_PDF/packages/core/src/types.ts:24) · [Storage Standard](https://storage.spec.whatwg.org/)

**Aceite.** Atualizar uma base criada na versão 1.0.1 preserva todos os originais, marcadores e posições. Fechar logo após mudar de trecho e reabrir leva à mesma frase. Restaurar em um perfil novo recompõe os livros, posições e marcadores. Restaurar duas vezes evita duplicatas. Backup inválido ou falha de cota preservam a biblioteca existente. A busca devolve trechos corretos para “João” e “joao” e só muda a seleção quando um resultado é aberto.

## Etapa 3 — PDF com camada de texto

### Experiência do usuário

1. O seletor e o arraste passam a aceitar PDF. O usuário vê o nome do documento e o progresso, por exemplo “Preparando página 12 de 54”, com cancelamento. O item entra na biblioteca quando a importação está pronta.
2. O leitor apresenta texto com quebra adaptada à tela e mostra **Página 12 de 54**. **Ir para página**, sumário, busca, marcadores, destaque, voz e retomada seguem a mesma interação de EPUB/TXT. Um controle para ver a página original pode entrar após validar a extração, com zoom e retorno à mesma posição.
3. Se uma página não tiver texto extraível, ela mantém sua numeração e recebe o estado **Página sem texto selecionável**. Em PDF misto, as páginas com texto continuam disponíveis. Um documento inteiramente digitalizado explica que precisa de OCR.
4. Se houver senha, pedir no momento da importação, com tentativa novamente. Guardar o original criptografado e tratar separadamente qualquer texto extraído persistente, deixando claro o efeito para quem compartilha o aparelho. Antes de implementar, a opção proposta é manter leitura em memória por sessão para PDFs protegidos, preservando a página salva e pedindo senha novamente ao reabrir.

### Extração e qualidade

- Prototipar com PDF.js e usar processamento fora da interface. Guardar texto e proveniência por página, preservar a ordem física e aproveitar sumário e estrutura quando presentes. Carregar o texto visível sob demanda se as medições indicarem pressão de memória. [PDF.js — páginas](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html) · [PDF.js — documentos](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html)
- Extrair parágrafos com base em geometria e quebras. Nos documentos de referência de duas colunas, ler uma coluna inteira antes da outra. Tratar hifens de quebra de linha sem unir palavras compostas. Aplicar a remoção de cabeçalho e rodapé repetidos apenas em casos identificáveis. Para páginas em que a ordem é ambígua, conservar a referência à página e testar a apresentação de um aviso antes de tentar correção automática mais agressiva.
- Criar um conjunto de referência com PDFs digitais de uma e duas colunas, capítulos, acentos, tabelas, numeração romana, imagens, páginas vazias, texto misto, senha, arquivo truncado e documento de 200 páginas. Associar trechos esperados e ordem a cada amostra. Tratar tabelas complexas e fórmulas como parte de uma avaliação de qualidade futura.
- Tratar cancelamento, corrupção e falta de espaço sem deixar registros parciais. Medir tempo de importação e de reabertura, tempo para a primeira frase, tamanho e memória. Como alvo inicial a confirmar no aparelho de referência, abrir um PDF de 200 páginas já importado em até cinco segundos, com importação que mantém a interface responsiva. Registrar modelo do celular, tamanho do arquivo e medições para que a meta seja comparável.

**Aceite.** Um PDF textual comum pode ser importado, ouvido, pesquisado e reaberto offline na mesma página e frase. Documentos de referência de duas colunas mantêm a ordem esperada. A leitura cruza páginas consecutivas sem duplicar ou perder trechos no corpus. Páginas vazias preservam a contagem. Cancelar ou tentar importar arquivo corrompido permite continuar usando a biblioteca. EPUB e TXT continuam passando pelos mesmos testes da versão atual.

## Etapa 4 — Escuta diária, vozes e controles de mídia

- **Temporizador.** Oferecer 15, 30 e 60 minutos e **Fim do capítulo**. Mostrar a opção ativa no player e permitir cancelar ou estender. Ao vencer, pausar, salvar a posição e parar o serviço Android. Testar com tela bloqueada, interrupção de áudio, mudança de livro e troca de velocidade. Se o sistema suspender o JavaScript, executar o temporizador junto ao player Android.
- **Controles de mídia no Android.** Prototipar sessão de mídia com título, capítulo e capa. Mapear play/pause, frase anterior e próxima na notificação, na tela bloqueada e no Bluetooth. Desconexão do fone deve pausar antes de transferir o áudio ao alto-falante. Definir se o comando de retomada reabre o último livro ou exige sessão ativa. [Android Media3](https://developer.android.com/media/media3/session/background-playback) · [Mudanças na saída de áudio](https://developer.android.com/media/platform/output)
- **Fila nativa se a validação exigir.** Se o WebView parar entre frases com a tela bloqueada, avaliar fila de WAV em `MediaSessionService`, com buffer curto e apenas uma fonte de estado de reprodução. O protótipo precisa demonstrar síntese de frases novas com a interface suspensa. Validar troca de livro, final de fila, perda de foco, cancelamento, descarte dos arquivos temporários e recuperação da posição antes de escolher a arquitetura definitiva. [Reprodução em segundo plano com Media3](https://developer.android.com/media/media3/session/background-playback)
- **Voz local e pronúncia.** Rotular vozes locais, remotas e Piper baixado. Oferecer opção **Somente vozes locais**, sem troca automática para uma voz remota. Dar acesso a uma amostra padronizada por idioma. Se os testes mostrarem pronúncias recorrentes que incomodam, prototipar um dicionário local de substituições, com prévia e aplicação exclusiva no áudio. [Web Speech API](https://webaudio.github.io/web-speech-api/#dom-speechsynthesisvoice-localservice)
- **Gestão de armazenamento.** Mostrar estimativa separada para livros, cache de áudio, vozes e pacotes OCR. Permitir remover uma voz ou limpar o cache de áudio. Se remover a voz ativa, voltar ao estado **Escolher voz**. Cancelar download e oferecer nova tentativa depois de falha de rede ou falta de espaço. Reaproveitar a limpeza de áudio existente. [Cache](/mnt/500/Leitor_PDF/packages/core/src/library.ts:110) · [Piper](/mnt/500/Leitor_PDF/packages/voice/src/piper.ts:119)

**Aceite.** App, controles de mídia e fone mostram o mesmo estado. Uma pausa, temporizador ou perda de foco interrompe a leitura e conserva a frase para retomada. Em modo local, fechar e reabrir em modo avião permite sintetizar um trecho inédito com uma voz instalada. Limpar cache ou remover uma voz preserva a biblioteca, marcadores e posições.

## Etapa 5 — OCR local para páginas digitalizadas

- Detectar ausência de texto por página. Mostrar quantas páginas precisam de OCR e oferecer **Reconhecer esta página**, **Reconhecer intervalo** e, após medir o custo, **Reconhecer páginas sem texto**. Começar com português. Mostrar tamanho e estado do pacote de idioma antes de baixá-lo.
- Renderizar a página para imagem e reconhecer em worker local. Manter uma fila limitada por memória, com progresso por página, cancelamento e retomada. Tesseract.js é um candidato para o protótipo. Ele recebe imagens, então a renderização continua com o mecanismo de PDF. [Tesseract.js](https://github.com/naptha/tesseract.js#project-scope) · [Instalação local](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
- Guardar o texto OCR com o número da página e origem explícita. Em PDF misto, preservar o texto digital onde já existe e trabalhar nas páginas selecionadas. Ao refazer OCR, substituir o resultado daquela página de forma consistente e resolver a posição pelo contexto. Permitir ouvir e buscar o texto reconhecido e comparar com a imagem da página.
- Medir em páginas limpas, inclinadas, rotacionadas, com baixo contraste, duas colunas e acentos. Registrar tempo por página, pico de memória e acurácia a partir de transcrições de referência. Testar arquivos longos com interrupção voluntária e fechamento do app. Definir limites de resolução e tamanho a partir do aparelho de referência antes de liberar lotes completos.

**Aceite.** O usuário identifica páginas digitalizadas e reconhece um intervalo localmente após obter o idioma. Pode cancelar, reabrir e continuar. Em arquivo misto, as páginas processadas ficam pesquisáveis e audíveis, sem duplicar texto das páginas digitais. A numeração e os marcadores mantêm o vínculo com o original. Manuscritos e fórmulas ficam como casos para avaliação posterior.

## Ideias para depois das entregas principais

| Ideia | Valor para o usuário | Condição para entrar |
| --- | --- | --- |
| Abrir com Leitor no Android | Abrir um EPUB, TXT ou PDF diretamente de Arquivos ou do compartilhamento | Importação com nome, permissão temporária e falhas previsíveis já validada |
| Favoritos, coleções e edição de metadados | Organizar uma biblioteca maior ou corrigir títulos extraídos | Busca e ordenação já em uso. Validar com uma biblioteca de dezenas de títulos |
| Seleção, notas e exportação de marcações | Reencontrar e levar trechos de estudo | Posições estáveis e relação entre trecho e página disponíveis |
| Repetir frase e pausa entre frases | Acompanhar idiomas e revisar textos em voz alta | Controles de reprodução e estado do player estabilizados |
| Exportação de áudio por capítulo | Ouvir em outro player | Decidir limite de duração, espaço, formato e compatibilidade dos motores. O Piper gera WAV, enquanto o motor do sistema tem outro fluxo |
| DOCX, HTML e Markdown | Ler materiais que ainda precisam de conversão | Escolher formatos a partir de arquivos reais, após validar PDF |
| Sincronização entre aparelhos | Alternar entre PC e celular mantendo a posição | Usar primeiro backup portátil. Avaliar conflitos, privacidade e custo de manter sincronização se houver demanda |
| App nativo para iPhone | Explorar leitura com tela bloqueada e controles de mídia | Testar a PWA instalada no iPhone. Avaliar app nativo se a PWA não cumprir um requisito confirmado |

## Matriz de validação e entrega

| Área | Casos mínimos | Evidência esperada |
| --- | --- | --- |
| Navegador e PWA | Chromium e Firefox, instalação e reabertura offline, modo claro/escuro, teclado, zoom, alterações no service worker | Registro de importação, busca, retomada e voz Piper com trecho novo. Atualização conserva os dados |
| Android | Pelo menos dois aparelhos quando disponíveis, incluindo Android 13 ou posterior, modo avião, tela bloqueada, interrupções, bateria e Bluetooth | Instalação limpa e atualização sobre 1.0.1, execução da etapa 0, log de falhas reproduzíveis e duração da sessão |
| iPhone | Safari e PWA adicionada à Tela de Início, seletor de arquivos, VoiceOver, modo avião e bloqueio de tela | Registrar quais fluxos funcionam e em que condições o áudio continua. O resultado orienta a decisão sobre iOS nativo |
| Desktop | Linux Tauri e Windows com NSIS, instalação limpa e atualização, EPUB/TXT/PDF, teclado e voz offline | Artefato gerado na plataforma, biblioteca preservada e registro de requisitos do instalador. Se instalação sem rede for necessária, testar o empacotamento do WebView2 offline |
| Dados | Perfil novo, base anterior, arquivo inválido, cota cheia, importação cancelada e restauração duplicada | Estado consistente e capacidade de recuperar originais, progresso e marcadores |
| Corpus | EPUB 2 e 3, TXT UTF‑8 e Windows‑1252, PDFs descritos na etapa 3 e digitalizações da etapa 5 | Resultados esperados por arquivo e medições em um aparelho de referência |

O pipeline deve rodar checagem TypeScript, build web e testes dos fluxos críticos. Para cada entrega móvel, gerar um APK versionado, verificar assinatura e conteúdo e registrar o que foi validado em aparelho. Para Windows, gerar o instalador no ambiente que tenha o toolchain e o empacotador necessários. [Distribuição Windows no Tauri](https://v2.tauri.app/distribute/windows-installer/)

## Decisões para aprovação

1. **Escopo inicial.** Aprovar primeira leitura e acessibilidade, navegação e backup, e PDF textual como primeiro pacote. Validar o APK 1.0.1 enquanto a fundação é planejada.
2. **Comportamento de PDF protegido.** Aprovar sessão em memória com senha solicitada ao reabrir, ou deixar o formato protegido para depois da primeira entrega de PDF.
3. **Prioridade de áudio.** Se o APK falhar com tela bloqueada em um aparelho de referência, decidir se fila nativa entra antes do PDF. Se o teste passar, priorizar PDF e adicionar controles de mídia na etapa de escuta diária.
4. **OCR.** Definir as primeiras amostras e o aparelho de referência antes de assumir tempo e acurácia. Começar com páginas selecionadas em português.

A implementação começa após sua aprovação. Os marcos de aceite permitem acompanhar e testar cada entrega à medida que o plano avança.
