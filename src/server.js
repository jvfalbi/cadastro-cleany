const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
// Caminho absoluto à raiz do projeto (onde fica package.json e .env). PM2 nem sempre usa cwd correto.
const ENV_PATH = path.resolve(__dirname, '..', '.env');
const envResult = require('dotenv').config({ path: ENV_PATH });
if (envResult.error) {
  console.warn('[Cleany] .env não carregado:', ENV_PATH, '(' + (envResult.error.code || envResult.error.message) + ') — login/senha vêm do código padrão.');
} else {
  console.log('[Cleany] .env OK:', ENV_PATH);
}
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./db');
const appUsers = require('./app-users');
const sqlite3 = require('sqlite3').verbose();

const app = express();

/** Espaço/BOM em NODE_ENV quebrava === 'production' e o servidor caía no modo dev na EC2. */
const rawNodeEnv = String(process.env.NODE_ENV || '')
  .replace(/^\uFEFF/, '')
  .trim();
const isProd = rawNodeEnv.toLowerCase() === 'production';
/** Login padrão só em desenvolvimento (localhost), quando o .env não define os dois. */
const DEV_LOGIN_USER = 'joaofalbi';
const DEV_LOGIN_PASSWORD = 'Butt1005!';
/** URL pública configurada (sem barra final), ex.: https://app.exemplo.com.br */
const BASE_URL_CONFIGURED = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
/* Em desenvolvimento nunca cookie Secure: senão o navegador ignora em http://localhost mesmo com BASE_URL=https no .env */
const SESSION_COOKIE_SECURE =
  isProd &&
  (process.env.SESSION_COOKIE_SECURE === '1' ||
    BASE_URL_CONFIGURED.toLowerCase().startsWith('https://'));

if (isProd) {
  app.set('trust proxy', 1);
}

/** Remove BOM (editores Windows), \r e espaços — evita “senha incorreta” com .env certo. */
function cleanEnvCredential(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
}

let LOGIN_USER = cleanEnvCredential(process.env.LOGIN_USER);
let LOGIN_PASSWORD = cleanEnvCredential(process.env.LOGIN_PASSWORD);

if (!isProd) {
  if (process.env.LOCAL_FORCE_DEV_LOGIN === '1') {
    LOGIN_USER = DEV_LOGIN_USER;
    LOGIN_PASSWORD = DEV_LOGIN_PASSWORD;
    console.warn('[Cleany] Dev: LOCAL_FORCE_DEV_LOGIN=1 — login fixo', DEV_LOGIN_USER, '/ (senha padrão dev)');
  } else {
    if (!LOGIN_USER) LOGIN_USER = DEV_LOGIN_USER;
    if (!LOGIN_PASSWORD) LOGIN_PASSWORD = DEV_LOGIN_PASSWORD;
    if (!process.env.LOGIN_USER || !process.env.LOGIN_PASSWORD) {
      console.warn(
        '[Cleany] Dev: LOGIN_USER ou LOGIN_PASSWORD vazio no .env — usando',
        DEV_LOGIN_USER,
        '/ (senha padrão dev no código)'
      );
    } else {
      console.warn(
        '[Cleany] Dev: login vem do .env (usuário:',
        JSON.stringify(LOGIN_USER) + ').',
        'Se a senha falhar, use esse usuário/senha do .env ou coloque LOCAL_FORCE_DEV_LOGIN=1 para o login padrão de desenvolvimento'
      );
    }
  }
}

/** Contas permitidas: LOGIN_USER/LOGIN_PASSWORD + opcional LOGIN_ACCOUNTS_JSON (array de { user, password }). */
function buildLoginAccountsList() {
  const list = [];
  const seen = new Set();
  const add = (u, p) => {
    const user = cleanEnvCredential(u);
    const pass = cleanEnvCredential(p);
    if (!user || !pass) return;
    if (seen.has(user)) return;
    seen.add(user);
    list.push({ user, password: pass });
  };
  add(LOGIN_USER, LOGIN_PASSWORD);
  const raw = process.env.LOGIN_ACCOUNTS_JSON;
  if (raw && String(raw).trim()) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const row of arr) {
          if (row && row.user != null && row.password != null) add(row.user, row.password);
        }
      }
    } catch (e) {
      console.error('[Cleany] LOGIN_ACCOUNTS_JSON inválido:', e.message);
      if (isProd) process.exit(1);
    }
  }
  return list;
}

const loginAccounts = buildLoginAccountsList();

/** Só este usuário vê “Usuários do sistema” e acessa /admin/usuarios. Em produção use ADMIN_USERNAME=... se o administrador não for o mesmo login principal (DEV_LOGIN_USER / seed). */
const ADMIN_USERNAME = cleanEnvCredential(process.env.ADMIN_USERNAME) || DEV_LOGIN_USER;

if (isProd) {
  const sec = cleanEnvCredential(process.env.SESSION_SECRET);
  if (sec.length < 16) {
    console.error('[Cleany] Produção: SESSION_SECRET no .env com pelo menos 16 caracteres.');
    process.exit(1);
  }
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  if (req.session.user !== ADMIN_USERNAME) {
    return res.status(403).type('html').send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Acesso negado</title></head><body><p>Acesso negado. Só o usuário administrador pode gerenciar usuários do sistema.</p><p><a href="/">Voltar ao início</a></p></body></html>');
  }
  next();
}

function marcarAtrasadasComoConcluidas(cb) {
  db.run(
    `UPDATE service_orders SET status = 'Concluída', updated_at = datetime('now')
     WHERE status IN ('Aberta', 'Em andamento')
     AND due_date IS NOT NULL AND due_time IS NOT NULL
     AND datetime(due_date || ' ' || due_time) <= datetime('now', 'localtime')`,
    (err) => {
      if (err) console.error('Erro ao marcar O.S. atrasadas:', err.message);
      if (cb) cb();
    }
  );
}
const PORT = process.env.PORT || 3000;
/** Nome do app no PM2 (ecosystem.config.cjs). Usado só em /admin/sistema → reiniciar. */
const PM2_APP_NAME = cleanEnvCredential(process.env.PM2_APP_NAME) || 'cadastro-cleany';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STYLES_PATH = path.join(PUBLIC_DIR, 'css', 'styles.css');
const SESSIONS_DB_PATH = path.join(__dirname, '..', 'data', 'sessions.sqlite');

function touchPublicStaticAssets() {
  const now = new Date();
  let count = 0;
  for (const sub of ['css', 'js']) {
    const dir = path.join(PUBLIC_DIR, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(css|js)$/i.test(name)) continue;
      try {
        fs.utimesSync(path.join(dir, name), now, now);
        count += 1;
      } catch (e) {
        console.warn('[Cleany] touch asset:', name, e.message);
      }
    }
  }
  return count;
}

function schedulePm2Restart() {
  const appName = PM2_APP_NAME;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', `timeout /t 1 /nobreak >nul & pm2 restart ${appName}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    spawn('sh', ['-c', `sleep 1 && pm2 restart ${appName.replace(/[^a-zA-Z0-9._-]/g, '')}`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: path.join(__dirname, '..', 'data'),
  }),
  secret: process.env.SESSION_SECRET || 'cleany-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: SESSION_COOKIE_SECURE,
  },
}));
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (/\.(css|js|html|json)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },
  })
);

app.use((req, res, next) => {
  if (BASE_URL_CONFIGURED) {
    res.locals.baseUrl = BASE_URL_CONFIGURED;
  } else {
    const xfProto = req.get('x-forwarded-proto');
    const proto = (xfProto && xfProto.split(',')[0].trim()) || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    res.locals.baseUrl = (host ? `${proto}://${host}` : '').replace(/\/+$/, '') || `http://localhost:${PORT}`;
  }
  res.locals.absUrl = function absUrl(p) {
    let pathPart = String(p == null || p === '' ? '/' : p);
    if (!pathPart.startsWith('/')) pathPart = '/' + pathPart;
    return res.locals.baseUrl + pathPart;
  };

  if (process.env.ASSET_V && String(process.env.ASSET_V).trim()) {
    res.locals.assetV = String(process.env.ASSET_V).trim();
  } else {
    try {
      res.locals.assetV = String(Math.floor(fs.statSync(STYLES_PATH).mtimeMs / 1000));
    } catch {
      res.locals.assetV = '1';
    }
  }
  res.locals.whatsappUrl = function (phone) {
    if (!phone) return '';
    const d = String(phone).replace(/\D/g, '');
    if (d.length < 10) return '';
    if (d.length === 10 || d.length === 11) return 'https://wa.me/55' + d;
    if (d.length >= 12 && d.substring(0, 2) === '55') return 'https://wa.me/' + d;
    return 'https://wa.me/55' + d;
  };
  res.locals.canManageUsers = !!(req.session && req.session.user && req.session.user === ADMIN_USERNAME);
  next();
});

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const username = cleanEnvCredential((req.body && req.body.username) || '');
  const password = cleanEnvCredential((req.body && req.body.password) || '');
  appUsers.verifyLogin(username, password, (err, ok) => {
    if (err) {
      console.error('[Cleany] Erro ao verificar login:', err.message);
      return res.render('login', { error: 'Erro ao entrar. Tente de novo.' });
    }
    if (ok) {
      req.session.user = username;
      return res.redirect('/');
    }
    if (isProd) {
      console.warn(
        '[Cleany] Login recusado. Usuário tentado:',
        JSON.stringify(username),
        '(senhas ficam no banco; crie usuários em /admin/usuarios ou use o .env na 1ª subida)'
      );
    }
    res.render('login', { error: 'Usuário ou senha incorretos.' });
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use(requireAuth);

app.get('/admin/usuarios', requireAdmin, (req, res) => {
  const q = req.query || {};
  let success = null;
  if (q.ok === 'criado') success = 'Usuário criado.';
  else if (q.ok === 'excluido') success = 'Usuário removido.';
  else if (q.ok === 'senha') success = 'Senha atualizada.';
  appUsers.listUsers((err, users) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Erro ao listar usuários.');
    }
    res.render('admin/users', {
      users: users || [],
      error: q.erro ? String(q.erro) : null,
      success,
    });
  });
});

app.post('/admin/usuarios', requireAdmin, (req, res) => {
  const username = cleanEnvCredential((req.body && req.body.username) || '');
  const password = cleanEnvCredential((req.body && req.body.password) || '');
  if (!username || !password) {
    return res.redirect('/admin/usuarios?erro=' + encodeURIComponent('Preencha usuário e senha.'));
  }
  if (password.length < 4) {
    return res.redirect('/admin/usuarios?erro=' + encodeURIComponent('Senha muito curta (mín. 4 caracteres).'));
  }
  appUsers.createUser(username, password, (err) => {
    if (err) {
      const msg =
        err.message && err.message.includes('UNIQUE')
          ? 'Já existe um usuário com esse nome.'
          : 'Não foi possível criar o usuário.';
      return res.redirect('/admin/usuarios?erro=' + encodeURIComponent(msg));
    }
    res.redirect('/admin/usuarios?ok=criado');
  });
});

app.post('/admin/usuarios/:id/excluir', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.redirect('/admin/usuarios?erro=' + encodeURIComponent('ID inválido.'));
  appUsers.deleteUser(id, (err) => {
    if (err) {
      return res.redirect('/admin/usuarios?erro=' + encodeURIComponent(err.message || 'Erro ao excluir.'));
    }
    res.redirect('/admin/usuarios?ok=excluido');
  });
});

app.post('/admin/usuarios/:id/senha', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newPassword = cleanEnvCredential((req.body && req.body.new_password) || '');
  if (!id || !newPassword) {
    return res.redirect('/admin/usuarios?erro=' + encodeURIComponent('Informe a nova senha.'));
  }
  if (newPassword.length < 4) {
    return res.redirect('/admin/usuarios?erro=' + encodeURIComponent('Senha muito curta (mín. 4 caracteres).'));
  }
  appUsers.updatePassword(id, newPassword, (err) => {
    if (err) {
      return res.redirect('/admin/usuarios?erro=' + encodeURIComponent(err.message || 'Erro ao alterar senha.'));
    }
    res.redirect('/admin/usuarios?ok=senha');
  });
});

app.get('/admin/sistema', requireAdmin, (req, res) => {
  const q = req.query || {};
  let success = null;
  const error = q.erro ? String(q.erro) : null;
  if (q.ok === 'cache') {
    success =
      'Cache de arquivos estáticos atualizado (data dos .css/.js). Recarregue as páginas (F5 ou Ctrl+F5).';
  } else if (q.ok === 'reiniciar') {
    success =
      'Reinício do aplicativo pedido ao PM2. Em alguns segundos o site pode ficar indisponível e voltar sozinho.';
  } else if (q.ok === 'sessoes') {
    success = 'Sessões de login apagadas. Todos os usuários precisarão entrar de novo.';
  } else if (q.ok === 'sessoes-vazio') {
    success = 'Não havia arquivo de sessões ainda; nada a limpar.';
  }
  res.render('admin/sistema', {
    success,
    error,
    assetVFixo: !!(process.env.ASSET_V && String(process.env.ASSET_V).trim()),
    pm2Name: PM2_APP_NAME,
  });
});

app.post('/admin/sistema/limpar-cache', requireAdmin, (req, res) => {
  try {
    const n = touchPublicStaticAssets();
    console.log('[Cleany] Admin: limpar cache de assets — arquivos tocados:', n);
  } catch (e) {
    console.error('[Cleany] Admin limpar-cache:', e.message);
    return res.redirect('/admin/sistema?erro=' + encodeURIComponent('Erro ao atualizar arquivos estáticos.'));
  }
  res.redirect('/admin/sistema?ok=cache');
});

app.post('/admin/sistema/reiniciar', requireAdmin, (req, res) => {
  console.warn('[Cleany] Admin: reinício PM2 solicitado —', PM2_APP_NAME);
  res.redirect('/admin/sistema?ok=reiniciar');
  setTimeout(() => schedulePm2Restart(), 400);
});

app.post('/admin/sistema/limpar-sessoes', requireAdmin, (req, res) => {
  if (!fs.existsSync(SESSIONS_DB_PATH)) {
    return res.redirect('/admin/sistema?ok=sessoes-vazio');
  }
  const sdb = new sqlite3.Database(SESSIONS_DB_PATH);
  sdb.run('DELETE FROM sessions', (err) => {
    sdb.close();
    if (err) {
      console.error('[Cleany] Admin limpar-sessoes:', err.message);
      return res.redirect('/admin/sistema?erro=' + encodeURIComponent('Erro ao limpar sessões: ' + err.message));
    }
    console.warn('[Cleany] Admin: tabela sessions esvaziada.');
    res.redirect('/admin/sistema?ok=sessoes');
  });
});

app.get('/', (req, res) => {
  marcarAtrasadasComoConcluidas(() => {
    const sql = `
      SELECT so.id, so.due_date, so.due_time, so.status, so.description,
        COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
        c.phone AS customer_phone
      FROM service_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.status IN ('Aberta', 'Em andamento') AND so.due_date >= date('now', 'localtime')
      ORDER BY so.due_date ASC, so.due_time ASC
      LIMIT 15
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return res.render('dashboard', { agendamentos: [] });
      res.render('dashboard', { agendamentos: rows || [] });
    });
  });
});

app.get('/clientes', (req, res) => {
  db.all(
    `SELECT * FROM customers ORDER BY COALESCE(CAST(NULLIF(TRIM(codigo), '') AS INTEGER), -1) DESC, id DESC`,
    (err, rows) => {
    if (err) {
      return res.status(500).send('Erro ao carregar clientes.');
    }
    res.render('customers/list', { customers: rows || [] });
  });
});

app.get('/clientes/novo', (req, res) => {
  res.render('customers/form', { customer: null });
});

app.post('/clientes', (req, res) => {
  const { name, phone, email, address, document, notes } = req.body;
  const phoneTrim = (phone || '').trim();
  const codigoInput = (req.body.codigo || '').trim() || null;

  if (!phoneTrim) {
    return res.render('customers/form', {
      customer: {
        codigo: codigoInput,
        name,
        nome_fantasia: (req.body.nome_fantasia || '').trim(),
        phone,
        email,
        address,
        document,
        notes,
      },
      error: 'Informe o telefone.',
    });
  }
  const documentTrim = (document || '').trim();
  if (!documentTrim) {
    return res.render('customers/form', {
      customer: {
        codigo: codigoInput,
        name,
        nome_fantasia: (req.body.nome_fantasia || '').trim(),
        phone,
        email,
        address,
        document,
        notes,
      },
      error: 'Informe o CPF ou CNPJ.',
    });
  }
  const nome_fantasia = (req.body.nome_fantasia || '').trim() || null;

  /** Próximo número na sequência da planilha (mesma lógica de ordem_planilha). */
  function findNextCodigoLivre(startNum, cb) {
    const candidate = String(startNum);
    db.get(
      'SELECT id FROM customers WHERE codigo IS NOT NULL AND TRIM(codigo) = ?',
      [candidate],
      (err, row) => {
        if (err) return cb(err);
        if (!row) return cb(null, candidate);
        findNextCodigoLivre(startNum + 1, cb);
      }
    );
  }

  function insertCliente(ordem, codigoFinal) {
    db.run(
      'INSERT INTO customers (name, phone, email, address, document, notes, ordem_planilha, codigo, nome_fantasia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, phoneTrim, email, address, documentTrim, notes, ordem, codigoFinal, nome_fantasia],
      (errIns) => {
        if (errIns) {
          console.error('[Cleany] POST /clientes (INSERT):', errIns.message);
          return res.status(500).send('Erro ao salvar cliente.');
        }
        res.redirect('/clientes');
      }
    );
  }

  db.get('SELECT COALESCE(MAX(ordem_planilha), 0) + 1 AS next FROM customers', [], (errOrdem, row) => {
    if (errOrdem) {
      console.error('[Cleany] POST /clientes (ordem_planilha):', errOrdem.message);
      return res.status(500).send('Erro ao salvar cliente.');
    }
    const ordem = row ? row.next : 1;

    if (codigoInput) {
      db.get(
        'SELECT id FROM customers WHERE codigo IS NOT NULL AND TRIM(codigo) = ?',
        [codigoInput],
        (errDup, rowDup) => {
          if (errDup) {
            console.error('[Cleany] POST /clientes (código duplicado):', errDup.message);
            return res.status(500).send('Erro ao salvar cliente.');
          }
          if (rowDup) {
            return res.render('customers/form', {
              customer: {
                codigo: codigoInput,
                name,
                nome_fantasia,
                phone: phoneTrim,
                email,
                address,
                document: documentTrim,
                notes,
              },
              error: 'Este código já está em uso por outro cliente. Escolha outro ou deixe em branco para gerar automaticamente.',
            });
          }
          insertCliente(ordem, codigoInput);
        }
      );
      return;
    }

    findNextCodigoLivre(ordem, (errCod, codigoFinal) => {
      if (errCod) {
        console.error('[Cleany] POST /clientes (código sequência):', errCod.message);
        return res.status(500).send('Erro ao salvar cliente.');
      }
      insertCliente(ordem, codigoFinal);
    });
  });
});

app.get('/clientes/:id/editar', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM customers WHERE id = ?', [id], (err, row) => {
    if (err || !row) {
      return res.status(404).send('Cliente não encontrado.');
    }
    res.render('customers/form', { customer: row });
  });
});

app.post('/clientes/:id', (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, document, notes } = req.body;
  const phoneTrim = (phone || '').trim();
  if (!phoneTrim) {
    return res.render('customers/form', {
      customer: {
        id,
        codigo: (req.body.codigo || '').trim() || null,
        name,
        nome_fantasia: (req.body.nome_fantasia || '').trim(),
        phone,
        email,
        address,
        document,
        notes,
      },
      error: 'Informe o telefone.',
    });
  }
  const documentTrim = (document || '').trim();
  if (!documentTrim) {
    return res.render('customers/form', {
      customer: {
        id,
        codigo: (req.body.codigo || '').trim() || null,
        name,
        nome_fantasia: (req.body.nome_fantasia || '').trim(),
        phone,
        email,
        address,
        document,
        notes,
      },
      error: 'Informe o CPF ou CNPJ.',
    });
  }
  const codigo = (req.body.codigo || '').trim() || null;
  const nome_fantasia = (req.body.nome_fantasia || '').trim() || null;
  const checkCodigo = (cb) => {
    if (!codigo) return cb(null, false);
    db.get(
      'SELECT id FROM customers WHERE codigo IS NOT NULL AND TRIM(codigo) = ? AND id != ?',
      [codigo, id],
      (err, row) => {
        if (err) return cb(err, true);
        cb(null, !!row);
      }
    );
  };
  checkCodigo((err, isDuplicate) => {
    if (err) return res.status(500).send('Erro ao atualizar cliente.');
    if (isDuplicate) {
      return res.render('customers/form', {
        customer: { id, codigo, name, nome_fantasia, phone, email, address, document, notes },
        error: 'Este código já está em uso por outro cliente. Escolha outro ou deixe em branco.',
      });
    }
    const stmt = db.prepare(
      'UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, document = ?, notes = ?, codigo = ?, nome_fantasia = ? WHERE id = ?'
    );
    stmt.run(name, phoneTrim, email, address, documentTrim, notes, codigo, nome_fantasia, id, (err) => {
      if (err) {
        return res.status(500).send('Erro ao atualizar cliente.');
      }
      res.redirect('/clientes');
    });
  });
});

app.post('/clientes/:id/excluir', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM customers WHERE id = ?');
  stmt.run(id, (err) => {
    if (err) {
      return res.status(500).send('Erro ao excluir cliente.');
    }
    res.redirect('/clientes');
  });
});

app.get('/historico-agendamentos', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  marcarAtrasadasComoConcluidas(() => {
    const sql = `
      SELECT so.*,
        COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
        c.phone AS customer_phone
      FROM service_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      ORDER BY
        CASE WHEN so.due_date IS NULL OR TRIM(COALESCE(so.due_date, '')) = '' THEN 1 ELSE 0 END,
        so.due_date DESC,
        CASE WHEN so.due_time IS NULL OR TRIM(COALESCE(so.due_time, '')) = '' THEN 1 ELSE 0 END,
        so.due_time DESC,
        so.id DESC
    `;
    db.all(sql, (err, rows) => {
      if (err) {
        return res.status(500).send('Erro ao carregar histórico de agendamentos.');
      }
      const orders = rows || [];
      db.all(
        `SELECT status, COUNT(*) AS total FROM service_orders GROUP BY status`,
        [],
        (err2, statusRows) => {
          db.get('SELECT COUNT(*) AS n FROM service_orders', [], (err3, countRow) => {
            const stats = {
              total: !err3 && countRow && countRow.n != null ? countRow.n : orders.length,
              Aberta: 0,
              'Em andamento': 0,
              Concluída: 0,
              Cancelada: 0,
            };
            (statusRows || []).forEach((r) => {
              stats[r.status] = r.total;
            });
            res.render('historico-agendamentos', { orders, stats });
          });
        }
      );
    });
  });
});

app.get('/ordens', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  marcarAtrasadasComoConcluidas(() => {
    const sql = `
      SELECT so.*,
        COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
        c.phone AS customer_phone
      FROM service_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      ORDER BY so.created_at DESC
    `;
    db.all(sql, (err, rows) => {
      if (err) {
        return res.status(500).send('Erro ao carregar ordens de serviço.');
      }
      const orders = rows || [];
      db.all(
        `SELECT status, COUNT(*) AS total FROM service_orders GROUP BY status`,
        [],
        (err2, statusRows) => {
          db.get('SELECT COUNT(*) AS n FROM service_orders', [], (err3, countRow) => {
            const stats = {
              total: !err3 && countRow && countRow.n != null ? countRow.n : orders.length,
              Aberta: 0,
              'Em andamento': 0,
              Concluída: 0,
              Cancelada: 0,
            };
            (statusRows || []).forEach((r) => {
              stats[r.status] = r.total;
            });
            res.render('orders/list', { orders, stats });
          });
        }
      );
    });
  });
});

app.get('/api/ordens/ocupados', (req, res) => {
  const data = req.query.data || '';
  if (!data) {
    return res.json({ ocupados: [] });
  }
  db.all(
    `SELECT due_time FROM service_orders
     WHERE due_date = ? AND due_time IS NOT NULL AND due_time != ''
     AND status != 'Cancelada'`,
    [data],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ ocupados: [] });
      }
      const ocupados = (rows || []).map((r) => (r.due_time || '').slice(0, 5));
      res.json({ ocupados });
    }
  );
});

app.get('/ordens/nova', (req, res) => {
  const prefillDate = req.query.data || '';
  const next = (customers, prefillOcupados) => {
    res.render('orders/form', { customers, prefillDate, prefillOcupados: prefillOcupados || [] });
  };
  db.all(
    `SELECT id, name, codigo FROM customers ORDER BY COALESCE(CAST(NULLIF(TRIM(codigo), '') AS INTEGER), -1) DESC, id DESC`,
    (err, customers) => {
    if (err) {
      return res.status(500).send('Erro ao carregar clientes.');
    }
    if (!prefillDate) {
      return next(customers, []);
    }
    db.all(
      `SELECT due_time FROM service_orders
       WHERE due_date = ? AND due_time IS NOT NULL AND due_time != ''
       AND status != 'Cancelada'`,
      [prefillDate],
      (err2, rows) => {
        const ocupados = (err2 || !rows) ? [] : rows.map((r) => (r.due_time || '').slice(0, 5));
        next(customers, ocupados);
      }
    );
  });
});

app.post('/ordens', (req, res) => {
  const { customer_id, description, status, price_estimate, due_date, due_time } = req.body;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO service_orders
      (customer_id, description, status, price_estimate, created_at, updated_at, due_date, due_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    customer_id,
    description,
    status || 'Aberta',
    price_estimate || null,
    now,
    now,
    due_date || null,
    due_time || null,
    (err) => {
      if (err) {
        return res.status(500).send('Erro ao salvar ordem de serviço.');
      }
      res.redirect('/ordens');
    }
  );
});

app.get('/ordens/:id', (req, res) => {
  const { id } = req.params;
  const sql = `
    SELECT so.*,
      COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
      c.phone, c.email, c.address
    FROM service_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    WHERE so.id = ?
  `;
  db.get(sql, [id], (err, order) => {
    if (err || !order) {
      return res.status(404).send('Ordem de serviço não encontrada.');
    }
    res.render('orders/detail', { order });
  });
});

app.post('/ordens/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, price_final } = req.body;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE service_orders SET status = ?, price_final = ?, updated_at = ? WHERE id = ?'
  );
  stmt.run(status, price_final || null, now, id, (err) => {
    if (err) {
      return res.status(500).send('Erro ao atualizar ordem de serviço.');
    }
    res.redirect(`/ordens/${id}`);
  });
});

app.get('/calendario', (req, res) => {
  marcarAtrasadasComoConcluidas(() => {
  const now = new Date();
  const vista = req.query.vista === 'mes' ? 'mes' : 'semana';

  let ano = parseInt(req.query.ano, 10);
  let mes = parseInt(req.query.mes, 10);
  if (!ano || !mes) {
    ano = now.getFullYear();
    mes = now.getMonth() + 1;
  }
  if (mes < 1) {
    mes = 12;
    ano--;
  }
  if (mes > 12) {
    mes = 1;
    ano++;
  }

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let refDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const refQ = (req.query.ref && String(req.query.ref).trim()) || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(refQ)) {
    const p = refQ.split('-');
    refDate = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }
  const weekStartD = new Date(refDate);
  weekStartD.setDate(refDate.getDate() - refDate.getDay());
  weekStartD.setHours(0, 0, 0, 0);

  function dateKeyFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const primeiroDia = new Date(ano, mes - 1, 1);
  const ultimoDia = new Date(ano, mes, 0);
  const inicio = new Date(primeiroDia);
  inicio.setDate(inicio.getDate() - primeiroDia.getDay());
  const fim = new Date(ultimoDia);
  fim.setDate(fim.getDate() + (6 - ultimoDia.getDay()));

  const sql = `
    SELECT so.*,
      COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
      c.phone AS customer_phone
    FROM service_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    ORDER BY so.due_date, so.created_at
  `;
  db.all(sql, (err, rows) => {
    if (err) {
      return res.status(500).send('Erro ao carregar calendário.');
    }

    const ordersByDate = {};
    (rows || []).forEach((o) => {
      if (o.status === 'Cancelada') return;
      const dateStr = o.due_date || (o.created_at ? o.created_at.slice(0, 10) : null);
      if (!dateStr) return;
      if (!ordersByDate[dateStr]) ordersByDate[dateStr] = [];
      ordersByDate[dateStr].push(o);
    });

    function parseDueTimeMinutes(t) {
      if (!t || typeof t !== 'string') return null;
      const p = String(t).trim().split(':');
      const h = parseInt(p[0], 10);
      const m = parseInt(p[1] || '0', 10);
      if (Number.isNaN(h)) return null;
      return h * 60 + (Number.isNaN(m) ? 0 : m);
    }

    function compareOrdersByTime(a, b) {
      const ta = parseDueTimeMinutes(a.due_time);
      const tb = parseDueTimeMinutes(b.due_time);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    }

    Object.keys(ordersByDate).forEach((k) => {
      ordersByDate[k].sort(compareOrdersByTime);
    });

    const TL_START = 8;
    const TL_END = 19;
    const TL_TOTAL_MIN = (TL_END - TL_START) * 60;

    function orderTimelineStyle(o) {
      const mins = parseDueTimeMinutes(o.due_time);
      if (mins == null) {
        return { topPct: 0.5, heightPct: 4, noTime: true };
      }
      let fromStart = mins - TL_START * 60;
      if (fromStart < 0) fromStart = 0;
      if (fromStart >= TL_TOTAL_MIN) fromStart = Math.max(0, TL_TOTAL_MIN - 20);
      return {
        topPct: (fromStart / TL_TOTAL_MIN) * 100,
        heightPct: Math.max((30 / TL_TOTAL_MIN) * 100, 3),
        noTime: false,
      };
    }

    const timeSlotLabels = [];
    for (let h = TL_START; h <= TL_END; h += 1) {
      timeSlotLabels.push(`${String(h).padStart(2, '0')}:00`);
      if (h < TL_END) {
        timeSlotLabels.push(`${String(h).padStart(2, '0')}:30`);
      }
    }

    const weekShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const weekTimelineDays = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(weekStartD);
      d.setDate(weekStartD.getDate() + i);
      const y = d.getFullYear();
      const mo = d.getMonth() + 1;
      const da = d.getDate();
      const dateKey = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
      const list = (ordersByDate[dateKey] || []).slice();
      list.sort(compareOrdersByTime);
      const orders = list.map((o) => Object.assign({}, o, { timeline: orderTimelineStyle(o) }));
      weekTimelineDays.push({
        dateKey,
        weekday: weekShort[i],
        dayNum: da,
        monthNum: mo,
        isToday: dateKey === todayStr,
        orders,
      });
    }

    const prevWeekStart = new Date(weekStartD);
    prevWeekStart.setDate(weekStartD.getDate() - 7);
    const nextWeekStart = new Date(weekStartD);
    nextWeekStart.setDate(weekStartD.getDate() + 7);
    const weekPrevLink = `/calendario?vista=semana&ref=${dateKeyFromDate(prevWeekStart)}`;
    const weekNextLink = `/calendario?vista=semana&ref=${dateKeyFromDate(nextWeekStart)}`;
    const weekEndD = new Date(weekStartD);
    weekEndD.setDate(weekStartD.getDate() + 6);
    const monthShort = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const weekRangeLabel = `${weekStartD.getDate()} ${monthShort[weekStartD.getMonth()]} – ${weekEndD.getDate()} ${monthShort[weekEndD.getMonth()]} ${weekEndD.getFullYear()}`;

    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const weeks = [];
    const cur = new Date(inicio);

    while (cur <= fim) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dateKey = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        const isCurrentMonth = cur.getMonth() === mes - 1;
        week.push({
          dateKey,
          dayNum: cur.getDate(),
          isCurrentMonth,
          isToday: dateKey === todayStr,
          orders: ordersByDate[dateKey] || [],
        });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const prevMes = mes === 1 ? 12 : mes - 1;
    const prevAno = mes === 1 ? ano - 1 : ano;
    const nextMes = mes === 12 ? 1 : mes + 1;
    const nextAno = mes === 12 ? ano + 1 : ano;

    const tabMesLink = `/calendario?vista=mes&ano=${ano}&mes=${mes}`;
    const tabSemanaLink = `/calendario?vista=semana&ref=${dateKeyFromDate(weekStartD)}`;
    const tabSemanaFromMonthLink = `/calendario?vista=semana&ref=${todayStr}`;

    res.render('calendar', {
      vista,
      monthName: monthNames[mes - 1],
      ano,
      mes,
      prevLink: `/calendario?vista=mes&ano=${prevAno}&mes=${prevMes}`,
      nextLink: `/calendario?vista=mes&ano=${nextAno}&mes=${nextMes}`,
      weeks,
      weekDays: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
      weekTimelineDays,
      timeSlotLabels,
      timelineStart: TL_START,
      timelineEnd: TL_END,
      weekPrevLink,
      weekNextLink,
      weekRangeLabel,
      tabMesLink,
      tabSemanaLink,
      tabSemanaFromMonthLink,
      tabMesFromWeekLink: `/calendario?vista=mes&ano=${refDate.getFullYear()}&mes=${refDate.getMonth() + 1}`,
    });
  });
  });
});

app.get('/servicos', (req, res) => {
  db.all('SELECT * FROM services ORDER BY name', (err, rows) => {
    if (err) return res.status(500).send('Erro ao carregar serviços.');
    res.render('services/list', { services: rows || [] });
  });
});

app.get('/servicos/novo', (req, res) => {
  res.render('services/form', { service: null });
});

app.post('/servicos', (req, res) => {
  const { name, description, price } = req.body;
  const stmt = db.prepare('INSERT INTO services (name, description, price) VALUES (?, ?, ?)');
  stmt.run(name || '', description || '', parseFloat(price) || 0, (err) => {
    if (err) return res.status(500).send('Erro ao salvar serviço.');
    res.redirect('/servicos');
  });
});

app.get('/servicos/:id/editar', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM services WHERE id = ?', [id], (err, row) => {
    if (err || !row) return res.status(404).send('Serviço não encontrado.');
    res.render('services/form', { service: row });
  });
});

app.post('/servicos/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, price } = req.body;
  const stmt = db.prepare('UPDATE services SET name = ?, description = ?, price = ? WHERE id = ?');
  stmt.run(name || '', description || '', parseFloat(price) || 0, id, (err) => {
    if (err) return res.status(500).send('Erro ao atualizar serviço.');
    res.redirect('/servicos');
  });
});

app.post('/servicos/:id/excluir', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM services WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).send('Erro ao excluir serviço.');
    res.redirect('/servicos');
  });
});

app.get('/financeiro', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let de = req.query.de || '';
  let ate = req.query.ate || '';
  if (!de || !ate) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    de = de || firstDay.toISOString().slice(0, 10);
    ate = ate || lastDay.toISOString().slice(0, 10);
  }

  const recebidoSql = `
    SELECT COALESCE(SUM(COALESCE(price_final, price_estimate, 0)), 0) AS total
    FROM service_orders
    WHERE status = 'Concluída' AND date(updated_at) >= ? AND date(updated_at) <= ?
  `;
  const aReceberSql = `
    SELECT COALESCE(SUM(COALESCE(price_estimate, 0)), 0) AS total
    FROM service_orders
    WHERE status IN ('Aberta', 'Em andamento') AND due_date >= date('now', 'localtime')
  `;
  const aReceberPeriodoSql = `
    SELECT COALESCE(SUM(COALESCE(price_estimate, 0)), 0) AS total
    FROM service_orders
    WHERE status IN ('Aberta', 'Em andamento') AND due_date >= ? AND due_date <= ?
  `;
  const listRecebidasSql = `
    SELECT so.id, so.updated_at, so.price_final, so.price_estimate, so.description,
      COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
      c.phone AS customer_phone
    FROM service_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    WHERE so.status = 'Concluída' AND date(so.updated_at) >= ? AND date(so.updated_at) <= ?
    ORDER BY so.updated_at DESC
  `;
  const listAReceberSql = `
    SELECT so.id, so.due_date, so.due_time, so.price_estimate, so.description,
      COALESCE(NULLIF(TRIM(c.name), ''), '(Cliente removido)') AS customer_name,
      c.phone AS customer_phone, so.status
    FROM service_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    WHERE so.status IN ('Aberta', 'Em andamento') AND so.due_date >= date('now', 'localtime')
    ORDER BY so.due_date ASC, so.due_time ASC
  `;

  db.get(recebidoSql, [de, ate], (err, rowRecebido) => {
    if (err) return res.status(500).send('Erro ao carregar financeiro.');
    const recebidoPeriodo = rowRecebido ? rowRecebido.total : 0;

    db.get(aReceberSql, [], (err2, rowAReceber) => {
      if (err2) return res.status(500).send('Erro ao carregar financeiro.');
      const aReceberTotal = rowAReceber ? rowAReceber.total : 0;

      db.get(aReceberPeriodoSql, [de, ate], (err3, rowPeriodo) => {
        if (err3) return res.status(500).send('Erro ao carregar financeiro.');
        const aReceberNoPeriodo = rowPeriodo ? rowPeriodo.total : 0;

        db.all(listRecebidasSql, [de, ate], (err4, listaRecebidas) => {
          if (err4) return res.status(500).send('Erro ao carregar financeiro.');
          db.all(listAReceberSql, [], (err5, listaAReceber) => {
            if (err5) return res.status(500).send('Erro ao carregar financeiro.');
            res.render('financeiro', {
              de,
              ate,
              recebidoPeriodo,
              aReceberTotal,
              aReceberNoPeriodo,
              listaRecebidas: listaRecebidas || [],
              listaAReceber: listaAReceber || [],
            });
          });
        });
      });
    });
  });
});

function startServer() {
  app.listen(PORT, () => {
    const mode = isProd ? 'produção' : 'desenvolvimento';
    const publicHint = BASE_URL_CONFIGURED || `http://127.0.0.1:${PORT} (defina BASE_URL no .env com o domínio público)`;
    console.log(
      `[Cleany] NODE_ENV="${rawNodeEnv || '(vazio)'}" → ${mode} | URL: ${publicHint} | usuários: banco SQLite + /admin/usuarios`
    );
    if (loginAccounts.length > 0) {
      console.log('[Cleany] Contas usadas na 1ª carga (seed do .env):', loginAccounts.map((a) => a.user).join(', '));
    }
    if (!isProd && process.env.PM2_HOME) {
      console.warn(
        '[Cleany] PM2 sem NODE_ENV=production — login/cookies usam modo desenvolvimento. Corrija: `pm2 start ecosystem.config.cjs` ou acrescente NODE_ENV=production no .env da EC2.'
      );
    }
  });
}

function bootstrapAndListen() {
  appUsers.countUsers((err, n) => {
    if (err) {
      console.error('[Cleany]', err.message);
      process.exit(1);
    }
    if (isProd && n === 0 && loginAccounts.length === 0) {
      console.error(
        '[Cleany] Produção: o banco não tem usuários e o .env não definiu LOGIN_* / LOGIN_ACCOUNTS_JSON. Defina pelo menos uma conta em',
        ENV_PATH
      );
      process.exit(1);
    }
    appUsers.seedFromAccountsIfEmpty(loginAccounts, (seedErr) => {
      if (seedErr) {
        console.error('[Cleany] Erro ao criar usuários iniciais:', seedErr.message);
        process.exit(1);
      }
      startServer();
    });
  });
}

bootstrapAndListen();

