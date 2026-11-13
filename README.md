# Leitor — livros em voz alta

Leitor de EPUB, TXT e PDF, com reconhecimento local de páginas digitalizadas. A mesma interface roda no navegador (PWA), no PC (Tauri) e no Android (Capacitor). Livros e posições ficam no aparelho, no IndexedDB. O Piper precisa de internet para baixar a voz na primeira vez.

Os pacotes de Android e PC ficam em [GitHub Releases](https://github.com/aaronmlf/leitor-pdf/releases).

## Recursos da versão 1.1

- Busca na biblioteca e dentro do livro, sem distinção entre maiúsculas e acentos. A biblioteca oferece **Continuar lendo** e filtros por formato.
- Sumário, navegação por frase ou página, marcadores editáveis, tamanho do texto, entrelinha, temas e acompanhamento opcional da narração.
- Backup ZIP com arquivos originais, posições, marcadores e preferências. A restauração exibe uma prévia e mescla os dados. Modelos de voz podem ser baixados novamente.
- PDF textual com extração local, progresso e cancelamento. Páginas sem texto mantêm a numeração. PDFs com senha são desbloqueados em memória a cada abertura.

## Recursos da versão 1.2

- Temporizador de 15, 30 ou 60 minutos e opção de parar ao fim do capítulo.
- Controles do Android para tocar, pausar e navegar por frases na tela bloqueada e em fones compatíveis enquanto o livro está aberto.
- OCR em português para PDF digitalizado ou misto. Escolha a página atual, um intervalo ou as páginas pendentes. O modelo vem incluído. O texto reconhecido fica disponível para leitura em voz alta, busca e backup. Para PDFs protegidos por senha, o leitor usa a camada de texto disponível no documento.
- Opção de usar apenas vozes locais, cancelar download de vozes, remover modelos Piper e limpar o cache de áudio.

## Comandos

```bash
npm ci               # instalar dependências com Node.js 22.13 ou posterior
npm run icons        # gerar ícones PWA (usa ImageMagick; rodar uma vez)
npm run fixture      # gerar o EPUB de demonstração (apps/web/public/leitor-demo.epub)
npm run dev          # servidor de desenvolvimento (apps/web)
npm run build        # build de produção + PWA
npm run preview      # servir o build (testa service worker)
npm run typecheck    # TS em todos os workspaces
```

## Estrutura (monorepo)

- `packages/core` — parsers EPUB e TXT, normalização da fala (pt-BR), posições de leitura, backup ZIP e persistência no IndexedDB (Dexie).
- `packages/voice` — camada de motor de voz trocável: `SystemVoiceEngine` (Web Speech API) e `PiperVoiceEngine` (ONNX/WASM offline, worker + prefetch + cache).
- `apps/web` — interface React, extração local com PDF.js e worker do Piper. A mesma interface é usada na PWA e nos aplicativos nativos.
- `apps/web/android` — projeto Android (Capacitor 8), com serviço de áudio em primeiro plano (`PlaybackService`) e plugin `BackgroundAudio`.
- `apps/desktop` — wrapper Tauri 2 (PC); o instalador Windows sai deste projeto.
- `scripts/` — geração do EPUB de demonstração e dos ícones.

## Status — Fase 1 (protótipo no navegador)

- [x] Abrir EPUB (arquivo ou arrastar) e extrair capítulos/parágrafos
- [x] Divisão em frases com proteção de abreviações, iniciais e números
- [x] Leitura com a voz do sistema: play/pause, velocidade, frase anterior/próxima, clicar numa frase para começar dela
- [x] Destaque da frase atual com rolagem automática
- [x] Posição e biblioteca salvas no IndexedDB (reabre onde parou)
- [x] PWA instalável (manifesto + service worker). A biblioteca abre offline depois da primeira visita.
- [x] Aviso quando o aparelho não tem voz de sistema (sugere o Piper)

## Status — Fase 2 (Piper offline)

- [x] `PiperVoiceEngine` rodando em Web Worker (UI não trava)
- [x] Catálogo de vozes do Hugging Face (pt-BR: faber/medium e edresson/low; pt-PT: tugão/medium)
- [x] Download do modelo com progresso, salvo em OPFS (persiste entre sessões)
- [x] Botão de amostra por voz e seleção ("Em uso")
- [x] Prefetch: a próxima frase é gerada enquanto a atual toca (sem pausas)
- [x] Cache de frases geradas no IndexedDB (releitura instantânea)
- [x] WASMs do ONNX Runtime e do phonemizer incorporados ao build a partir das dependências npm
- [x] Service worker cacheia os WASMs em runtime (CacheFirst) — TTS offline após o primeiro uso
- [ ] Escolha final da voz (usuário ouve faber, edresson e tugão no próprio aparelho)

## Status — Fase 3 (PC e Android)

- [x] Wrapper Tauri 2 (`apps/desktop`): janela, ícones (ico/icns/png), empacota o build do `apps/web`
- [x] Build do Tauri validado (binário compilado; instalador Windows sai com `npm run desktop:build` no Windows)
- [x] Projeto Android (Capacitor 8) gerado em `apps/web/android` com o app web embutido
- [x] Serviço de áudio em primeiro plano com notificação, wake lock e pausa ao perder o foco de áudio
- [x] Registro de service worker desativado nos shells nativos
- [x] Ícones nativos gerados
- [x] APK de teste gerado (`leitor-debug.apk`)
- [ ] Teste no aparelho: tela apagada, prioridade de áudio e escolha da voz
- [ ] Gerar e testar o instalador NSIS no Windows
- [ ] Validar a PWA no iPhone

## Status — Importação e leitura

- [x] Importar TXT pela biblioteca
- [x] Importar PDF com texto selecionável e navegar por página
- [x] Salvar, abrir, renomear e excluir marcadores por frase
- [x] Normalizar números, datas, valores e siglas em português durante a leitura em voz alta
- [x] Buscar livros e trechos, exportar backup e restaurar a biblioteca

## Como compilar os apps nativos

**Windows:** `npm run desktop:build -- --bundles nsis` gera o instalador em `apps/desktop/src-tauri/target/release/bundle/nsis/`.

**Linux:** `npm run desktop:build -- --bundles deb` gera o pacote em `apps/desktop/src-tauri/target/release/bundle/deb/`. As dependências de compilação usadas no GitHub estão no workflow `release.yml`.

**Android:** com JDK 21 e Android SDK 36 configurados, sincronize o build web e gere o APK de depuração.

```bash
npm run android:sync
cd apps/web/android
./gradlew assembleDebug
```

O APK fica em `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`. Para gerar pelo Android Studio, rode `npm run android:sync` antes de `npm run android:open`.

## EPUB de demonstração

O build inclui `leitor-demo.epub`; na biblioteca vazia há o botão "Testar com livro de demonstração". Os casos difíceis (números, siglas, diálogo com travessão, parágrafo longo) estão no capítulo 1.

## Próximas etapas

O [plano de evolução](PLANO_EVOLUCAO.md) reúne a revisão da interface, as propostas para PDF e áudio e os critérios de aceitação para aprovação.
