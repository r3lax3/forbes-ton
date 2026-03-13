const axios = require('axios');
const db = require('../db');
const { t } = require('../i18n');
const { sendMessage } = require('../utils/telegram');
const { TELEGRAM_API } = require('../config');
const { handleStart, handleLangCallback } = require('../bot/commands');
const { isAdmin, getBroadcastState, handleAdminCommand, handleAdminCallback, handleCancel, handleBroadcastText } = require('../bot/admin');

async function notifyPositionDrop(chatId, oldPos, newPos) {
    const lang = await db.getUserLang(chatId);
    const message = t(lang, 'positionDrop', { old: oldPos, new: newPos });

    try {
        await sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(`[NOTIFY] Error sending to ${chatId}:`, e.message);
    }
}

async function webhookHandler(req, res) {
    const update = req.body;

    try {
        // Callback queries (language selection, admin panel)
        if (update.callback_query) {
            const cb = update.callback_query;
            const chatId = cb.message.chat.id;
            const data = cb.data;

            await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
                callback_query_id: cb.id
            }).catch(() => {});

            if (data.startsWith('lang_')) {
                await handleLangCallback(chatId, data);
            }

            if (isAdmin(chatId)) {
                if (data === 'admin_stats' || data === 'admin_broadcast') {
                    await handleAdminCallback(chatId, data);
                }
            }
        }

        // Messages
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || '';

            await db.upsertUser(String(chatId), 'ru');

            if (text === '/start') {
                await handleStart(chatId);
            } else if (text === '/admin' && isAdmin(chatId)) {
                await handleAdminCommand(chatId);
            } else if (text === '/cancel' && getBroadcastState(chatId) === 'awaiting_broadcast') {
                await handleCancel(chatId);
            } else if (getBroadcastState(chatId) === 'awaiting_broadcast' && isAdmin(chatId)) {
                handleBroadcastText(chatId, text).catch(e => console.error('[BROADCAST] Error:', e));
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
            const chatId = payload.chatId;
            const amountStars = payment.total_amount;

            const userData = await db.getPending(chatId);
            if (!userData) {
                console.error(`[WEBHOOK] No pending data for chatId ${chatId}`);
                return res.sendStatus(200);
            }

            const { name, description, assets } = userData;

            // Get old positions before update
            const oldRating = await db.getRating(100);
            const oldPositions = {};
            oldRating.forEach((u, index) => { oldPositions[u.chat_id] = index + 1; });

            // Add stars to this user
            await db.addStars(chatId, name, description, assets, amountStars);

            // Get new positions after update
            const newRating = await db.getRating(100);
            const newPositions = {};
            newRating.forEach((u, index) => { newPositions[u.chat_id] = index + 1; });

            // Notify users who dropped
            for (const [id, oldPos] of Object.entries(oldPositions)) {
                const newPos = newPositions[id];
                if (newPos && newPos > oldPos) {
                    notifyPositionDrop(id, oldPos, newPos).catch(e =>
                        console.error(`[NOTIFY] Error for ${id}:`, e.message)
                    );
                }
            }

            // Save rank snapshot for startup check
            await db.saveRankSnapshot(newPositions);

            console.log(`[WEBHOOK] Payment: ${amountStars} stars from ${name} (${chatId})`);
            await db.deletePending(chatId);
        }
    } catch (err) {
        console.error('[WEBHOOK] Error:', err.message);
    }

    res.sendStatus(200);
}

module.exports = webhookHandler;
