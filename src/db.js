const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

/**
 * Painéis com PM2 costumam apontar para uma pasta do site que é recriada no deploy/restart:
 * `projeto/data/database.sqlite` some e nasce um banco vazio — “cadastro sumiu”.
 *
 * Prioridade:
 * 1) DATABASE_PATH ou DATA_DIR no .env (sempre ganham)
 * 2) CLEANY_USE_PROJECT_DATA=1 → força ./data dentro do projeto (só desenvolvimento)
 * 3) PM2 (pm_id) ou NODE_ENV=production → pasta fixa FORA do projeto:
 *    Windows: %USERPROFILE%\.cleany-cadastro-data
 *    Linux:   ~/.cleany-cadastro-data
 *    Na 1ª subida, copia database.sqlite e sessions.sqlite do ./data antigo se existirem.
 * 4) Caso contrário → ./data (desenvolvimento local sem PM2)
 */
const rawDbFile = process.env.DATABASE_PATH && String(process.env.DATABASE_PATH).trim();
const rawDataDir = process.env.DATA_DIR && String(process.env.DATA_DIR).trim();
const forceProjectData = process.env.CLEANY_USE_PROJECT_DATA === '1';

const projectDataDir = path.resolve(path.join(__dirname, '..', 'data'));
const pm2OrProd =
  process.env.pm_id != null ||
  process.env.PM_ID != null ||
  process.env.NODE_APP_INSTANCE != null ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const persistentDefaultDir = path.join(os.homedir(), '.cleany-cadastro-data');

/** Se vamos usar pasta persistente e ainda não há banco lá, copia do ./data do projeto (migração). */
function migrateFromProjectIfNeeded(targetDataDir) {
  if (path.resolve(targetDataDir) === projectDataDir) return;
  const targetDb = path.join(targetDataDir, 'database.sqlite');
  if (fs.existsSync(targetDb)) return;
  const legacyDb = path.join(projectDataDir, 'database.sqlite');
  if (!fs.existsSync(legacyDb)) return;
  fs.mkdirSync(targetDataDir, { recursive: true });
  const pairs = [
    ['database.sqlite', 'database.sqlite'],
    ['sessions.sqlite', 'sessions.sqlite'],
  ];
  try {
    for (const [name] of pairs) {
      const from = path.join(projectDataDir, name);
      const to = path.join(targetDataDir, name);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, to);
      for (const suf of ['-wal', '-shm']) {
        const fa = from + suf;
        const ta = to + suf;
        if (fs.existsSync(fa) && !fs.existsSync(ta)) fs.copyFileSync(fa, ta);
      }
    }
    console.log('[Cleany] Migração: ./data do projeto →', targetDataDir);
  } catch (e) {
    console.error('[Cleany] Migração falhou:', e.message);
  }
}

let dataDir;
let dbPath;

if (rawDbFile) {
  dbPath = path.isAbsolute(rawDbFile) ? rawDbFile : path.resolve(process.cwd(), rawDbFile);
  dataDir = path.dirname(dbPath);
} else if (rawDataDir) {
  dataDir = path.isAbsolute(rawDataDir) ? rawDataDir : path.resolve(process.cwd(), rawDataDir);
  dbPath = path.join(dataDir, 'database.sqlite');
} else if (forceProjectData) {
  dataDir = projectDataDir;
  dbPath = path.join(dataDir, 'database.sqlite');
} else if (pm2OrProd) {
  dataDir = path.resolve(persistentDefaultDir);
  dbPath = path.join(dataDir, 'database.sqlite');
  migrateFromProjectIfNeeded(dataDir);
  console.warn(
    '[Cleany] PM2/produção: banco em pasta PERSISTENTE fora do site:',
    dataDir,
    '(não apaga ao trocar a pasta do projeto no painel.)'
  );
} else {
  dataDir = projectDataDir;
  dbPath = path.join(dataDir, 'database.sqlite');
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

