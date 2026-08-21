// db.js — Accès à la base de données SQLite (aucune dépendance externe : node:sqlite est intégré à Node.js 22+)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'foundros.db');
const db = new DatabaseSync(DB_PATH);

// --- Schéma ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    company_name TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS updates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    arr REAL DEFAULT 0,
    arr_prev REAL DEFAULT 0,
    burn REAL DEFAULT 0,
    burn_prev REAL DEFAULT 0,
    cash REAL DEFAULT 0,
    clients INTEGER DEFAULT 0,
    wins TEXT,
    challenges TEXT,
    wins_text TEXT,
    challenges_text TEXT,
    ai_used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_updates_user ON updates(user_id);

  -- Module Finance : dépenses manuelles (sert au cashflow/projection)
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    label TEXT,
    amount REAL NOT NULL,
    month TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);

  -- Module Legal : contrats (saisis manuellement ou analysés par IA côté client)
  CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    counterparty TEXT,
    contract_type TEXT,
    start_date TEXT,
    end_date TEXT,
    notice_days INTEGER,
    summary TEXT,
    raw_text TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts(user_id);

  -- Module Market Watch : concurrents suivis + journal d'observations
  CREATE TABLE IF NOT EXISTS competitors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_competitors_user ON competitors(user_id);

  CREATE TABLE IF NOT EXISTS competitor_notes (
    id TEXT PRIMARY KEY,
    competitor_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    note TEXT NOT NULL,
    ts INTEGER NOT NULL,
    FOREIGN KEY (competitor_id) REFERENCES competitors(id)
  );
  CREATE INDEX IF NOT EXISTS idx_competitor_notes_competitor ON competitor_notes(competitor_id);

  -- Module Voice of Customer : retours clients centralisés
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
`);

function uuid() { return crypto.randomUUID(); }

// --- Users ---
function createUser({ email, passwordHash, salt, companyName }) {
  const id = uuid();
  db.prepare(`INSERT INTO users (id, email, password_hash, salt, company_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, email.toLowerCase().trim(), passwordHash, salt, companyName || null, Date.now());
  return getUserById(id);
}
function getUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()); }
function getUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }

// --- Updates (Investor Hub) ---
function createUpdate(userId, data) {
  const id = uuid();
  db.prepare(`INSERT INTO updates (id, user_id, ts, arr, arr_prev, burn, burn_prev, cash, clients, wins, challenges, wins_text, challenges_text, ai_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, Date.now(), data.arr||0, data.arrPrev||0, data.burn||0, data.burnPrev||0,
         data.cash||0, data.clients||0, data.wins||'', data.challenges||'', data.winsText||'', data.challengesText||'', data.aiUsed?1:0);
  return getUpdateById(id);
}
function getUpdateById(id) { return db.prepare('SELECT * FROM updates WHERE id = ?').get(id); }
function listUpdatesForUser(userId) { return db.prepare('SELECT * FROM updates WHERE user_id = ? ORDER BY ts ASC').all(userId); }
function deleteUpdate(userId, updateId) { return db.prepare('DELETE FROM updates WHERE id = ? AND user_id = ?').run(updateId, userId).changes > 0; }

// --- Expenses (Finance) ---
function createExpense(userId, data) {
  const id = uuid();
  db.prepare(`INSERT INTO expenses (id, user_id, category, label, amount, month, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, data.category, data.label||'', data.amount, data.month, Date.now());
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
}
function listExpensesForUser(userId) { return db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY month DESC, created_at DESC').all(userId); }
function deleteExpense(userId, id) { return db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(id, userId).changes > 0; }

// --- Contracts (Legal) ---
function createContract(userId, data) {
  const id = uuid();
  db.prepare(`INSERT INTO contracts (id, user_id, name, counterparty, contract_type, start_date, end_date, notice_days, summary, raw_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, data.name, data.counterparty||'', data.contractType||'', data.startDate||'', data.endDate||'',
         data.noticeDays||null, data.summary||'', data.rawText||'', Date.now());
  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
}
function listContractsForUser(userId) { return db.prepare('SELECT * FROM contracts WHERE user_id = ? ORDER BY created_at DESC').all(userId); }
function deleteContract(userId, id) { return db.prepare('DELETE FROM contracts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0; }

// --- Competitors + notes (Market Watch) ---
function createCompetitor(userId, data) {
  const id = uuid();
  db.prepare(`INSERT INTO competitors (id, user_id, name, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, userId, data.name, data.url||'', data.notes||'', Date.now());
  return db.prepare('SELECT * FROM competitors WHERE id = ?').get(id);
}
function listCompetitorsForUser(userId) { return db.prepare('SELECT * FROM competitors WHERE user_id = ? ORDER BY created_at DESC').all(userId); }
function deleteCompetitor(userId, id) {
  db.prepare('DELETE FROM competitor_notes WHERE competitor_id = ? AND user_id = ?').run(id, userId);
  return db.prepare('DELETE FROM competitors WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}
function createCompetitorNote(userId, competitorId, note) {
  const id = uuid();
  db.prepare(`INSERT INTO competitor_notes (id, competitor_id, user_id, note, ts) VALUES (?, ?, ?, ?, ?)`)
    .run(id, competitorId, userId, note, Date.now());
  return db.prepare('SELECT * FROM competitor_notes WHERE id = ?').get(id);
}
function listNotesForCompetitor(userId, competitorId) {
  return db.prepare('SELECT * FROM competitor_notes WHERE competitor_id = ? AND user_id = ? ORDER BY ts DESC').all(competitorId, userId);
}

// --- Feedback (Voice of Customer) ---
function createFeedback(userId, data) {
  const id = uuid();
  db.prepare(`INSERT INTO feedback (id, user_id, source, text, ts) VALUES (?, ?, ?, ?, ?)`)
    .run(id, userId, data.source||'', data.text, Date.now());
  return db.prepare('SELECT * FROM feedback WHERE id = ?').get(id);
}
function listFeedbackForUser(userId) { return db.prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY ts DESC').all(userId); }
function deleteFeedback(userId, id) { return db.prepare('DELETE FROM feedback WHERE id = ? AND user_id = ?').run(id, userId).changes > 0; }

module.exports = {
  db,
  createUser, getUserByEmail, getUserById,
  createUpdate, getUpdateById, listUpdatesForUser, deleteUpdate,
  createExpense, listExpensesForUser, deleteExpense,
  createContract, listContractsForUser, deleteContract,
  createCompetitor, listCompetitorsForUser, deleteCompetitor, createCompetitorNote, listNotesForCompetitor,
  createFeedback, listFeedbackForUser, deleteFeedback,
};
