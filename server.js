require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const db = require('./db');
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

db.initDb().then(async () => {
    console.log('Database initialized');
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        await setupWebhook();
    });
});
