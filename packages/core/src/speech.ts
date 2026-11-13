/**
 * Normalização de texto para fala (pt-BR). O texto na tela continua o
 * original; esta transformação é aplicada apenas no que vai para o motor
 * de voz, que lê números, horas, dinheiro, ordinais e siglas "por extenso"
 * de forma errada se receber o texto cru.
 */

const UNIDADES = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito',
  'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis',
  'dezessete', 'dezoito', 'dezenove',
]

const DEZENAS = [
  '', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta',
  'oitenta', 'noventa',
]

const CENTENAS = [
  'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
]

function under100(value: number): string {
  if (value < 20) return UNIDADES[value]!
  const dezena = DEZENAS[Math.floor(value / 10)]!
  const unidade = value % 10
  return unidade === 0 ? dezena : `${dezena} e ${UNIDADES[unidade]!}`
}

function under1000(value: number): string {
  if (value < 100) return under100(value)
  const centena = Math.floor(value / 100)
  const resto = value % 100
  if (centena === 1 && resto === 0) return 'cem'
  const base = CENTENAS[centena - 1]!
  return resto === 0 ? base : `${base} e ${under100(resto)}`
}

function underMillion(value: number): string {
  if (value < 1000) return under1000(value)
  const milhar = Math.floor(value / 1000)
  const resto = value % 1000
  const base = milhar === 1 ? 'mil' : `${under1000(milhar)} mil`
  if (resto === 0) return base
  // Regra clássica: "mil e cem", "mil e vinte", mas "mil duzentos e trinta".
  if (resto < 100 || resto % 100 === 0) return `${base} e ${under1000(resto)}`
  return `${base} ${under1000(resto)}`
}

/** 0..999.999.999 → palavras em pt-BR ("1.024" → "mil e vinte e quatro"). */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value))
  if (!Number.isFinite(n) || n > 999_999_999) return String(Math.floor(value))
  if (n < 1_000_000) return underMillion(n)
  const milhões = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000
  const base = milhões === 1 ? 'um milhão' : `${underMillion(milhões)} milhões`
  if (resto === 0) return base
  if (resto < 100 || resto % 100 === 0) return `${base} e ${underMillion(resto)}`
  return `${base} ${underMillion(resto)}`
}

const DIGITOS: Record<string, string> = {
  '0': 'zero', '1': 'um', '2': 'dois', '3': 'três', '4': 'quatro',
  '5': 'cinco', '6': 'seis', '7': 'sete', '8': 'oito', '9': 'nove',
}

const LETRAS: Record<string, string> = {
  B: 'bê', C: 'cé', D: 'dê', F: 'éfe', G: 'gê', H: 'agá', J: 'jota',
  K: 'cá', L: 'éle', M: 'eme', N: 'ene', P: 'pé', Q: 'quê', R: 'erre',
  S: 'ésse', T: 'tê', V: 'vê', W: 'dáblio', X: 'xis', Y: 'ípsilon', Z: 'zê',
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const ORDINAL_M = [
  'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo',
  'oitavo', 'nono', 'décimo',
]
const ORDINAL_F = [
  'primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima',
  'oitava', 'nona', 'décima',
]
const DEZENAS_ORDINAIS_M = [
  '', 'décimo', 'vigésimo', 'trigésimo', 'quadragésimo', 'quinquagésimo',
  'sexagésimo', 'septuagésimo', 'octogésimo', 'nonagésimo',
]

/** 1..99 como ordinal ("21" → "vigésimo primeiro" / "vigésima segunda"). */
export function ordinalPt(n: number, feminino: boolean): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return numberToWords(n)
  const ordinais = feminino ? ORDINAL_F : ORDINAL_M
  if (n <= 10) return ordinais[n - 1]!
  const dezena = DEZENAS_ORDINAIS_M[Math.floor(n / 10)]!
  const base = feminino ? dezena.replace(/o$/, 'a') : dezena
  const unidade = n % 10
  return unidade === 0 ? base : `${base} ${ordinais[unidade - 1]!}`
}

const VALOR_ROMANO: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500 }

/**
 * Numeral romano em forma canônica (I..D, sem M). Exclui M de propósito:
 * palavras como "MIX" e "MIL" contêm letras romanas e virariam números.
 */
const ROMANO_ESTRITO = /^(?:(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))$/

/** Valor de um numeral romano canônico, ou null se não for um. */
function romanValue(s: string): number | null {
  if (!ROMANO_ESTRITO.test(s)) return null
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const atual = VALOR_ROMANO[s.charAt(i)]
    if (!atual) return null
    const próximo = VALOR_ROMANO[s.charAt(i + 1)] ?? 0
    total += atual < próximo ? -atual : atual
  }
  return total > 0 && total < 4000 ? total : null
}

/** Nomes femininos que não terminam em "a" (para ordinais de rainhas etc.). */
const NOMES_FEMININOS = /^(elizabeth|isabel|elisabete|catherine|vit[óo]ria|margarida|beatriz)/i

/** Abreviações que os motores de voz leem letra a letra ou erram. */
const ABREVIATURAS: Array<[RegExp, string]> = [
  [/\bsrta\.\s?/gi, 'senhorita '],
  [/\bsra\.\s?/gi, 'senhora '],
  [/\bsr\.\s?/gi, 'senhor '],
  [/\bdra\.\s?/gi, 'doutora '],
  [/\bdr\.\s?/gi, 'doutor '],
  [/\bprofa\.\s?/gi, 'professora '],
  [/\bprof\.\s?/gi, 'professor '],
  [/\bv\.?\s?exa\b\.?\s?/gi, 'sua excelência '],
  [/\bexa\b\.?\s?/gi, 'excelência '],
  [/\bexmo\b\.?\s?/gi, 'excelentíssimo '],
  [/\bexma\b\.?\s?/gi, 'excelentíssima '],
  [/\bav\.\s?/gi, 'avenida '],
  [/\bcia\.\s?/gi, 'companhia '],
  [/\bpág\.\s?/gi, 'página '],
  [/\betc\.?\b/gi, 'etcétera'],
  [/\bcap\.\s?/gi, 'capítulo '],
  [/\bart\.\s?/gi, 'artigo '],
  [/\bed\.\s?/gi, 'edição '],
  [/\bvol\.\s?/gi, 'volume '],
  [/\bjr\.\s?/gi, 'júnior '],
  [/\bnº\.?\s?/gi, 'número '],
  [/§/g, ' parágrafo '],
]

/**
 * Prepara um trecho para o motor de voz: expande abreviações e converte
 * números, horas, dinheiro, ordinais, datas, medidas e siglas para palavras.
 */
export function normalizeForSpeech(input: string): string {
  let text = input

  // Horas: 10h30, 10h30min, 10h
  text = text.replace(/\b(\d{1,2})h(\d{2})(?:min)?\b/gi, (_, h: string, m: string) => {
    const hora = Number(h)
    const minuto = Number(m)
    const sufixo = hora === 1 ? 'hora' : 'horas'
    return minuto > 0
      ? `${numberToWords(hora)} ${sufixo} e ${numberToWords(minuto)}`
      : `${numberToWords(hora)} ${sufixo}`
  })
  text = text.replace(/\b(\d{1,2})h\b/gi, (_, h: string) => {
    const hora = Number(h)
    return `${numberToWords(hora)} ${hora === 1 ? 'hora' : 'horas'}`
  })

  // Dinheiro: R$ 1.250, R$ 1.250,00, R$ 0,50
  text = text.replace(/R\$\s*(\d+(?:\.\d{3})*)(?:,(\d{2}))?/g, (_, inteiro: string, centavos?: string) => {
    const reais = Number(inteiro.replace(/\./g, ''))
    const cents = centavos ? Number(centavos) : 0
    if (reais === 0 && cents === 0) return 'zero real'
    const partes: string[] = []
    if (reais > 0) partes.push(`${numberToWords(reais)} ${reais === 1 ? 'real' : 'reais'}`)
    if (cents > 0) partes.push(`${numberToWords(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`)
    return partes.join(' e ')
  })

  // Datas: 13/11/2026, 13-11-2026 ou 13.11.2026.
  text = text.replace(/\b(\d{1,2})([./-])(\d{1,2})(?:\2(\d{2,4}))?\b/g, (original, d: string, separator: string, m: string, y?: string) => {
    const dia = Number(d)
    const mes = MESES[Number(m) - 1]
    if (!mes || dia < 1 || dia > 31 || (separator === '.' && y?.length !== 4)) return original
    const ano = y ? Number(y) : null
    const anoTexto = ano === null
      ? ''
      : ` de ${numberToWords(ano < 100 ? 2000 + ano : ano)}`
    return `${numberToWords(dia)} de ${mes}${anoTexto}`
  })

  // Medidas coladas no número: 10 km, 3 kg, 5 m, 20 ml…
  text = text.replace(/\b(\d+(?:\.\d{3})*)\s?(km\/h|km|kg|cm|mm|ml|m|l)\b/gi, (original, n: string, unidade: string) => {
    const valor = Number(n.replace(/\./g, ''))
    if (!Number.isFinite(valor)) return original
    const nome = {
      'km/h': 'quilômetros por hora',
      km: 'quilômetros',
      kg: 'quilos',
      cm: 'centímetros',
      mm: 'milímetros',
      ml: 'mililitros',
      m: 'metros',
      l: 'litros',
    }[unidade.toLowerCase()]
    if (!nome) return original
    return `${numberToWords(valor)} ${nome}`
  })

  // Ordinais: 1º, 2ª, 21º
  text = text.replace(/(\d+)([ºª])/g, (_, n: string, sufixo: string) =>
    ordinalPt(Number(n), sufixo === 'ª'))

  // Graus: 45° → "quarenta e cinco graus"
  text = text.replace(/(\d+)\s?°/g, (_, n: string) => `${numberToWords(Number(n))} graus`)

  // Porcentagem: 50%
  text = text.replace(/(\d+)\s?%/g, (_, n: string) => `${numberToWords(Number(n))} por cento`)

  // Decimais: 3,14 → "três vírgula um quatro"
  text = text.replace(/\b(\d+(?:\.\d{3})*),(\d+)\b/g, (_, inteiro: string, decimais: string) =>
    `${numberToWords(Number(inteiro.replace(/\./g, '')))} vírgula ${[...decimais].map(c => DIGITOS[c] ?? c).join(' ')}`)

  // Milhares com ponto: 1.024, 12.345.678
  text = text.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, m => numberToWords(Number(m.replace(/\./g, ''))))

  // Inteiros soltos: 1827 → "mil oitocentos e vinte e sete" (anos leem assim)
  text = text.replace(/\b\d+\b/g, n => numberToWords(Number(n)))

  for (const [pattern, replacement] of ABREVIATURAS) {
    text = text.replace(pattern, replacement)
  }

  // Romanos depois de nome próprio: "Pedro II" → "Pedro segundo"
  text = text.replace(/\b([A-ZÀ-Ú][a-zà-úç]+)\s+([IVXLC]{1,4})\b/g, (original, nome: string, romano: string) => {
    const valor = romanValue(romano.toUpperCase())
    if (valor === null) return original
    const feminino = /a$/.test(nome) || NOMES_FEMININOS.test(nome)
    if (valor <= 20) return `${nome} ${ordinalPt(valor, feminino)}`
    return `${nome} ${numberToWords(valor)}`
  })

  // Romanos soltos: "Capítulo XV" já virou número? Não — XV está aqui:
  text = text.replace(/\b[IVXLC]{1,7}\b/g, romano => {
    const valor = romanValue(romano)
    return valor === null ? romano : numberToWords(valor)
  })

  // Siglas só de consoantes: CPF → "cé pé éfe", CD → "cé dê"
  text = text.replace(/\b[BCDFGHJKLMNPQRSTVWXYZ]{2,5}\b/g, m =>
    [...m].map(c => LETRAS[c] ?? c).join(' '))

  return text.replace(/\s+/g, ' ').trim()
}
