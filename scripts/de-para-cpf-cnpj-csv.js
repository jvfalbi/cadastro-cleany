/**
 * Lê um CSV e classifica o conteúdo das colunas E e F como CPF, CNPJ ou outro.
 *
 * Colunas: A=0, B=1, C=2, D=3, E=4, F=5
 *
 * Uso:
 *   node scripts/de-para-cpf-cnpj-csv.js "C:\caminho\arquivo.csv"
 *   node scripts/de-para-cpf-cnpj-csv.js "arquivo.csv" --out "relatorio-de-para.csv"
 *   node scripts/de-para-cpf-cnpj-csv.js "arquivo.csv" --sep ";"
 */

const fs = require('fs');
const path = require('path');

const COL_E = 4;
const COL_F = 5;

function parseCSVLine(line, sep) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === sep && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result.map((s) => s.trim());
}

function classifyDoc(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { tipo: 'vazio', digitos: '', observacao: '' };
  }
  const str = String(raw).trim();
  const digitos = str.replace(/\D/g, '');
  if (digitos.length === 0) {
    return { tipo: 'sem_numeros', digitos: '', observacao: 'texto sem dígitos' };
  }
  if (digitos.length === 11) {
    return { tipo: 'CPF', digitos, observacao: '11 dígitos' };
  }
  if (digitos.length === 14) {
    return { tipo: 'CNPJ', digitos, observacao: '14 dígitos' };
  }
  if (digitos.length < 11) {
    return { tipo: 'incompleto', digitos, observacao: digitos.length + ' dígitos (esperado 11 ou 14)' };
  }
  if (digitos.length > 11 && digitos.length < 14) {
    return { tipo: 'incompleto', digitos, observacao: digitos.length + ' dígitos (entre CPF e CNPJ)' };
  }
  return { tipo: 'invalido', digitos, observacao: digitos.length + ' dígitos (mais de 14)' };
}

function escCSV(s, sepChar) {
  if (s == null) return '';
  const t = String(s);
  const needQuote = new RegExp('["' + sepChar + '\r\n]');
  if (needQuote.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

function linhaResumo(eClass, fClass) {
  const parts = [];
  if (eClass.tipo === 'CPF') parts.push('E=CPF');
  else if (eClass.tipo === 'CNPJ') parts.push('E=CNPJ');
  else if (eClass.tipo === 'vazio') parts.push('E vazio');
  else parts.push('E=' + eClass.tipo);

  if (fClass.tipo === 'CPF') parts.push('F=CPF');
  else if (fClass.tipo === 'CNPJ') parts.push('F=CNPJ');
  else if (fClass.tipo === 'vazio') parts.push('F vazio');
  else parts.push('F=' + fClass.tipo);

  return parts.join(' | ');
}

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const sepIdx = argv.indexOf('--sep');
let outPath = null;
let sep = ',';
if (sepIdx >= 0 && argv[sepIdx + 1]) {
  sep = argv[sepIdx + 1];
}
const args = argv.filter((a, i) => {
  if (a === '--out' || a === '--sep') return false;
  if (outIdx >= 0 && i === outIdx + 1) {
    outPath = a;
    return false;
  }
  if (sepIdx >= 0 && i === sepIdx + 1) return false;
  return true;
});

const inputPath = args[0];
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error('Informe o caminho de um arquivo CSV existente.');
  console.error('Exemplo: node scripts/de-para-cpf-cnpj-csv.js "C:\\pasta\\clientes.csv"');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');
const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);

const rows = [];
for (let i = 0; i < lines.length; i++) {
  rows.push(parseCSVLine(lines[i], sep));
}

const header = rows[0] || [];
const dataRows = rows.slice(1);

const outLines = [];
outLines.push(
  [
    'linha_csv',
    'col_E_original',
    'col_E_classificacao',
    'col_E_so_digitos',
    'col_E_obs',
    'col_F_original',
    'col_F_classificacao',
    'col_F_so_digitos',
    'col_F_obs',
    'de_para_resumo',
  ]
    .map((c) => escCSV(c, ','))
    .join(',')
);

let stats = { E_CPF: 0, E_CNPJ: 0, E_vazio: 0, E_outro: 0, F_CPF: 0, F_CNPJ: 0, F_vazio: 0, F_outro: 0 };

dataRows.forEach((cells, idx) => {
  const linhaNum = idx + 2;
  const valE = cells[COL_E] != null ? cells[COL_E] : '';
  const valF = cells[COL_F] != null ? cells[COL_F] : '';
  const eClass = classifyDoc(valE);
  const fClass = classifyDoc(valF);

  if (eClass.tipo === 'CPF') stats.E_CPF++;
  else if (eClass.tipo === 'CNPJ') stats.E_CNPJ++;
  else if (eClass.tipo === 'vazio') stats.E_vazio++;
  else stats.E_outro++;

  if (fClass.tipo === 'CPF') stats.F_CPF++;
  else if (fClass.tipo === 'CNPJ') stats.F_CNPJ++;
  else if (fClass.tipo === 'vazio') stats.F_vazio++;
  else stats.F_outro++;

  outLines.push(
    [
      linhaNum,
      valE,
      eClass.tipo,
      eClass.digitos,
      eClass.observacao,
      valF,
      fClass.tipo,
      fClass.digitos,
      fClass.observacao,
      linhaResumo(eClass, fClass),
    ]
      .map((c) => escCSV(c, ','))
      .join(',')
  );
});

const defaultOut = path.join(
  path.dirname(path.resolve(inputPath)),
  'de-para-colunas-E-F-' + path.basename(inputPath, path.extname(inputPath)) + '.csv'
);
const finalOut = outPath ? path.resolve(outPath) : defaultOut;
fs.writeFileSync(finalOut, '\uFEFF' + outLines.join('\r\n'), 'utf8');

console.log('Arquivo gerado:', finalOut);
console.log('Separador de leitura:', JSON.stringify(sep));
console.log('Cabeçalho detectado (linha 1) — coluna E = índice', COL_E + 1, '→', header[COL_E] || '(vazio)');
console.log('Cabeçalho detectado (linha 1) — coluna F = índice', COL_F + 1, '→', header[COL_F] || '(vazio)');
console.log('');
console.log('Resumo coluna E:', {
  CPF: stats.E_CPF,
  CNPJ: stats.E_CNPJ,
  vazio: stats.E_vazio,
  outro: stats.E_outro,
});
console.log('Resumo coluna F:', {
  CPF: stats.F_CPF,
  CNPJ: stats.F_CNPJ,
  vazio: stats.F_vazio,
  outro: stats.F_outro,
});
