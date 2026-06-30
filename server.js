const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

const SCHEMA = 'app_260630_c6bq';
const TABLES = new Set(['anbang_events','anbang_hosts','anbang_presentations','anbang_people','aicando_order','anbang_settings']);

app.use(cors({ origin: '*', exposedHeaders: ['Content-Range'] }));
app.use(express.json());

function safe(col) { return col.replace(/[^a-zA-Z0-9_]/g, ''); }
function tbl(t) { return `"${SCHEMA}"."${t}"`; }

function buildWhere(query) {
  const filters = [], values = [];
  let pi = 1;
  for (const [k, v] of Object.entries(query)) {
    if (['select','order','limit','offset','on_conflict'].includes(k)) continue;
    const m = String(v).match(/^(eq|neq|gt|gte|lt|lte|is)\.(.*)/s);
    if (!m) continue;
    const [, op, val] = m;
    const col = `"${safe(k)}"`;
    if (op === 'is') {
      filters.push(`${col} IS ${val === 'null' ? 'NULL' : val.toUpperCase()}`);
    } else {
      const opMap = { eq:'=', neq:'!=', gt:'>', gte:'>=', lt:'<', lte:'<=' };
      filters.push(`${col} ${opMap[op]} $${pi++}`);
      values.push(val === 'null' ? null : val);
    }
  }
  return { where: filters.length ? 'WHERE ' + filters.join(' AND ') : '', values, pi };
}

// GET
app.get('/rest/v1/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!TABLES.has(table)) return res.status(404).json({ message: 'Not found' });

    const sel = (req.query.select || '*') === '*' ? '*'
      : req.query.select.split(',').map(c => `"${safe(c.trim())}"`).join(', ');
    const { where, values } = buildWhere(req.query);

    let sql = `SELECT ${sel} FROM ${tbl(table)} ${where}`;

    if (req.query.order) {
      const parts = req.query.order.split(',').map(o => {
        const [c, d] = o.split('.');
        return `"${safe(c)}" ${d === 'desc' ? 'DESC' : 'ASC'}`;
      });
      sql += ' ORDER BY ' + parts.join(', ');
    }
    if (req.query.limit) sql += ` LIMIT ${Math.abs(parseInt(req.query.limit))||100}`;
    if (req.query.offset) sql += ` OFFSET ${Math.abs(parseInt(req.query.offset))||0}`;

    const r = await pool.query(sql, values);
    res.json(r.rows);
  } catch (e) { console.error(e.message); res.status(500).json({ message: e.message }); }
});

// POST (insert / upsert)
app.post('/rest/v1/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!TABLES.has(table)) return res.status(404).json({ message: 'Not found' });

    const rows = Array.isArray(req.body) ? req.body : [req.body];
    const prefer = req.headers['prefer'] || '';
    const onConflict = req.query.on_conflict;
    const results = [];

    for (const row of rows) {
      const cols = Object.keys(row);
      if (!cols.length) continue;
      const colList = cols.map(c => `"${safe(c)}"`).join(', ');
      const ph = cols.map((_, i) => `$${i+1}`).join(', ');
      let sql;

      if (onConflict && prefer.includes('merge-duplicates')) {
        const conflictCols = onConflict.split(',').map(c => `"${safe(c)}"`).join(', ');
        const updateCols = cols.filter(c => !onConflict.split(',').includes(c));
        const updateSet = updateCols.length
          ? updateCols.map(c => `"${safe(c)}" = EXCLUDED."${safe(c)}"`).join(', ')
          : `"${safe(cols[0])}" = EXCLUDED."${safe(cols[0])}"`;
        sql = `INSERT INTO ${tbl(table)} (${colList}) VALUES (${ph}) ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet} RETURNING *`;
      } else {
        sql = `INSERT INTO ${tbl(table)} (${colList}) VALUES (${ph}) RETURNING *`;
      }
      const r = await pool.query(sql, Object.values(row));
      results.push(...r.rows);
    }

    res.status(201).json(prefer.includes('return=representation') ? results : []);
  } catch (e) { console.error(e.message); res.status(500).json({ message: e.message }); }
});

// PATCH (update)
app.patch('/rest/v1/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!TABLES.has(table)) return res.status(404).json({ message: 'Not found' });

    const { where, values, pi } = buildWhere(req.query);
    if (!where) return res.status(400).json({ message: 'Filter required' });

    const data = req.body;
    const cols = Object.keys(data);
    const set = cols.map((c, i) => `"${safe(c)}" = $${pi+i}`).join(', ');
    const sql = `UPDATE ${tbl(table)} SET ${set} ${where} RETURNING *`;
    const r = await pool.query(sql, [...values, ...Object.values(data)]);
    res.json(r.rows);
  } catch (e) { console.error(e.message); res.status(500).json({ message: e.message }); }
});

// DELETE
app.delete('/rest/v1/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!TABLES.has(table)) return res.status(404).json({ message: 'Not found' });

    const { where, values } = buildWhere(req.query);
    if (!where) return res.status(400).json({ message: 'Filter required' });

    const sql = `DELETE FROM ${tbl(table)} ${where} RETURNING *`;
    const r = await pool.query(sql, values);
    res.json(r.rows);
  } catch (e) { console.error(e.message); res.status(500).json({ message: e.message }); }
});

// Static (index.html)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AB-DAY backend: http://localhost:${PORT}`));
