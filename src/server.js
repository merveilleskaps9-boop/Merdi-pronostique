'use strict';

require('dotenv').config();
process.env.TZ = 'America/Toronto';

const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

// Fonction pour construire les instructions selon le sport
function buildPrompt(sport, date, pdfTexts, notes) {
  let prompt = `Tu es un expert en analyse de paris sportifs. Date d'analyse : ${date}.\n`;
  prompt += `Analyse toutes les images et donnees fournies. Utilise uniquement les cotes visibles, ne les invente pas.\n\n`;

  if (sport === 'basketball') {
    prompt += `MARCHES AUTORISES UNIQUEMENT (NBA/Basket) :\n`;
    prompt += `- Over/Under (Plus/Moins) total de points pour le match\n`;
    prompt += `- Over/Under points par equipe\n`;
    prompt += `GENERE EXACTEMENT 5 TICKETS bases sur ces marches.\n`;
  } else if (sport === 'baseball') {
    prompt += `MARCHES AUTORISES UNIQUEMENT (MLB/Baseball) :\n`;
    prompt += `- Lanceur : Strikeouts (Retraits au baton)\n`;
    prompt += `- Joueur : Coups surs (Hits)\n`;
    prompt += `- Joueur : Points (Runs)\n`;
    prompt += `- Joueur : RBIs (Points produits)\n`;
    prompt += `- Joueur : Total Coups surs + Points + RBIs\n`;
    prompt += `GENERE EXACTEMENT 5 TICKETS bases sur les performances des joueurs et lanceurs.\n`;
  } else {
    prompt += `MARCHES AUTORISES UNIQUEMENT (Football) :\n`;
    prompt += `- BTTS Oui (les deux equipes marquent)\n`;
    prompt += `- Plus de 2.5 buts\n`;
    prompt += `- Plus de 1.5 buts equipe domicile\n`;
    prompt += `GENERE EXACTEMENT 5 TICKETS (Ticket 1 et 2 : BTTS, Ticket 3 : +2.5 buts, Ticket 4 : +1.5 buts domicile, Ticket 5 : Mix).\n`;
  }

  if (pdfTexts) prompt += `\nCONTENU DES PDFs :\n${pdfTexts}`;
  if (notes) prompt += `\nNOTES SUPPLEMENTAIRES :\n${notes}`;

  prompt += `\n\nReponds UNIQUEMENT avec un JSON valide, sans markdown. Format strict :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "source": "manuel",
  "tickets": [
    {
      "id": 1,
      "type": "Nom du marche",
      "raisonnement": "Explication globale du ticket",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "Nom du marche",
          "odds": 1.50,
          "justification": "Raison specifique"
        }
      ]
    }
  ]
}`;

  return prompt;
}

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
  const { date, notes, sport = 'football' } = req.body;

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
      storage.addActivityLog(`Analyse manuelle (${sport}) avec ${files.length} fichier(s) pour ${date}`, 'info');

      const messageContent = [];
      let pdfTexts = '';

      for (const file of files) {
        const ext = path.extname(file.path).toLowerCase();
        
        if (ext === '.pdf') {
          const text = await extractTextFromPDF(file.path);
          pdfTexts += `\n--- PDF: ${file.originalname} ---\n${text}\n`;
        } else {
          const base64 = fileToBase64(file.path);
          let mimeType = file.mimetype || getMimeType(file.originalname);
          
          if (!mimeType || !mimeType.startsWith('image/')) {
            if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.webp') mimeType = 'image/webp';
            else if (ext === '.gif') mimeType = 'image/gif';
            else mimeType = 'image/jpeg';
          }

          const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
          if (validMimeTypes.includes(mimeType)) {
             messageContent.push({
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 }
            });
          } else {
             storage.addActivityLog(`Fichier ignore : format non supporte (${mimeType}) pour ${file.originalname}`, 'warn');
          }
        }
      }

      const textPrompt = buildPrompt(sport, date, pdfTexts, notes);
      messageContent.push({ type: 'text', text: textPrompt });

      if (messageContent.length === 1) {
          throw new Error("Aucune image valide ou texte PDF n'a pu etre extrait des fichiers fournis.");
      }

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
      storage.addActivityLog(`5 tickets (${sport}) generes depuis fichiers manuels pour ${date}`, 'success');
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
  const { apiFootballKey, apiOddsKey, anthropicKey, geminiKey } = req.body;
  const current = storage.loadSettings();
  const updated = {
    ...current,
    ...(apiFootballKey !== undefined && { apiFootballKey }),
    ...(apiOddsKey !== undefined && { apiOddsKey }),
    ...(anthropicKey !== undefined && { anthropicKey }),
    ...(geminiKey !== undefined && { geminiKey }),
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
    hasAnthropic: !!s.anthropicKey || !!process.env.ANTHROPIC_API_KEY,
    hasGemini: !!s.geminiKey || !!process.env.GEMINI_API_KEY
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