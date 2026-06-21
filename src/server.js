// Fonction pour construire les instructions selon le sport
function buildPrompt(sport, date, pdfTexts, notes) {
  let prompt = `Tu es un expert en analyse de paris sportifs. Date d'analyse : ${date}.\n`;
  prompt += `Analyse toutes les images et donnees fournies. Utilise uniquement les cotes visibles, ne les invente pas.\n\n`;

  if (sport === 'basketball') {
    prompt += `MARCHES AUTORISES UNIQUEMENT (NBA/Basket) :\n`;
    prompt += `- Over/Under (Plus/Moins) total de points pour le match\n`;
    prompt += `- Over/Under points par equipe\n`;
    prompt += `GENERE EXACTEMENT 5 TICKETS bases sur ces marches.\n`;
  } else if (sport === 'baseball') {
    prompt += `MARCHES AUTORISES UNIQUEMENT (MLB/Baseball) :\n`;
    prompt += `- Lanceur : Strikeouts (Retraits au baton)\n`;
    prompt += `- Joueur : Coups surs (Hits)\n`;
    prompt += `- Joueur : Points (Runs)\n`;
    prompt += `- Joueur : RBIs (Points produits)\n`;
    prompt += `- Joueur : Total Coups surs + Points + RBIs\n`;
    prompt += `GENERE EXACTEMENT 5 TICKETS bases sur les performances des joueurs et lanceurs.\n`;
  } else {
    prompt += `MARCHES AUTORISES UNIQUEMENT (Football) :\n`;
    prompt += `- BTTS Oui (les deux equipes marquent)\n`;
    prompt += `- Plus de 2.5 buts\n`;
    prompt += `- Plus de 1.5 buts equipe domicile\n`;
    prompt += `GENERE EXACTEMENT 5 TICKETS (Ticket 1 et 2 : BTTS, Ticket 3 : +2.5 buts, Ticket 4 : +1.5 buts domicile, Ticket 5 : Mix).\n`;
  }

  if (pdfTexts) prompt += `\nCONTENU DES PDFs :\n${pdfTexts}`;
  if (notes) prompt += `\nNOTES SUPPLEMENTAIRES :\n${notes}`;

  prompt += `\n\nReponds UNIQUEMENT avec un JSON valide, sans markdown. Format strict :
{
  "date": "${date}",
  "generatedAt": "${new Date().toISOString()}",
  "source": "manuel",
  "tickets": [
    {
      "id": 1,
      "type": "Nom du marche",
      "raisonnement": "Explication globale du ticket",
      "picks": [
        {
          "match": "Equipe A vs Equipe B",
          "league": "Nom championnat",
          "market": "Nom du marche",
          "odds": 1.50,
          "justification": "Raison specifique"
        }
      ]
    }
  ]
}`;

  return prompt;
}

// ---- Route analyse manuelle avec images et PDFs ----
app.post('/api/analyze-manual', upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  const { date, notes, sport = 'football' } = req.body;

  if (!date) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Date requise' });
  }

  const settings = storage.loadSettings();
  const apiAnthropic = settings.anthropicKey || process.env.ANTHROPIC_API_KEY;
  if (!apiAnthropic) {
    cleanupFiles(files);
    return res.status(400).json({ error: 'Cle Anthropic manquante' });
  }

  res.json({ message: 'Analyse manuelle lancee en arriere-plan', date });

  (async () => {
    try {
      storage.addActivityLog(`Analyse manuelle (${sport}) avec ${files.length} fichier(s) pour ${date}`, 'info');

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
          
          // Fallback base sur l'extension si le mimetype est absent ou invalide
          if (!mimeType || !mimeType.startsWith('image/')) {
            if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.webp') mimeType = 'image/webp';
            else if (ext === '.gif') mimeType = 'image/gif';
            else mimeType = 'image/jpeg'; // Valeur par defaut de securite
          }

          // Validation finale: Anthropic n'accepte QUE ces 4 formats
          const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
          if (validMimeTypes.includes(mimeType)) {
             messageContent.push({
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 }
            });
          } else {
             storage.addActivityLog(`Fichier ignore : format non supporte (${mimeType}) pour ${file.originalname}`, 'warn');
          }
        }
      }

      // Appel de la fonction pour generer les instructions en fonction du sport
      const textPrompt = buildPrompt(sport, date, pdfTexts, notes);
      messageContent.push({ type: 'text', text: textPrompt });

      // Verification avant l'appel a l'API pour eviter d'envoyer une requete vide
      if (messageContent.length === 1) {
          throw new Error("Aucune image valide ou texte PDF n'a pu etre extrait des fichiers fournis.");
      }

      const client = new Anthropic({ apiKey: apiAnthropic });
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', 
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
      storage.addActivityLog(`5 tickets (${sport}) generes depuis fichiers manuels pour ${date}`, 'success');
    } catch (e) {
      storage.addActivityLog(`Erreur analyse manuelle: ${e.message}`, 'error');
    } finally {
      cleanupFiles(files);
    }
  })();
});