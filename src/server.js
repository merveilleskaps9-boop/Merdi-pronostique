'use strict';

require('dotenv').config();
process.env.TZ = 'America/Toronto';

const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const storage = require('./storage');
const scheduler = require('./scheduler');
const { getFixturesForTargetLeagues, enrichFixtureWithStats } = require('./apiFootball');
const { getAllOddsForDate, extractBestOdds } = require('./apiOdds');
const { generateTickets, generateMorningReport } = require('./analyzer');
const { upload, extractTextFromPDF, fileToBase64, getMimeType, cleanupFiles } = require('./uploadHandler');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

async function runEveningAnalysis(date) {
  const settings = storage.loadSettings();
  const apiFootball = settings.apiFootballKey || process.env.API_FOOTBALL_KEY;
  const apiOdds = settings.apiOddsKey || process.env.ODDS_API_KEY;
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (!apiAnthropic) throw new Error('Cle Anthropic manquante');

  storage.addActivityLog(`Debut analyse pour ${date}`, 'info');

  let fixtures = [];
  let oddsData = [];
  let oddsAvailable = false;
  let usage = storage.loadApiUsage();

  if (apiFootball) {
    try {
      storage.addActivityLog('Recuperation des fixtures via API-Football...', 'info');
      const raw = await getFixturesForTargetLeagues(apiFootball, date);
      storage.addActivityLog(`${raw.length} matchs trouves`, 'info');
      fixtures = raw.slice(0, 30);
      usage.footballDailyUsed = Math.min(usage.footballDailyUsed + 1, 100);
    } catch (e) {
      storage.addActivityLog(`Erreur API-Football: ${e.message}`, 'warn');
    }
  }

  if (apiOdds) {
    try {
      storage.addActivityLog('Recuperation des cotes via The Odds API...', 'info');
      const { odds, remaining, used } = await getAllOddsForDate(apiOdds, date);
      oddsData = odds.map(extractBestOdds);
      if (used !== null) usage.oddsMonthlyUsed = used;
      if (oddsData.length > 0) oddsAvailable = true;
      storage.addActivityLog(`${oddsData.length} evenements avec cotes recuperes`, 'info');
    } catch (e) {
      storage.addActivityLog(`Cotes non disponibles: ${e.message}`, 'warn');
    }
  }

  if (!oddsAvailable) {
    storage.addActivityLog('Analyse sans cotes - Claude analysera forme et enjeux uniquement', 'info');
  }

  storage.saveApiUsage(usage);
  storage.addActivityLog('Generation des 5 tickets via Claude AI...', 'info');
  const ticketsData = await generateTickets(apiAnthropic, fixtures, oddsData, date, oddsAvailable);
  storage.saveTickets(date, ticketsData);
  storage.addActivityLog(`5 tickets generes et sauvegardes pour ${date}`, 'success');
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

// ---- Route analyse manuelle avec images et PDFs ----
app.post('/api/analyze-manual', upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  const { date, notes } = req.body;

  if (!date) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Date requise' });
  }

  const settings = storage.loadSettings();
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiAnthropic) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Cle Anthropic manquante' });
  }

  res.json({ message: 'Analyse manuelle lancee en arriere-plan', date });

  (async () => {
    try {
      storage.addActivityLog(`Analyse manuelle avec ${files.length} fichier(s) pour ${date}`, 'info');

      const messageContent = [];
      let pdfTexts = '';

      for (const file of files) {
        const ext = path.extname(file.path).toLowerCase();
        if (ext === '.pdf') {
          const text = await extractTextFromPDF(file.path);
          pdfTexts += `\n--- PDF: ${file.originalname} ---\n${text}\n`;
        } else {
          const base64 = fileToBase64(file.path);
          const mimeType = getMimeType(file.path);
          messageContent.push({
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 }
          });
        }
      }

      let textPrompt = `Tu es un expert en analyse de paris sportifs football. Date d'analyse : ${date}.

Tu as recu des captures d'ecran et/ou des PDFs contenant des matchs, des cotes et des statistiques de football.

INSTRUCTIONS :
1. Analyse TOUTES les images et donnees fournies
2. Extrais les matchs avec leurs equipes et les cotes disponibles
3. Utilise UNIQUEMENT les cotes que tu vois dans les images, ne les invente pas
4. Si tu vois des classements ou statistiques, utilise-les pour ta justification

MARCHES AUTORISES UNIQUEMENT - AUCUN AUTRE MARCHE :
- "BTTS Oui" : les deux equipes marquent (cote entre 1.30 et 2.20 max)
- "Plus de 2.5 buts" : total buts superieur a 2.5 (cote entre 1.40 et 2.50 max)
- "Plus de 1.5 buts equipe domicile" : equipe domicile marque plus de 1.5 buts (cote entre 1.25 et 2.00 max)

MARCHES INTERDITS : victoire equipe, match nul, 1, X, 2, double chance, tout autre marche

GENERE EXACTEMENT 5 TICKETS :
- Ticket 1 "BTTS" : 4 a 6 matchs, UNIQUEMENT "BTTS Oui"
- Ticket 2 "BTTS" : 4 a 6 matchs DIFFERENTS du ticket 1, UNIQUEMENT "BTTS Oui"
- Ticket 3 "Plus de 2.5 buts" : 4 a 6 matchs, UNIQUEMENT "Plus de 2.5 buts"
- Ticket 4 "Plus de 1.5 buts domicile" : 4 a 6 matchs, UNIQUEMENT "Plus de 1.5 buts equipe domicile"
- Ticket 5 "Mix" : 4 a 6 matchs, mix "BTTS Oui" et "Plus de 1.5 buts equipe domicile" uniquement

Evite au maximum de repeter les memes matchs entre tickets.`;

      if (pdfTexts) {
        textPrompt += `\n\nCONTENU DES PDFs :\n${pdfTexts}`;
      }

      if (notes) {
        textPrompt += `\n\nNOTES SUPPLEMENTAIRES :\n${notes}`;
      }

      textPrompt += `\n\nReponds UNIQUEMENT avec JSON valide, sans markdown :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "source": "manuel",
  "tickets": [
    {
      "id": 1,
      "type": "BTTS",
      "raisonnement": "Explication courte",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "BTTS Oui",
          "odds": 1.45,
          "justification": "Raison courte"
        }
      ]
    }
  ]
}`;

      messageContent.push({ type: 'text', text: textPrompt });

      const client = new Anthropic({ apiKey: apiAnthropic });
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{ role: 'user', content: messageContent }]
      });

      const rawText = message.content[0].text;
      let jsonText = rawText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(jsonText);
      if (parsed.tickets) {
        parsed.tickets = parsed.tickets.map(ticket => {
          const totalOdds = Math.round(
            (ticket.picks || []).reduce((acc, p) => acc * (parseFloat(p.odds) || 1), 1) * 100
          ) / 100;
          return { ...ticket, totalOdds };
        });
      }

      storage.saveTickets(date, parsed);
      storage.addActivityLog(`5 tickets generes depuis fichiers manuels pour ${date}`, 'success');
    } catch (e) {
      storage.addActivityLog(`Erreur analyse manuelle: ${e.message}`, 'error');
    } finally {
      cleanupFiles(files);
    }
  })();
});

// ---- Routes API standard ----
app.get('/api/status', (req, res) => {
  const usage = storage.loadApiUsage();
  const settings = storage.loadSettings();
  const latestDate = storage.getLatestDate();
  const now = new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' });
  res.json({
    status: 'ok', currentTime: now, timezone: 'America/Toronto',
    latestAnalysis: latestDate, apiUsage: usage,
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
  if (!date) return res.status(400).json({ error: 'Date requise' });
  storage.addActivityLog(`Analyse automatique lancee pour ${date}`, 'info');
  res.json({ message: 'Analyse lancee en arriere-plan', date });
  runEveningAnalysis(date).catch(err => {
    storage.addActivityLog(`Erreur analyse: ${err.message}`, 'error');
  });
});

app.post('/api/report', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise' });
  res.json({ message: 'Rapport lance en arriere-plan', date });
  runMorningReport(date).catch(err => {
    storage.addActivityLog(`Erreur rapport: ${err.message}`, 'error');
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

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