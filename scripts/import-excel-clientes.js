/**
 * Importa clientes do Excel (.xlsx) do zero: apaga todos os clientes e O.S., depois insere os da planilha.
 * Usa a coluna "codigo" (ou "código") da planilha e mantém a ordem das linhas.
 *
 * Uso: node scripts/import-excel-clientes.js "C:\caminho\cadastroclientesatualizado.csv.xlsx"
 */

const path = require('path');
const fs = require('fs');

const XLSX_PATH = process.argv[2] || path.join(process.env.USERPROFILE || '', 'OneDrive', 'Área de Trabalho', 'cadastroclientesatualizado.csv.xlsx');
const DB_PATH = path.join(__dirname, '..', 'data', 'database.sqlite');

function toStr(val) {
  if (val == null) return '';
  if (typeof val === 'object' && val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim();
}

function findCol(headers, keys, excludePrefix) {
  const h = (headers || []).map((c) => toStr(c).toLowerCase().normalize('NFD').replace(/\u0300/g, ''));
  for (const key of keys) {
    const k = key.toLowerCase().normalize('NFD').replace(/\u0300/g, '');
    const i = h.findIndex((x) => {
      if (excludePrefix && x.indexOf(excludePrefix) === 0) return false;
      return x === k || x.includes(k) || (k.length >= 3 && x.includes(k));
    });
    if (i >= 0) return i;
  }
  return -1;
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error('Arquivo não encontrado:', XLSX_PATH);
    console.error('Uso: node scripts/import-excel-clientes.js "C:\\caminho\\arquivo.xlsx"');
    process.exit(1);
  }

  const XLSX = (await import('xlsx')).default;
  const workbook = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) {
    console.error('Planilha vazia ou sem referência.');
    process.exit(1);
  }
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  if (!data || data.length < 2) {
    console.error('Planilha sem dados (precisa de cabeçalho + pelo menos 1 linha).');
    process.exit(1);
  }

  function rowLooksLikeHeader(row) {
    const h = (row || []).map((c) => toStr(c).toLowerCase().normalize('NFD').replace(/\u0300/g, ''));
    const hasCodigo = h.some((x) => /codigo|code/.test(x));
    const hasNome = h.some((x) => /nome|fantasia|razao|cliente|empresa/.test(x));
    const hasTel = h.some((x) => /telefone|fone|phone|celular/.test(x));
    return (hasCodigo && hasNome) || (hasNome && hasTel) || (hasCodigo && hasTel);
  }

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(20, data.length); r++) {
    if (rowLooksLikeHeader(data[r])) {
      headerRowIndex = r;
      break;
    }
  }
  if (headerRowIndex > 0) {
    console.log('Cabeçalho encontrado na linha', headerRowIndex + 1, '(pulando', headerRowIndex, 'linhas do topo)');
  }

  const headers = data[headerRowIndex];
  const rows = data.slice(headerRowIndex + 1);
  console.log('Aba:', sheetName, '|', rows.length, 'linhas de dados');

  const idxCodigo = findCol(headers, ['codigo', 'código', 'code']);
  const idxRazao = findCol(headers, ['razaosocial', 'razao social', 'razão social']);
  const idxFantasia = findCol(headers, ['nome fantasia', 'nomefantasia', 'fantasia']);
  const idxTelefone = findCol(headers, ['telefone', 'phone', 'fone', 'celular', 'foneres', 'fonecom']);
  const idxEmail = findCol(headers, ['email', 'e-mail', 'mail']);
  const idxEndereco = findCol(headers, ['endereco', 'endereço', 'address', 'end']);
  const idxDoc = findCol(headers, ['cpf', 'cnpj', 'documento', 'cpf/cnpj'], 'estado');
  const idxObs = findCol(headers, ['observacoes', 'observações', 'obs', 'notes']);

  if (idxRazao < 0 && idxFantasia < 0) {
    console.error('Nenhuma coluna Razão social ou Nome fantasia encontrada. Cabeçalhos:', headers.join(', '));
    process.exit(1);
  }

  console.log('Colunas: codigo=', idxCodigo >= 0 ? headers[idxCodigo] : '-', '| razao=', idxRazao >= 0 ? headers[idxRazao] : '-', '| fantasia=', idxFantasia >= 0 ? headers[idxFantasia] : '-', '| tel=', idxTelefone >= 0 ? headers[idxTelefone] : '-', '| email=', idxEmail >= 0 ? headers[idxEmail] : '-', '| end=', idxEndereco >= 0 ? headers[idxEndereco] : '-', '| doc=', idxDoc >= 0 ? headers[idxDoc] : '-');

  const toInsert = [];
  let ordem = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const get = (idx) => (idx >= 0 && row[idx] !== undefined ? toStr(row[idx]) : '');
    const razao = idxRazao >= 0 ? get(idxRazao) : '';
    const fantasia = idxFantasia >= 0 ? get(idxFantasia) : '';
    if (!razao && !fantasia) continue;
    ordem++;
    const codigoPlanilha = idxCodigo >= 0 ? get(idxCodigo) : '';
    const codigo = codigoPlanilha || String(ordem);
    const name = razao || fantasia;
    const nome_fantasia = razao ? (fantasia || null) : null;
    toInsert.push({
      ordem_planilha: ordem,
      codigo,
      name,
      nome_fantasia,
      phone: get(idxTelefone) || null,
      email: get(idxEmail) || null,
      address: get(idxEndereco) || null,
      document: get(idxDoc) || null,
      notes: get(idxObs) || null,
    });
  }

  const preview = process.argv.includes('--preview');
  if (preview) {
    console.log('\n--- PREVIEW (primeiras 10 linhas) - não importa, só mostra o que seria importado ---');
    toInsert.slice(0, 10).forEach((r, i) => {
      console.log((i + 1) + '. Código:', r.codigo, '| Nome (Razão social):', r.name || '-', '| Fantasia:', r.nome_fantasia || '-');
    });
    console.log('\nTotal que seria importado:', toInsert.length, 'clientes. Para importar de verdade, rode sem --preview.');
    process.exit(0);
  }

  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(DB_PATH);

  console.log('Linhas na planilha:', rows.length, '| a importar:', toInsert.length);

  db.serialize(() => {
    db.run('DELETE FROM service_orders', (err) => {
      if (err) {
        console.error('Erro ao apagar O.S.:', err.message);
        db.close();
        process.exit(1);
      }
      console.log('O.S. apagadas.');
    });
    db.run('DELETE FROM customers', (err) => {
      if (err) {
        console.error('Erro ao apagar clientes:', err.message);
        db.close();
        process.exit(1);
      }
      console.log('Clientes apagados.');
    });
  });

  db.run('DELETE FROM service_orders', function () {
    db.run('DELETE FROM customers', function () {
      const stmt = db.prepare(
        'INSERT INTO customers (ordem_planilha, codigo, name, nome_fantasia, phone, email, address, document, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      let done = 0;
      const total = toInsert.length;
      if (total === 0) {
        stmt.finalize(() => {
          db.close();
          console.log('Nenhuma linha para importar.');
        });
        return;
      }
      toInsert.forEach((r) => {
        stmt.run(r.ordem_planilha, r.codigo, r.name, r.nome_fantasia || null, r.phone, r.email, r.address, r.document, r.notes, (err) => {
          if (err) console.error('Erro:', r.name, err.message);
          done++;
          if (done === total) {
            stmt.finalize(() => {
              db.close();
              console.log('Concluído. Inseridos:', total, 'clientes.');
            });
          }
        });
      });
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
