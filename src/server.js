'use strict';

require('dotenv').config();
process.env.TZ = 'America/Toronto';

const express = require('express');
const cors = require('cors');
const path = require('path');
const storage = require('./storage');
const scheduler = require('./scheduler');
const { getFixturesForTargetLeagues, enrichFixtureWithStats } = require('./apiFootball');
const { getAllOddsForDate, extractBestOdds } = require('./apiOdds');
const { generateTickets, generateMorningReport } = require('./analyzer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Fonctions principales ----

async function runEveningAnalysis(date) {
  const settings = storage.loadSettings();
  const apiFootball = settings.apiFootballKey || process.env.API_FOOTBALL_KEY;
  const apiOdds = settings.apiOddsKey || process.env.ODDS_API_KEY;
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (!apiAnthropic) throw new Error('Cle Anthropic manquante');

  storage.addActivityLog(`Debut analyse pour ${date}`, 'info');

  let fixtures = [];
  let oddsData = [];
  let usage = storage.loadApiUsage();

  // Recuperation des matchs
  if (apiFootball) {
    try {
      storage.addActivityLog('Recuperation des fixtures via API-Football...', 'info');
      const raw = await getFixturesForTargetLeagues(apiFootball, date);
      storage.addActivityLog(`${raw.length} matchs trouves, enrichissement des stats...`, 'info');
      const enriched = [];
      for (const f of raw.slice(0, 30)) {
        try {
          const enrichedF = await enrichFixtureWithStats(apiFootball, f);
          enriched.push(enrichedF);
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          enriched.push({
            fixtureId: f.fixture.id,
            date: f.fixture.date,
            league: { id: f.league.id, name: f.league.name, country: f.league.country },
            home: { id: f.teams.home.id, name: f.teams.home.name },
            away: { id: f.teams.away.id, name: f.teams.away.name },
            homeForm: [], awayForm: [],
            homeAvgGoals: 0, awayAvgGoals: 0,
            homeAvgConceded: 0, awayAvgConceded: 0,
            isPriorityGoals: false, status: 'NS'
          });
        }
      }
      fixtures = enriched;
      usage.footballDailyUsed = Math.min(usage.footballDailyUsed + Math.ceil(raw.length / 5) + 1, 100);
    } catch (e) {
      storage.addActivityLog(`Erreur API-Football: ${e.message} - analyse sans donnees externes`, 'warn');
    }
  }

  // Recuperation des cotes
  if (apiOdds) {
    try {
      storage.addActivityLog('Recuperation des cotes via The Odds API...', 'info');
      const { odds, remaining, used } = await getAllOddsForDate(apiOdds, date);
      oddsData = odds.map(extractBestOdds);
      if (used !== null) usage.oddsMonthlyUsed = used;
      storage.addActivityLog(`${oddsData.length} evenements avec cotes recuperes`, 'info');
    } catch (e) {
      storage.addActivityLog(`Erreur The Odds API: ${e.message} - cotes non disponibles`, 'warn');
    }
  }

  storage.saveApiUsage(usage);

  // Generation des tickets via Claude
  storage.addActivityLog('Generation des 15 tickets via Claude AI...', 'info');
  const ticketsData = await generateTickets(apiAnthropic, fixtures, oddsData, date);
  storage.saveTickets(date, ticketsData);
  storage.addActivityLog(`15 tickets generes et sauvegardes pour ${date}`, 'success');

  return ticketsData;
}

async function runMorningReport(date) {
  const settings = storage.loadSettings();
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiAnthropic) throw new Error('Cle Anthropic manquante');

  const tickets = storage.loadTickets(date);
  if (!tickets) throw new Error(`Aucun ticket trouve pour ${date}`);

  storage.addActivityLog(`Debut rapport du matin pour ${date}`, 'info');
  const report = await generateMorningReport(apiAnthropic, tickets.tickets || [], []);
  storage.saveReport(date, report);
  storage.addActivityLog(`Rapport du matin genere pour ${date}`, 'success');

  return report;
}

// ---- Routes API ----

app.get('/api/status', (req, res) => {
  const usage = storage.loadApiUsage();
  const settings = storage.loadSettings();
  const latestDate = storage.getLatestDate();
  const now = new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' });

  res.json({
    status: 'ok',
    currentTime: now,
    timezone: 'America/Toronto',
    latestAnalysis: latestDate,
    apiUsage: usage,
    configured: {
      apiFootball: !!(settings.apiFootballKey || process.env.API_FOOTBALL_KEY),
      apiOdds: !!(settings.apiOddsKey || process.env.ODDS_API_KEY),
      anthropic: !!(settings.anthropicKey || process.env.ANTHROPIC_API_KEY)
    }
  });
});

app.get('/api/tickets/:date', (req, res) => {
  const data = storage.loadTickets(req.params.date);
  if (!data) return res.status(404).json({ error: 'Aucun ticket pour cette date' });
  res.json(data);
});

app.get('/api/tickets', (req, res) => {
  const latestDate = storage.getLatestDate();
  if (!latestDate) return res.json({ tickets: [], date: null });
  const data = storage.loadTickets(latestDate);
  res.json(data || { tickets: [], date: latestDate });
});

app.get('/api/report/:date', (req, res) => {
  const data = storage.loadReport(req.params.date);
  if (!data) return res.status(404).json({ error: 'Aucun rapport pour cette date' });
  res.json(data);
});

app.get('/api/history', (req, res) => {
  const dates = storage.getAllDates();
  const history = dates.map(date => {
    const tickets = storage.loadTickets(date);
    const report = storage.loadReport(date);
    return {
      date,
      ticketsCount: tickets ? (tickets.tickets || []).length : 0,
      report: report ? { won: report.summary.won, lost: report.summary.lost, winRate: report.summary.winRate } : null
    };
  });
  res.json(history);
});

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(storage.getActivityLogs(limit));
});

app.post('/api/analyze', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise (YYYY-MM-DD)' });
  storage.addActivityLog(`Analyse manuelle lancee pour ${date}`, 'info');
  res.json({ message: 'Analyse lancee en arriere-plan', date });
  runEveningAnalysis(date).catch(err => {
    storage.addActivityLog(`Erreur analyse manuelle: ${err.message}`, 'error');
  });
});

app.post('/api/report', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise' });
  res.json({ message: 'Rapport lance en arriere-plan', date });
  runMorningReport(date).catch(err => {
    storage.addActivityLog(`Erreur rapport manuel: ${err.message}`, 'error');
  });
});

app.post('/api/settings', (req, res) => {
  const { apiFootballKey, apiOddsKey, anthropicKey } = req.body;
  const current = storage.loadSettings();
  const updated = {
    ...current,
    ...(apiFootballKey !== undefined && { apiFootballKey }),
    ...(apiOddsKey !== undefined && { apiOddsKey }),
    ...(anthropicKey !== undefined && { anthropicKey }),
    updatedAt: new Date().toISOString()
  };
  storage.saveSettings(updated);
  storage.addActivityLog('Parametres sauvegardes', 'success');
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
  const s = storage.loadSettings();
  res.json({
    hasApiFootball: !!s.apiFootballKey || !!process.env.API_FOOTBALL_KEY,
    hasApiOdds: !!s.apiOddsKey || !!process.env.ODDS_API_KEY,
    hasAnthropic: !!s.anthropicKey || !!process.env.ANTHROPIC_API_KEY
  });
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---- Demarrage ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(` Football Pronostics - Serveur actif`);
  console.log(` http://localhost:${PORT}`);
  console.log(`=================================================\n`);
  storage.addActivityLog(`Serveur demarre sur le port ${PORT}`, 'success');
  scheduler.initScheduler(runEveningAnalysis, runMorningReport);
});

module.exports = app;
