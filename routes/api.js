const express = require('express');
const axios = require('axios');
const db = require('../db');
const { getFrontendTranslations } = require('../i18n');
const { sanitize } = require('../utils/sanitize');
const { validateInitData } = require('../utils/telegram');
const { TELEGRAM_API, ALLOWED_LANGS, ONLINE_TIMEOUT } = require('../config');

const router = express.Router();
const lastSeen = new Map();

// --- Translations ---
router.get('/translations', (req, res) => {
    const lang = req.query.lang || 'ru';
    const safeLang = ALLOWED_LANGS.includes(lang) ? lang : 'ru';
    res.json(getFrontendTranslations(safeLang));
});

// --- Heartbeat ---
router.post('/heartbeat', (req, res) => {
    const { identifier } = req.body;
    if (identifier && typeof identifier === 'string') {
        lastSeen.set(identifier, Date.now());
    }
    res.sendStatus(200);
});

// --- Stats ---
router.get('/stats', async (req, res) => {
    const now = Date.now();
    const totalUsers = await db.getTotalUsers();
    let online = 0;
    for (const last of lastSeen.values()) {
        if (now - last < ONLINE_TIMEOUT) online++;
    }
    res.json({ totalUsers, online });
});

// --- Rating ---
router.get('/rating', async (req, res) => {
    const rating = await db.getRating(100);
    const safe = rating.map(r => ({
        chat_id: r.chat_id,
        name: sanitize(r.name),
        description: sanitize(r.description),
        assets: sanitize(r.assets),
        amount: r.amount
    }));
    res.json(safe);
});

// --- Create invoice ---
router.post('/create-invoice', async (req, res) => {
    const { name, description, assets, amount, initData } = req.body;

    const tgUser = validateInitData(initData);
    if (!tgUser) {
        return res.status(403).json({ error: 'Invalid Telegram authorization' });
    }

    const chatId = tgUser.id ? tgUser.id.toString() : null;
    if (!chatId || !name || !description || !amount) {
        return res.status(400).json({ error: 'Missing data' });
    }

    // Store raw data — sanitization happens only on output (GET /rating)
    const safeName = String(name).slice(0, 100);
    const safeDesc = String(description).slice(0, 200);
    const safeAssets = String(assets || '').slice(0, 500);

    const starsAmount = parseInt(amount);
    if (!Number.isFinite(starsAmount) || starsAmount < 1 || starsAmount > 1000000) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    await db.savePending(chatId, safeName, safeDesc, safeAssets);

    try {
        const response = await axios.post(`${TELEGRAM_API}/createInvoiceLink`, {
            title: 'Forbes TG — Top Spot',
            description: `${safeName} — ${safeDesc}`,
            payload: JSON.stringify({ chatId }),
            currency: 'XTR',
            prices: [{ label: 'Participation', amount: starsAmount }],
            start_parameter: 'forbes'
        });

        if (response.data.ok) {
            res.json({ invoiceLink: response.data.result });
        } else {
            throw new Error(response.data.description);
        }
    } catch (error) {
        console.error('[CREATE-INVOICE] Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Payment creation failed' });
    }
});

module.exports = router;
