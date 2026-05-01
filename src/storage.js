'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

function ensureDirs() {
  [DATA_DIR, LOGS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}
ensureDirs();

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function saveTickets(date, ticketsData) {
  const filePath = path.join(DATA_DIR, `tickets_${date}.json`);
  writeJSON(filePath, ticketsData);
  const indexPath = path.join(DATA_DIR, 'index.json');
  const index = readJSON(indexPath) || { analyses: [] };
  if (!index.analyses.includes(date)) {
    index.analyses.unshift(date);
    if (index.analyses.length > 90) index.analyses = index.analyses.slice(0, 90);
  }
  writeJSON(indexPath, index);
  return filePath;
}

function loadTickets(date) {
  const filePath = path.join(DATA_DIR, `tickets_${date}.json`);
  return readJSON(filePath);
}

function saveReport(date, reportData) {
  const filePath = path.join(DATA_DIR, `report_${date}.json`);
  writeJSON(filePath, reportData);
  return filePath;
}

function loadReport(date) {
  const filePath = path.join(DATA_DIR, `report_${date}.json`);
  return readJSON(filePath);
}

function getLatestDate() {
  const indexPath = path.join(DATA_DIR, 'index.json');
  const index = readJSON(indexPath);
  return index && index.analyses.length ? index.analyses[0] : null;
}

function getAllDates() {
  const indexPath = path.join(DATA_DIR, 'index.json');
  const index = readJSON(indexPath);
  return index ? index.analyses : [];
}

function saveApiUsage(usage) {
  const filePath = path.join(DATA_DIR, 'api_usage.json');
  writeJSON(filePath, { ...usage, updatedAt: new Date().toISOString() });
}

function loadApiUsage() {
  const filePath = path.join(DATA_DIR, 'api_usage.json');
  return readJSON(filePath) || {
    footballDailyUsed: 0,
    footballDailyLimit: 100,
    footballLastReset: new Date().toISOString().slice(0, 10),
    oddsMonthlyUsed: 0,
    oddsMonthlyLimit: 500,
    oddsLastReset: new Date().toISOString().slice(0, 7),
    updatedAt: null
  };
}

function addActivityLog(message, type = 'info') {
  const logPath = path.join(LOGS_DIR, 'activity.json');
  const logs = readJSON(logPath) || [];
  logs.unshift({
    timestamp: new Date().toISOString(),
    type,
    message
  });
  if (logs.length > 200) logs.splice(200);
  writeJSON(logPath, logs);
}

function getActivityLogs(limit = 50) {
  const logPath = path.join(LOGS_DIR, 'activity.json');
  const logs = readJSON(logPath) || [];
  return logs.slice(0, limit);
}

function saveSettings(settings) {
  const filePath = path.join(DATA_DIR, 'settings.json');
  writeJSON(filePath, settings);
}

function loadSettings() {
  const filePath = path.join(DATA_DIR, 'settings.json');
  return readJSON(filePath) || {};
}

module.exports = {
  saveTickets,
  loadTickets,
  saveReport,
  loadReport,
  getLatestDate,
  getAllDates,
  saveApiUsage,
  loadApiUsage,
  addActivityLog,
  getActivityLogs,
  saveSettings,
  loadSettings
};
