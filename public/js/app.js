'use strict';

let allTickets = [];
let currentFilter = 'all';
let autoCloseTimer = null;
let selectedFiles = [];
let localHistory = JSON.parse(localStorage.getItem('pronos_local_history')) || { proposes: [], mises: [] };
let currentHistTab = 'proposes';

function getLocalYYYYMMDD(timestamp) {
  const d = new Date(new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initSidebar();
  initClock();
  initDropZone();
  refreshDashboard();
  
  const today = getLocalYYYYMMDD(Date.now());
  document.getElementById('tickets-date-picker').value = today;
  document.getElementById('manuel-date').value = today;
  
  loadTicketsForDate(today);
  showHistoryTab('proposes');
  loadSettings();
  setInterval(refreshDashboard, 30000);
});

function initSidebar() {
  const menuBtn = document.getElementById('menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(closeSidebar, 5000);
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    clearTimeout(autoCloseTimer);
  }

  if (menuBtn) menuBtn.addEventListener('click', openSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 900) closeSidebar();
    });
  });
}

function initNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      switchTab(link.dataset.tab);
    });
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  if(name === 'historique') showHistoryTab(currentHistTab);
}

function initClock() {
  function update() {
    const now = new Date();
    const str = now.toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('sidebar-clock').textContent = str;
  }
  update();
  setInterval(update, 1000);
}

function initDropZone() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border-strong)'; });
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--border-strong)'; handleFileSelect(e.dataTransfer.files); });
}

function handleFileSelect(files) {
  const newFiles = Array.from(files);
  const combined = [...selectedFiles, ...newFiles].slice(0, 20);
  selectedFiles = combined;
  renderFilePreview();
}

function renderFilePreview() {
  const preview = document.getElementById('file-preview');
  if (!preview) return;
  if (!selectedFiles.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = selectedFiles.map((f, i) => {
    const isPdf = f.type === 'application/pdf';
    const icon = isPdf ? '📄' : '🖼️';
    const name = f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name;
    return `<div style="position:relative;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;font-size:11px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;">
      <span>${icon}</span><span>${escHtml(name)}</span>
      <button onclick="removeFile(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;margin-left:4px;">×</button>
    </div>`;
  }).join('');
  const count = document.getElementById('drop-zone');
  if (count) count.querySelector('div:nth-child(2)').textContent = `${selectedFiles.length} fichier(s) selectionnes`;
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFilePreview();
}

function getSelectedFootballOptions() {
  const checkboxes = document.querySelectorAll('#foot-options-container input[type="checkbox"]:checked');
  const vals = Array.from(checkboxes).map(cb => cb.value);
  return vals.join(', ');
}

async function launchManualAnalysis() {
  const date = document.getElementById('manuel-date').value;
  if (!date) { alert('Selectionnez une date.'); return; }
  if (!selectedFiles.length) { alert('Ajoutez au moins un fichier.'); return; }

  const btn = document.getElementById('manuel-btn');
  const progress = document.getElementById('manuel-progress');
  const fill = document.getElementById('manuel-progress-fill');
  const msg = document.getElementById('manuel-progress-msg');
  const result = document.getElementById('manuel-result');

  btn.disabled = true;
  btn.textContent = 'Analyse en cours...';
  progress.style.display = 'block';
  result.textContent = '';

  const steps = [[15, 'Preparation...'],[35, 'Envoi aux IAs...'],[60, 'Recherche et lecture...'],[80, 'Generation des tickets...'],[100, 'Finalisation...']];
  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) { fill.style.width = steps[stepIdx][0] + '%'; msg.textContent = steps[stepIdx][1]; stepIdx++; }
  }, 3000);

  try {
    const formData = new FormData();
    formData.append('date', date);
    formData.append('sport', document.getElementById('manuel-sport').value);
    
    if(document.getElementById('manuel-sport').value === 'football') {
      formData.append('optionsFoot', getSelectedFootballOptions());
    }

    const notes = document.getElementById('manuel-notes').value;
    if (notes) formData.append('notes', notes);
    selectedFiles.forEach(f => formData.append('files', f));

    const res = await fetch('/api/analyze-manual', { method: 'POST', body: formData });
    clearInterval(interval);

    if (res.ok) {
      fill.style.width = '100%';
      msg.textContent = 'Termine!';
      result.className = 'feedback-msg feedback-ok';
      result.textContent = `Tickets generes avec succes. Verifiez l'onglet Tickets du jour.`;
      
      setTimeout(() => {
        document.getElementById('tickets-date-picker').value = date;
        loadTicketsForDate(date);
        switchTab('tickets');
        setTimeout(() => loadTicketsForDate(date), 10000);
      }, 3000);
      selectedFiles = [];
      renderFilePreview();
    } else { throw new Error('Erreur serveur'); }
  } catch (e) {
    clearInterval(interval);
    result.className = 'feedback-msg feedback-err';
    result.textContent = 'Erreur: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Analyser et generer';
  }
}

async function refreshDashboard() {
  try {
    const status = await fetch('/api/status').then(r => r.json());
    const usage = status.apiUsage || {};
    document.getElementById('api-football-remaining').textContent = (usage.footballDailyLimit || 100) - (usage.footballDailyUsed || 0);
    const alert = document.getElementById('config-alert');
    if (!status.configured.anthropic && !status.configured.gemini) { alert.style.display = 'flex'; } else { alert.style.display = 'none'; }
  } catch (e) {}
  await loadLogs();
}

async function loadLogs() {
  try {
    const logs = await fetch('/api/logs?limit=10').then(r => r.json());
    const container = document.getElementById('activity-log');
    if (!logs.length) { container.innerHTML = '<div class="log-empty">Aucune activite recente.</div>'; return; }
    container.innerHTML = logs.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
      return `<div class="log-item"><span class="log-msg">${escHtml(l.message)}</span><span class="log-time">${time}</span></div>`;
    }).join('');
  } catch (e) {}
}

// === INTERFACE DE SUIVI DE FOOTBALL (ACCUEIL) ===
async function refreshFootballNews() {
  const btn = document.getElementById('btn-refresh-news');
  const loader = document.getElementById('news-loading');
  const wdContainer = document.getElementById('wd-news-container');
  const barcaContainer = document.getElementById('barca-news-container');
  const leaguesContainer = document.getElementById('leagues-news-container');
  const picksContainer = document.getElementById('upcoming-picks-container');

  btn.disabled = true;
  loader.style.display = 'block';

  try {
    const res = await fetch('/api/news');
    const data = await res.json();

    if(data.error) throw new Error(data.error);

    // Render World Cup
    wdContainer.innerHTML = `
      <div style="background:var(--bg-lighter); padding:12px; border-radius:var(--radius); border:1px solid var(--border);">
        ${data.worldCup.image ? `<img src="${data.worldCup.image}" onerror="this.style.display='none'" style="width:100%; height:120px; object-fit:cover; border-radius:6px; margin-bottom:10px;">` : ''}
        <div style="font-weight:bold; color:var(--text); margin-bottom:6px;">${escHtml(data.worldCup.title)}</div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.4;">${escHtml(data.worldCup.desc)}</div>
      </div>
    `;

    // Render Barca / Fabrizio Romano
    barcaContainer.innerHTML = `
      <div style="background:var(--bg-lighter); padding:12px; border-radius:var(--radius); border:1px solid var(--border);">
        ${data.barcaTransfers.image ? `<img src="${data.barcaTransfers.image}" onerror="this.style.display='none'" style="width:100%; height:120px; object-fit:cover; border-radius:6px; margin-bottom:10px;">` : ''}
        <div style="font-weight:bold; color:var(--text); margin-bottom:6px;">${escHtml(data.barcaTransfers.title)}</div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.4;">${escHtml(data.barcaTransfers.desc)}</div>
      </div>
    `;

    // Render Leagues
    leaguesContainer.innerHTML = data.leagues.map(l => `
      <div class="log-item"><span class="log-msg"><strong>${escHtml(l.name)}:</strong> ${escHtml(l.summary)}</span></div>
    `).join('');

    // Render Upcoming Matches & Recommendations
    picksContainer.innerHTML = data.upcomingPicks.map(p => `
      <div style="background:var(--bg-card); padding:12px; border-radius:var(--radius); border:1px solid var(--border); display:flex; gap:10px; align-items:center;">
        ${p.image ? `<img src="${p.image}" onerror="this.style.display='none'" style="width:60px; height:60px; object-fit:cover; border-radius:50%;">` : ''}
        <div style="flex:1;">
          <div style="font-weight:bold; color:var(--accent); font-size:14px;">${escHtml(p.match)}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Date: ${escHtml(p.date)}</div>
          <div style="font-size:12px; color:var(--text);"><span style="color:var(--hp);">✓ Choix I.A :</span> ${escHtml(p.recommendation)}</div>
          <div style="font-size:12px; font-weight:bold; margin-top:2px;">Cote estimée: ${escHtml(p.odds)}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    alert("Erreur lors du chargement des actualités : " + err.message);
  } finally {
    btn.disabled = false;
    loader.style.display = 'none';
  }
}

async function loadTicketsForDate(date) {
  document.getElementById('tickets-date-label').textContent = `Date: ${date}`;
  try {
    const data = await fetch(`/api/tickets/${date}`).then(r => r.ok ? r.json() : null);
    if (!data || !data.tickets || !data.tickets.length) { renderTicketsEmpty(); return; }
    allTickets = data.tickets;
    
    allTickets.forEach(t => {
       const exists = localHistory.proposes.find(pt => pt.id === t.id && pt.sourceDate === t.sourceDate);
       const existsMise = localHistory.mises.find(mt => mt.id === t.id && mt.sourceDate === t.sourceDate);
       if(!exists && !existsMise) {
           localHistory.proposes.push({...t, generatedTimestamp: Date.now()});
       }
    });
    localStorage.setItem('pronos_local_history', JSON.stringify(localHistory));

    filterTickets(currentFilter);
  } catch (e) { renderTicketsEmpty(); }
}

function filterTickets(filter, btn) {
  currentFilter = filter;
  if (btn) {
    document.querySelectorAll('.ticket-filters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const filtered = filter === 'all' ? allTickets : allTickets.filter(t => t.type.toLowerCase().includes(filter.toLowerCase()));
  renderTickets(filtered);
}

function renderTickets(tickets) {
  if (!tickets.length) { renderTicketsEmpty(); return; }
  document.getElementById('tickets-container').innerHTML = tickets.map(t => renderTicketCard(t, true)).join('');
}

function renderTicketsEmpty() {
  document.getElementById('tickets-container').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">&#9917;</div>
      <p>Aucun ticket disponible pour cette date.</p>
      <button class="btn btn-primary" onclick="switchTab('manuel')">Lancer l'analyse</button>
    </div>`;
}

function renderTicketCard(ticket, showBetButton = false) {
  const typeStr = ticket.type.toLowerCase();
  let typeClass = 'type-sec'; 
  if (typeStr.includes('moyen')) typeClass = 'type-hp'; 
  if (typeStr.includes('risque')) typeClass = 'type-combo'; 
  
  let totalOdds = 1;
  if (ticket.picks && ticket.picks.length) {
    totalOdds = Math.round(ticket.picks.reduce((acc, p) => acc * (parseFloat(p.odds) || 1), 1) * 100) / 100;
  }
  
  const isMise = localHistory.mises.some(m => m.id === ticket.id && m.sourceDate === ticket.sourceDate);

  const picks = (ticket.picks || []).map(p => `
    <div class="pick-row">
      <div class="pick-left">
        <div class="pick-match">${escHtml(p.match)}</div>
        <div class="pick-league">${escHtml(p.league || '')}</div>
        <div class="pick-market">${escHtml(p.market)}</div>
        ${p.justification ? `<div style="font-size:10px; color:var(--text-muted); margin-top:4px;">${escHtml(p.justification)}</div>` : ''}
      </div>
      <div class="pick-odds-val">${formatOdds(p.odds)}</div>
    </div>`).join('');
    
  let actionBtn = '';
  if (showBetButton) {
      if(isMise) {
          actionBtn = `<button class="btn btn-secondary btn-small" disabled>Déjà Misé</button>`;
      } else {
          actionBtn = `<button class="btn btn-primary btn-small" onclick="markAsBetted('${ticket.id}', '${ticket.sourceDate}')">Miser ce ticket</button>`;
      }
  } else if (ticket.status === 'mise') {
      actionBtn = `
        <div style="display:flex; gap:8px;">
          <button class="btn btn-hp btn-small" onclick="resolveTicket('${ticket.id}', '${ticket.sourceDate}', true)">Gagné</button>
          <button class="btn btn-secondary btn-small" onclick="resolveTicket('${ticket.id}', '${ticket.sourceDate}', false)">Perdu</button>
        </div>`;
  } else if (ticket.status === 'gagnant') {
      actionBtn = `<span style="color:var(--hp); font-weight:bold;">✅ Validé Gagnant</span>`;
  } else if (ticket.status === 'perdant') {
      actionBtn = `<span style="color:var(--text-muted); font-weight:bold;">❌ Perdu</span>`;
  }

  return `
    <div class="ticket-card">
      <div class="ticket-head">
        <div>
          <div class="ticket-number">Ticket #${ticket.id}</div>
          <div class="ticket-type-label ${typeClass}">${escHtml(ticket.type)}</div>
        </div>
        <div style="text-align:right;">
          <div class="ticket-odds">${formatOdds(totalOdds)}</div>
          <div class="ticket-odds-label">cote totale</div>
        </div>
      </div>
      ${ticket.raisonnement ? `<div style="padding:10px 15px; font-size:11px; background:var(--bg-lighter); color:var(--text-secondary); border-bottom:1px solid var(--border);">${escHtml(ticket.raisonnement)}</div>` : ''}
      <div class="ticket-picks">${picks}</div>
      ${actionBtn ? `<div style="padding:12px 15px; border-top:1px solid var(--border); display:flex; justify-content:flex-end;">${actionBtn}</div>` : ''}
    </div>`;
}

function showHistoryTab(tab) {
    currentHistTab = tab;
    document.getElementById('tab-hist-proposes').classList.remove('active');
    document.getElementById('tab-hist-mises').classList.remove('active');
    document.getElementById(`tab-hist-${tab}`).classList.add('active');
    
    const container = document.getElementById('history-container');
    const items = tab === 'proposes' ? localHistory.proposes : localHistory.mises;
    
    if(!items || items.length === 0) {
        container.innerHTML = `<div class="empty-state">Aucun ticket dans cette section.</div>`;
        return;
    }
    
    items.sort((a, b) => (b.generatedTimestamp || 0) - (a.generatedTimestamp || 0));
    container.innerHTML = items.map(t => renderTicketCard(t, tab === 'proposes')).join('');
}

function markAsBetted(ticketId, sourceDate) {
    const idx = localHistory.proposes.findIndex(t => t.id == ticketId && t.sourceDate === sourceDate);
    if(idx > -1) {
        const ticket = localHistory.proposes.splice(idx, 1)[0];
        ticket.status = 'mise';
        localHistory.mises.push(ticket);
        localStorage.setItem('pronos_local_history', JSON.stringify(localHistory));
        alert('Ticket déplacé vers vos tickets misés !');
        if(document.getElementById('tab-historique').classList.contains('active')) {
            showHistoryTab(currentHistTab);
        } else {
            loadTicketsForDate(sourceDate);
        }
    }
}

function resolveTicket(ticketId, sourceDate, isWinner) {
    const ticket = localHistory.mises.find(t => t.id == ticketId && t.sourceDate === sourceDate);
    if(ticket) {
        ticket.status = isWinner ? 'gagnant' : 'perdant';
        localStorage.setItem('pronos_local_history', JSON.stringify(localHistory));
        showHistoryTab('mises');
    }
}

async function loadSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    if (s.hasAnthropic) document.getElementById('cfg-anthropic').placeholder = '(cle configuree)';
    if (s.hasGemini) document.getElementById('cfg-gemini').placeholder = '(cle configuree)';
    
    document.getElementById('cfg-auto-analysis').checked = s.autoAnalysis === true;
    
    if(s.footOptions && s.footOptions.length > 0) {
        const checkboxes = document.querySelectorAll('#foot-options-container input[type="checkbox"]');
        checkboxes.forEach(cb => {
            if(s.footOptions.includes(cb.value)) cb.checked = true;
        });
    }
  } catch (e) {}
}

async function saveSettings() {
  const payload = {};
  const anthropic = document.getElementById('cfg-anthropic').value.trim();
  const gemini = document.getElementById('cfg-gemini').value.trim();
  if (anthropic) payload.anthropicKey = anthropic;
  if (gemini) payload.geminiKey = gemini;
  
  payload.autoAnalysis = document.getElementById('cfg-auto-analysis').checked;
  
  const checkedFoot = Array.from(document.querySelectorAll('#foot-options-container input[type="checkbox"]:checked')).map(cb => cb.value);
  payload.footOptions = checkedFoot;
  
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  
  const feedback = document.getElementById('settings-feedback');
  feedback.className = 'feedback-msg feedback-ok';
  feedback.textContent = "Paramètres sauvegardés avec succès !";
  
  document.getElementById('cfg-anthropic').value = '';
  document.getElementById('cfg-gemini').value = '';
  setTimeout(() => { feedback.textContent = ''; }, 3000);
  
  loadSettings();
}

function changerSport(sport) {
  document.querySelectorAll('.sport-tab').forEach(btn => btn.classList.remove('active'));
  const targetBtn = document.querySelector(`.sport-tab[onclick="changerSport('${sport}')"]`);
  if (targetBtn) targetBtn.classList.add('active');
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatOdds(val) {
  if (!val || val === 0) return '--';
  return parseFloat(val).toFixed(2);
}