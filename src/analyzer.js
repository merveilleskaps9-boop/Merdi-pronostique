'use strict';

const Anthropic = require('@anthropic-ai/sdk');

function calculateTotalOdds(picks) {
  if (!picks || !picks.length) return 1;
  return Math.round(picks.reduce((total, pick) => {
    return total * (parseFloat(pick.odds) || 1);
  }, 1) * 100) / 100;
}

function buildAnalysisPrompt(fixtures, odds, date, oddsAvailable) {
  const fixturesSummary = fixtures.slice(0, 40).map(f => {
    const matchOdds = odds.find(o =>
      o.homeTeam && f.home && f.home.name &&
      (o.homeTeam.toLowerCase().includes(f.home.name.toLowerCase().slice(0, 5)) ||
       f.home.name.toLowerCase().includes(o.homeTeam.toLowerCase().slice(0, 5)))
    );
    const oddsStr = matchOdds
      ? `Cotes reelles: 1=${matchOdds.odds.homeWin||'?'} X=${matchOdds.odds.draw||'?'} 2=${matchOdds.odds.awayWin||'?'} O1.5=${matchOdds.odds.over15||'?'} O2.5=${matchOdds.odds.over25||'?'}`
      : 'Pas de cotes disponibles pour ce match';
    return `[${f.league ? f.league.name : 'Ligue'}] ${f.home ? f.home.name : '?'} vs ${f.away ? f.away.name : '?'} | ${oddsStr}`;
  }).join('\n');

  const oddsOnly = odds.slice(0, 30).map(o =>
    `${o.homeTeam} vs ${o.awayTeam}: 1=${o.odds.homeWin||'?'} X=${o.odds.draw||'?'} 2=${o.odds.awayWin||'?'} O1.5=${o.odds.over15||'?'} O2.5=${o.odds.over25||'?'}`
  ).join('\n');

  const oddsNote = oddsAvailable
    ? ''
    : `\nIMPORTANT - COTES NON DISPONIBLES : Tu ne dois PAS inventer de cotes. Analyse uniquement la forme des equipes, le classement, les enjeux et les statistiques. Pour chaque pick mets odds: 0 et explique dans la justification pourquoi ce match est interessant sans mentionner de cotes.`;

  return `Tu es un expert en analyse de paris sportifs football. Date : ${date}.

MATCHS DU JOUR :
${fixturesSummary || 'Donnees non disponibles.'}

COTES EN TEMPS REEL :
${oddsOnly || 'Cotes non disponibles.'}
${oddsNote}

${oddsAvailable ? `REGLES ABSOLUES :
1. Utilise UNIQUEMENT les cotes reelles fournies ci-dessus quand disponibles
2. Si cotes non disponibles pour un match, utilise des cotes REALISTES et CONSERVATIVES
3. Cotes minimum : BTTS > 1.30, Over 1.5 > 1.25, Over 2.5 > 1.40, Victoire favorite > 1.30
4. Fournis UNIQUEMENT les cotes individuelles. Le systeme calculera automatiquement la cote totale.` : `REGLES ABSOLUES :
1. NE PAS inventer de cotes. Mets odds: 0 pour tous les picks.
2. Base ton analyse sur la forme, le classement, les enjeux et les statistiques uniquement.
3. Explique clairement pourquoi chaque match est interessant dans la justification.`}

PROTOCOLE : Forme 3 derniers matchs, performance domicile/exterieur, priorite buts/BTTS pour Turquie, Pays-Bas, Allemagne, MLS, Mexique, Bresil, Serie B, Segunda.

GENERE EXACTEMENT 15 TICKETS :
- 5 "Haute Performance" : 4 a 6 matchs
- 5 "Securite" : 4 a 6 matchs
- 5 "Securite et Haute Performance" : 4 a 8 matchs, max 3 picks par match

Evite de repeter les memes matchs entre tickets.

Reponds UNIQUEMENT avec JSON valide, sans markdown :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "oddsAvailable": ${oddsAvailable},
  "tickets": [
    {
      "id": 1,
      "type": "Haute Performance",
      "raisonnement": "Explication courte",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "Plus de 1.5 buts",
          "odds": 1.35,
          "justification": "Raison courte"
        }
      ]
    }
  ]
}`;
}

async function generateTickets(apiKey, fixtures, odds, date, oddsAvailable = true) {
  const client = new Anthropic({ apiKey });
  const prompt = buildAnalysisPrompt(fixtures, odds, date, oddsAvailable);
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
  if (parsed.tickets) {
    parsed.tickets = parsed.tickets.map(ticket => ({
      ...ticket,
      totalOdds: calculateTotalOdds(ticket.picks)
    }));
  }
  return parsed;
}

async function generateMorningReport(apiKey, previousTickets, matchResults) {
  const client = new Anthropic({ apiKey });
  const ticketsSummary = previousTickets.map(t => {
    const picksStr = (t.picks || []).map(p => `${p.match} - ${p.market} @ ${p.odds}`).join('; ');
    return `Ticket ${t.id} (${t.type}, cote ${t.totalOdds}): ${picksStr}`;
  }).join('\n');
  const prompt = `Genere un rapport de performance matinal pour ces tickets football.

TICKETS :
${ticketsSummary}

Reponds UNIQUEMENT avec JSON valide :
{
  "reportDate": "${new Date().toISOString()}",
  "summary": { "totalTickets": 15, "won": 0, "lost": 0, "pending": 15, "winRate": "0%" },
  "ticketResults": [],
  "analysis": "Rapport en attente des resultats."
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

module.exports = { generateTickets, generateMorningReport, calculateTotalOdds };