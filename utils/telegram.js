const crypto = require('crypto');
const axios = require('axios');
const { BOT_TOKEN, TELEGRAM_API } = require('../config');

function validateInitData(initData) {
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

        const authDate = parseInt(params.get('auth_date') || '0', 10);
        if (Date.now() / 1000 - authDate > 86400) return null;

        const userStr = params.get('user');
        if (userStr) return JSON.parse(userStr);
        return {};
    } catch (e) {
        return null;
    }
}

async function sendMessage(chatId, text, opts = {}) {
    return axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text,
        ...opts
    });
}

module.exports = { validateInitData, sendMessage };
