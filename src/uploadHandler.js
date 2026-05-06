'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporte: ' + file.mimetype));
    }
  }
});

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf'
  };
  return types[ext] || 'application/octet-stream';
}

function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

function extractTextFromPDF(filePath) {
  return '[PDF: ' + path.basename(filePath) + ']';
}

function cleanupFiles(files) {
  if (!files) return;
  const list = Array.isArray(files) ? files : [files];
  list.forEach(f => {
    const p = f.path || f;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      console.error('Erreur suppression fichier:', p, e.message);
    }
  });
}

module.exports = { upload, extractTextFromPDF, fileToBase64, getMimeType, cleanupFiles };
