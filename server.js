const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const db = require('./db');
const { t, getFrontendTranslations } = require('./i18n');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APP_URL = process.env.APP_URL || 'https://forbes-ton.onrender.com';

const pendingData = {};
const lastSeen = new Map();
const userChats = new Map(); // identifier -> chatId
const broadcastState = new Map(); // chatId -> 'awaiting_broadcast'

const app = express();
app.use(express.json());

// --- Telegram initData validation ---
function validateTelegramInitData(initData) {
    if (!BOT_TOKEN || !initData) return null;
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) return null;

        params.delete('hash');
        const entries = [...params.entries()];
        entries.sort((a, b) => a[0].localeCompare(b[0]));
        const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (computedHash !== hash) return null;

        // Check auth_date is not too old (allow 24 hours)
        const authDate = parseInt(params.get('auth_date') || '0', 10);
        if (Date.now() / 1000 - authDate > 86400) return null;

        const userStr = params.get('user');
        if (userStr) {
            return JSON.parse(userStr);
        }
        return {};
    } catch (e) {
        return null;
    }
}

// --- Serve static files but protect index.html ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API: translations ---
app.get('/api/translations', (req, res) => {
    const lang = req.query.lang || 'ru';
    const allowed = ['ru', 'en', 'zh'];
    const safeLang = allowed.includes(lang) ? lang : 'ru';
    res.json(getFrontendTranslations(safeLang));
});

// --- API: heartbeat ---
app.post('/api/heartbeat', (req, res) => {
    const { identifier, chatId } = req.body;
    if (identifier && typeof identifier === 'string') {
        lastSeen.set(identifier, Date.now());
        if (chatId && typeof chatId === 'string') {
            userChats.set(identifier, chatId);
        }
    }
    res.sendStatus(200);
});

// --- API: stats ---
app.get('/api/stats', async (req, res) => {
    const now = Date.now();
    const onlineTimeout = 5 * 60 * 1000;
    const totalUsers = await db.getTotalBotUsers();
    let online = 0;
    for (const last of lastSeen.values()) {
        if (now - last < onlineTimeout) online++;
    }
    res.json({ totalUsers, online });
});

// --- API: rating ---
app.get('/api/rating', async (req, res) => {
    const rating = await db.getRating(100);
    // Sanitize output — strip any HTML from user-submitted fields
    const safe = rating.map(r => ({
        identifier: r.identifier,
        name: sanitize(r.name),
        description: sanitize(r.description),
        assets: sanitize(r.assets),
        amount: r.amount
    }));
    res.json(safe);
});

// --- API: create invoice ---
app.post('/api/create-invoice', async (req, res) => {
    const { name, description, assets, amount, identifier, chatId, initData } = req.body;

    // Validate initData from Telegram
    const tgUser = validateTelegramInitData(initData);
    if (!tgUser) {
        return res.status(403).json({ error: 'Invalid Telegram authorization' });
    }

    // Use Telegram user ID as the authoritative identifier
    const safeIdentifier = tgUser.id ? tgUser.id.toString() : identifier;

    if (!name || !description || !amount || !safeIdentifier) {
        return res.status(400).json({ error: 'Missing data' });
    }

    // Validate & sanitize inputs
    const safeName = sanitize(String(name)).slice(0, 100);
    const safeDesc = sanitize(String(description)).slice(0, 200);
    const safeAssets = sanitize(String(assets || '')).slice(0, 500);

    const starsAmount = parseInt(amount);
    if (!Number.isFinite(starsAmount) || starsAmount < 1 || starsAmount > 1000000) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    pendingData[safeIdentifier] = { name: safeName, description: safeDesc, assets: safeAssets };
    if (chatId) {
        userChats.set(safeIdentifier, String(chatId));
    }

    try {
        const response = await axios.post(`${TELEGRAM_API}/createInvoiceLink`, {
            title: 'Forbes TG — Top Spot',
            description: `Participant: ${safeName} — ${safeDesc}`,
            payload: JSON.stringify({ identifier: safeIdentifier }),
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

// --- HTML sanitization (prevent XSS) ---
function sanitize(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// --- Notify user about position drop ---
async function notifyPositionDrop(identifier, oldPos, newPos) {
    const chatId = userChats.get(identifier);
    if (!chatId) return;

    const lang = await db.getBotUserLang(chatId);
    const message = t(lang, 'positionDrop', { old: oldPos, new: newPos });

    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error(`[NOTIFY] Error sending to ${identifier}:`, e.message);
    }
}

// --- Admin helpers ---
function isAdmin(chatId) {
    return ADMIN_IDS.includes(String(chatId));
}

async function sendAdminPanel(chatId) {
    const lang = await db.getBotUserLang(String(chatId));
    const keyboard = {
        inline_keyboard: [
            [{ text: t(lang, 'btnStats'), callback_data: 'admin_stats' }],
            [{ text: t(lang, 'btnBroadcast'), callback_data: 'admin_broadcast' }]
        ]
    };
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: t(lang, 'adminPanel'),
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

async function sendAdminStats(chatId) {
    const lang = await db.getBotUserLang(String(chatId));
    const stats = await db.getAdminStats();
    const text = t(lang, 'adminStats', {
        total: stats.total,
        dead: stats.dead,
        payers: stats.payers,
        totalStars: stats.totalStars
    });
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
    });
}

async function performBroadcast(chatId, text) {
    const allUsers = await db.getAllBotUserChatIds();
    let sent = 0;
    let failed = 0;

    for (const user of allUsers) {
        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: user.chat_id,
                text,
                parse_mode: 'Markdown'
            });
            sent++;
        } catch (e) {
            failed++;
        }
        // Rate limit: 30 messages per second max
        if ((sent + failed) % 25 === 0) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const lang = await db.getBotUserLang(String(chatId));
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: t(lang, 'broadcastDone', { sent, failed })
    });
}

// --- Webhook ---
app.post('/webhook', async (req, res) => {
    const update = req.body;

    try {
        // Handle callback queries (admin panel buttons, language selection)
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const data = cb.data;

            // Answer callback to remove loading indicator
            await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
                callback_query_id: cb.id
            }).catch(() => {});

            // Language selection
            if (data.startsWith('lang_')) {
                const lang = data.replace('lang_', '');
                await db.setBotUserLang(String(chatId), lang);

                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: chatId,
                    text: t(lang, 'langSet')
                });

                // Send welcome with app button
                const keyboard = {
                    inline_keyboard: [
                        [{ text: t(lang, 'openApp'), web_app: { url: APP_URL } }]
                    ]
                };
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: chatId,
                    text: t(lang, 'welcome'),
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }

            // Admin actions
            if (isAdmin(chatId)) {
                if (data === 'admin_stats') {
                    await sendAdminStats(chatId);
                } else if (data === 'admin_broadcast') {
                    broadcastState.set(String(chatId), 'awaiting_broadcast');
                    const lang = await db.getBotUserLang(String(chatId));
                    await axios.post(`${TELEGRAM_API}/sendMessage`, {
                        chat_id: chatId,
                        text: t(lang, 'broadcastPrompt')
                    });
                }
            }
        }

        // Handle messages
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || '';

            // Register bot user
            await db.upsertBotUser(String(chatId), 'ru');

            if (text === '/start') {
                // Send language selection
                const langKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
                            { text: '🇬🇧 English', callback_data: 'lang_en' },
                            { text: '🇨🇳 中文', callback_data: 'lang_zh' }
                        ]
                    ]
                };
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: chatId,
                    text: t('ru', 'chooseLang'),
                    reply_markup: langKeyboard
                });
            } else if (text === '/admin' && isAdmin(chatId)) {
                await sendAdminPanel(chatId);
            } else if (text === '/cancel' && broadcastState.get(String(chatId)) === 'awaiting_broadcast') {
                broadcastState.delete(String(chatId));
                const lang = await db.getBotUserLang(String(chatId));
                await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: chatId,
                    text: t(lang, 'broadcastCancelled')
                });
            } else if (broadcastState.get(String(chatId)) === 'awaiting_broadcast' && isAdmin(chatId)) {
                broadcastState.delete(String(chatId));
                // Run broadcast in background
                performBroadcast(chatId, text).catch(e => console.error('[BROADCAST] Error:', e));
            }
        }

        // Pre-checkout
        if (update.pre_checkout_query) {
            await axios.post(`${TELEGRAM_API}/answerPreCheckoutQuery`, {
                pre_checkout_query_id: update.pre_checkout_query.id,
                ok: true
            });
        }

        // Successful payment
        if (update.message && update.message.successful_payment) {
            const payment = update.message.successful_payment;
            const payload = JSON.parse(payment.invoice_payload);
            const { identifier } = payload;
            const amountStars = payment.total_amount;
            const payerChatId = update.message.chat.id;

            const userData = pendingData[identifier];
            if (!userData) {
                console.error(`[WEBHOOK] No pending data for identifier ${identifier}`);
                return res.sendStatus(200);
            }

            const { name, description, assets } = userData;

            // Track stars in bot_users
            await db.updateBotUserStars(String(payerChatId), amountStars);

            // Save old positions
            const oldRating = await db.getRating(100);
            const oldPositions = {};
            oldRating.forEach((u, index) => { oldPositions[u.identifier] = index + 1; });

            // Update rating
            await db.addOrUpdateUser(identifier, name, description, assets, amountStars);

            // Check new positions and notify drops
            const newRating = await db.getRating(100);
            const newPositions = {};
            newRating.forEach((u, index) => { newPositions[u.identifier] = index + 1; });

            for (const [id] of userChats.entries()) {
                const oldPos = oldPositions[id];
                const newPos = newPositions[id];
                if (oldPos && newPos && newPos > oldPos) {
                    notifyPositionDrop(id, oldPos, newPos).catch(e =>
                        console.error(`[NOTIFY] Error for ${id}:`, e.message)
                    );
                }
            }

            console.log(`[WEBHOOK] Payment: ${amountStars} stars from ${name} (${identifier})`);
            delete pendingData[identifier];
        }
    } catch (err) {
        console.error('[WEBHOOK] Error:', err.message);
    }

    res.sendStatus(200);
});

// --- Init and start ---
db.initDb().then(() => {
    console.log('Database initialized');
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
