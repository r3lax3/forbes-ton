const BOT_TOKEN = process.env.BOT_TOKEN;

module.exports = {
    BOT_TOKEN,
    ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    APP_URL: process.env.APP_URL || 'https://forbes-ton.onrender.com',
    PORT: process.env.PORT || 3000,
    ALLOWED_LANGS: ['ru', 'en', 'zh'],
    TELEGRAM_API: `https://api.telegram.org/bot${BOT_TOKEN}`,
    ONLINE_TIMEOUT: 5 * 60 * 1000,
    HEARTBEAT_INTERVAL: 120000,
    PENDING_MAX_AGE: 24 * 60 * 60 * 1000,
};
