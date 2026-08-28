// shared.js — fonctions communes à toutes les pages Survéo
const API = '';

function getToken(){ return localStorage.getItem('surveo_token'); }
function setToken(t){ localStorage.setItem('surveo_token', t); }
function clearToken(){ localStorage.removeItem('surveo_token'); }

async function apiCall(path, opts={}){
  const headers = { 'Content-Type': 'application/json', ...(opts.headers||{}) };
  const token = getToken();
  if(token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

// Vérifie l'authentification au chargement d'une page protégée.
// Redirige vers login.html si pas de token valide. Retourne l'utilisateur sinon.
async function requireAuth(){
  const token = getToken();
  if(!token){ window.location.href = 'login.html'; return null; }
  try{
    const { user } = await apiCall('/api/me');
    return user;
  }catch(e){
    clearToken();
    window.location.href = 'login.html';
    return null;
  }
}

function logout(){
  clearToken();
  window.location.href = 'login.html';
}

// ---------- Menu hamburger mobile ----------
function toggleDrawer(){
  document.getElementById('navDrawer').classList.toggle('open');
  document.getElementById('navOverlay').classList.toggle('open');
}
function closeDrawer(){
  document.getElementById('navDrawer').classList.remove('open');
  document.getElementById('navOverlay').classList.remove('open');
}

function fmtEuro(n){ return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n||0) + ' €'; }
function pctDelta(cur, prev){ if(!prev || prev===0) return null; return ((cur-prev)/prev*100); }
function monthLabel(ts){ const d=new Date(ts); const s=d.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}); return s.charAt(0).toUpperCase()+s.slice(1); }
function monthShort(ts){ return new Date(ts).toLocaleDateString('fr-FR',{month:'short'}); }

function showSaveIndicator(){
  const el = document.getElementById('saveIndicator');
  if(!el) return;
  el.classList.add('show');
  clearTimeout(showSaveIndicator._t);
  showSaveIndicator._t = setTimeout(()=>el.classList.remove('show'), 1800);
}

// ---------- Score de santé Survéo — calculé uniquement à partir de données réelles ----------
// Ne retourne jamais une catégorie si les données sous-jacentes n'existent pas.
function computeHealthScore({ updates, contracts }){
  const categories = [];

  // Santé financière — basée sur le runway réel (cash / burn) de la dernière update
  if(updates && updates.length > 0){
    const latest = updates[updates.length-1];
    if(latest.burn > 0){
      const runway = latest.cash / latest.burn;
      let score;
      if(runway >= 12) score = 95;
      else if(runway >= 6) score = 72;
      else if(runway >= 3) score = 42;
      else score = 15;
      categories.push({
        key:'financial', label:'Santé financière', score,
        detail: `Runway actuel : ${runway.toFixed(1)} mois`
      });
    }

    // Santé de la croissance — basée sur la variation ARR déclarée
    const arrDelta = pctDelta(latest.arr, latest.arrPrev);
    if(arrDelta !== null){
      let score;
      if(arrDelta >= 10) score = 92;
      else if(arrDelta >= 0) score = 68;
      else if(arrDelta >= -10) score = 38;
      else score = 15;
      categories.push({
        key:'growth', label:'Croissance', score,
        detail: `ARR ${arrDelta>=0?'en hausse':'en baisse'} de ${Math.abs(arrDelta).toFixed(0)}% vs mois précédent`
      });
    }
  }

  // Santé légale — basée sur les contrats suivis avec préavis qui approche
  if(contracts && contracts.length > 0){
    const now = Date.now();
    let alerts = 0;
    contracts.forEach(c=>{
      if(c.endDate && c.noticeDays){
        const endTs = new Date(c.endDate).getTime();
        const noticeTs = endTs - c.noticeDays*86400000;
        if(!isNaN(noticeTs) && now >= noticeTs - 60*86400000 && now <= endTs) alerts++;
      }
    });
    const score = Math.max(20, 100 - Math.round((alerts / contracts.length) * 100));
    categories.push({
      key:'legal', label:'Santé légale', score,
      detail: alerts > 0 ? `${alerts} contrat(s) avec préavis à examiner` : `Aucun préavis urgent sur ${contracts.length} contrat(s) suivi(s)`
    });
  }

  if(categories.length === 0) return null;

  const overall = Math.round(categories.reduce((s,c)=>s+c.score,0) / categories.length);
  return { overall, categories };
}
