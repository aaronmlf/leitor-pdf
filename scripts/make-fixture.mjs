import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

const OUT = path.resolve('apps/web/public/leitor-demo.epub')

const cap1 = [
  'Sr. Álvaro chegou atrasado, como sempre. O relógio marcava 10h30 quando empurrou a porta da livraria, ofegante, com um embrulho debaixo do braço.',
  '— Boa tarde! — disse ele, tirando o chapéu. — Trouxe o que prometi: o mapa que meu avô desenhou em 1927.',
  'Dona Célia examinou o papel com cuidado. O custo da restauração seria alto: R$ 1.250,00, talvez R$ 1.500,00 se faltasse tinta. Não era o preço que a assustava; era o risco de perder de vez as marcas do avô.',
  'Espera... não faça isso ainda, sussurrou ela. Precisamos conferir cada linha antes de decidir. O Dr. Beaumond, da seção de mapas antigos, pode vir amanhã. A Sra. Ferro, não; ela já foi embora.',
]

const cap2 = [
  'No dia seguinte, a chuva castigava a cidade. 1.050.000 moradores, segundo o jornal, ficaram sem energia elétrica. A livraria, por sorte, tinha velas.',
  '— A senha está escondida em três lugares — explicou Álvaro. — O primeiro é a estante número 7; o segundo, a gaveta 12; o terceiro... bem, o terceiro você descobre sozinho.',
  'Dona Célia anotou tudo. Sempre desconfiou de quem fala demais. Aí estão os detalhes que importam: medidas, números e datas. O resto é conversa.',
  'Ela abriu a gaveta 12 e encontrou uma carta amarelada. "Quem ler isto deve procurar a janela que olha para o quintal", dizia o bilhete, em letra fina e apressada.',
]

const cap3 = [
  'A janela do quintal rangeu quando foi aberta. Lá fora, o quintal estreito terminava num muro de pedras; no alto do muro, alguém tinha gravado três palavras quase apagadas pelo tempo: SIGA O SOL.',
  '— Siga o sol — repetiu Célia. — O que significa? Para onde vai o sol? Para oeste, obviamente. Então a resposta está a oeste daqui.',
  'Naquela noite, com a lanterna apontada para a parede do fundo, ela viu a sombra de um sol desenhado a giz. No centro, um pequeno desenho de chave. E, embaixo, uma data: 15.08.1927.',
  'Terminou ali a primeira parte da busca. A segunda começaria ao amanhecer, quando o sol — como sempre — voltasse a apontar o caminho.',
]

// Parágrafo longo (mais de 700 caracteres) para testar a quebra por pontuação.
const longParagraph =
  'A biblioteca municipal ficava numa esquina de esquinas, onde o ônibus 14 virava à esquerda e o 22 seguia reto, e quem esperava ali muito tempo acabava conhecendo os vizinhos de banco, as comadres do mercado, o vigia da escola, o menino que vendia pijamas de nanã, a dona do ponto de recarga de celular, o casal que discutia sempre às cinco e meia da tarde, e todos eles, sem exceção, tinham uma história sobre o prédio antigo do outro lado da rua, que ninguém sabia de cabeça quando fora construído, mas que todos juravam ser mais velho que a própria cidade, e talvez fosse, pois as pedras do alicerce, diziam, tinham vindo de navio, uma a uma, embrulhadas em palha e contadas pelo escrivão da colônia, que por sua vez aparece num retrato amarelecido no saguão da prefeitura, segurando um guarda-chuva que não parecia dele.'

function chapterXhtml(title, paragraphs) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR" xml:lang="pt-BR">
<head><title>${title}</title></head>
<body>
<h1>${title}</h1>
${paragraphs.map(p => `  <p>${p}</p>`).join('\n')}
</body>
</html>
`
}

const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:leitor-demo-0001</dc:identifier>
    <dc:title>Livro de Demonstração</dc:title>
    <dc:creator>Leitor (demo)</dc:creator>
    <dc:language>pt-BR</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cap1" href="text/cap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cap2" href="text/cap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cap3" href="text/cap3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cap1"/>
    <itemref idref="cap2"/>
    <itemref idref="cap3"/>
  </spine>
</package>
`

const css = `body { font-family: serif; margin: 5%; }
h1 { text-align: center; }
p { text-indent: 1.5em; }
`

const zip = new JSZip()
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
zip.file('META-INF/container.xml', container)
zip.file('OEBPS/content.opf', opf)
zip.file('OEBPS/style.css', css)
zip.file('OEBPS/text/cap1.xhtml', chapterXhtml('Capítulo 1 — O embrulho', [...cap1, longParagraph]))
zip.file('OEBPS/text/cap2.xhtml', chapterXhtml('Capítulo 2 — A gaveta 12', cap2))
zip.file('OEBPS/text/cap3.xhtml', chapterXhtml('Capítulo 3 — Siga o sol', cap3))

await mkdir(path.dirname(OUT), { recursive: true })
const buffer = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
await writeFile(OUT, buffer)
console.log(`EPUB de demonstração gerado em ${OUT} (${buffer.length} bytes)`)
