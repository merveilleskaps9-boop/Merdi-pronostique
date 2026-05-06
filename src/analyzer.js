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
      ? `BTTS=${matchOdds.odds.btts_yes||'?'} O2.5=${matchOdds.odds.over25||'?'} O1.5domicile=${matchOdds.odds.over15||'?'}`
      : 'cotes non disponibles';
    return `[${f.league ? f.league.name : 'Ligue'}] ${f.home ? f.home.name : '?'} vs ${f.away ? f.away.name : '?'} | ${oddsStr}`;
  }).join('\n');

  const oddsOnly = odds.slice(0, 30).map(o =>
    `${o.homeTeam} vs ${o.awayTeam}: BTTS=${o.odds.btts_yes||'?'} O2.5=${o.odds.over25||'?'} O1.5=${o.odds.over15||'?'}`
  ).join('\n');

  const oddsNote = oddsAvailable ? '' : `\nCOTES NON DISPONIBLES : mets odds: 0 pour tous les picks.`;

  return `Tu es un expert en analyse de paris sportifs football. Date : ${date}.

MATCHS DU JOUR :
${fixturesSummary || 'Donnees non disponibles.'}

COTES REELLES :
${oddsOnly || 'Non disponibles.'}
${oddsNote}

=== REGLES STRICTES - LIRE ATTENTIVEMENT ===

MARCHES AUTORISES : SEULEMENT CES 3 MARCHES, AUCUN AUTRE :
- "BTTS Oui" : les deux equipes marquent
- "Plus de 2.5 buts" : total buts dans le match superieur a 2.5
- "Plus de 1.5 buts equipe domicile" : equipe a domicile marque plus de 1.5 buts

MARCHES INTERDITS (ne jamais utiliser) :
- Victoire equipe 1, Victoire equipe 2, Match nul
- 1, X, 2, 1X, X2, 1X2
- Double chance
- Tout autre marche que les 3 autorises ci-dessus

COTES INDIVIDUELLES AUTORISEES :
- "BTTS Oui" : entre 1.30 et 2.20 maximum
- "Plus de 2.5 buts" : entre 1.40 et 2.50 maximum
- "Plus de 1.5 buts equipe domicile" : entre 1.25 et 2.00 maximum
- Si tu n'as pas de cote reelle, utilise une cote realiste dans ces fourchettes
- JAMAIS de cote superieure a 2.50 pour un pick individuel

NOMBRE DE PICKS PAR TICKET : entre 4 et 6 matchs DIFFERENTS

GENERE EXACTEMENT 5 TICKETS :
- Ticket 1 "BTTS" : 4 a 6 matchs, UNIQUEMENT le marche "BTTS Oui"
- Ticket 2 "BTTS" : 4 a 6 matchs DIFFERENTS du ticket 1, UNIQUEMENT "BTTS Oui"
- Ticket 3 "Plus de 2.5 buts" : 4 a 6 matchs, UNIQUEMENT "Plus de 2.5 buts"
- Ticket 4 "Plus de 1.5 buts domicile" : 4 a 6 matchs, UNIQUEMENT "Plus de 1.5 buts equipe domicile"
- Ticket 5 "Mix" : 4 a 6 matchs, mix de "BTTS Oui" et "Plus de 1.5 buts equipe domicile" uniquement

Evite au maximum de repeter les memes matchs entre les tickets.

Reponds UNIQUEMENT avec JSON valide, sans markdown, sans backticks :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "tickets": [
    {
      "id": 1,
      "type": "BTTS",
      "raisonnement": "Explication courte pourquoi ces matchs sont bons pour BTTS",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "BTTS Oui",
          "odds": 1.45,
          "justification": "Les deux equipes ont marque dans leurs 5 derniers matchs"
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
  "summary": { "totalTickets": 5, "won": 0, "lost": 0, "pending": 5, "winRate": "0%" },
  "ticketResults": [],
  "analysis": "Rapport en attente des resultats."
}`;
  const message = await client.messages.create({
    model: 'claude-ha