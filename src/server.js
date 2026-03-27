const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./db');

const app = express();

const LOGIN_USER = process.env.LOGIN_USER || 'joaofalbi';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'Butt1005!';

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cleany-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  res.locals.whatsappUrl = function (phone) {
    if (!phone) return '';
    const d = String(phone).replace(/\D/g, '');
    if (d.length < 10) return '';
    if (d.length === 10 || d.length === 11) return 'https://wa.me/55' + d;
    if (d.length >= 12 && d.substring(0, 2) === '55') return 'https://wa.me/' + d;
    return 'https://wa.me/55' + d;
  };
  next();
});

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === LOGIN_USER && password === LOGIN_PASSWORD) {
    req.session.user = username;
    return res.redirect('/');
  }
  res.render('login', { error: 'Usuário ou senha incorretos.' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use(requireAuth);

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
  db.all("SELECT * FROM customers ORDER BY COALESCE(CAST(NULLIF(TRIM(codigo), '') AS INTEGER), 999999), codigo, id", (err, rows) => {
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
  if (!phoneTrim) {
    return res.render('customers/form', {
      customer: {
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
    db.get('SELECT id FROM customers WHERE TRIM(COALESCE(codigo, "")) = ?', [codigo], (err, row) => {
      if (err) return cb(err, true);
      cb(null, !!row);
    });
  };
  checkCodigo((err, isDuplicate) => {
    if (err) return res.status(500).send('Erro ao salvar cliente.');
    if (isDuplicate) {
      return res.render('customers/form', {
        customer: { codigo, name, nome_fantasia, phone, email, address, document, notes },
        error: 'Este código já está em uso por outro cliente. Escolha outro ou deixe em branco.',
      });
    }
    db.get('SELECT COALESCE(MAX(ordem_planilha), 0) + 1 AS next FROM customers', [], (err, row) => {
      if (err) return res.status(500).send('Erro ao salvar cliente.');
      const ordem = row ? row.next : 1;
      const stmt = db.prepare(
        'INSERT INTO customers (name, phone, email, address, document, notes, ordem_planilha, codigo, nome_fantasia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      stmt.run(name, phoneTrim, email, address, documentTrim, notes, ordem, codigo, nome_fantasia, (err2) => {
        if (err2) {
          return res.status(500).send('Erro ao salvar cliente.');
        }
        res.redirect('/clientes');
      });
      stmt.finalize();
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
    db.get('SELECT id FROM customers WHERE TRIM(COALESCE(codigo, "")) = ? AND id != ?', [codigo, id], (err, row) => {
      if (err) return cb(err, true);
      cb(null, !!row);
    });
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
  db.all("SELECT id, name, codigo FROM customers ORDER BY COALESCE(CAST(NULLIF(TRIM(codigo), '') AS INTEGER), 999999), codigo, id", (err, customers) => {
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
  let ano = parseInt(req.query.ano, 10) || now.getFullYear();
  let mes = parseInt(req.query.mes, 10) || now.getMonth() + 1;
  if (mes < 1) { mes = 12; ano--; }
  if (mes > 12) { mes = 1; ano++; }

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

    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const weeks = [];
    const cur = new Date(inicio);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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

    res.render('calendar', {
      monthName: monthNames[mes - 1],
      ano,
      mes,
      prevLink: `/calendario?ano=${prevAno}&mes=${prevMes}`,
      nextLink: `/calendario?ano=${nextAno}&mes=${nextMes}`,
      weeks,
      weekDays: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
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

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

