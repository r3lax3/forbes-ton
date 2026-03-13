const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { PENDING_MAX_AGE } = require('./config');

async function openDb() {
    return open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });
}

async function initDb() {
    const db = await openDb();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            chat_id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            description TEXT DEFAULT '',
            assets TEXT DEFAULT '',
            amount INTEGER NOT NULL DEFAULT 0,
            lang TEXT NOT NULL DEFAULT 'ru',
            last_active INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS pending_invoices (
            chat_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            assets TEXT DEFAULT '',
            created_at INTEGER NOT NULL
        )
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS rank_snapshots (
            chat_id TEXT PRIMARY KEY,
            position INTEGER NOT NULL
        )
    `);
    // Clean up stale pending invoices (older than 24h)
    const cutoff = Date.now() - PENDING_MAX_AGE;
    await db.run('DELETE FROM pending_invoices WHERE created_at < ?', cutoff);
    await db.close();
}

// --- User management ---

async function upsertUser(chatId, lang) {
    const db = await openDb();
    const now = Date.now();
    await db.run(
        `INSERT INTO users (chat_id, lang, last_active, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET last_active = ?`,
        [chatId, lang || 'ru', now, now, now]
    );
    await db.close();
}

async function setUserLang(chatId, lang) {
    const db = await openDb();
    await db.run('UPDATE users SET lang = ? WHERE chat_id = ?', [lang, chatId]);
    await db.close();
}

async function getUserLang(chatId) {
    const db = await openDb();
    const row = await db.get('SELECT lang FROM users WHERE chat_id = ?', chatId);
    await db.close();
    return row ? row.lang : 'ru';
}

// --- Rating ---

async function getRating(limit = 100) {
    const db = await openDb();
    const rows = await db.all(
        `SELECT chat_id, name, description, assets, amount
         FROM users
         WHERE amount > 0
         ORDER BY amount DESC
         LIMIT ?`,
        limit
    );
    await db.close();
    return rows;
}

async function addStars(chatId, name, description, assets, amountToAdd) {
    const db = await openDb();
    const now = Date.now();
    await db.run(
        `INSERT INTO users (chat_id, name, description, assets, amount, last_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
             amount = amount + ?,
             name = ?,
             description = ?,
             assets = ?,
             last_active = ?`,
        [chatId, name, description || '', assets || '', amountToAdd, now, now,
         amountToAdd, name, description || '', assets || '', now]
    );
    await db.close();
}

// --- Pending invoices ---

async function savePending(chatId, name, description, assets) {
    const db = await openDb();
    await db.run(
        `INSERT INTO pending_invoices (chat_id, name, description, assets, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
             name = ?, description = ?, assets = ?, created_at = ?`,
        [chatId, name, description || '', assets || '', Date.now(),
         name, description || '', assets || '', Date.now()]
    );
    await db.close();
}

async function getPending(chatId) {
    const db = await openDb();
    const row = await db.get('SELECT * FROM pending_invoices WHERE chat_id = ?', chatId);
    await db.close();
    return row || null;
}

async function deletePending(chatId) {
    const db = await openDb();
    await db.run('DELETE FROM pending_invoices WHERE chat_id = ?', chatId);
    await db.close();
}

// --- Rank snapshots ---

async function getRankSnapshot() {
    const db = await openDb();
    const rows = await db.all('SELECT chat_id, position FROM rank_snapshots');
    await db.close();
    const snapshot = {};
    rows.forEach(r => { snapshot[r.chat_id] = r.position; });
    return snapshot;
}

async function saveRankSnapshot(positions) {
    const db = await openDb();
    await db.run('DELETE FROM rank_snapshots');
    for (const [chatId, position] of Object.entries(positions)) {
        await db.run(
            'INSERT INTO rank_snapshots (chat_id, position) VALUES (?, ?)',
            [chatId, position]
        );
    }
    await db.close();
}

// --- Stats ---

async function getTotalUsers() {
    const db = await openDb();
    const result = await db.get('SELECT COUNT(*) as cnt FROM users');
    await db.close();
    return result.cnt;
}

async function getAdminStats() {
    const db = await openDb();
    const total = await db.get('SELECT COUNT(*) as cnt FROM users');
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dead = await db.get('SELECT COUNT(*) as cnt FROM users WHERE last_active < ?', thirtyDaysAgo);
    const payers = await db.get('SELECT COUNT(*) as cnt FROM users WHERE amount > 0');
    const totalStars = await db.get('SELECT COALESCE(SUM(amount), 0) as total FROM users');
    await db.close();
    return {
        total: total.cnt,
        dead: dead.cnt,
        payers: payers.cnt,
        totalStars: totalStars.total
    };
}

async function getAllUsers() {
    const db = await openDb();
    const rows = await db.all('SELECT chat_id, lang FROM users');
    await db.close();
    return rows;
}

module.exports = {
    initDb,
    upsertUser,
    setUserLang,
    getUserLang,
    getRating,
    addStars,
    savePending,
    getPending,
    deletePending,
    getRankSnapshot,
    saveRankSnapshot,
    getTotalUsers,
    getAdminStats,
    getAllUsers
};
