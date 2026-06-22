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
  if (count) count.querySelector('div:nth-child(2)').textContent = `${selectedFiles.length} fichier(s) selectionnes`;
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFilePreview();
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

  const steps = [[15, 'Preparation...'],[35, 'Envoi aux IAs...'],[60, 'Lecture des cotes...'],[80, 'Generation des tickets...'],[100, 'Finalisation...']];
  let stepIdx = 0;
  const interval = setInterval(() => {
    if (stepIdx < steps.length) { fill.style.width = steps[stepIdx][0] + '%'; msg.textContent = steps[stepIdx][1]; stepIdx++; }
  }, 3000);

  try {
    const formData = new FormData();
    formData.append('date', date);
    formData.append('sport', document.getElementById('manuel-sport').value);
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
        setTimeout(() => loadTicketsForDate(date), 20000);
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
  const filtered = filter === 'all' ? allTickets : allTickets.filter(t => t.type.toLowerCase().includes(filter.toLowerCase()));
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
      <p>Aucun ticket disponible.</p>
      <button class="btn btn-primary" onclick="switchTab('manuel')">Lancer l'analyse</button>
    </div>`;
}

function renderTicketCard(ticket) {
  const typeStr = ticket.type.toLowerCase();
  let typeClass = 'type-sec'; // Bleu par defaut
  if (typeStr.includes('moyen')) typeClass = 'type-hp'; // Vert
  if (typeStr.includes('risque')) typeClass = 'type-combo'; // Violet
  
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
          <div class="ticket-number">Ticket #${ticket.id}</div>
          <div class="ticket-type-label ${typeClass}">${escHtml(ticket.type)}</div>
        </div>
        <div>
          <div class="ticket-odds">${formatOdds(totalOdds)}</div>
          <div class="ticket-odds-label">cote totale</div>
        </div>
      </div>
      <div class="ticket-picks">${picks}</div>
    </div>`;
}

async function loadHistory() {
  try {
    const history = await fetch('/api/history').then(r => r.json());
    const container = document.getElementById('history-container');
    if (!history.length) return;
    container.innerHTML = `
      <table class="history-table" style="width:100%; text-align:left;">
        <thead><tr><th>Date</th><th>Tickets</th><th>Actions</th></tr></thead>
        <tbody>${history.map(h => `
          <tr>
            <td style="padding:10px 0;">${h.date}</td>
            <td>${h.ticketsCount}</td>
            <td><span style="color:var(--accent);cursor:pointer;" onclick="viewDate('${h.date}')">Voir</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {}
}

function viewDate(date) {
  document.getElementById('tickets-date-picker').value = date;
  loadTicketsForDate(date);
  switchTab('tickets');
}

async function loadSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    if (s.hasAnthropic) document.getElementById('cfg-anthropic').placeholder = '(cle configuree)';
    if (s.hasGemini) document.getElementById('cfg-gemini').placeholder = '(cle configuree)';
  } catch (e) {}
}

async function saveSettings() {
  const payload = {};
  const anthropic = document.getElementById('cfg-anthropic').value.trim();
  const gemini = document.getElementById('cfg-gemini').value.trim();
  if (anthropic) payload.anthropicKey = anthropic;
  if (gemini) payload.geminiKey = gemini;
  
  if (Object.keys(payload).length) {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    alert("Cles sauvegardees !");
    document.getElementById('cfg-anthropic').value = '';
    document.getElementById('cfg-gemini').value = '';
    loadSettings();
  }
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
