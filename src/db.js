const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      document TEXT,
      notes TEXT
    )`
  );

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
});

module.exports = db;

