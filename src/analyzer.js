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
      ? 'BTTS=' + (matchOdds.odds.btts_yes||'?') + ' O2.5=' + (matchOdds.odds.over25||'?') + ' O1.5domicile=' + (matchOdds.odds.over15||'?')
      : 'cotes non disponibles';
    return '[' + (f.league ? f.league.name : 'Ligue') + '] ' + (f.home ? f.home.name : '?') + ' vs ' + (f.away ? f.away.name : '?') + ' | ' + oddsStr;
  }).join('\n');

  const oddsOnly = odds.slice(0, 30).map(o =>
    o.homeTeam + ' vs ' + o.awayTeam + ': BTTS=' + (o.odds.btts_yes||'?') + ' O2.5=' + (o.odds.over25||'?') + ' O1.5=' + (o.odds.over15||'?')
  ).join('\n');

  const oddsNote = oddsAvailable ? '' : '\nCOTES NON DISPONIBLES : mets odds: 0 pour tous les picks.';

  return 'Tu es un expert en analyse de paris sportifs football. Date : ' + date + '.\n\nMATCHS DU JOUR :\n' + (fixturesSummary || 'Donnees non disponibles.') + '\n\nCOTES REELLES :\n' + (oddsOnly || 'Non disponibles.') + oddsNote + '\n\n=== REGLES STRICTES ===\n\nMARCHES AUTORISES : SEULEMENT CES 3 MARCHES :\n- "BTTS Oui"\n- "Plus de 2.5 buts"\n- "Plus de 1.5 buts equipe domicile"\n\nGENERE EXACTEMENT 5 TICKETS :\n- Ticket 1 "BTTS" : 4 a 6 matchs, UNIQUEMENT "BTTS Oui"\n- Ticket 2 "BTTS" : 4 a 6 matchs DIFFERENTS, UNIQUEMENT "BTTS Oui"\n- Ticket 3 "Plus de 2.5 buts" : 4 a 6 matchs\n- Ticket 4 "Plus de 1.5 buts domicile" : 4 a 6 matchs\n- Ticket 5 "Mix" : 4 a 6 matchs, mix "BTTS Oui" et "Plus de 1.5 buts equipe domicile"\n\nReponds UNIQUEMENT avec JSON valide, sans markdown :\n{"date":"' + date + '","generatedAt":"' + new Date().toISOString() + '","tickets":[{"id":1,"type":"BTTS","raisonnement":"...","picks":[{"match":"Equipe A vs Equipe B","league":"Ligue","market":"BTTS Oui","odds":1.45,"justification":"..."}]}]}';
}

async function generateTickets(apiKey, fixtures, odds, date, oddsAvailable) {
  if (oddsAvailable === undefined) oddsAvailable = true;
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
    const picksStr = (t.picks || []).map(p => p.match + ' - ' + p.market + ' @ ' + p.odds).join('; ');
    return 'Ticket ' + t.id + ' (' + t.type + ', cote ' + t.totalOdds + '): ' + picksStr;
  }).join('\n');
  const prompt = 'Genere un rapport de performance matinal pour ces tickets football.\n\nTICKETS :\n' + ticketsSummary + '\n\nReponds UNIQUEMENT avec JSON valide :\n{"reportDate":"' + new Date().toISOString() + '","summary":{"totalTickets":5,"won":0,"lost":0,"pending":5,"winRate":"0%"},"ticketResults":[],"analysis":"Rapport en attente des resultats."}';
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });
  try {
    const text = message.content[0].text.trim();
    const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return {
      reportDate: new Date().toISOString(),
      summary: { totalTickets: previousTickets.length, won: 0, lost: 0, pending: previousTickets.length, winRate: '0%' },
      ticketResults: [],
      analysis: 'Erreur de parsing du rapport.'
    };
  }
}

module.exports = { generateTickets, generateMorningReport };
