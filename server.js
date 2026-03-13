require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const db = require('./db');
const { t } = require('./i18n');
const { sendMessage } = require('./utils/telegram');
const apiRoutes = require('./routes/api');
const webhookHandler = require('./routes/webhook');
const { PORT, APP_URL, TELEGRAM_API } = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.post('/webhook', webhookHandler);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function setupWebhook() {
    const webhookUrl = `${APP_URL}/webhook`;
    try {
        // Delete old webhook and drop pending updates
        await axios.post(`${TELEGRAM_API}/deleteWebhook`, {
            drop_pending_updates: true
        });
        console.log('Old webhook deleted, pending updates dropped');

        // Set new webhook
        const res = await axios.post(`${TELEGRAM_API}/setWebhook`, {
            url: webhookUrl,
            drop_pending_updates: true
        });
        if (res.data.ok) {
            console.log(`Webhook set: ${webhookUrl}`);
        } else {
            console.error('Failed to set webhook:', res.data.description);
        }
    } catch (e) {
        console.error('Webhook setup error:', e.message);
    }
}

async function checkRankChanges() {
    try {
        const oldPositions = await db.getRankSnapshot();
        const currentRating = await db.getRating(100);
        const newPositions = {};
        currentRating.forEach((u, index) => { newPositions[u.chat_id] = index + 1; });

        // Only check if we have a previous snapshot
        if (Object.keys(oldPositions).length > 0) {
            for (const [id, oldPos] of Object.entries(oldPositions)) {
                const newPos = newPositions[id];
                if (newPos && newPos > oldPos) {
                    const lang = await db.getUserLang(id);
                    const message = t(lang, 'positionDrop', { old: oldPos, new: newPos });
                    try {
                        await sendMessage(id, message, { parse_mode: 'Markdown' });
                        console.log(`[STARTUP-NOTIFY] Notified ${id}: ${oldPos} -> ${newPos}`);
                    } catch (e) {
                        console.error(`[STARTUP-NOTIFY] Error sending to ${id}:`, e.message);
                    }
                }
            }
        }

        // Save current snapshot
        await db.saveRankSnapshot(newPositions);
        console.log(`[STARTUP] Rank snapshot saved (${Object.keys(newPositions).length} users)`);
    } catch (e) {
        console.error('[STARTUP] Rank check error:', e.message);
    }
}

db.initDb().then(async () => {
    console.log('Database initialized');
    await checkRankChanges();
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        await setupWebhook();
    });
});
