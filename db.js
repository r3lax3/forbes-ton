const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function openDb() {
    return open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });
}

async function initDb() {
    const db = await openDb();

    // Rating users (people who paid stars)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            identifier TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            assets TEXT,
            amount INTEGER NOT NULL DEFAULT 0
        )
    `);

    // Bot users (everyone who started the bot)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS bot_users (
            chat_id TEXT PRIMARY KEY,
            lang TEXT NOT NULL DEFAULT 'ru',
            last_active INTEGER NOT NULL DEFAULT 0,
            total_stars_sent INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0
        )
    `);

    await db.close();
}

// --- Rating users ---

async function getRating(limit = 100) {
    const db = await openDb();
    const rows = await db.all(
        `SELECT identifier, name, description, assets, amount
         FROM users
         ORDER BY amount DESC
         LIMIT ?`,
        limit
    );
    await db.close();
    return rows;
}

async function addOrUpdateUser(identifier, name, description, assets, amountToAdd) {
    const db = await openDb();
    const existing = await db.get('SELECT * FROM users WHERE identifier = ?', identifier);
    if (existing) {
        await db.run(
            `UPDATE users
             SET amount = amount + ?,
                 name = ?,
                 description = ?,
                 assets = ?
             WHERE identifier = ?`,
            [amountToAdd, name, description || '', assets || '', identifier]
        );
    } else {
        await db.run(
            `INSERT INTO users (identifier, name, description, assets, amount) VALUES (?, ?, ?, ?, ?)`,
            [identifier, name, description || '', assets || '', amountToAdd]
        );
    }
    await db.close();
}

async function getTotalRatingUsers() {
    const db = await openDb();
    const result = await db.get('SELECT COUNT(*) as cnt FROM users');
    await db.close();
    return result.cnt;
}

// --- Bot users ---

async function upsertBotUser(chatId, lang) {
    const db = await openDb();
    const now = Date.now();
    await db.run(
        `INSERT INTO bot_users (chat_id, lang, last_active, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET last_active = ?`,
        [chatId, lang || 'ru', now, now, now]
    );
    await db.close();
}

async function setBotUserLang(chatId, lang) {
    const db = await openDb();
    await db.run(
        `UPDATE bot_users SET lang = ? WHERE chat_id = ?`,
        [lang, chatId]
    );
    await db.close();
}

async function getBotUserLang(chatId) {
    const db = await openDb();
    const row = await db.get('SELECT lang FROM bot_users WHERE chat_id = ?', chatId);
    await db.close();
    return row ? row.lang : 'ru';
}

async function updateBotUserStars(chatId, starsAmount) {
    const db = await openDb();
    const now = Date.now();
    await db.run(
        `UPDATE bot_users SET total_stars_sent = total_stars_sent + ?, last_active = ? WHERE chat_id = ?`,
        [starsAmount, now, chatId]
    );
    await db.close();
}

async function getAllBotUserChatIds() {
    const db = await openDb();
    const rows = await db.all('SELECT chat_id, lang FROM bot_users');
    await db.close();
    return rows;
}

async function getAdminStats() {
    const db = await openDb();
    const total = await db.get('SELECT COUNT(*) as cnt FROM bot_users');
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dead = await db.get('SELECT COUNT(*) as cnt FROM bot_users WHERE last_active < ?', thirtyDaysAgo);
    const payers = await db.get('SELECT COUNT(*) as cnt FROM bot_users WHERE total_stars_sent > 0');
    const totalStars = await db.get('SELECT COALESCE(SUM(total_stars_sent), 0) as total FROM bot_users');
    await db.close();
    return {
        total: total.cnt,
        dead: dead.cnt,
        payers: payers.cnt,
        totalStars: totalStars.total
    };
}

async function getTotalBotUsers() {
    const db = await openDb();
    const result = await db.get('SELECT COUNT(*) as cnt FROM bot_users');
    await db.close();
    return result.cnt;
}

module.exports = {
    initDb,
    getRating,
    addOrUpdateUser,
    getTotalRatingUsers,
    upsertBotUser,
    setBotUserLang,
    getBotUserLang,
    updateBotUserStars,
    getAllBotUserChatIds,
    getAdminStats,
    getTotalBotUsers
};
