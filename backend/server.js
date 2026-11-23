require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { pool, testConnection } = require('./database');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'soil_session';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres.');
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  const expectedOrigin = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expectedOrigin) return res.status(403).json({ error: 'Origem não permitida.' });
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', expectedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = value => typeof value === 'string' ? value.trim() : value;
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const makeId = () => crypto.randomUUID();

function signSession(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function setSession(res, user) {
  res.cookie(COOKIE_NAME, signSession(user), COOKIE_OPTIONS);
}
function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_OPTIONS.secure, sameSite: 'lax', path: '/' });
}
const requireAuth = asyncRoute(async (req, res, next) => {
  const token = req.cookies[COOKIE_NAME] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.execute('SELECT id, name, email, role FROM users WHERE id = ?', [payload.sub]);
    if (!rows.length) return res.status(401).json({ error: 'Sessão inválida.' });
    req.user = rows[0];
    next();
  } catch {
    clearSession(res);
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
});
const requireAdmin = (req, res, next) => req.user?.role === 'admin'
  ? next() : res.status(403).json({ error: 'Acesso restrito ao administrador.' });

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
function validateRecord(kind, body) {
  const required = {
    properties: ['nome', 'produtor', 'local', 'area'],
    pastures: ['nome', 'prop', 'area', 'capim'],
    analyses: ['prop', 'pasto', 'amostra', 'data']
  }[kind];
  if (!required) return 'Tipo de registro inválido.';
  for (const key of required) if (body[key] === undefined || body[key] === null || String(body[key]).trim() === '') return 'Preencha os campos obrigatórios.';
  if (kind === 'analyses' && !/^\d{4}-\d{2}-\d{2}$/.test(body.data)) return 'Data da análise inválida.';
  if (kind !== 'analyses' && (!Number.isFinite(Number(body.area)) || Number(body.area) < 0)) return 'Área inválida.';
  return null;
}
async function owned(connection, table, id, userId) {
  const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId]);
  return rows.length > 0;
}
async function createAdminFromEnv() {
  const email = clean(process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) return;
  if (password.length < 12) throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
  const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (!rows.length) {
    const hash = await bcrypt.hash(password, 12);
    await pool.execute('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
      [clean(process.env.ADMIN_NAME || 'Administrador'), email, hash, 'admin']);
    console.log('Administrador inicial criado.');
  }
}
function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
  const name = clean(req.body.name || '');
  const email = clean(req.body.email || '').toLowerCase();
  const password = String(req.body.password || '');
  if (!name || name.length > 120 || !validEmail(email) || password.length < 10) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com pelo menos 10 caracteres.' });
  }
  const suppliedInvite = Buffer.from(String(req.body.inviteCode || ''));
  const expectedInvite = Buffer.from(String(process.env.INVITE_CODE || ''));
  const inviteMatches = expectedInvite.length > 0 && suppliedInvite.length === expectedInvite.length &&
    crypto.timingSafeEqual(suppliedInvite, expectedInvite);
  if (!inviteMatches) return res.status(403).json({ error: 'Código de convite inválido.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const [result] = await pool.execute('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
      [name, email, hash, 'user']);
    const user = { id: result.insertId, name, email, role: 'user' };
    setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw error;
  }
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const email = clean(req.body.email || '').toLowerCase();
  const password = String(req.body.password || '');
  const [rows] = await pool.execute('SELECT id,name,email,password_hash,role FROM users WHERE email = ?', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  setSession(res, rows[0]);
  res.json({ user: publicUser(rows[0]) });
}));
app.post('/api/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/forgot-password', resetLimiter, asyncRoute(async (req, res) => {
  const email = clean(req.body.email || '').toLowerCase();
  const [users] = await pool.execute('SELECT id,email,name FROM users WHERE email = ?', [email]);
  const response = { message: 'Se o e-mail estiver cadastrado e o serviço de envio estiver configurado, você receberá as instruções.' };
  if (!users.length) return res.json(response);
  const transport = mailer();
  if (!transport) return res.status(503).json({ error: 'Recuperação por e-mail ainda não está configurada no servidor.' });
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await pool.execute('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [users[0].id]);
  await pool.execute('INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
    [users[0].id, tokenHash]);
  const link = new URL('/?reset=' + encodeURIComponent(rawToken), process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').toString();
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: users[0].email,
    subject: 'Recuperação de senha - Soil Analysis',
    text: 'Olá, ' + users[0].name + '. Use este link para criar uma nova senha (válido por 30 minutos): ' + link
  });
  res.json(response);
}));
app.post('/api/auth/reset-password', resetLimiter, asyncRoute(async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 10) return res.status(400).json({ error: 'Token inválido ou senha menor que 10 caracteres.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id,user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE', [tokenHash]);
    if (!rows.length) { await connection.rollback(); return res.status(400).json({ error: 'Link expirado ou já utilizado.' }); }
    const hash = await bcrypt.hash(password, 12);
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, rows[0].user_id]);
    await connection.execute('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [rows[0].user_id]);
    await connection.commit();
    res.json({ message: 'Senha alterada. Faça login com a nova senha.' });
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}));

app.post('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const name = clean(req.body.name || '');
  const email = clean(req.body.email || '').toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (!name || !validEmail(email) || password.length < 10) return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com pelo menos 10 caracteres.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const [result] = await pool.execute('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)', [name,email,hash,role]);
    res.status(201).json({ user: { id: result.insertId, name, email, role } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw error;
  }
}));

const configs = {
  properties: { table: 'properties', columns: ['nome','produtor','local','area','obs'], map: r => r },
  pastures: { table: 'pastures', columns: ['nome','area','capim','data','obs'], map: r => ({ ...r, prop: r.property_id }) },
  analyses: { table: 'analyses', columns: ['amostra','data','prof','ph','mo','al','hal','p','k','ca','mg','sb','ctc','v','argila'], map: r => ({ ...r, prop: r.property_id, pasto: r.pasture_id }) }
};
const numericFields = new Set(['area','ph','mo','al','hal','p','k','ca','mg','sb','ctc','v','argila']);
function apiValue(value, field) {
  if (value === '' || value === undefined || value === null) return null;
  if (numericFields.has(field)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Valor numérico inválido: ' + field);
    return number;
  }
  return value;
}
function sqlColumns(kind, body, userId, id, creating) {
  const cfg = configs[kind];
  const fields = [...cfg.columns];
  const values = fields.map(field => {
    if (field === 'property_id') return body.prop;
    if (field === 'pasture_id') return body.pasto;
    return apiValue(body[field], field);
  });
  if (kind === 'pastures') { fields.splice(1, 0, 'property_id'); values.splice(1, 0, body.prop); }
  if (kind === 'analyses') {
    fields.splice(1, 0, 'property_id', 'pasture_id'); values.splice(1, 0, body.prop, body.pasto);
  }
  if (creating) { fields.unshift('id','user_id'); values.unshift(id,userId); }
  return { fields, values };
}
for (const kind of Object.keys(configs)) {
  const cfg = configs[kind];
  app.get('/api/' + kind, requireAuth, asyncRoute(async (req, res) => {
    const [rows] = await pool.execute('SELECT * FROM ' + cfg.table + ' WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json({ items: rows.map(cfg.map) });
  }));
  app.post('/api/' + kind, requireAuth, asyncRoute(async (req, res) => {
    const error = validateRecord(kind, req.body);
    if (error) return res.status(400).json({ error });
    if (kind !== 'properties' && !(await owned(pool, 'properties', req.body.prop, req.user.id))) return res.status(404).json({ error: 'Propriedade não encontrada.' });
    if (kind === 'analyses') {
      const [linkedPasture] = await pool.execute(
        'SELECT id FROM pastures WHERE id = ? AND property_id = ? AND user_id = ?',
        [req.body.pasto, req.body.prop, req.user.id]
      );
      if (!linkedPasture.length) return res.status(400).json({ error: 'A pastagem selecionada não pertence à propriedade informada.' });
    }
    const id = clean(req.body.id || makeId());
    const { fields, values } = sqlColumns(kind, req.body, req.user.id, id, true);
    await pool.execute('INSERT INTO ' + cfg.table + ' (' + fields.map(f => '`'+f+'`').join(',') + ') VALUES (' + fields.map(() => '?').join(',') + ')', values);
    res.status(201).json({ item: { ...req.body, id } });
  }));
  app.put('/api/' + kind + '/:id', requireAuth, asyncRoute(async (req, res) => {
    const error = validateRecord(kind, req.body);
    if (error) return res.status(400).json({ error });
    if (!(await owned(pool, cfg.table, req.params.id, req.user.id))) return res.status(404).json({ error: 'Registro não encontrado.' });
    if (kind !== 'properties' && !(await owned(pool, 'properties', req.body.prop, req.user.id))) return res.status(404).json({ error: 'Propriedade não encontrada.' });
    if (kind === 'analyses' && !(await owned(pool, 'pastures', req.body.pasto, req.user.id))) return res.status(404).json({ error: 'Pastagem não encontrada.' });
    const { fields, values } = sqlColumns(kind, req.body, req.user.id, req.params.id, false);
    await pool.execute('UPDATE ' + cfg.table + ' SET ' + fields.map(f => '`'+f+'` = ?').join(',') + ' WHERE id = ? AND user_id = ?', [...values, req.params.id, req.user.id]);
    res.json({ item: { ...req.body, id: req.params.id } });
  }));
  app.delete('/api/' + kind + '/:id', requireAuth, asyncRoute(async (req, res) => {
    if (!(await owned(pool, cfg.table, req.params.id, req.user.id))) return res.status(404).json({ error: 'Registro não encontrado.' });
    await pool.execute('DELETE FROM ' + cfg.table + ' WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));
}

app.post('/api/migration/import', requireAuth, asyncRoute(async (req, res) => {
  const source = req.body && req.body.data;
  if (!source || !Array.isArray(source.props) || !Array.isArray(source.pastos) || !Array.isArray(source.analises)) {
    return res.status(400).json({ error: 'Formato de dados locais inválido.' });
  }
  const raw = JSON.stringify(source);
  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) return res.status(413).json({ error: 'Os dados excedem o limite de importação.' });
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id,properties_count,pastures_count,analyses_count FROM migration_batches WHERE user_id = ? AND fingerprint = ? FOR UPDATE', [req.user.id, fingerprint]);
    if (existing.length) {
      await connection.commit();
      return res.json({ alreadyImported: true, counts: { properties: existing[0].properties_count, pastures: existing[0].pastures_count, analyses: existing[0].analyses_count } });
    }
    const props = new Map();
    const pastures = new Map();
    for (const p of source.props) {
      const id = String(p.id || makeId());
      const [r] = await connection.execute(
        'INSERT INTO properties (id,user_id,nome,produtor,`local`,area,obs) VALUES (?,?,?,?,?,?,?)',
        [id,req.user.id,clean(p.nome || 'Propriedade importada'),clean(p.produtor || ''),clean(p.local || ''),apiValue(p.area || 0,'area'),clean(p.obs || '')]);
      props.set(String(p.id), id);
    }
    for (const p of source.pastos) {
      const propertyId = props.get(String(p.prop));
      if (!propertyId) throw new Error('Migração interrompida: uma pastagem referencia propriedade inexistente.');
      const id = String(p.id || makeId());
      await connection.execute(
        'INSERT INTO pastures (id,user_id,property_id,nome,area,capim,data,obs) VALUES (?,?,?,?,?,?,?,?)',
        [id,req.user.id,propertyId,clean(p.nome || 'Pastagem importada'),apiValue(p.area || 0,'area'),clean(p.capim || 'Não informado'),p.data || null,clean(p.obs || '')]);
      pastures.set(String(p.id), id);
    }
    for (const a of source.analises) {
      const propertyId = props.get(String(a.prop));
      const pastureId = pastures.get(String(a.pasto));
      if (!propertyId || !pastureId) throw new Error('Migração interrompida: uma análise referencia propriedade ou pastagem inexistente.');
      const fields = ['id','user_id','property_id','pasture_id','amostra','data','prof','ph','mo','al','hal','p','k','ca','mg','sb','ctc','v','argila'];
      const values = [String(a.id || makeId()),req.user.id,propertyId,pastureId,clean(a.amostra || 'Sem identificação'),a.data || new Date().toISOString().slice(0,10),a.prof || null,
        ...['ph','mo','al','hal','p','k','ca','mg','sb','ctc','v','argila'].map(k => apiValue(a[k],k))];
      await connection.execute('INSERT INTO analyses ('+fields.map(f=>'`'+f+'`').join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')',values);
    }
    await connection.execute(
      'INSERT INTO migration_batches (user_id,fingerprint,properties_count,pastures_count,analyses_count) VALUES (?,?,?,?,?)',
      [req.user.id,fingerprint,source.props.length,source.pastos.length,source.analises.length]);
    await connection.commit();
    res.json({ imported: true, counts: { properties: source.props.length, pastures: source.pastos.length, analyses: source.analises.length } });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Há identificadores repetidos nos dados locais. Revise os dados antes de tentar novamente.' });
    throw error;
  } finally { connection.release(); }
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (req,res) => {
  const [rows] = await pool.execute('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC');
  res.json({ users: rows });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Erro interno. Tente novamente.' : error.message });
});

async function start() {
  await testConnection();
  await createAdminFromEnv();
  app.listen(PORT, '0.0.0.0', () => console.log('Soil Analysis disponível na porta ' + PORT));
}
start().catch(error => { console.error('Falha ao iniciar:', error); process.exit(1); });
