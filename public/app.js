// --- Telegram WebApp init & validation ---
const tg = window.Telegram && window.Telegram.WebApp;
let tgInitData = '';
let currentUserId = '';

if (!tg || !tg.initData) {
    // Not running inside Telegram — block access
    document.getElementById('accessDenied').style.display = 'flex';
    document.getElementById('accessDeniedText').textContent = 'This app is only available via Telegram.';
    // Stop all further execution
    throw new Error('Not in Telegram');
}

tg.ready();
tg.expand();
tgInitData = tg.initData;

if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    currentUserId = tg.initDataUnsafe.user.id.toString();
}

// Show main app
document.getElementById('mainApp').style.display = 'block';

const API_URL = '';
let currentUserInRating = null; // null if not in rating, or the user's data object

// --- Language ---
let currentLang = localStorage.getItem('forbes_lang') || 'ru';
let T = {}; // translations

async function loadTranslations(lang) {
    try {
        const res = await fetch(API_URL + '/api/translations?lang=' + encodeURIComponent(lang));
        T = await res.json();
    } catch (e) {
        T = {};
    }
}

function updateFormState() {
    if (currentUserInRating) {
        document.getElementById('formTitle').textContent = T.f_formTitleExisting || T.f_formTitle || '';
        document.getElementById('labelAmount').textContent = T.f_labelAmountExisting || T.f_labelAmount || '';
        document.getElementById('addBtn').textContent = T.f_btnSubmitExisting || T.f_btnSubmit || '';
    } else {
        document.getElementById('formTitle').textContent = T.f_formTitle || '';
        document.getElementById('labelAmount').textContent = T.f_labelAmount || '';
        document.getElementById('addBtn').textContent = T.f_btnSubmit || '';
    }
}

function applyTranslations() {
    document.getElementById('subtitleText').textContent = T.f_subtitle || '';
    document.getElementById('promoText').innerHTML = '<strong>' + escapeHtml(T.f_promo || '') + '</strong>';
    document.getElementById('promoStars').textContent = T.f_promoSub || '';
    document.getElementById('headerRank').textContent = T.f_headerRank || '#';
    document.getElementById('headerName').textContent = T.f_headerName || '';
    document.getElementById('headerChannels').textContent = T.f_headerChannels || '';
    document.getElementById('headerStars').textContent = T.f_headerStars || '';
    document.getElementById('participantsLabel').textContent = T.f_participants || '';
    document.getElementById('needForTop1Label').textContent = T.f_needForTop1 || '';
    document.getElementById('needForTop100Label').textContent = T.f_needForTop100 || '';
    document.getElementById('labelName').textContent = T.f_labelName || '';
    document.getElementById('labelDesc').textContent = T.f_labelDesc || '';
    document.getElementById('labelAssets').textContent = T.f_labelAssets || '';
    document.getElementById('nameInput').placeholder = T.f_placeholderName || '';
    document.getElementById('descInput').placeholder = T.f_placeholderDesc || '';
    document.getElementById('assetsInput').placeholder = T.f_placeholderAssets || '';
    document.getElementById('footerText').textContent = T.f_footer || '';

    // Update form title/button/amount label based on user's rating status
    updateFormState();

    // Update lang buttons
    document.querySelectorAll('.lang-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
}

// Language buttons
document.querySelectorAll('.lang-selector button').forEach(btn => {
    btn.addEventListener('click', async () => {
        currentLang = btn.dataset.lang;
        localStorage.setItem('forbes_lang', currentLang);
        await loadTranslations(currentLang);
        applyTranslations();
        sendHeartbeat(currentLang);
    });
});

// --- XSS protection ---
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// Safe URL linkifier — only allows https:// t.me links
function linkify(text) {
    if (!text) return '&mdash;';
    const escaped = escapeHtml(text);
    return escaped.replace(/(https:\/\/t\.me\/[a-zA-Z0-9_/]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function formatStars(amount) {
    return amount.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u2605';
}

// --- Heartbeat ---
async function sendHeartbeat(lang) {
    try {
        const payload = { identifier: currentUserId, chatId: currentUserId };
        if (lang) payload.lang = lang;
        const res = await fetch(API_URL + '/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.lang && data.lang !== currentLang) {
            currentLang = data.lang;
            localStorage.setItem('forbes_lang', currentLang);
            await loadTranslations(currentLang);
            applyTranslations();
        }
    } catch (e) {}
}
setInterval(sendHeartbeat, 120000);

// --- Load rating ---
async function loadRating() {
    try {
        const res = await fetch(API_URL + '/api/rating');
        const data = await res.json();
        const tbody = document.getElementById('rankRows');

        // All data is already server-sanitized, but we escape again on client
        tbody.innerHTML = data.map((item, i) => {
            const assetsHtml = linkify(item.assets || '');
            const isCurrent = (item.chat_id === currentUserId);
            const rankDisplay = (i === 0) ? '&#x1F451;' : (i + 1);
            const rowClass = 'rank-row' + (isCurrent ? ' current-user' : '');
            return '<div class="' + rowClass + '">'
                + '<div class="rank-number">' + rankDisplay + '</div>'
                + '<div>'
                + '<div class="person-name">' + escapeHtml(item.name) + '</div>'
                + (item.description ? '<div class="person-description">' + escapeHtml(item.description) + '</div>' : '')
                + '</div>'
                + '<div class="assets">' + assetsHtml + '</div>'
                + '<div class="worth">' + formatStars(item.amount) + '</div>'
                + '</div>';
        }).join('');

        // Check if current user is in the rating
        const prevInRating = currentUserInRating;
        currentUserInRating = data.find(item => item.chat_id === currentUserId) || null;

        // Update form state if user's presence in rating changed
        if ((!prevInRating && currentUserInRating) || (prevInRating && !currentUserInRating)) {
            updateFormState();
        }

        // Prefill form with user's existing data on first load
        if (currentUserInRating && !prevInRating) {
            document.getElementById('nameInput').value = currentUserInRating.name || '';
            document.getElementById('descInput').value = currentUserInRating.description || '';
            document.getElementById('assetsInput').value = currentUserInRating.assets || '';
        }

        document.getElementById('participantsCount').innerText = data.length;

        if (data.length > 0) {
            document.getElementById('needForTop1').innerText = (data[0].amount + 1).toFixed(0);
        } else {
            document.getElementById('needForTop1').innerText = '1';
        }

        // Top 100 threshold
        if (data.length >= 100) {
            document.getElementById('needForTop100').innerText = (data[99].amount + 1).toFixed(0);
        } else {
            document.getElementById('needForTop100').innerText = '1';
        }
    } catch (e) {
        console.error('Error loading rating:', e);
    }
}

// --- Load stats ---
async function loadStats() {
    try {
        const res = await fetch(API_URL + '/api/stats');
        const stats = await res.json();
        document.getElementById('statTotalLabel').innerHTML =
            escapeHtml(T.f_totalUsers || 'Total') + ': <span>' + stats.totalUsers + '</span>';
        document.getElementById('statOnlineLabel').innerHTML =
            escapeHtml(T.f_online || 'Online') + ': <span>' + stats.online + '</span>';
    } catch (e) {}
}

// --- Payment ---
async function initiatePayment() {
    const errorDiv = document.getElementById('errorMsg');
    errorDiv.style.display = 'none';

    const name = document.getElementById('nameInput').value.trim();
    const desc = document.getElementById('descInput').value.trim();
    const assets = document.getElementById('assetsInput').value.trim();
    const amountStars = parseInt(document.getElementById('amountInput').value);

    if (!name || !desc) {
        errorDiv.textContent = T.f_errorNameDesc || 'Fill in name and description';
        errorDiv.style.display = 'block';
        return;
    }
    if (!amountStars || amountStars < 1) {
        errorDiv.textContent = T.f_errorMinAmount || 'Minimum amount is 1 star';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const response = await fetch(API_URL + '/api/create-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                description: desc,
                assets,
                amount: amountStars,
                initData: tgInitData
            })
        });
        const data = await response.json();
        if (data.invoiceLink) {
            tg.openInvoice(data.invoiceLink, function(status) {
                if (status === 'paid') {
                    setTimeout(loadRating, 2000);
                }
            });
        } else {
            errorDiv.textContent = T.f_errorPayment || 'Payment error';
            errorDiv.style.display = 'block';
        }
    } catch (e) {
        errorDiv.textContent = T.f_errorServer || 'Server error';
        errorDiv.style.display = 'block';
    }
}

document.getElementById('addBtn').onclick = initiatePayment;

// --- Init ---
(async () => {
    await sendHeartbeat(); // fetch lang from DB (may update currentLang)
    await loadTranslations(currentLang);
    applyTranslations();
    loadRating();
    loadStats();
    setInterval(loadStats, 30000);
    setInterval(loadRating, 60000);
})();
