const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

/**
 * Em cada deploy (git pull, pasta nova, etc.) o projeto pode vir sem `data/database.sqlite`.
 * O .gitignore não versiona o banco — correto — mas aí um deploy “limpo” cria arquivo NOVO vazio.
 * Em produção use DATA_DIR ou DATABASE_PATH apontando para disco persistente (fora do release), ex.:
 *   DATA_DIR=/var/lib/cleany-data
 *   DATABASE_PATH=/var/lib/cleany-data/database.sqlite
 */
const rawDbFile = process.env.DATABASE_PATH && String(process.env.DATABASE_PATH).trim();
const rawDataDir = process.env.DATA_DIR && String(process.env.DATA_DIR).trim();

let dataDir;
let dbPath;

if (rawDbFile) {
  dbPath = path.isAbsolute(rawDbFile) ? rawDbFile : path.resolve(process.cwd(), rawDbFile);
  dataDir = path.dirname(dbPath);
} else if (rawDataDir) {
  dataDir = path.isAbsolute(rawDataDir) ? rawDataDir : path.resolve(process.cwd(), rawDataDir);
  dbPath = path.join(dataDir, 'database.sqlite');
} else {
  dataDir = path.resolve(path.join(__dirname, '..', 'data'));
  dbPath = path.resolve(path.join(dataDir, 'database.sqlite'));
}

dataDir = path.resolve(dataDir);
dbPath = path.resolve(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);
db.dataDir = dataDir;
db.dbPath = dbPath;
db.configure('busyTimeout', 10000);
console.log('[Cleany] Pasta de dados (sessões + SQLite):', dataDir);
console.log('[Cleany] Arquivo principal do banco:', dbPath);

db.serialize(() => {
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');
  db.run('PRAGMA foreign_keys=ON');
  db.run(
    `CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      document TEXT,
      notes TEXT,
      ordem_planilha INTEGER,
      codigo TEXT,
      nome_fantasia TEXT
    )`
  );
  db.run('ALTER TABLE customers ADD COLUMN ordem_planilha INTEGER', (err) => {
    if (err && !err.message.includes('duplicate')) console.error('ordem_planilha:', err.message);
  });
  db.run('ALTER TABLE customers ADD COLUMN codigo TEXT', (err) => {
    if (err && !err.message.includes('duplicate')) console.error('codigo:', err.message);
  });
  db.run('ALTER TABLE customers ADD COLUMN nome_fantasia TEXT', (err) => {
    if (err && !err.message.includes('duplicate')) console.error('nome_fantasia:', err.message);
  });
  db.run('UPDATE customers SET ordem_planilha = id WHERE ordem_planilha IS NULL', (err) => {
    if (err) console.error('backfill ordem_planilha:', err.message);
  });

  const addrCols = ['cep', 'address_street', 'address_number', 'address_neighborhood', 'address_city', 'address_state'];
  addrCols.forEach((col) => {
    db.run(`ALTER TABLE customers ADD COLUMN ${col} TEXT`, (err) => {
      if (err && !err.message.includes('duplicate')) console.error(`customers.${col}:`, err.message);
    });
  });

  db.run(
    `CREATE TABLE IF NOT EXISTS service_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Aberta',
      price_estimate REAL,
      price_final REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      due_date TEXT,
      due_time TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )`
  );

  db.run('ALTER TABLE service_orders ADD COLUMN due_time TEXT', (err) => {
    if (err && !err.message.includes('duplicate')) console.error('due_time column:', err.message);
  });

  db.run(
    `CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL DEFAULT 0
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  db.get('SELECT COUNT(*) as n FROM services', (err, row) => {
    if (err || !row || row.n > 0) return;
    const defaults = [
      ['Locação de triturador de resíduos', 'Locação do equipamento com assistência técnica básica.', 1200],
      ['Manutenção preventiva', 'Revisão periódica, limpeza e ajustes gerais do equipamento.', 450],
      ['Manutenção corretiva', 'Atendimento para correção de falhas pontuais.', 0],
      ['Treinamento de operação', 'Capacitação da equipe para uso correto dos trituradores.', 350],
    ];
    const stmt = db.prepare('INSERT INTO services (name, description, price) VALUES (?, ?, ?)');
    defaults.forEach(([name, description, price]) => stmt.run(name, description, price));
    stmt.finalize();
  });

  db.get('SELECT COUNT(*) as n FROM customers', (err, row) => {
    if (err) console.error('[Cleany] Contagem de clientes:', err.message);
    else console.log('[Cleany] Clientes neste arquivo SQLite:', row ? row.n : '?');
    try {
      const st = fs.statSync(dbPath);
      console.log('[Cleany] Tamanho database.sqlite:', st.size, 'bytes');
    } catch (e) {
      console.warn('[Cleany] stat database:', e.message);
    }
  });
});

function shutdownDb(signal) {
  console.warn('[Cleany] Encerrando (' + signal + '): fechando SQLite com segurança…');
  db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
    if (err) console.error('[Cleany] wal_checkpoint:', err.message);
    db.close((err2) => {
      if (err2) console.error('[Cleany] Erro ao fechar banco:', err2.message);
      process.exit(err2 ? 1 : 0);
    });
  });
}
process.once('SIGINT', () => shutdownDb('SIGINT'));
process.once('SIGTERM', () => shutdownDb('SIGTERM'));

module.exports = db;

