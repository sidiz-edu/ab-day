require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const S = '"app_260630_c6bq"';
const ra = fn => (req, res, next) => fn(req, res, next).catch(next);

app.use(express.static(path.join(__dirname)));

// ── Events ──
app.get('/api/events', ra(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${S}."anbang_events" ORDER BY month DESC`);
  res.json(rows);
}));
app.post('/api/events', ra(async (req, res) => {
  const { month, date, time_range, location, host_team } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ${S}."anbang_events"(month,date,time_range,location,host_team) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [month, date, time_range, location, host_team]
  );
  res.json(rows[0]);
}));
app.patch('/api/events/:id', ra(async (req, res) => {
  const { month, date, time_range, location, host_team } = req.body;
  const { rows } = await pool.query(
    `UPDATE ${S}."anbang_events" SET month=$1,date=$2,time_range=$3,location=$4,host_team=$5 WHERE id=$6 RETURNING *`,
    [month, date, time_range, location, host_team, req.params.id]
  );
  res.json(rows[0]);
}));
app.delete('/api/events/:id', ra(async (req, res) => {
  await pool.query(`DELETE FROM ${S}."anbang_events" WHERE id=$1`, [req.params.id]);
  res.sendStatus(204);
}));

// ── Presentations ──
app.get('/api/presentations', ra(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${S}."anbang_presentations" ORDER BY order_num ASC`);
  res.json(rows);
}));
app.post('/api/presentations', ra(async (req, res) => {
  const body = req.body;
  const items = Array.isArray(body) ? body : [body];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const p of items) {
      const { rows } = await client.query(
        `INSERT INTO ${S}."anbang_presentations"(event_month,title,presenter,type,duration_min,order_num) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [p.event_month, p.title, p.presenter || null, p.type, p.duration_min || null, p.order_num]
      );
      results.push(rows[0]);
    }
    await client.query('COMMIT');
    res.json(Array.isArray(body) ? results : results[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));
app.patch('/api/presentations/reorder', ra(async (req, res) => {
  const items = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(`UPDATE ${S}."anbang_presentations" SET order_num=$1 WHERE id=$2`, [item.order_num, item.id]);
    }
    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));
app.patch('/api/presentations/:id', ra(async (req, res) => {
  const p = req.body;
  const { rows } = await pool.query(
    `UPDATE ${S}."anbang_presentations" SET event_month=$1,title=$2,presenter=$3,type=$4,duration_min=$5,order_num=$6 WHERE id=$7 RETURNING *`,
    [p.event_month, p.title, p.presenter || null, p.type, p.duration_min || null, p.order_num, req.params.id]
  );
  res.json(rows[0]);
}));
app.delete('/api/presentations/:id', ra(async (req, res) => {
  await pool.query(`DELETE FROM ${S}."anbang_presentations" WHERE id=$1`, [req.params.id]);
  res.sendStatus(204);
}));

// ── Hosts ──
app.get('/api/hosts', ra(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${S}."anbang_hosts" ORDER BY order_num ASC`);
  res.json(rows);
}));
app.post('/api/hosts', ra(async (req, res) => {
  const { event_month, people } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${S}."anbang_hosts" WHERE event_month=$1`, [event_month]);
    for (let i = 0; i < people.length; i++) {
      await client.query(
        `INSERT INTO ${S}."anbang_hosts"(event_month,name,is_lead,order_num) VALUES($1,$2,$3,$4)`,
        [event_month, people[i], i === 0, i]
      );
    }
    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));
app.delete('/api/hosts/by-month/:month', ra(async (req, res) => {
  await pool.query(`DELETE FROM ${S}."anbang_hosts" WHERE event_month=$1`, [req.params.month]);
  res.sendStatus(204);
}));
app.delete('/api/hosts/:id', ra(async (req, res) => {
  await pool.query(`DELETE FROM ${S}."anbang_hosts" WHERE id=$1`, [req.params.id]);
  res.sendStatus(204);
}));

// ── People ──
app.get('/api/people', ra(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${S}."anbang_people" ORDER BY name ASC`);
  res.json(rows);
}));
app.post('/api/people', ra(async (req, res) => {
  const { name, team, title, email } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ${S}."anbang_people"(name,team,title,email) VALUES($1,$2,$3,$4) RETURNING *`,
    [name, team, title || null, email || null]
  );
  res.json(rows[0]);
}));
app.patch('/api/people/batch-email', ra(async (req, res) => {
  const items = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(`UPDATE ${S}."anbang_people" SET email=$1 WHERE id=$2`, [item.email, item.id]);
    }
    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));
app.patch('/api/people/:id', ra(async (req, res) => {
  const ALLOWED = ['name', 'team', 'title', 'email', 'status'];
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => ALLOWED.includes(k));
  if (!keys.length) return res.sendStatus(204);
  const sets = keys.map((k, i) => `"${k}"=$${i + 1}`).join(',');
  const vals = [...keys.map(k => (fields[k] === undefined ? null : fields[k])), req.params.id];
  const { rows } = await pool.query(
    `UPDATE ${S}."anbang_people" SET ${sets} WHERE id=$${vals.length} RETURNING *`,
    vals
  );
  res.json(rows[0] || {});
}));
app.delete('/api/people/:id', ra(async (req, res) => {
  await pool.query(`DELETE FROM ${S}."anbang_people" WHERE id=$1`, [req.params.id]);
  res.sendStatus(204);
}));

// ── Settings ──
app.get('/api/settings', ra(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${S}."anbang_settings"`);
  res.json(rows);
}));
app.put('/api/settings', ra(async (req, res) => {
  const { key, value } = req.body;
  await pool.query(
    `INSERT INTO ${S}."anbang_settings"(key,value,updated_at) VALUES($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [key, value]
  );
  res.sendStatus(204);
}));

// ── Aicando Order ──
app.get('/api/aicando-order', ra(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM ${S}."aicando_order" ORDER BY order_num ASC`);
  res.json(rows);
}));
app.post('/api/aicando-order', ra(async (req, res) => {
  const { name, order_num } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO ${S}."aicando_order"(name,order_num) VALUES($1,$2) RETURNING *`,
    [name, order_num]
  );
  res.json(rows[0]);
}));
app.patch('/api/aicando-order/reorder', ra(async (req, res) => {
  const items = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      await client.query(`UPDATE ${S}."aicando_order" SET order_num=$1 WHERE id=$2`, [item.order_num, item.id]);
    }
    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));
app.patch('/api/aicando-order/:id', ra(async (req, res) => {
  const { order_num } = req.body;
  await pool.query(`UPDATE ${S}."aicando_order" SET order_num=$1 WHERE id=$2`, [order_num, req.params.id]);
  res.sendStatus(204);
}));
app.delete('/api/aicando-order/:id', ra(async (req, res) => {
  await pool.query(`DELETE FROM ${S}."aicando_order" WHERE id=$1`, [req.params.id]);
  res.sendStatus(204);
}));

// ── Error handler ──
app.use(function (err, req, res, next) {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ab-day backend on port', PORT));
