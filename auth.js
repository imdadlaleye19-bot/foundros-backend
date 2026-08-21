// auth.js — Hashing de mot de passe (scrypt) + tokens de session signés (HMAC)
// Aucune dépendance externe : tout repose sur le module natif "crypto" de Node.js.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

// --- Mots de passe ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Tokens de session (équivalent JWT simplifié, signé HMAC-SHA256) ---
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

function createToken(payload) {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', SECRET).update(encodedBody).digest('hex');
  return `${encodedBody}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encodedBody, signature] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(encodedBody).digest('hex');
  const sigA = Buffer.from(signature || '', 'hex');
  const sigB = Buffer.from(expectedSig, 'hex');
  if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(encodedBody));
    if (payload.exp && Date.now() > payload.exp) return null; // expiré
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, createToken, verifyToken };
