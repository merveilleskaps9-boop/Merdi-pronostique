'use strict';

const axios = require('axios');

const BASE_URL = 'https://apifootball.com/api';

const PRIORITY_LEAGUES_GOALS = [148, 152, 207, 206, 243, 244, 262, 268, 265, 264];

async function getFixturesForTargetLeagues(apiKey, date) {
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        action: 'get_events',
        from: date,
        to: date,
        APIkey: apiKey
      }
    });
    const data = response.data;
    if (!Array.isArray(data)) return [];
    return data;
  } catch (err) {
    throw new Error('Erreur apifootball: ' + err.message);
  }
}

async function enrichFixtureWithStats(apiKey, fixture) {
  const leagueId = parseInt(fixture.league_id);
  const isPriorityGoals = PRIORITY_LEAGUES_GOALS.includes(leagueId);
  return {
    fixtureId: fixture.match_id,
    date: fixture.match_date,
    league: {
      id: leagueId,
      name: fixture.league_name,
      country: fixture.country_name
    },
    home: { id: fixture.match_hometeam_id, name: fixture.match_hometeam_name },
    away: { id: fixture.match_awayteam_id, name: fixture.match_awayteam_name },
    homeForm: [],
    awayForm: [],
    homeAvgGoals: 0,
    awayAvgGoals: 0,
    homeAvgConceded: 0,
    awayAvgConceded: 0,
    isPriorityGoals,
    status: fixture.match_status
  };
}

module.exports = {
  PRIORITY_LEAGUES_GOALS,
  getFixturesForTargetLeagues,
  enrichFixtureWithStats
};