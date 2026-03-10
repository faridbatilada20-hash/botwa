const fs = require('fs');
const path = require('path');

// Owner configuration
global.owner = ['628388407448']; // Nomor owner tanpa @
global.ownerName = 'Farid';
global.botName = 'farid-bot';
global.packname = 'FaridBot';
global.author = 'Farid';
global.prefix = '.';
global.mess = {
    success: '✅ Sukses',
    admin: '❌ Fitur ini hanya untuk admin grup!',
    botAdmin: '❌ Bot harus menjadi admin untuk menggunakan fitur ini!',
    owner: '❌ Fitur ini hanya untuk owner!',
    group: '❌ Fitur ini hanya untuk dalam grup!',
    private: '❌ Fitur ini hanya untuk private chat!',
    premium: '❌ Fitur ini hanya untuk user premium!',
    wait: '⏳ Sedang diproses...',
    error: '❌ Terjadi kesalahan!'
};

// Database path
global.dbPath = path.join(__dirname, 'database.json');

// API Keys
global.openaiKey = 'sk-xxx'; // Ganti dengan API key OpenAI
global.geminiKey = 'xxx'; // Ganti dengan API key Gemini

// Initialize database
if (!fs.existsSync(global.dbPath)) {
    fs.writeFileSync(global.dbPath, JSON.stringify({
        users: {},
        groups: {},
        chats: {},
        cmd: {},
        premium: [],
        banned: [],
        sewa: {},
        jadibot: [],
        msg: {}
    }, null, 2));
}

// Helper functions
global.getTime = (format) => {
    const moment = require('moment-timezone');
    return moment().tz('Asia/Jakarta').format(format || 'HH:mm:ss');
};

global.getDate = () => {
    const moment = require('moment-timezone');
    return moment().tz('Asia/Jakarta').format('DD/MM/YYYY');
};

global.getDay = () => {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const moment = require('moment-timezone');
    return days[moment().tz('Asia/Jakarta').day()];
};
