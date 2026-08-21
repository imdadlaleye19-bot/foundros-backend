// server.js — Serveur FoundrOS. Node.js pur, zéro dépendance externe (pas d'Express, pas de framework).
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  createUser, getUserByEmail, getUserById,
  createUpdate, listUpdatesForUser, deleteUpdate,
  createExpense, listExpensesForUser, deleteExpense,
  createContract, listContractsForUser, deleteContract,
  createCompetitor, listCompetitorsForUser, deleteCompetitor, createCompetitorNote, listNotesForCompetitor,
  createFeedback, listFeedbackForUser, deleteFeedback,
} = require('./db');
const { hashPassword, verifyPassword, createToken, verifyToken } = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Utilitaires HTTP ----------
function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 3e6) req.destroy(); // garde-fou anti-abus (3MB max, pour le texte de contrats)
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.userId) || null;
}

function publicUser(u) { return { id: u.id, email: u.email, companyName: u.company_name, createdAt: u.created_at }; }
function publicUpdate(u) {
  return { id: u.id, ts: u.ts, arr: u.arr, arrPrev: u.arr_prev, burn: u.burn, burnPrev: u.burn_prev,
    cash: u.cash, clients: u.clients, wins: u.wins, challenges: u.challenges,
    winsText: u.wins_text, challengesText: u.challenges_text, aiUsed: !!u.ai_used };
}
function publicExpense(e) { return { id: e.id, category: e.category, label: e.label, amount: e.amount, month: e.month, createdAt: e.created_at }; }
function publicContract(c) { return { id: c.id, name: c.name, counterparty: c.counterparty, contractType: c.contract_type,
  startDate: c.start_date, endDate: c.end_date, noticeDays: c.notice_days, summary: c.summary, rawText: c.raw_text, createdAt: c.created_at }; }
function publicCompetitor(c) { return { id: c.id, name: c.name, url: c.url, notes: c.notes, createdAt: c.created_at }; }
function publicNote(n) { return { id: n.id, competitorId: n.competitor_id, note: n.note, ts: n.ts }; }
function publicFeedback(f) { return { id: f.id, source: f.source, text: f.text, ts: f.ts }; }

// ---------- Fichiers statiques ----------
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, decodeURIComponent(filePath.split('?')[0]));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Interdit'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function isValidEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

// ---------- Serveur ----------
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});

  try {
    // ===== AUTH =====
    if (url === '/api/register' && req.method === 'POST') {
      const { email, password, companyName } = await readBody(req);
      if (!isValidEmail(email)) return sendJSON(res, 400, { error: "Email invalide." });
      if (!password || password.length < 8) return sendJSON(res, 400, { error: "Le mot de passe doit faire au moins 8 caractères." });
      if (getUserByEmail(email)) return sendJSON(res, 409, { error: "Un compte existe déjà avec cet email." });
      const { hash, salt } = hashPassword(password);
      const user = createUser({ email, passwordHash: hash, salt, companyName });
      return sendJSON(res, 201, { token: createToken({ userId: user.id }), user: publicUser(user) });
    }
    if (url === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req);
      const user = getUserByEmail(email || '');
      if (!user || !verifyPassword(password || '', user.salt, user.password_hash)) return sendJSON(res, 401, { error: "Email ou mot de passe incorrect." });
      return sendJSON(res, 200, { token: createToken({ userId: user.id }), user: publicUser(user) });
    }
    if (url === '/api/me' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJSON(res, 401, { error: "Non authentifié." });
      return sendJSON(res, 200, { user: publicUser(user) });
    }

    // Toutes les routes ci-dessous nécessitent une authentification
    const authRequired = url.startsWith('/api/') && !['/api/register', '/api/login'].includes(url);
    let user = null;
    if (authRequired) {
      user = getAuthUser(req);
      if (!user) return sendJSON(res, 401, { error: "Non authentifié." });
    }

    // ===== INVESTOR HUB (updates) =====
    if (url === '/api/updates' && req.method === 'GET') return sendJSON(res, 200, { updates: listUpdatesForUser(user.id).map(publicUpdate) });
    if (url === '/api/updates' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 201, { update: publicUpdate(createUpdate(user.id, body)) });
    }
    if (url.startsWith('/api/updates/') && req.method === 'DELETE') {
      const ok = deleteUpdate(user.id, url.split('/').pop());
      return ok ? sendJSON(res, 200, { deleted: true }) : sendJSON(res, 404, { error: "Update introuvable." });
    }

    // ===== FINANCE (expenses) =====
    if (url === '/api/expenses' && req.method === 'GET') return sendJSON(res, 200, { expenses: listExpensesForUser(user.id).map(publicExpense) });
    if (url === '/api/expenses' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.category || !body.amount || !body.month) return sendJSON(res, 400, { error: "category, amount et month sont requis." });
      return sendJSON(res, 201, { expense: publicExpense(createExpense(user.id, body)) });
    }
    if (url.startsWith('/api/expenses/') && req.method === 'DELETE') {
      const ok = deleteExpense(user.id, url.split('/').pop());
      return ok ? sendJSON(res, 200, { deleted: true }) : sendJSON(res, 404, { error: "Dépense introuvable." });
    }

    // ===== LEGAL (contracts) =====
    if (url === '/api/contracts' && req.method === 'GET') return sendJSON(res, 200, { contracts: listContractsForUser(user.id).map(publicContract) });
    if (url === '/api/contracts' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name) return sendJSON(res, 400, { error: "Le nom du contrat est requis." });
      return sendJSON(res, 201, { contract: publicContract(createContract(user.id, body)) });
    }
    if (url.startsWith('/api/contracts/') && req.method === 'DELETE') {
      const ok = deleteContract(user.id, url.split('/').pop());
      return ok ? sendJSON(res, 200, { deleted: true }) : sendJSON(res, 404, { error: "Contrat introuvable." });
    }

    // ===== MARKET WATCH (competitors + notes) =====
    if (url === '/api/competitors' && req.method === 'GET') return sendJSON(res, 200, { competitors: listCompetitorsForUser(user.id).map(publicCompetitor) });
    if (url === '/api/competitors' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name) return sendJSON(res, 400, { error: "Le nom du concurrent est requis." });
      return sendJSON(res, 201, { competitor: publicCompetitor(createCompetitor(user.id, body)) });
    }
    if (url.startsWith('/api/competitors/') && url.endsWith('/notes') && req.method === 'GET') {
      const competitorId = url.split('/')[3];
      return sendJSON(res, 200, { notes: listNotesForCompetitor(user.id, competitorId).map(publicNote) });
    }
    if (url.startsWith('/api/competitors/') && url.endsWith('/notes') && req.method === 'POST') {
      const competitorId = url.split('/')[3];
      const body = await readBody(req);
      if (!body.note) return sendJSON(res, 400, { error: "Le contenu de la note est requis." });
      return sendJSON(res, 201, { note: publicNote(createCompetitorNote(user.id, competitorId, body.note)) });
    }
    if (url.startsWith('/api/competitors/') && req.method === 'DELETE') {
      const ok = deleteCompetitor(user.id, url.split('/').pop());
      return ok ? sendJSON(res, 200, { deleted: true }) : sendJSON(res, 404, { error: "Concurrent introuvable." });
    }

    // ===== VOICE OF CUSTOMER (feedback) =====
    if (url === '/api/feedback' && req.method === 'GET') return sendJSON(res, 200, { feedback: listFeedbackForUser(user.id).map(publicFeedback) });
    if (url === '/api/feedback' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.text) return sendJSON(res, 400, { error: "Le texte du retour est requis." });
      return sendJSON(res, 201, { feedback: publicFeedback(createFeedback(user.id, body)) });
    }
    if (url.startsWith('/api/feedback/') && req.method === 'DELETE') {
      const ok = deleteFeedback(user.id, url.split('/').pop());
      return ok ? sendJSON(res, 200, { deleted: true }) : sendJSON(res, 404, { error: "Retour introuvable." });
    }

    // ===== Fichiers statiques (frontend) =====
    if (req.method === 'GET') return serveStatic(req, res);

    sendJSON(res, 404, { error: "Route inconnue." });
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: "Erreur serveur.", detail: err.message });
  }
});

server.listen(PORT, () => console.log(`FoundrOS backend démarré → http://localhost:${PORT}`));
