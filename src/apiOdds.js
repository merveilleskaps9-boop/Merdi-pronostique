'use strict';

const axios = require('axios');

const BASE_URL = 'https://api.the-odds-api.com/v4';

const SPORT_KEYS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_england_league1',
  'soccer_spain_segunda_division',
  'soccer_italy_serie_b',
  'soccer_germany_bundesliga2',
  'soccer_turkey_super_league',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_belgium_first_div',
  'soccer_usa_mls',
  'soccer_mexico_ligamx',
  'soccer_brazil_campeonato',
  'soccer_argentina_primera_division',
  'soccer_saudi_arabia_pro_league',
  'soccer_japan_j_league',
  'soccer_china_superleague',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'soccer_conmebol_copa_libertadores'
];

const MARKETS = ['h2h', 'totals', 'btts'];

async function getOddsForSport(apiKey, sportKey, markets = ['h2h', 'totals']) {
  try {
    const response = await axios.get(`${BASE_URL}/sports/${sportKey}/odds`, {
      params: {
        apiKey,
        regions: 'eu',
        markets: markets.join(','),
        oddsFormat: 'decimal',
        dateFormat: 'iso'
      }
    });
    const remaining = response.headers['x-requests-remaining'];
    const used = response.headers['x-requests-used'];
    return {
      data: response.data || [],
      remaining: parseInt(remaining) || null,
      used: parseInt(used) || null
    };
  } catch (err) {
    if (err.response && err.response.status === 422) {
      return { data: [], remaining: null, used: null };
    }
    throw err;
  }
}

async function getAllOddsForDate(apiKey, targetDate) {
  const allOdds = [];
  let remaining = null;
  let used = null;

  for (const sportKey of SPORT_KEYS) {
    try {
      const result = await getOddsForSport(apiKey, sportKey, ['h2h', 'totals']);
      remaining = result.remaining;
      used = result.used;
      const filtered = result.data.filter(event => {
        const eventDate = event.commence_time ? event.commence_time.slice(0, 10) : '';
        return eventDate === targetDate;
      });
      allOdds.push(...filtered.map(e => ({ ...e, sport_key: sportKey })));
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`Erreur odds pour ${sportKey}:`, err.message);
    }
  }

  return { odds: allOdds, remaining, used };
}

function extractBestOdds(oddsEvent) {
  const result = {
    matchId: oddsEvent.id,
    homeTeam: oddsEvent.home_team,
    awayTeam: oddsEvent.away_team,
    commenceTime: oddsEvent.commence_time,
    sportKey: oddsEvent.sport_key,
    odds: {
      homeWin: null,
      draw: null,
      awayWin: null,
      over15: null,
      over25: null,
      under25: null,
      btts_yes: null,
      btts_no: null
    }
  };

  if (!oddsEvent.bookmakers || !oddsEvent.bookmakers.length) return result;

  const allH2H = [];
  const allTotals = [];

  for (const bm of oddsEvent.bookmakers) {
    for (const market of bm.markets) {
      if (market.key === 'h2h') allH2H.push(...market.outcomes);
      if (market.key === 'totals') allTotals.push(...market.outcomes);
    }
  }

  function bestOdds(outcomes, name) {
    const filtered = outcomes.filter(o => o.name === name);
    if (!filtered.length) return null;
    return Math.max(...filtered.map(o => o.price));
  }

  result.odds.homeWin = bestOdds(allH2H, oddsEvent.home_team);
  result.odds.awayWin = bestOdds(allH2H, oddsEvent.away_team);
  result.odds.draw = bestOdds(allH2H, 'Draw');

  const over15 = allTotals.filter(o => o.name === 'Over' && Math.abs(o.point - 1.5) < 0.1);
  const over25 = allTotals.filter(o => o.name === 'Over' && Math.abs(o.point - 2.5) < 0.1);
  const under25 = allTotals.filter(o => o.name === 'Under' && Math.abs(o.point - 2.5) < 0.1);

  if (over15.length) result.odds.over15 = Math.max(...over15.map(o => o.price));
  if (over25.length) result.odds.over25 = Math.max(...over25.map(o => o.price));
  if (under25.length) result.odds.under25 = Math.max(...under25.map(o => o.price));

  return result;
}

module.exports = {
  SPORT_KEYS,
  getAllOddsForDate,
  getOddsForSport,
  extractBestOdds
};
