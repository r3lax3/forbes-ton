const db = require('../db');
const { t } = require('../i18n');
const { sendMessage } = require('../utils/telegram');
const { ADMIN_IDS } = require('../config');

const broadcastState = new Map();

function isAdmin(chatId) {
    return ADMIN_IDS.includes(String(chatId));
}

function getBroadcastState(chatId) {
    return broadcastState.get(String(chatId));
}

async function handleAdminCommand(chatId) {
    const lang = await db.getUserLang(String(chatId));
    const keyboard = {
        inline_keyboard: [
            [{ text: t(lang, 'btnStats'), callback_data: 'admin_stats' }],
            [{ text: t(lang, 'btnBroadcast'), callback_data: 'admin_broadcast' }]
        ]
    };
    await sendMessage(chatId, t(lang, 'adminPanel'), {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

async function handleAdminCallback(chatId, action) {
    if (action === 'admin_stats') {
        const lang = await db.getUserLang(String(chatId));
        const stats = await db.getAdminStats();
        const text = t(lang, 'adminStats', {
            total: stats.total,
            dead: stats.dead,
            payers: stats.payers,
            totalStars: stats.totalStars
        });
        await sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } else if (action === 'admin_broadcast') {
        broadcastState.set(String(chatId), 'awaiting_broadcast');
        const lang = await db.getUserLang(String(chatId));
        await sendMessage(chatId, t(lang, 'broadcastPrompt'));
    }
}

async function handleCancel(chatId) {
    broadcastState.delete(String(chatId));
    const lang = await db.getUserLang(String(chatId));
    await sendMessage(chatId, t(lang, 'broadcastCancelled'));
}

async function handleBroadcastText(chatId, text) {
    broadcastState.delete(String(chatId));

    const allUsers = await db.getAllUsers();
    let sent = 0;
    let failed = 0;

    for (const user of allUsers) {
        try {
            await sendMessage(user.chat_id, text, { parse_mode: 'Markdown' });
            sent++;
        } catch (e) {
            failed++;
        }
        if ((sent + failed) % 25 === 0) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    const lang = await db.getUserLang(String(chatId));
    await sendMessage(chatId, t(lang, 'broadcastDone', { sent, failed }));
}

module.exports = {
    isAdmin,
    getBroadcastState,
    handleAdminCommand,
    handleAdminCallback,
    handleCancel,
    handleBroadcastText
};
