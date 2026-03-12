const db = require('../db');
const { t } = require('../i18n');
const { sendMessage } = require('../utils/telegram');
const { APP_URL, ALLOWED_LANGS } = require('../config');

async function handleStart(chatId) {
    const langKeyboard = {
        inline_keyboard: [
            [
                { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
                { text: '🇬🇧 English', callback_data: 'lang_en' },
                { text: '🇨🇳 中文', callback_data: 'lang_zh' }
            ]
        ]
    };
    await sendMessage(chatId, '🌐 Choose your language / Выберите язык / 选择语言:', {
        reply_markup: langKeyboard
    });
}

async function handleLangCallback(chatId, data) {
    const lang = data.replace('lang_', '');
    if (!ALLOWED_LANGS.includes(lang)) return;

    await db.setUserLang(String(chatId), lang);

    await sendMessage(chatId, t(lang, 'langSet'));

    const keyboard = {
        inline_keyboard: [
            [{ text: t(lang, 'openApp'), web_app: { url: APP_URL } }]
        ]
    };
    await sendMessage(chatId, t(lang, 'welcome'), {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

module.exports = { handleStart, handleLangCallback };
