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

function buildPrompt(sport, date, pdfTexts, notes, optionsFoot) {
  let prompt = `Tu es un expert en analyse de paris sportifs. Date d'analyse : ${date}.\n`;
  prompt += `Analyse minutieusement toutes les images fournies. N'invente aucune cote, utilise uniquement celles visibles sur les captures.\n\n`;

  prompt += `REGLES FONDAMENTALES DE CONSTRUCTION DES TICKETS :\n`;
  prompt += `Tu DOIS analyser le nombre de matchs presents sur les images et appliquer l'une de ces deux strategies :\n`;
  prompt += `CAS A (S'il n'y a que 1 ou 2 matchs sur les images) : Cree des tickets de type "Bet Builder" (combiner plusieurs evenements differents d'un meme match). La cote totale de CHAQUE ticket doit se situer obligatoirement entre 10.0 et 30.0.\n`;
  prompt += `CAS B (S'il y a 3 matchs ou plus) : CHAQUE ticket doit combiner au moins 3 matchs differents. Pour chaque match de ce ticket, tu dois faire 2 a 3 selections specifiques.\n\n`;

  prompt += `MARCHES A UTILISER PAR SPORT :\n`;
  if (sport === 'basketball') {
    prompt += `- Points du joueur (Plus de / Moins de)\n`;
    prompt += `- Passes decisives du joueur\n`;
    prompt += `- Rebonds du joueur\n`;
    prompt += `- Total Points + Rebonds + Passes (PRA)\n`;
  } else if (sport === 'baseball') {
    prompt += `- Joueur : Coups surs (Hits), Points (Runs), RBIs, Total bases\n`;
    prompt += `- Lanceur : Strikeouts (Retraits au baton)\n`;
  } else {
    const prefFoot = optionsFoot || 'BTTS, Plus de 1.5 buts, Victoire 1 ou 2';
    prompt += `ANALYSE PROFONDE EXIGEE : Analyse la forme recente (5 derniers matchs) et les enjeux grace a tes propres connaissances web.\n`;
    prompt += `Tes choix doivent se concentrer sur ces preferences du parieur : ${prefFoot}.\n`;
    prompt += `Outre les choix visibles sur l'image, tu DOIS proposer des recommandations pertinentes (ex: +2.5 corners, tirs cadres, cartons, equipe remporte une mi-temps) justifiees par ton analyse externe pour gonfler la cote.\n`;
  }

  if (pdfTexts) prompt += `\nCONTENU DES PDFs POUR CONTEXTE :\n${pdfTexts}`;
  if (notes) prompt += `\nNOTES DU PARIEUR :\n${notes}`;

  prompt += `\n\nSTRUCTURE EXIGEE :\nTu DOIS generer EXACTEMENT 6 TICKETS au total, en respectant ces categories de cotes totales de combine :\n`;
  prompt += `- Ticket 1 et 2 : Type "Sur" (Cote globale entre 10.0 et 30.0)\n`;
  prompt += `- Ticket 3 et 4 : Type "Moyen" (Cote globale entre 35.0 et 60.0)\n`;
  prompt += `- Ticket 5 et 6 : Type "Risque" (Cote globale entre 65.0 et 1000.0+)\n\n`;

  prompt += `Reponds UNIQUEMENT avec un JSON valide. Aucun texte avant ou apres. Format strict a respecter :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "source": "manuel",
  "tickets": [
    {
      "id": 1,
      "type": "Sur",
      "raisonnement": "Explication de la strategie et de la recherche statistique effectuee",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "Nom de la selection",
          "odds": 1.90,
          "justification": "Raison basee sur les stats de forme"
        }
      ]
    }
  ]
}`;

  return prompt;
}

async function runEveningAnalysis(date) {
  const settings = storage.loadSettings();
  if (!settings.autoAnalysis) {
    storage.addActivityLog(`Analyse automatique desactivee dans les parametres pour ${date}`, 'info');
    return null;
  }

  const apiFootball = settings.apiFootballKey || process.env.API_FOOTBALL_KEY;
  const apiOdds = settings.apiOddsKey || process.env.ODDS_API_KEY;
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (!apiAnthropic) throw new Error('Cle Anthropic manquante');

  storage.addActivityLog(`Debut analyse automatique pour ${date}`, 'info');

  let fixtures = [];
  let oddsData = [];
  let oddsAvailable = false;
  let usage = storage.loadApiUsage();

  if (apiFootball) {
    try {
      storage.addActivityLog('Recuperation des fixtures via API-Football...', 'info');
      const raw = await getFixturesForTargetLeagues(apiFootball, date);
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
    } catch (e) {
      storage.addActivityLog(`Cotes non disponibles: ${e.message}`, 'warn');
    }
  }

  storage.saveApiUsage(usage);
  const ticketsData = await generateTickets(apiAnthropic, fixtures, oddsData, date, oddsAvailable);
  storage.saveTickets(date, ticketsData);
  storage.addActivityLog(`Tickets generes et sauvegardes pour ${date}`, 'success');
  return ticketsData;
}

async function runMorningReport(date) {
  const settings = storage.loadSettings();
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiAnthropic) throw new Error('Cle Anthropic manquante');
  const tickets = storage.loadTickets(date);
  if (!tickets) throw new Error(`Aucun ticket trouve pour ${date}`);
  const report = await generateMorningReport(apiAnthropic, tickets.tickets || [], []);
  storage.saveReport(date, report);
  storage.addActivityLog(`Rapport du matin genere pour ${date}`, 'success');
  return report;
}

app.post('/api/analyze-manual', upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  const { date, notes, sport = 'football', optionsFoot = '' } = req.body;

  if (!date) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Date requise' });
  }

  const settings = storage.loadSettings();
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;
  const apiGemini = settings.geminiKey || process.env.GEMINI_API_KEY;

  if (!apiAnthropic && !apiGemini) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Aucune cle IA configuree (Claude ou Gemini)' });
  }

  res.json({ message: 'Analyse manuelle lancee', date });

  (async () => {
    try {
      storage.addActivityLog(`Analyse (${sport}) lancee avec ${files.length} fichier(s)`, 'info');

      const messageContentClaude = [];
      const messageContentGemini = [];
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
             messageContentClaude.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
             messageContentGemini.push({ inlineData: { data: base64, mimeType: mimeType } });
          }
        }
      }

      const textPrompt = buildPrompt(sport, date, pdfTexts, notes, optionsFoot);
      
      messageContentClaude.push({ type: 'text', text: textPrompt });
      messageContentGemini.unshift({ text: textPrompt });

      let combinedTickets = [];

      if (apiAnthropic) {
        try {
          storage.addActivityLog(`Interrogation de Claude AI en cours...`, 'info');
          const client = new Anthropic({ apiKey: apiAnthropic });
          const message = await client.messages.create({
            model: 'claude-haiku-4-5-20251001', 
            max_tokens: 8000,
            messages: [{ role: 'user', content: messageContentClaude }]
          });

          let jsonText = message.content[0].text.trim();
          if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
          
          const parsed = JSON.parse(jsonText);
          if (parsed.tickets) {
            parsed.tickets.forEach(t => { t.type = t.type + ' (Claude)'; combinedTickets.push(t); });
          }
        } catch (err) {
          storage.addActivityLog(`Erreur Claude: ${err.message}`, 'error');
        }
      }

      if (apiGemini) {
        try {
          storage.addActivityLog(`Interrogation de Gemini AI en cours...`, 'info');
          const genAI = new GoogleGenerativeAI(apiGemini);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          
          const result = await model.generateContent(messageContentGemini);
          let jsonText = result.response.text().trim();
          if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
          
          const parsed = JSON.parse(jsonText);
          if (parsed.tickets) {
            parsed.tickets.forEach((t, index) => { t.id = t.id + 100 + index; t.type = t.type + ' (Gemini)'; combinedTickets.push(t); });
          }
        } catch (err) {
          storage.addActivityLog(`Erreur Gemini: ${err.message}`, 'error');
        }
      }

      combinedTickets = combinedTickets.map(ticket => {
        const totalOdds = Math.round(
          (ticket.picks || []).reduce((acc, p) => acc * (parseFloat(p.odds) || 1), 1) * 100
        ) / 100;
        return { ...ticket, totalOdds, sourceDate: date };
      });

      storage.saveTickets(date, { date: date, generatedAt: new Date().toISOString(), source: 'manuel', tickets: combinedTickets });
      storage.addActivityLog(`Analyse terminee : ${combinedTickets.length} tickets generes`, 'success');

    } catch (e) {
      storage.addActivityLog(`Erreur globale analyse: ${e.message}`, 'error');
    } finally {
      cleanupFiles(files);
    }
  })();
});

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
      anthropic: !!(settings.anthropicKey || process.env.ANTHROPIC_API_KEY),
      gemini: !!(settings.geminiKey || process.env.GEMINI_API_KEY)
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
  runEveningAnalysis(date).catch(err => { storage.addActivityLog(`Erreur analyse: ${err.message}`, 'error'); });
});

app.post('/api/report', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'Date requise' });
  res.json({ message: 'Rapport lance en arriere-plan', date });
  runMorningReport(date).catch(err => { storage.addActivityLog(`Erreur rapport: ${err.message}`, 'error'); });
});

app.post('/api/settings', (req, res) => {
  const { apiFootballKey, apiOddsKey, anthropicKey, geminiKey, autoAnalysis, footOptions } = req.body;
  const current = storage.loadSettings();
  const updated = {
    ...current,
    ...(apiFootballKey !== undefined && { apiFootballKey }),
    ...(apiOddsKey !== undefined && { apiOddsKey }),
    ...(anthropicKey !== undefined && { anthropicKey }),
    ...(geminiKey !== undefined && { geminiKey }),
    ...(autoAnalysis !== undefined && { autoAnalysis }),
    ...(footOptions !== undefined && { footOptions }),
    updatedAt: new Date().toISOString()
  };
  storage.saveSettings(updated);
  storage.addActivityLog('Parametres sauvegardes', 'success');
  res.json({ success: true, settings: updated });
});

app.get('/api/settings', (req, res) => {
  const s = storage.loadSettings();
  res.json({
    hasApiFootball: !!s.apiFootballKey || !!process.env.API_FOOTBALL_KEY,
    hasApiOdds: !!s.apiOddsKey || !!process.env.ODDS_API_KEY,
    hasAnthropic: !!s.anthropicKey || !!process.env.ANTHROPIC_API_KEY,
    hasGemini: !!s.geminiKey || !!process.env.GEMINI_API_KEY,
    autoAnalysis: s.autoAnalysis || false,
    footOptions: s.footOptions || []
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur demarre sur le port ${PORT}`);
  scheduler.initScheduler(runEveningAnalysis, runMorningReport);
});

module.exports = app;