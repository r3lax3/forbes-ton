require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');
const apiRoutes = require('./routes/api');
const webhookHandler = require('./routes/webhook');
const { PORT } = require('./config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.post('/webhook', webhookHandler);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.initDb().then(() => {
    console.log('Database initialized');
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
