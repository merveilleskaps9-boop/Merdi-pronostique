'use strict';

const cron = require('node-cron');
const storage = require('./storage');

let eveningJob = null;
let morningJob = null;
let runEveningAnalysis = null;
let runMorningReport = null;

function initScheduler(eveningFn, morningFn) {
  runEveningAnalysis = eveningFn;
  runMorningReport = morningFn;

  // Analyse du soir : chaque jour a 20h00 ET (UTC-4 ete, UTC-5 hiver)
  // node-cron utilise le TZ de l'environnement (America/Toronto dans .env)
  eveningJob = cron.schedule('0 20 * * 5,6,0', async () => {
    const today = new Date().toISOString().slice(0, 10);
    storage.addActivityLog(`[CRON] Lancement automatique analyse du soir pour ${today}`, 'info');
    try {
      await runEveningAnalysis(today);
      storage.addActivityLog('[CRON] Analyse du soir terminee avec succes', 'success');
    } catch (err) {
      storage.addActivityLog(`[CRON] Erreur analyse du soir : ${err.message}`, 'error');
    }
  }, { timezone: 'America/Toronto' });

  // Rapport du matin : chaque jour a 07h00 ET
  morningJob = cron.schedule('0 7 * * *', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    storage.addActivityLog(`[CRON] Lancement automatique rapport du matin pour ${yesterday}`, 'info');
    try {
      await runMorningReport(yesterday);
      storage.addActivityLog('[CRON] Rapport du matin termine avec succes', 'success');
    } catch (err) {
      storage.addActivityLog(`[CRON] Erreur rapport du matin : ${err.message}`, 'error');
    }
  }, { timezone: 'America/Toronto' });

  storage.addActivityLog('Scheduleur initialise (20h00 analyse, 07h00 rapport)', 'success');
  console.log('[SCHEDULER] Taches cron initialisees - Analyse 20h00 ET, Rapport 07h00 ET');
}

function stopScheduler() {
  if (eveningJob) eveningJob.stop();
  if (morningJob) morningJob.stop();
}

module.exports = { initScheduler, stopScheduler };
