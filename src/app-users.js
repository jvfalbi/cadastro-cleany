const bcrypt = require('bcryptjs');
const db = require('./db');

const BCRYPT_ROUNDS = 10;

/**
 * Na primeira execução (tabela vazia), copia contas do .env para o banco com hash.
 * Depois disso o login e a gestão são só pelo SQLite.
 */
function seedFromAccountsIfEmpty(accounts, cb) {
  db.get('SELECT COUNT(*) as n FROM app_users', (err, row) => {
    if (err) return cb(err);
    if (row && row.n > 0) return cb(null);
    if (!accounts || accounts.length === 0) return cb(null);

    console.log('[Cleany] Primeira execução: gravando usuários no banco (a partir do .env)...');

    let i = 0;
    function insertNext() {
      if (i >= accounts.length) {
        console.log('[Cleany] Usuários criados no banco:', accounts.length);
        return cb(null);
      }
      const { user, password } = accounts[i];
      bcrypt.hash(password, BCRYPT_ROUNDS, (hErr, hash) => {
        if (hErr) return cb(hErr);
        db.run(
          `INSERT INTO app_users (username, password_hash, created_at) VALUES (?, ?, datetime('now'))`,
          [user, hash],
          (runErr) => {
            if (runErr) return cb(runErr);
            i += 1;
            insertNext();
          }
        );
      });
    }
    insertNext();
  });
}

function verifyLogin(username, password, cb) {
  db.get('SELECT password_hash FROM app_users WHERE username = ?', [username], (err, row) => {
    if (err) return cb(err);
    if (!row) return cb(null, false);
    bcrypt.compare(password, row.password_hash, (cmpErr, ok) => {
      if (cmpErr) return cb(cmpErr);
      cb(null, !!ok);
    });
  });
}

function listUsers(cb) {
  db.all(
    'SELECT id, username, created_at FROM app_users ORDER BY username COLLATE NOCASE',
    [],
    cb
  );
}

function countUsers(cb) {
  db.get('SELECT COUNT(*) as n FROM app_users', [], (err, row) => {
    if (err) return cb(err);
    cb(null, row ? row.n : 0);
  });
}

function createUser(username, password, cb) {
  bcrypt.hash(password, BCRYPT_ROUNDS, (err, hash) => {
    if (err) return cb(err);
    db.run(
      `INSERT INTO app_users (username, password_hash, created_at) VALUES (?, ?, datetime('now'))`,
      [username, hash],
      function onRun(runErr) {
        if (runErr) return cb(runErr);
        cb(null, { id: this.lastID });
      }
    );
  });
}

function deleteUser(id, cb) {
  countUsers((err, n) => {
    if (err) return cb(err);
    if (n <= 1) return cb(new Error('Não é possível excluir o último usuário do sistema.'));
    db.run('DELETE FROM app_users WHERE id = ?', [id], function onRun(runErr) {
      if (runErr) return cb(runErr);
      if (this.changes === 0) return cb(new Error('Usuário não encontrado.'));
      cb(null);
    });
  });
}

function updatePassword(id, newPassword, cb) {
  bcrypt.hash(newPassword, BCRYPT_ROUNDS, (err, hash) => {
    if (err) return cb(err);
    db.run('UPDATE app_users SET password_hash = ? WHERE id = ?', [hash, id], function onRun(runErr) {
      if (runErr) return cb(runErr);
      if (this.changes === 0) return cb(new Error('Usuário não encontrado.'));
      cb(null);
    });
  });
}

module.exports = {
  seedFromAccountsIfEmpty,
  verifyLogin,
  listUsers,
  countUsers,
  createUser,
  deleteUser,
  updatePassword,
};
