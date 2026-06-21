// ---- Route analyse manuelle avec images et PDFs ----
app.post('/api/analyze-manual', upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  const { date, notes } = req.body;

  if (!date) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Date requise' });
  }

  const settings = storage.loadSettings();
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiAnthropic) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Clé Anthropic manquante' });
  }

  res.json({ message: 'Analyse manuelle lancée en arrière-plan', date });

  (async () => {
    try {
      storage.addActivityLog(`Analyse manuelle avec ${files.length} fichier(s) pour ${date}`, 'info');

      const messageContent = [];
      let pdfTexts = '';

      for (const file of files) {
        const ext = path.extname(file.path).toLowerCase();
        
        if (ext === '.pdf') {
          const text = await extractTextFromPDF(file.path);
          pdfTexts += `\n--- PDF: ${file.originalname} ---\n${text}\n`;
        } else {
          const base64 = fileToBase64(file.path);
          // Normalisation stricte du type MIME pour Anthropic
          let mimeType = file.mimetype || getMimeType(file.originalname);
          
          // Fallback basé sur l'extension si le mimetype est absent ou invalide
          if (!mimeType || !mimeType.startsWith('image/')) {
            if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.webp') mimeType = 'image/webp';
            else if (ext === '.gif') mimeType = 'image/gif';
            else mimeType = 'image/jpeg'; // Valeur par défaut de sécurité
          }

          // Validation finale: Anthropic n'accepte QUE ces 4 formats
          const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
          if (validMimeTypes.includes(mimeType)) {
             messageContent.push({
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 }
            });
          } else {
             storage.addActivityLog(`Fichier ignoré : format non supporté (${mimeType}) pour ${file.originalname}`, 'warn');
          }
        }
      }

      let textPrompt = `Tu es un expert en analyse de paris sportifs football. Date d'analyse : ${date}.

Tu as reçu des captures d'écran et/ou des PDFs contenant des matchs, des cotes et des statistiques de football.

INSTRUCTIONS :
1. Analyse TOUTES les images et données fournies
2. Extrais les matchs avec leurs équipes et les cotes disponibles
3. Utilise UNIQUEMENT les cotes que tu vois dans les images, ne les invente pas
4. Si tu vois des classements ou statistiques, utilise-les pour ta justification

MARCHÉS AUTORISÉS UNIQUEMENT - AUCUN AUTRE MARCHÉ :
- "BTTS Oui" : les deux équipes marquent (cote entre 1.30 et 2.20 max)
- "Plus de 2.5 buts" : total buts supérieur à 2.5 (cote entre 1.40 et 2.50 max)
- "Plus de 1.5 buts équipe domicile" : équipe domicile marque plus de 1.5 buts (cote entre 1.25 et 2.00 max)

MARCHÉS INTERDITS : victoire équipe, match nul, 1, X, 2, double chance, tout autre marché

GÉNÈRE EXACTEMENT 5 TICKETS :
- Ticket 1 "BTTS" : 4 à 6 matchs, UNIQUEMENT "BTTS Oui"
- Ticket 2 "BTTS" : 4 à 6 matchs DIFFÉRENTS du ticket 1, UNIQUEMENT "BTTS Oui"
- Ticket 3 "Plus de 2.5 buts" : 4 à 6 matchs, UNIQUEMENT "Plus de 2.5 buts"
- Ticket 4 "Plus de 1.5 buts domicile" : 4 à 6 matchs, UNIQUEMENT "Plus de 1.5 buts équipe domicile"
- Ticket 5 "Mix" : 4 à 6 matchs, mix "BTTS Oui" et "Plus de 1.5 buts équipe domicile" uniquement

Évite au maximum de répéter les mêmes matchs entre tickets.`;

      if (pdfTexts) {
        textPrompt += `\n\nCONTENU DES PDFs :\n${pdfTexts}`;
      }

      if (notes) {
        textPrompt += `\n\nNOTES SUPPLÉMENTAIRES :\n${notes}`;
      }

      textPrompt += `\n\nRéponds UNIQUEMENT avec JSON valide, sans markdown :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "source": "manuel",
  "tickets": [
    {
      "id": 1,
      "type": "BTTS",
      "raisonnement": "Explication courte",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "BTTS Oui",
          "odds": 1.45,
          "justification": "Raison courte"
        }
      ]
    }
  ]
}`;

      messageContent.push({ type: 'text', text: textPrompt });

      // Vérification avant l'appel à l'API pour éviter d'envoyer une requête vide
      if (messageContent.length === 1) {
          throw new Error("Aucune image valide ou texte PDF n'a pu être extrait des fichiers fournis.");
      }

      const client = new Anthropic({ apiKey: apiAnthropic });
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', // On conserve le modèle que tu as configuré
        max_tokens: 8000,
        messages: [{ role: 'user', content: messageContent }]
      });

      const rawText = message.content[0].text;
      let jsonText = rawText.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(jsonText);
      if (parsed.tickets) {
        parsed.tickets = parsed.tickets.map(ticket => {
          const totalOdds = Math.round(
            (ticket.picks || []).reduce((acc, p) => acc * (parseFloat(p.odds) || 1), 1) * 100
          ) / 100;
          return { ...ticket, totalOdds };
        });
      }

      storage.saveTickets(date, parsed);
      storage.addActivityLog(`5 tickets générés depuis fichiers manuels pour ${date}`, 'success');
    } catch (e) {
      storage.addActivityLog(`Erreur analyse manuelle: ${e.message}`, 'error');
    } finally {
      cleanupFiles(files);
    }
  })();
});