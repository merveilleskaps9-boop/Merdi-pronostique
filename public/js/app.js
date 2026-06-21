'use strict';

let allTickets = [];
let currentFilter = 'all';
let autoCloseTimer = null;
let selectedFiles = [];

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
  document.getElementById('analyze-date').value = today;
  document.getElementById('manuel-date').value = today;
  
  const yesterday = getLocalYYYYMMDD(Date.now() - 86400000);
  document.getElementById('report-date').value = yesterday;
  
  loadTicketsForDate(today);
  loadHistory();
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
  if (count) count.querySelector('div:nth-child(2)').textContent = `${selectedFiles.length} fichier(s) selectionne(s) - Cliquer pour en ajouter`;
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFilePreview();
}

async function launchManualAnalysis() {
  const date = document.getElementById('manuel-date').value;
  if (!date) { alert('Selectionnez une date.'); return; }
  if (!selectedFiles.length) { alert('Ajoutez au moins un fichier (screenshot ou PDF).'); return; }

  const btn = document.getElementById('manuel-btn');
  const progress = document.getElementById('manuel-progress');
  const fill = document.getElementById('manuel-progress-fill');
  const msg = document.getElementById('manuel-progress-msg');
  const result = document.getElementById('manuel-result');

  btn.disabled = true;
  btn.textContent = 'Analyse en cours...';
  progress.style.display = 'block';
  result.textContent = '';

  const steps = [[15, 'Preparation des fichiers...'],[35, 'Envoi aux IAs...'],[60, 'Lecture des images et PDFs...'],[80, 'Generation des tickets...'],[100, 'Finalisation...']];
  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) { fill.style.width = steps[stepIdx][0] + '%'; msg.textContent = steps[stepIdx][1]; stepIdx++; }
  }, 2000);

  try {
    const formData = new FormData();
    formData.append('date', date);
    
    const sportSelect = document.getElementById('manuel-sport');
    const sport = sportSelect ? sportSelect.value : 'football';
    formData.append('sport', sport);

    const notes = document.getElementById('manuel-notes').value;
    if (notes) formData.append('notes', notes);
    
    selectedFiles.forEach(f => formData.append('files', f));

    const res = await fetch('/api/analyze-manual', { method: 'POST', body: formData });
    clearInterval(interval);

    if (res.ok) {
      fill.style.width = '100%';
      msg.textContent = 'Analyse lancee avec succes!';
      result.className = 'feedback-msg feedback-ok';
      result.textContent = `Les tickets de ${sport} sont en cours de generation. Verifiez dans 30 secondes dans "Tickets du jour".`;
      setTimeout(() => {
        document.getElementById('tickets-date-picker').value = date;
        loadTicketsForDate(date);
        switchTab('tickets');
        setTimeout(() => loadTicketsForDate(date), 30000);
      }, 3000);
      selectedFiles = [];
      renderFilePreview();
      document.getElementById('manuel-notes').value = '';
    } else { throw new Error('Erreur serveur'); }
  } catch (e) {
    clearInterval(interval);
    result.className = 'feedback-msg feedback-err';
    result.textContent = 'Erreur: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Analyser et generer les tickets ↗';
  }
}

async function refreshDashboard() {
  try {
    const status = await fetch('/api/status').then(r => r.json());
    updateStatsFromStatus(status);
    checkConfigAlert(status);
  } catch (e) { console.error('Erreur lors du rafraichissement:', e); }
  await loadLogs();
  await loadLatestReport();
}

function updateStatsFromStatus(status) {
  const usage = status.apiUsage || {};
  const footballRemaining = (usage.footballDailyLimit || 100) - (usage.footballDailyUsed || 0);
  const oddsRemaining = (usage.oddsMonthlyLimit || 500) - (usage.oddsMonthlyUsed || 0);
  document.getElementById('api-football-remaining').textContent = footballRemaining;
  document.getElementById('api-odds-remaining').textContent = oddsRemaining;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  const h = now.getHours(), m = now.getMinutes();
  let minutesTo20h = (20 * 60) - (h * 60 + m);
  if (minutesTo20h <= 0) minutesTo20h += 24 * 60;
  document.getElementById('next-analysis-in').textContent = `dans ${Math.floor(minutesTo20h/60)}h ${minutesTo20h%60}min`;
  document.getElementById('usage-football').textContent = `${usage.footballDailyUsed||0} / ${usage.footballDailyLimit||100}`;
  document.getElementById('usage-odds').textContent = `${usage.oddsMonthlyUsed||0} / ${usage.oddsMonthlyLimit||500}`;
  document.getElementById('bar-football').style.width = Math.min(((usage.footballDailyUsed||0)/100)*100, 100) + '%';
  document.getElementById('bar-odds').style.width = Math.min(((usage.oddsMonthlyUsed||0)/500)*100, 100) + '%';
}

function checkConfigAlert(status) {
  const alert = document.getElementById('config-alert');
  if (!status.configured || !status.configured.anthropic) { alert.style.display = 'flex'; } else { alert.style.display = 'none'; }
}

async function loadLogs() {
  try {
    const logs = await fetch('/api/logs?limit=10').then(r => r.json());
    const container = document.getElementById('activity-log');
    if (!logs.length) { container.innerHTML = '<div class="log-empty">Aucune activite recente.</div>'; return; }
    container.innerHTML = logs.map(l => {
      const typeClass = { success: 'dot-success', error: 'dot-error', warn: 'dot-warn', info: 'dot-info' }[l.type] || 'dot-info';
      const time = new Date(l.timestamp).toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
      return `<div class="log-item"><span class="log-dot ${typeClass}"></span><span class="log-msg">${escHtml(l.message)}</span><span class="log-time">${time}</span></div>`;
    }).join('');
  } catch (e) { document.getElementById('activity-log').innerHTML = '<div class="log-empty">Erreur chargement journal.</div>'; }
}

async function loadLatestReport() {
  try {
    const history = await fetch('/api/history').then(r => r.json());
    const withReport = history.find(h => h.report);
    if (!withReport) {
      document.getElementById('latest-report').innerHTML = '<div class="empty-state" style="padding:1.5rem 0;">Aucun rapport disponible.</div>';
      document.getElementById('win-rate').textContent = '--';
      return;
    }
    const r = withReport.report;
    document.getElementById('win-rate').textContent = r.winRate || '--';
    document.getElementById('latest-report').innerHTML = `
      <div class="report-summary">
        <div class="report-stat"><div class="report-stat-val report-win">${r.won}</div><div class="report-stat-lbl">Gagnes</div></div>
        <div class="report-stat"><div class="report-stat-val report-loss">${r.lost}</div><div class="report-stat-lbl">Perdus</div></div>
        <div class="report-stat"><div class="report-stat-val">${r.winRate}</div><div class="report-stat-lbl">Taux</div></div>
      </div>`;
  } catch (e) {}
}

async function loadTicketsForDate(date) {
  document.getElementById('tickets-date-label').textContent = `Date: ${date}`;
  try {
    const data = await fetch(`/api/tickets/${date}`).then(r => r.ok ? r.json() : null);
    if (!data || !data.tickets || !data.tickets.length) { renderTicketsEmpty(); return; }
    allTickets = data.tickets;
    filterTickets(currentFilter);
  } catch (e) { renderTicketsEmpty(); }
}

function filterTickets(filter, btn) {
  currentFilter = filter;
  if (btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const filtered = filter === 'all' ? allTickets : allTickets.filter(t => t.type === filter || t.type.includes(filter));
  renderTickets(filtered);
}

function renderTickets(tickets) {
  if (!tickets.length) { renderTicketsEmpty(); return; }
  document.getElementById('tickets-container').innerHTML = tickets.map(t => renderTicketCard(t)).join('');
}

function renderTicketsEmpty() {
  document.getElementById('tickets-container').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">&#9917;</div>
      <p>Aucun ticket disponible.<br>Lancez une analyse pour generer les tickets.</p>
      <button class="btn btn-primary" onclick="openAnalyzeModal()">Lancer l'analyse</button>
    </div>`;
}

function renderTicketCard(ticket) {
  const typeClass = ticket.type.includes('Haute') && !ticket.type.includes('Securite') ? 'type-hp' : ticket.type.includes('Securite et') ? 'type-combo' : 'type-sec';
  let totalOdds = 1;
  if (ticket.picks && ticket.picks.length) {
    totalOdds = Math.round(ticket.picks.reduce((acc, p) => acc * (parseFloat(p.odds) || 1), 1) * 100) / 100;
  }
  const picks = (ticket.picks || []).map(p => `
    <div class="pick-row">
      <div class="pick-left">
        <div class="pick-match">${escHtml(p.match)}</div>
        <div class="pick-league">${escHtml(p.league || '')}</div>
        <div class="pick-market">${escHtml(p.market)}</div>
      </div>
      <div class="pick-odds-val">${formatOdds(p.odds)}</div>
    </div>`).join('');
  return `
    <div class="ticket-card">
      <div class="ticket-head">
        <div>
          <div class="ticket-number">Ticket #${ticket.id}${ticket.source === 'manuel' ? ' 📁' : ''}</div>
          <div class="ticket-type-label ${typeClass}">${escHtml(ticket.type)}</div>
        </div>
        <div>
          <div class="ticket-odds">${formatOdds(totalOdds)}</div>
          <div class="ticket-odds-label">cote totale</div>
        </div>
      </div>
      <div class="ticket-picks">${picks}</div>
      ${ticket.raisonnement ? `<div class="ticket-reasoning">${escHtml(ticket.raisonnement)}</div>` : ''}
    </div>`;
}

async function loadHistory() {
  try {
    const history = await fetch('/api/history').then(r => r.json());
    const container = document.getElementById('history-container');
    if (!history.length) { container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Aucun historique.</p></div>'; return; }
    container.innerHTML = `
      <table class="history-table">
        <thead><tr><th>Date</th><th>Tickets</th><th>Gagnes</th><th>Perdus</th><th>Taux</th><th>Actions</th></tr></thead>
        <tbody>${history.map(h => `
          <tr>
            <td class="date-cell">${h.date}</td>
            <td>${h.ticketsCount}</td>
            <td class="win-cell">${h.report ? h.report.won : '--'}</td>
            <td class="loss-cell">${h.report ? h.report.lost : '--'}</td>
            <td class="rate-cell">${h.report ? h.report.winRate : '--'}</td>
            <td><span class="history-action" onclick="viewDate('${h.date}')">Voir</span>${!h.report ? ` | <span class="history-action" onclick="generateReportFor('${h.date}')">Rapport</span>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) { document.getElementById('history-container').innerHTML = '<div class="empty-state">Erreur.</div>'; }
}

function viewDate(date) {
  document.getElementById('tickets-date-picker').value = date;
  loadTicketsForDate(date);
  switchTab('tickets');
}

async function generateReportFor(date) {
  if (!confirm(`Generer le rapport pour le ${date}?`)) return;
  await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
  alert('Rapport en cours de generation.');
  loadHistory();
}

async function loadSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    if (s.hasApiFootball) document.getElementById('cfg-football').placeholder = '(cle configuree)';
    if (s.hasApiOdds) document.getElementById('cfg-odds').placeholder = '(cle configuree)';
    if (s.hasAnthropic) document.getElementById('cfg-anthropic').placeholder = '(cle configuree)';
    if (s.hasGemini) {
      const geminiInput = document.getElementById('cfg-gemini');
      if (geminiInput) geminiInput.placeholder = '(cle configuree)';
    }
  } catch (e) { console.error('Erreur parametres:', e); }
}

async function saveSettings() {
  const fb = document.getElementById('settings-feedback');
  const payload = {};
  const football = document.getElementById('cfg-football').value.trim();
  const odds = document.getElementById('cfg-odds').value.trim();
  const anthropic = document.getElementById('cfg-anthropic').value.trim();
  const geminiInput = document.getElementById('cfg-gemini');
  const gemini = geminiInput ? geminiInput.value.trim() : '';
  
  if (football) payload.apiFootballKey = football;
  if (odds) payload.apiOddsKey = odds;
  if (anthropic) payload.anthropicKey = anthropic;
  if (gemini) payload.geminiKey = gemini;
  
  if (!Object.keys(payload).length) { fb.className = 'feedback-msg feedback-err'; fb.textContent = 'Aucune cle.'; return; }
  
  try {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) {
      fb.className = 'feedback-msg feedback-ok';
      fb.textContent = 'Cles sauvegardees.';
      document.getElementById('cfg-football').value = '';
      document.getElementById('cfg-odds').value = '';
      document.getElementById('cfg-anthropic').value = '';
      if (geminiInput) geminiInput.value = '';
      loadSettings();
      refreshDashboard();
      setTimeout(() => { fb.textContent = ''; }, 4000);
    } else { fb.className = 'feedback-msg feedback-err'; fb.textContent = 'Erreur serveur.'; }
  } catch (e) { fb.className = 'feedback-msg feedback-err'; fb.textContent = 'Erreur reseau.'; }
}

async function launchReport() {
  const date = document.getElementById('report-date').value;
  if (!date) { alert('Selectionnez une date.'); return; }
  await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
  alert('Rapport lance.');
  loadHistory();
}

function openAnalyzeModal() {
  document.getElementById('analyze-modal').style.display = 'flex';
  document.getElementById('analyze-progress').style.display = 'none';
  document.getElementById('analyze-result').textContent = '';
  document.getElementById('analyze-btn').disabled = false;
  document.getElementById('analyze-btn').textContent = "Lancer l'analyse";
}

function closeAnalyzeModal() { document.getElementById('analyze-modal').style.display = 'none'; }

async function launchAnalysis() {
  const date = document.getElementById('analyze-date').value;
  if (!date) { alert('Selectionnez une date.'); return; }
  
  const btn = document.getElementById('analyze-btn');
  const progress = document.getElementById('analyze-progress');
  const fill = document.getElementById('progress-fill');
  const msg = document.getElementById('progress-msg');
  const result = document.getElementById('analyze-result');
  
  btn.disabled = true;
  btn.textContent = 'En cours...';
  progress.style.display = 'block';
  result.textContent = '';
  
  const steps = [[10, 'Connexion...'],[25, 'Matchs du jour...'],[45, 'Cotes en temps reel...'],[65, 'Analyse...'],[85, 'Generation tickets...'],[100, 'Finalisation...']];
  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) { fill.style.width = steps[stepIdx][0] + '%'; msg.textContent = steps[stepIdx][1]; stepIdx++; }
  }, 1800);
  
  try {
    const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
    clearInterval(interval);
    
    if (res.ok) {
      fill.style.width = '100%';
      msg.textContent = 'Succes!';
      result.className = 'feedback-msg feedback-ok';
      result.textContent = 'Tickets en cours de generation...';
      setTimeout(() => {
        closeAnalyzeModal();
        document.getElementById('tickets-date-picker').value = date;
        loadTicketsForDate(date);
        switchTab('tickets');
        setTimeout(() => { loadTicketsForDate(date); refreshDashboard(); }, 15000);
      }, 2000);
    } else { throw new Error('Erreur serveur'); }
  } catch (e) {
    clearInterval(interval);
    result.className = 'feedback-msg feedback-err';
    result.textContent = 'Erreur: ' + e.message;
    btn.disabled = false;
    btn.textContent = "Reessayer";
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatOdds(val) {
  if (!val || val === 0) return '--';
  return parseFloat(val).toFixed(2);
}