/**
 * Classifica o campo document (CPF/CNPJ) dos clientes já salvos no SQLite.
 * Útil quando você não tem mais o CSV/Excel original, só o banco do sistema.
 *
 * Uso: node scripts/de-para-documentos-db.js
 *      node scripts/de-para-documentos-db.js --out "relatorio-docs.csv"
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, '..', 'data', 'database.sqlite');

function classifyDoc(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { tipo: 'vazio', digitos: '', observacao: '' };
  }
  const digitos = String(raw).trim().replace(/\D/g, '');
  if (digitos.length === 0) {
    return { tipo: 'sem_numeros', digitos: '', observacao: 'texto sem dígitos' };
  }
  if (digitos.length === 11) return { tipo: 'CPF', digitos, observacao: '11 dígitos' };
  if (digitos.length === 14) return { tipo: 'CNPJ', digitos, observacao: '14 dígitos' };
  if (digitos.length < 11) return { tipo: 'incompleto', digitos, observacao: digitos.length + ' dígitos' };
  if (digitos.length > 11 && digitos.length < 14) {
    return { tipo: 'incompleto', digitos, observacao: digitos.length + ' dígitos (entre CPF e CNPJ)' };
  }
  return { tipo: 'invalido', digitos, observacao: digitos.length + ' dígitos (mais de 14)' };
}

function escCSV(s) {
  if (s == null) return '';
  const t = String(s);
  if (/[",\r\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
  return t;
}

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
let outPath = null;
const args = argv.filter((a, i) => {
  if (a === '--out') return false;
  if (outIdx >= 0 && i === outIdx + 1) {
    outPath = a;
    return false;
  }
  return true;
});

if (!fs.existsSync(dbPath)) {
  console.error('Banco não encontrado:', dbPath);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath);
const finalOut = outPath
  ? path.resolve(outPath)
  : path.join(__dirname, '..', 'data', 'de-para-documentos-clientes.csv');

db.all('SELECT id, name, codigo, document FROM customers ORDER BY id', [], (err, rows) => {
  if (err) {
    console.error(err.message);
    db.close();
    process.exit(1);
  }
  const lines = [];
  lines.push(
    ['id', 'codigo', 'name', 'document_original', 'classificacao', 'so_digitos', 'obs']
      .map(escCSV)
      .join(',')
  );
  const stats = { CPF: 0, CNPJ: 0, vazio: 0, outro: 0 };
  (rows || []).forEach((r) => {
    const c = classifyDoc(r.document);
    if (c.tipo === 'CPF') stats.CPF++;
    else if (c.tipo === 'CNPJ') stats.CNPJ++;
    else if (c.tipo === 'vazio') stats.vazio++;
    else stats.outro++;
    lines.push(
      [r.id, r.codigo || '', r.name, r.document || '', c.tipo, c.digitos, c.observacao]
        .map(escCSV)
        .join(',')
    );
  });
  fs.writeFileSync(finalOut, '\uFEFF' + lines.join('\r\n'), 'utf8');
  console.log('Arquivo:', finalOut);
  console.log('Total clientes:', rows.length);
  console.log('Resumo document:', stats);
  db.close();
});
