/**
 * Exporta todas as tabelas de um arquivo Access (.mdb) para CSV.
 * Um arquivo por tabela, na pasta escolhida (padrão: pasta do MDB).
 *
 * Uso: node scripts/export-mdb-to-csv.js "C:\caminho\clientes.mdb"
 *      node scripts/export-mdb-to-csv.js "C:\caminho\clientes.mdb" "C:\saida"
 */

const path = require('path');
const fs = require('fs');

const MDB_PATH = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads', 'clientes', 'clientes.mdb');
const OUT_DIR = process.argv[3] || path.join(path.dirname(MDB_PATH), 'clientes-csv');

function escapeCsv(val) {
  if (val == null) return '';
  const s = typeof val === 'object' && val instanceof Date
    ? val.toISOString()
    : String(val);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

async function main() {
  if (!fs.existsSync(MDB_PATH)) {
    console.error('Arquivo não encontrado:', MDB_PATH);
    console.error('Uso: node scripts/export-mdb-to-csv.js "C:\\caminho\\clientes.mdb" [pasta-saida]');
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  console.log('MDB:', MDB_PATH);
  console.log('Saída:', OUT_DIR);

  const { readFileSync } = require('fs');
  const MDBReader = (await import('mdb-reader')).default;

  const buffer = readFileSync(MDB_PATH);
  const reader = new MDBReader(buffer);
  const tableNames = reader.getTableNames().filter((t) => !/^msys/i.test(t));

  for (const tableName of tableNames) {
    const table = reader.getTable(tableName);
    const columnNames = table.getColumnNames();
    const rows = table.getData();

    const safeName = tableName.replace(/[^\w\s-]/g, '_').replace(/\s+/g, '_');
    const csvPath = path.join(OUT_DIR, safeName + '.csv');

    const header = columnNames.map(escapeCsv).join(';');
    const lines = rows.map((row) =>
      columnNames.map((col) => escapeCsv(row[col])).join(';')
    );
    const content = [header, ...lines].join('\n');

    fs.writeFileSync(csvPath, '\uFEFF' + content, 'utf8');
    console.log('  ', tableName, '->', csvPath, '(' + rows.length, 'linhas)');
  }

  console.log('Concluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
