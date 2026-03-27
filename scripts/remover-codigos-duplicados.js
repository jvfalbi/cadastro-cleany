/**
 * Encontra clientes com código duplicado e, opcionalmente, remove os duplicados
 * mantendo apenas o registro com menor id (e transferindo as O.S. para ele).
 *
 * Uso:
 *   node scripts/remover-codigos-duplicados.js          # só lista duplicados
 *   node scripts/remover-codigos-duplicados.js --apply  # remove duplicados (mantém o de menor id)
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'data', 'database.sqlite');
const APPLY = process.argv.includes('--apply');

const db = new sqlite3.Database(DB_PATH);

function run() {
  // Códigos que aparecem mais de uma vez (considerando apenas não vazios)
  db.all(
    `SELECT TRIM(COALESCE(codigo, '')) AS codigo, COUNT(*) AS qtd, GROUP_CONCAT(id) AS ids
     FROM customers
     WHERE TRIM(COALESCE(codigo, '')) != ''
     GROUP BY TRIM(COALESCE(codigo, ''))
     HAVING COUNT(*) > 1`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Erro ao buscar duplicados:', err.message);
        db.close();
        process.exit(1);
      }
      if (rows.length === 0) {
        console.log('Nenhum código duplicado encontrado.');
        db.close();
        return;
      }
      console.log('Códigos duplicados encontrados:', rows.length);
      rows.forEach((r) => {
        const ids = r.ids.split(',').map((x) => parseInt(x, 10)).sort((a, b) => a - b);
        const [manter, ...remover] = ids;
        console.log(`  Código "${r.codigo}": ${r.qtd} cliente(s) – ids: ${ids.join(', ')} → manter ${manter}, remover [${remover.join(', ')}]`);
      });
      if (!APPLY) {
        console.log('\nPara remover os duplicados (mantendo o de menor id e transferindo as O.S.), execute:');
        console.log('  node scripts/remover-codigos-duplicados.js --apply');
        db.close();
        return;
      }
      let index = 0;
      function processarProximo() {
        if (index >= rows.length) {
          console.log('\nConcluído.');
          db.close();
          return;
        }
        const r = rows[index++];
        const ids = r.ids.split(',').map((x) => parseInt(x, 10)).sort((a, b) => a - b);
        const [manterId, ...removerIds] = ids;
        if (removerIds.length === 0) return processarProximo();
        function transferirOs(pos, cb) {
          if (pos >= removerIds.length) return cb();
          const idRemover = removerIds[pos];
          db.run('UPDATE service_orders SET customer_id = ? WHERE customer_id = ?', [manterId, idRemover], (e) => {
            if (e) console.error('Erro ao transferir O.S. do cliente', idRemover, '→', manterId, e.message);
            transferirOs(pos + 1, cb);
          });
        }
        transferirOs(0, () => {
          db.run('DELETE FROM customers WHERE id IN (' + removerIds.join(',') + ')', (e) => {
            if (e) console.error('Erro ao excluir clientes duplicados:', e.message);
            else console.log('  Código "' + r.codigo + '": removidos ids', removerIds.join(', '));
            processarProximo();
          });
        });
      }
      processarProximo();
    }
  );
}

run();
