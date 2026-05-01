'use strict';

const Anthropic = require('@anthropic-ai/sdk');

function buildAnalysisPrompt(fixtures, odds, date) {
  const fixturesSummary = fixtures.slice(0, 40).map(f => {
    const homeFormStr = f.homeForm ? f.homeForm.map(m => `${m.result}(${m.goalsFor}-${m.goalsAgainst})`).join(',') : 'N/A';
    const awayFormStr = f.awayForm ? f.awayForm.map(m => `${m.result}(${m.goalsFor}-${m.goalsAgainst})`).join(',') : 'N/A';
    const matchOdds = odds.find(o =>
      o.homeTeam.toLowerCase().includes(f.home.name.toLowerCase().slice(0, 6)) ||
      f.home.name.toLowerCase().includes(o.homeTeam.toLowerCase().slice(0, 6))
    );
    const oddsStr = matchOdds
      ? `Cotes: 1=${matchOdds.odds.homeWin || '?'} X=${matchOdds.odds.draw || '?'} 2=${matchOdds.odds.awayWin || '?'} O1.5=${matchOdds.odds.over15 || '?'} O2.5=${matchOdds.odds.over25 || '?'}`
      : 'Cotes: non disponibles';
    return `[${f.league.name} - ${f.league.country}] ${f.home.name} vs ${f.away.name} | Forme dom: ${homeFormStr} | Forme ext: ${awayFormStr} | MoyButs dom: ${f.homeAvgGoals} concedes: ${f.homeAvgConceded} | MoyButs ext: ${f.awayAvgGoals} concedes: ${f.awayAvgConceded} | PrioriteButs: ${f.isPriorityGoals} | ${oddsStr}`;
  }).join('\n');

  return `Tu es un expert en analyse de paris sportifs football. Date d'analyse : ${date}.

DONNEES DES MATCHS DU JOUR :
${fixturesSummary || 'Aucun match trouve via API - base ton analyse sur tes connaissances des championnats actifs.'}

PROTOCOLE D'ANALYSE MULTICRITERES :
1. Forme actuelle (3 derniers matchs) et position au classement
2. Performance specifique domicile/exterieur
3. Enjeu du match et gestion du calendrier
4. Priorite marches BUTS et BTTS pour : Turquie, Pays-Bas, Allemagne, MLS, Mexique, Bresil, Serie B Italie, Segunda Liga

SEUILS DE COTES MINIMALES PAR MARCHE :
- Plus de 1.5 buts (match) : > 1.25
- Plus de 1.5 buts equipe domicile : > 1.25
- Plus de 0.5 buts equipe exterieure (si performante) : > 1.25
- Plus de 1.5 buts equipe exterieure (si favorite) : > 1.25
- BTTS Oui : > 1.30
- BTTS + Plus de 2.5 buts : > 1.30
- BTTS 1ere mi-temps : > 1.25
- Corners equipe exterieure +2.5 : > 1.25
- Corners equipe domicile +3 : > 1.25
- Victoire Equipe 1 : > 1.30
- Equipe gagne au moins une mi-temps : > 1.30

EVITER au maximum de repeter les memes matchs entre les tickets sauf si c'est vraiment tres sur.

GENERE EXACTEMENT 15 TICKETS au format JSON strict :
- 5 tickets "Haute Performance" : cote totale cumulee entre 10 et 20
- 5 tickets "Securite" : cote totale cumulee entre 10 et 15
- 5 tickets "Securite et Haute Performance" : cote minimale 35, max 3 selections par match, 4 a 8 matchs par ticket

Reponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans backticks, sans texte avant ou apres. Format exact :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "tickets": [
    {
      "id": 1,
      "type": "Haute Performance",
      "totalOdds": 12.5,
      "raisonnement": "Explication courte du contexte general du ticket",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom du championnat",
          "market": "Plus de 1.5 buts",
          "odds": 1.35,
          "justification": "Forme offensive des deux equipes, moyenne de 2.3 buts sur 3 derniers matchs"
        }
      ]
    }
  ]
}`;
}

async function generateTickets(apiKey, fixtures, odds, date) {
  const client = new Anthropic({ apiKey });
  const prompt = buildAnalysisPrompt(fixtures, odds, date);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  });

  const rawText = message.content[0].text;
  let jsonText = rawText.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  const parsed = JSON.parse(jsonText);
  return parsed;
}

async function generateMorningReport(apiKey, previousTickets, matchResults) {
  const client = new Anthropic({ apiKey });

  const ticketsSummary = previousTickets.map(t => {
    const picksStr = t.picks.map(p => `${p.match} - ${p.market} @ ${p.odds}`).join('; ');
    return `Ticket ${t.id} (${t.type}, cote ${t.totalOdds}): ${picksStr}`;
  }).join('\n');

  const resultsSummary = matchResults.length
    ? matchResults.map(r => `${r.match}: ${r.scoreHT || '?'}-${r.scoreAT || '?'} (FT: ${r.scoreFH || '?'}-${r.scoreFA || '?'})`).join('\n')
    : 'Resultats non disponibles - analyse basee sur les picks uniquement.';

  const prompt = `Tu es un analyste de paris football. Genere un rapport de performance matinal pour les tickets du soir precedent.

TICKETS DU SOIR PRECEDENT :
${ticketsSummary}

SCORES FINAUX :
${resultsSummary}

Pour chaque ticket, determine s'il est gagne ou perdu selon les scores disponibles. Si un score n'est pas disponible, marque le pick comme "resultats a verifier".

Reponds UNIQUEMENT avec un objet JSON valide, sans markdown. Format :
{
  "reportDate": "${new Date().toISOString()}",
  "summary": {
    "totalTickets": 15,
    "won": 0,
    "lost": 0,
    "pending": 0,
    "winRate": "0%"
  },
  "ticketResults": [
    {
      "ticketId": 1,
      "type": "Haute Performance",
      "totalOdds": 12.5,
      "result": "gagne|perdu|en_attente",
      "picksResults": [
        {
          "match": "Equipe A vs Equipe B",
          "market": "Plus de 1.5 buts",
          "odds": 1.35,
          "result": "gagne|perdu|en_attente",
          "scoreInfo": "Score final: 2-1"
        }
      ]
    }
  ],
  "analysis": "Bref commentaire sur la performance globale des picks et les tendances observees"
}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const rawText = message.content[0].text;
  let jsonText = rawText.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  return JSON.parse(jsonText);
}

module.exports = { generateTickets, generateMorningReport, buildAnalysisPrompt };
