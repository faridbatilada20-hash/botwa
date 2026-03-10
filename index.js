const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    makeInMemoryStore,
    jidDecode,
    downloadContentFromMessage,
    getContentType,
    generateWAMessage,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    generateMessageID,
    prepareWAMessageMedia,
    proto
} = require('@adiwajshing/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const moment = require('moment-timezone');
const axios = require('axios');
const { exec, spawn } = require('child_process');
const config = require('./config');
const Database = require('./lib/database');

// Initialize database
const db = new Database(config.dbPath);

// Logger
const logger = P({ level: 'silent' });

// Store
const store = makeInMemoryStore({ logger });

// Main function
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger,
        browser: ['FaridBot', 'Safari', '1.0.0']
    });
    
    store.bind(sock.ev);
    
    // Handle connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(chalk.red('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect));
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log(chalk.green('✓ Bot connected successfully!'));
            console.log(chalk.cyan(`✓ Bot name: ${config.botName}`));
            console.log(chalk.cyan(`✓ Owner: ${config.ownerName}`));
            console.log(chalk.cyan(`✓ Prefix: ${config.prefix}`));
        }
    });
    
    // Handle credentials update
    sock.ev.on('creds.update', saveCreds);
    
    // Handle messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;
        if (m.key && m.key.remoteJid === 'status@broadcast') return;
        
        const messageContent = m.message;
        const messageType = getContentType(messageContent);
        
        const from = m.key.remoteJid;
        const type = messageType;
        const sender = m.key.fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net' || sock.user.id) : (m.key.participant || m.key.remoteJid);
        const senderNumber = sender.split('@')[0];
        const isGroup = from.endsWith('@g.us');
        const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
        const groupName = groupMetadata ? groupMetadata.subject : '';
        const isBotAdmin = isGroup ? groupMetadata?.participants.find(p => p.id === sock.user.id)?.admin : false;
        const isAdmin = isGroup ? groupMetadata?.participants.find(p => p.id === sender)?.admin : false;
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const pushName = m.pushName || '';
        
        // Get database user
        let user = db.getUser(sender);
        let group = isGroup ? db.getGroup(from) : null;
        
        // Check banned
        if (db.data.banned.includes(senderNumber) && !config.owner.includes(senderNumber)) return;
        
        // Check premium
        const isPremium = db.data.premium.includes(senderNumber) || config.owner.includes(senderNumber);
        
        // Parse message
        const body = m.message?.conversation || 
                    m.message?.imageMessage?.caption || 
                    m.message?.videoMessage?.caption || 
                    m.message?.extendedTextMessage?.text || 
                    m.message?.buttonsResponseMessage?.selectedButtonId || 
                    m.message?.listResponseMessage?.singleSelectReply?.selectedRowId || 
                    '';
        
        const command = body.toLowerCase().startsWith(config.prefix) ? body.slice(config.prefix.length).trim().split(' ')[0].toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const text = args.join(' ');
        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo;
        const isQuoted = quoted ? true : false;
        
        // Download media function
        const downloadMedia = async (message, type) => {
            try {
                const stream = await downloadContentFromMessage(message, type);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                return buffer;
            } catch (e) {
                return null;
            }
        };
        
        // Reply function
        const reply = (text) => {
            sock.sendMessage(from, { text }, { quoted: m });
        };
        
        // Process commands
        if (command) {
            // Get user info for menu
            const userInfo = user;
            const isPremiumUser = isPremium ? 'VIP' : 'Member';
            const limitUser = isPremium ? 'Infinity' : userInfo.limit;
            const moneyUser = userInfo.money;
            const mode = 'public';
            
            // Command handler
            try {
                switch (command) {
                    // ========== MENU ==========
                    case 'menu':
                    case 'help': {
                        const menuText = `╭──❍「 *USER INFO* 」❍
├ *Nama* : ${pushName || senderNumber}
├ *Id* : @${senderNumber}
├ *User* : ${isPremiumUser}
├ *Limit* : ${limitUser}
├ *Money* : ${moneyUser}
╰─┬────❍
╭─┴─❍「 *BOT INFO* 」❍
├ *Nama Bot* : ${config.botName}
├ *Powered* : @s.whatsapp.net
├ *Owner* : @${config.owner[0]}
├ *Mode* : ${mode}
├ *Prefix* : *${config.prefix}*
├ *Premium Feature* : 🔸️
╰─┬────❍
╭─┴─❍「 *ABOUT* 」❍
├ *Tanggal* : ${config.getDate()}
├ *Hari* : ${config.getDay()}
├ *Jam* : ${config.getTime()}
╰──────❍
╭──❍「 *BOT* 」❍
│□ .profile
│□ .claim
│□ .buy [item] (nominal)
│□ .transfer
│□ .leaderboard
│□ .request (text)
│□ .react (emoji)
│□ .tagme
│□ .runtime
│□ .totalfitur
│□ .speed
│□ .ping
│□ .afk
│□ .rvo (reply pesan viewone)
│□ .inspect (url gc)
│□ .addmsg
│□ .delmsg
│□ .getmsg
│□ .listmsg
│□ .setcmd
│□ .delcmd
│□ .listcmd
│□ .lockcmd
│□ .q (reply pesan)
│□ .menfes (62xxx|fake name)
│□ .confes (62xxx|fake name)
│□ .roomai
│□ .jadibot 🔸️
│□ .stopjadibot
│□ .listjadibot
│□ .donasi
│□ .addsewa
│□ .delsewa
│□ .listsewa
╰─┬────❍
╭─┴❍「 *GROUP* 」❍
│□ .add (62xxx)
│□ .kick (@tag/62xxx)
│□ .promote (@tag/62xxx)
│□ .demote (@tag/62xxx)
│□ .warn (@tag/62xxx)
│□ .unwarn (@tag/62xxx)
│□ .setname (nama baru gc)
│□ .setdesc (desk)
│□ .setppgc (reply imgnya)
│□ .delete (reply pesan)
│□ .linkgrup
│□ .revoke
│□ .tagall
│□ .pin
│□ .unpin
│□ .hidetag
│□ .totag (reply pesan)
│□ .listonline
│□ .group set
│□ .group (khusus admin)
╰─┬────❍
╭─┴❍「 *SEARCH* 」❍
│□ .ytsearch (query)
│□ .spotify (query)
│□ .pixiv (query)
│□ .pinterest (query)
│□ .wallpaper (query)
│□ .ringtone (query)
│□ .google (query)
│□ .gimage (query)
│□ .npm (query)
│□ .style (query)
│□ .cuaca (kota)
│□ .tenor (query)
│□ .urban (query)
╰─────❍
╭─┴❍「 *DOWNLOAD* 」❍
│□ .ytmp3 (url)
│□ .ytmp4 (url)
│□ .instagram (url)
│□ .tiktok (url)
│□ .tiktokmp3 (url)
│□ .facebook (url)
│□ .spotifydl (url)
│□ .mediafire (url)
╰─┬────❍
╭─┴❍「 *QUOTES* 」❍
│□ .motivasi
│□ .quotes
│□ .truth
│□ .bijak
│□ .dare
│□ .bucin
│□ .renungan
╰─┬────❍
╭─┴❍「 *TOOLS* 」❍
│□ .get (url) 🔸️
│□ .hd (reply pesan)
│□ .toaudio (reply pesan)
│□ .tomp3 (reply pesan)
│□ .tovn (reply pesan)
│□ .toimage (reply pesan)
│□ .toptv (reply pesan)
│□ .tourl (reply pesan)
│□ .tts (textnya)
│□ .toqr (textnya)
│□ .brat (textnya)
│□ .bratvid (textnya)
│□ .ssweb (url) 🔸️
│□ .sticker (send/reply img)
│□ .colong (reply stiker)
│□ .smeme (send/reply img)
│□ .dehaze (send/reply img)
│□ .colorize (send/reply img)
│□ .hitamkan (send/reply img)
│□ .emojimix 🙃+💀
│□ .nulis
│□ .readmore text1|text2
│□ .qc (pesannya)
│□ .translate
│□ .wasted (send/reply img)
│□ .triggered (send/reply img)
│□ .shorturl (urlnya)
│□ .gitclone (urlnya)
│□ .fat (reply audio)
│□ .fast (reply audio)
│□ .bass (reply audio)
│□ .slow (reply audio)
│□ .tupai (reply audio)
│□ .deep (reply audio)
│□ .robot (reply audio)
│□ .blown (reply audio)
│□ .reverse (reply audio)
│□ .smooth (reply audio)
│□ .earrape (reply audio)
│□ .nightcore (reply audio)
│□ .getexif (reply sticker)
╰─┬────❍
╭─┴❍「 *AI* 」❍
│□ .ai (query)
│□ .gemini (query)
│□ .txt2img (query)
╰─┬────❍
╭─┴❍「 *ANIME* 」❍
│□ .waifu
│□ .neko
╰─┬────❍
╭─┴❍「 *GAME* 」❍
│□ .tictactoe
│□ .akinator
│□ .suit
│□ .slot
│□ .math (level)
│□ .begal
│□ .ulartangga
│□ .blackjack
│□ .catur
│□ .casino (nominal)
│□ .samgong (nominal)
│□ .rampok (@tag)
│□ .tekateki
│□ .tebaklirik
│□ .tebakkata
│□ .tebakbom
│□ .susunkata
│□ .colorblind
│□ .tebakkimia
│□ .caklontong
│□ .tebakangka
│□ .tebaknegara
│□ .tebakgambar
│□ .tebakbendera
╰─┬────❍
╭─┴❍「 *FUN* 」❍
│□ .coba
│□ .dadu
│□ .bisakah (text)
│□ .apakah (text)
│□ .kapan (text)
│□ .siapa (text)
│□ .kerangajaib (text)
│□ .cekmati (nama lu)
│□ .ceksifat
│□ .cekkhodam (nama lu)
│□ .rate (reply pesan)
│□ .jodohku
│□ .jadian
│□ .fitnah
│□ .halah (text)
│□ .hilih (text)
│□ .huluh (text)
│□ .heleh (text)
│□ .holoh (text)
╰─┬────❍
╭─┴❍「 *RANDOM* 」❍
│□ .coffe
╰─┬────❍
╭─┴❍「 *STALKER* 」❍
│□ .wastalk
│□ .githubstalk
╰─┬────❍
╭─┴❍「 *OWNER* 」❍
│□ .bot [set]
│□ .setbio
│□ .setppbot
│□ .join
│□ .leave
│□ .block
│□ .listblock
│□ .openblock
│□ .listpc
│□ .listgc
│□ .ban
│□ .unban
│□ .mute
│□ .unmute
│□ .creategc
│□ .clearchat
│□ .addprem
│□ .delprem
│□ .listprem
│□ .addlimit
│□ .adduang
│□ .setbotauthor
│□ .setbotname
│□ .setbotpackname
│□ .setapikey
│□ .addowner
│□ .delowner
│□ .getmsgstore
│□ .bot --settings
│□ .bot settings
│□ .getsession
│□ .delsession
│□ .delsampah
│□ .upsw
│□ .backup
│□ $
│□ >
│□ <
╰──────❍`;

                        // Get user profile picture
                        let ppUrl;
                        try {
                            ppUrl = await sock.profilePictureUrl(sender, 'image');
                        } catch {
                            ppUrl = 'https://telegra.ph/file/1e1e3c9d3e5e3b3c9d3e5.jpg';
                        }

                        // Send menu with image
                        await sock.sendMessage(from, {
                            image: { url: ppUrl },
                            caption: menuText,
                            mentions: [sender, ...config.owner.map(v => v + '@s.whatsapp.net')]
                        }, { quoted: m });
                    }
                    break;

                    // ========== BOT FEATURES ==========
                    case 'profile': {
                        let userInfo = user;
                        let profileText = `╭──❍「 *PROFILE USER* 」❍
├ *Nama* : ${pushName || senderNumber}
├ *Nomor* : ${senderNumber}
├ *Status* : ${isPremium ? 'Premium' : 'Free'}
├ *Limit* : ${userInfo.limit}
├ *Money* : ${userInfo.money}
├ *Exp* : ${userInfo.exp}
├ *Level* : ${userInfo.level}
├ *Terdaftar* : ${userInfo.registered ? '✓' : '✗'}
╰──────❍`;
                        
                        let ppUrl;
                        try {
                            ppUrl = await sock.profilePictureUrl(sender, 'image');
                        } catch {
                            ppUrl = 'https://telegra.ph/file/1e1e3c9d3e5e3b3c9d3e5.jpg';
                        }
                        
                        await sock.sendMessage(from, {
                            image: { url: ppUrl },
                            caption: profileText
                        }, { quoted: m });
                    }
                    break;

                    case 'claim': {
                        // Daily claim logic
                        let userInfo = user;
                        let lastClaim = userInfo.lastClaim || 0;
                        let now = Date.now();
                        let cooldown = 86400000; // 24 hours
                        
                        if (now - lastClaim < cooldown) {
                            let remaining = cooldown - (now - lastClaim);
                            let hours = Math.floor(remaining / 3600000);
                            let minutes = Math.floor((remaining % 3600000) / 60000);
                            reply(`❌ Kamu sudah claim hari ini!\nSisa waktu: ${hours} jam ${minutes} menit`);
                        } else {
                            userInfo.money += 1000;
                            userInfo.limit += 10;
                            userInfo.lastClaim = now;
                            db.save();
                            reply(`✅ Kamu mendapatkan:\n💰 Money: 1000\n🎫 Limit: 10`);
                        }
                    }
                    break;

                    case 'buy': {
                        if (!text) return reply('Format: .buy [item] [nominal]\nContoh: .buy limit 10');
                        let [item, nominal] = text.split(' ');
                        nominal = parseInt(nominal);
                        
                        if (isNaN(nominal)) return reply('Nominal harus angka!');
                        
                        let userInfo = user;
                        
                        if (item === 'limit') {
                            let price = nominal * 100;
                            if (userInfo.money < price) return reply(`Money tidak cukup! Butuh ${price} money`);
                            userInfo.money -= price;
                            userInfo.limit += nominal;
                            db.save();
                            reply(`✅ Berhasil membeli ${nominal} limit seharga ${price} money`);
                        } else {
                            reply('Item tidak tersedia!');
                        }
                    }
                    break;

                    case 'transfer': {
                        if (!isQuoted && !m.message?.extendedTextMessage?.contextInfo?.mentionedJid) {
                            return reply('Reply atau tag user yang ingin ditransfer!');
                        }
                        
                        let target = m.message.extendedTextMessage.contextInfo.mentionedJid[0] || quotedMsg.participant;
                        if (!target) return reply('User tidak ditemukan!');
                        
                        let [amount, type] = args;
                        if (!amount || !type) return reply('Format: .transfer [jumlah] [limit/money]');
                        
                        amount = parseInt(amount);
                        if (isNaN(amount)) return reply('Jumlah harus angka!');
                        
                        let userInfo = user;
                        let targetInfo = db.getUser(target);
                        
                        if (type === 'limit') {
                            if (userInfo.limit < amount) return reply('Limit tidak cukup!');
                            userInfo.limit -= amount;
                            targetInfo.limit += amount;
                            db.save();
                            reply(`✅ Berhasil transfer ${amount} limit ke @${target.split('@')[0]}`, { mentions: [target] });
                        } else if (type === 'money') {
                            if (userInfo.money < amount) return reply('Money tidak cukup!');
                            userInfo.money -= amount;
                            targetInfo.money += amount;
                            db.save();
                            reply(`✅ Berhasil transfer ${amount} money ke @${target.split('@')[0]}`, { mentions: [target] });
                        }
                    }
                    break;

                    case 'leaderboard': {
                        let users = Object.entries(db.data.users);
                        let sortedMoney = users.sort((a, b) => b[1].money - a[1].money).slice(0, 10);
                        let sortedLimit = users.sort((a, b) => b[1].limit - a[1].limit).slice(0, 10);
                        
                        let moneyText = '💰 *TOP 10 MONEY*\n';
                        sortedMoney.forEach(([jid, data], i) => {
                            moneyText += `${i+1}. @${jid.split('@')[0]} : ${data.money}\n`;
                        });
                        
                        let limitText = '\n🎫 *TOP 10 LIMIT*\n';
                        sortedLimit.forEach(([jid, data], i) => {
                            limitText += `${i+1}. @${jid.split('@')[0]} : ${data.limit}\n`;
                        });
                        
                        reply(moneyText + limitText);
                    }
                    break;

                    case 'request': {
                        if (!text) return reply('Masukkan request kamu!');
                        let ownerJid = config.owner[0] + '@s.whatsapp.net';
                        await sock.sendMessage(ownerJid, {
                            text: `📝 *REQUEST FITUR*\nDari: @${senderNumber}\nPesan: ${text}`,
                            mentions: [sender]
                        });
                        reply('✅ Request telah dikirim ke owner!');
                    }
                    break;

                    case 'react': {
                        if (!text) return reply('Masukkan emoji!');
                        if (!quotedMsg) return reply('Reply pesan yang ingin direaksi!');
                        
                        let reaction = {
                            react: {
                                text: text,
                                key: m.message.extendedTextMessage.contextInfo.quotedMessage.key || m.key
                            }
                        };
                        await sock.sendMessage(from, reaction);
                    }
                    break;

                    case 'tagme': {
                        sock.sendMessage(from, {
                            text: `@${senderNumber}`,
                            mentions: [sender]
                        }, { quoted: m });
                    }
                    break;

                    case 'runtime': {
    let uptime = process.uptime();
    let hours = Math.floor(uptime / 3600);
    let minutes = Math.floor((uptime % 3600) / 60);
    let seconds = Math.floor(uptime % 60);
    
    reply(`⏰ *Runtime*\n${hours} Jam ${minutes} Menit ${seconds} Detik`);
}
break;

case 'totalfitur': {
    // Count all features from menu
    const features = [
        // Bot Features (32)
        'profile', 'claim', 'buy', 'transfer', 'leaderboard', 'request', 'react', 
        'tagme', 'runtime', 'totalfitur', 'speed', 'ping', 'afk', 'rvo', 'inspect', 
        'addmsg', 'delmsg', 'getmsg', 'listmsg', 'setcmd', 'delcmd', 'listcmd', 
        'lockcmd', 'q', 'menfes', 'confes', 'roomai', 'jadibot', 'stopjadibot', 
        'listjadibot', 'donasi', 'addsewa', 'delsewa', 'listsewa',
        
        // Group Features (21)
        'add', 'kick', 'promote', 'demote', 'warn', 'unwarn', 'setname', 'setdesc', 
        'setppgc', 'delete', 'linkgrup', 'revoke', 'tagall', 'pin', 'unpin', 'hidetag', 
        'totag', 'listonline', 'group set', 'group',
        
        // Search Features (13)
        'ytsearch', 'spotify', 'pixiv', 'pinterest', 'wallpaper', 'ringtone', 'google', 
        'gimage', 'npm', 'style', 'cuaca', 'tenor', 'urban',
        
        // Download Features (8)
        'ytmp3', 'ytmp4', 'instagram', 'tiktok', 'tiktokmp3', 'facebook', 'spotifydl', 'mediafire',
        
        // Quotes Features (7)
        'motivasi', 'quotes', 'truth', 'bijak', 'dare', 'bucin', 'renungan',
        
        // Tools Features (41)
        'get', 'hd', 'toaudio', 'tomp3', 'tovn', 'toimage', 'toptv', 'tourl', 'tts', 
        'toqr', 'brat', 'bratvid', 'ssweb', 'sticker', 'colong', 'smeme', 'dehaze', 
        'colorize', 'hitamkan', 'emojimix', 'nulis', 'readmore', 'qc', 'translate', 
        'wasted', 'triggered', 'shorturl', 'gitclone', 'fat', 'fast', 'bass', 'slow', 
        'tupai', 'deep', 'robot', 'blown', 'reverse', 'smooth', 'earrape', 'nightcore', 
        'getexif',
        
        // AI Features (3)
        'ai', 'gemini', 'txt2img',
        
        // Anime Features (2)
        'waifu', 'neko',
        
        // Game Features (24)
        'tictactoe', 'akinator', 'suit', 'slot', 'math', 'begal', 'ulartangga', 
        'blackjack', 'catur', 'casino', 'samgong', 'rampok', 'tekateki', 'tebaklirik', 
        'tebakkata', 'tebakbom', 'susunkata', 'colorblind', 'tebakkimia', 'caklontong', 
        'tebakangka', 'tebaknegara', 'tebakgambar', 'tebakbendera',
        
        // Fun Features (19)
        'coba', 'dadu', 'bisakah', 'apakah', 'kapan', 'siapa', 'kerangajaib', 'cekmati', 
        'ceksifat', 'cekkhodam', 'rate', 'jodohku', 'jadian', 'fitnah', 'halah', 'hilih', 
        'huluh', 'heleh', 'holoh',
        
        // Random Features (1)
        'coffe',
        
        // Stalker Features (2)
        'wastalk', 'githubstalk',
        
        // Owner Features (28)
        'bot', 'setbio', 'setppbot', 'join', 'leave', 'block', 'listblock', 'openblock', 
        'listpc', 'listgc', 'ban', 'unban', 'mute', 'unmute', 'creategc', 'clearchat', 
        'addprem', 'delprem', 'listprem', 'addlimit', 'adduang', 'setbotauthor', 
        'setbotname', 'setbotpackname', 'setapikey', 'addowner', 'delowner', 'getmsgstore', 
        'getsession', 'delsession', 'delsampah', 'upsw', 'backup'
    ];
    
    // Hitung total fitur (hapus duplikat jika ada)
    const uniqueFeatures = [...new Set(features)];
    const totalFitur = uniqueFeatures.length;
    
    reply(`📊 *Total Fitur*\nJumlah fitur: ${totalFitur} fitur\n\n*Keterangan:*\n• Bot Features: 32\n• Group Features: 21\n• Search Features: 13\n• Download Features: 8\n• Quotes Features: 7\n• Tools Features: 41\n• AI Features: 3\n• Anime Features: 2\n• Game Features: 24\n• Fun Features: 19\n• Random Features: 1\n• Stalker Features: 2\n• Owner Features: 28\n\n*Total Keseluruhan: 201 fitur*`);
}
break;
 case 'speed':
case 'ping': {
    let timestamp = Date.now();
    reply('Pong!').then(() => {
        let latency = Date.now() - timestamp;
        reply(`⚡ *Speed*\nResponse: ${latency} ms`);
    });
}
break;

case 'afk': {
    let reason = text || 'Tidak ada alasan';
    user.afk = true;
    user.afkReason = reason;
    user.afkTime = Date.now();
    db.save();
    reply(`✅ AFK diaktifkan\nAlasan: ${reason}`);
}
break;

case 'rvo': {
    if (!isQuoted) return reply('Reply pesan view once!');
    let msg = quotedMsg.quotedMessage;
    if (msg.viewOnceMessage) {
        let viewOnce = msg.viewOnceMessage;
        if (viewOnce.imageMessage) {
            let buffer = await downloadMedia(viewOnce.imageMessage, 'image');
            await sock.sendMessage(from, { image: buffer }, { quoted: m });
        } else if (viewOnce.videoMessage) {
            let buffer = await downloadMedia(viewOnce.videoMessage, 'video');
            await sock.sendMessage(from, { video: buffer }, { quoted: m });
        }
    }
}
break;

case 'inspect': {
    if (!text) return reply('Masukkan URL grup!');
    let code = text.split('https://chat.whatsapp.com/')[1];
    if (!code) return reply('URL tidak valid!');
    
    try {
        let data = await sock.groupAcceptInvite(code);
        reply(`🔍 *INSPECT GROUP*\nID: ${data}`);
    } catch {
        reply('❌ Gagal menginspeksi grup!');
    }
}
break;

case 'addmsg': {
    if (!text) return reply('Format: .addmsg [key]|[pesan]');
    let [key, ...msgArr] = text.split('|');
    let msg = msgArr.join('|');
    if (!key || !msg) return reply('Format salah!');
    
    if (!db.data.msg[key]) db.data.msg[key] = [];
    db.data.msg[key].push({
        message: msg,
        from: sender,
        time: Date.now()
    });
    db.save();
    reply(`✅ Pesan dengan key "${key}" telah ditambahkan!`);
}
break;

case 'delmsg': {
    if (!text) return reply('Masukkan key pesan yang ingin dihapus!');
    if (!db.data.msg[text]) return reply('Key tidak ditemukan!');
    
    delete db.data.msg[text];
    db.save();
    reply(`✅ Pesan dengan key "${text}" telah dihapus!`);
}
break;

case 'getmsg': {
    if (!text) return reply('Masukkan key pesan yang ingin diambil!');
    if (!db.data.msg[text]) return reply('Key tidak ditemukan!');
    
    let msgs = db.data.msg[text];
    let textMsg = `📋 *Daftar Pesan - ${text}*\n\n`;
    msgs.forEach((msg, i) => {
        textMsg += `${i+1}. ${msg.message}\n`;
    });
    reply(textMsg);
}
break;

case 'listmsg': {
    let keys = Object.keys(db.data.msg);
    if (keys.length === 0) return reply('Belum ada pesan tersimpan!');
    
    let textMsg = '📋 *Daftar Key Pesan*\n\n';
    keys.forEach(key => {
        textMsg += `• ${key}\n`;
    });
    reply(textMsg);
}
break;

case 'setcmd': {
    if (!text) return reply('Format: .setcmd [command]|[reply]');
    let [cmd, replyMsg] = text.split('|');
    if (!cmd || !replyMsg) return reply('Format salah!');
    
    if (!db.data.cmd[cmd]) db.data.cmd[cmd] = [];
    db.data.cmd[cmd].push({
        reply: replyMsg,
        from: sender,
        time: Date.now()
    });
    db.save();
    reply(`✅ Command "${cmd}" telah ditambahkan!`);
}
break;

case 'delcmd': {
    if (!text) return reply('Masukkan command yang ingin dihapus!');
    if (!db.data.cmd[text]) return reply('Command tidak ditemukan!');
    
    delete db.data.cmd[text];
    db.save();
    reply(`✅ Command "${text}" telah dihapus!`);
}
break;

case 'listcmd': {
    let cmds = Object.keys(db.data.cmd);
    if (cmds.length === 0) return reply('Belum ada command tersimpan!');
    
    let textCmd = '📋 *Daftar Custom Command*\n\n';
    cmds.forEach(cmd => {
        textCmd += `• ${cmd}\n`;
    });
    reply(textCmd);
}
break;

case 'lockcmd': {
    if (!text) return reply('Masukkan command yang ingin dikunci!');
    if (!db.data.cmd[text]) return reply('Command tidak ditemukan!');
    
    db.data.cmd[text].locked = !db.data.cmd[text].locked;
    db.save();
    reply(`✅ Command "${text}" telah ${db.data.cmd[text].locked ? 'dikunci' : 'dibuka'}!`);
}
break;

case 'q': {
    if (!isQuoted) return reply('Reply pesan yang ingin di-quote!');
    let quotedText = quoted.conversation || 
                    quoted.extendedTextMessage?.text || 
                    quoted.imageMessage?.caption ||
                    quoted.videoMessage?.caption;
    
    let quotedSender = quotedMsg.participant || sender;
    let quotedName = pushName || quotedSender.split('@')[0];
    
    let qText = `❝${quotedText}❞\n\n- ${quotedName}`;
    reply(qText);
}
break;

case 'menfes':
case 'confes': {
    if (!text) return reply('Format: .menfes 62xxx|nama palsu|pesan');
    let [target, fakeName, ...msgArr] = text.split('|');
    let msg = msgArr.join('|');
    if (!target || !fakeName || !msg) return reply('Format salah!');
    
    target = target + '@s.whatsapp.net';
    let menfesText = `📫 *MENFES*\nDari: ${fakeName}\nPesan: ${msg}`;
    
    await sock.sendMessage(target, { text: menfesText });
    reply('✅ Pesan telah dikirim!');
}
break;

case 'roomai': {
    reply('🚧 Fitur dalam pengembangan!');
}
break;

case 'jadibot': {
    if (!isPremium) return reply(config.mess.premium);
    reply('🚧 Fitur jadibot dalam pengembangan!');
}
break;

case 'stopjadibot': {
    if (!isPremium) return reply(config.mess.premium);
    reply('🚧 Fitur stopjadibot dalam pengembangan!');
}
break;

case 'listjadibot': {
    if (!isPremium) return reply(config.mess.premium);
    let jadibotList = db.data.jadibot;
    if (jadibotList.length === 0) return reply('Belum ada jadibot!');
    
    let text = '📋 *Daftar Jadibot*\n\n';
    jadibotList.forEach((bot, i) => {
        text += `${i+1}. @${bot.split('@')[0]}\n`;
    });
    reply(text);
}
break;

case 'donasi': {
    let donasiText = `╭──❍「 *DONASI* 」❍
├ *DANA* : 083888407448
├ *OVO* : 083888407448
├ *GOPAY* : 083888407448
├ *PULSA* : 083888407448
╰──────❍
Terima kasih atas dukungannya! 🙏`;
    reply(donasiText);
}
break;

case 'addsewa': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Format: .addsewa [id grup]|[hari]');
    
    let [groupId, days] = text.split('|');
    days = parseInt(days);
    if (!groupId || !days) return reply('Format salah!');
    
    let expireDate = Date.now() + (days * 86400000);
    db.data.sewa[groupId] = expireDate;
    db.save();
    reply(`✅ Grup ${groupId} telah ditambahkan ke sewa selama ${days} hari!`);
}
break;

case 'delsewa': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan ID grup!');
    
    if (db.data.sewa[text]) {
        delete db.data.sewa[text];
        db.save();
        reply('✅ Sewa grup telah dihapus!');
    } else {
        reply('Grup tidak ditemukan dalam daftar sewa!');
    }
}
break;

case 'listsewa': {
    let sewaList = Object.entries(db.data.sewa);
    if (sewaList.length === 0) return reply('Belum ada grup sewa!');
    
    let text = '📋 *Daftar Grup Sewa*\n\n';
    sewaList.forEach(([id, expire]) => {
        let expireDate = new Date(expire).toLocaleString('id-ID');
        text += `• ${id}\n  Expire: ${expireDate}\n\n`;
    });
    reply(text);
}
break;

// ========== GROUP FEATURES ==========
case 'add': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    let number = args[0];
    if (!number) return reply('Masukkan nomor!');
    
    number = number.replace(/[^0-9]/g, '');
    if (number.startsWith('0')) number = '62' + number.slice(1);
    if (!number.startsWith('62')) number = '62' + number;
    
    try {
        await sock.groupParticipantsUpdate(from, [number + '@s.whatsapp.net'], 'add');
        reply('✅ Berhasil menambahkan anggota!');
    } catch {
        reply('❌ Gagal menambahkan anggota!');
    }
}
break;

case 'kick': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (target.length === 0) {
        if (args[0]) {
            let number = args[0].replace(/[^0-9]/g, '');
            if (number.startsWith('0')) number = '62' + number.slice(1);
            if (!number.startsWith('62')) number = '62' + number;
            target = [number + '@s.whatsapp.net'];
        } else {
            return reply('Tag user yang ingin dikick!');
        }
    }
    
    try {
        await sock.groupParticipantsUpdate(from, target, 'remove');
        reply('✅ Berhasil mengeluarkan anggota!');
    } catch {
        reply('❌ Gagal mengeluarkan anggota!');
    }
}
break;

case 'promote': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (target.length === 0) return reply('Tag user yang ingin di-promote!');
    
    try {
        await sock.groupParticipantsUpdate(from, target, 'promote');
        reply('✅ Berhasil promote anggota!');
    } catch {
        reply('❌ Gagal promote anggota!');
    }
}
break;

case 'demote': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (target.length === 0) return reply('Tag user yang ingin di-demote!');
    
    try {
        await sock.groupParticipantsUpdate(from, target, 'demote');
        reply('✅ Berhasil demote anggota!');
    } catch {
        reply('❌ Gagal demote anggota!');
    }
}
break;

case 'warn': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || quotedMsg?.participant;
    if (!target) return reply('Tag user yang ingin di-warn!');
    
    if (!group.warn) group.warn = {};
    if (!group.warn[target]) group.warn[target] = 0;
    group.warn[target] += 1;
    db.save();
    
    reply(`⚠️ User @${target.split('@')[0]} mendapat warn ke-${group.warn[target]}`, { mentions: [target] });
    
    if (group.warn[target] >= 3) {
        if (isBotAdmin) {
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            delete group.warn[target];
            db.save();
            reply('❌ User dikeluarkan karena mencapai 3 warn!');
        }
    }
}
break;

case 'unwarn': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || quotedMsg?.participant;
    if (!target) return reply('Tag user yang ingin di-unwarn!');
    
    if (group.warn && group.warn[target]) {
        group.warn[target] -= 1;
        if (group.warn[target] <= 0) delete group.warn[target];
        db.save();
        reply(`✅ Warn user @${target.split('@')[0]} dikurangi!`, { mentions: [target] });
    } else {
        reply('User tidak memiliki warn!');
    }
}
break;

case 'setname': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    if (!text) return reply('Masukkan nama grup baru!');
    
    try {
        await sock.groupUpdateSubject(from, text);
        reply('✅ Nama grup berhasil diubah!');
    } catch {
        reply('❌ Gagal mengubah nama grup!');
    }
}
break;

case 'setdesc': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    if (!text) return reply('Masukkan deskripsi grup baru!');
    
    try {
        await sock.groupUpdateDescription(from, text);
        reply('✅ Deskripsi grup berhasil diubah!');
    } catch {
        reply('❌ Gagal mengubah deskripsi grup!');
    }
}
break;

case 'setppgc': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar yang ingin dijadikan PP grup!');
    
    let buffer = await downloadMedia(media, 'image');
    
    try {
        await sock.updateProfilePicture(from, buffer);
        reply('✅ Foto profil grup berhasil diubah!');
    } catch {
        reply('❌ Gagal mengubah foto profil grup!');
    }
}
break;

case 'delete':
case 'del': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber) && !m.key.fromMe) return reply(config.mess.admin);
    if (!isQuoted) return reply('Reply pesan yang ingin dihapus!');
    
    let key = {
        remoteJid: from,
        fromMe: false,
        id: quotedMsg.stanzaId,
        participant: quotedMsg.participant
    };
    
    await sock.sendMessage(from, { delete: key });
}
break;

case 'linkgrup':
case 'linkgc': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    try {
        let code = await sock.groupInviteCode(from);
        reply(`🔗 Link grup: https://chat.whatsapp.com/${code}`);
    } catch {
        reply('❌ Gagal mendapatkan link grup!');
    }
}
break;

case 'revoke': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    try {
        await sock.groupRevokeInvite(from);
        reply('✅ Link grup berhasil direset!');
    } catch {
        reply('❌ Gagal mereset link grup!');
    }
}
break;

case 'tagall': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    
    let members = groupMetadata.participants;
    let mentions = members.map(v => v.id);
    let textMsg = text || ' ';
    
    for (let i = 0; i < members.length; i++) {
        textMsg += `\n@${members[i].id.split('@')[0]}`;
    }
    
    await sock.sendMessage(from, { text: textMsg, mentions });
}
break;

case 'pin': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isQuoted) return reply('Reply pesan yang ingin di-pin!');
    
    let key = {
        remoteJid: from,
        fromMe: false,
        id: quotedMsg.stanzaId,
        participant: quotedMsg.participant
    };
    
    await sock.sendMessage(from, { pin: key });
    reply('✅ Pesan berhasil di-pin!');
}
break;

case 'unpin': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isQuoted) return reply('Reply pesan yang ingin di-unpin!');
    
    let key = {
        remoteJid: from,
        fromMe: false,
        id: quotedMsg.stanzaId,
        participant: quotedMsg.participant
    };
    
    await sock.sendMessage(from, { unpin: key });
    reply('✅ Pesan berhasil di-unpin!');
}
break;

case 'hidetag': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    
    let members = groupMetadata.participants;
    let mentions = members.map(v => v.id);
    let textMsg = text || ' ';
    
    await sock.sendMessage(from, { text: textMsg, mentions });
}
break;

case 'totag': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isQuoted) return reply('Reply pesan yang ingin ditotag!');
    
    let members = groupMetadata.participants;
    let mentions = members.map(v => v.id);
    let quotedText = quoted.conversation || 
                    quoted.extendedTextMessage?.text || 
                    quoted.imageMessage?.caption ||
                    quoted.videoMessage?.caption;
    
    await sock.sendMessage(from, { 
        text: quotedText + '\n\n' + mentions.map(v => `@${v.split('@')[0]}`).join(' '), 
        mentions 
    });
}
break;

case 'listonline': {
    if (!isGroup) return reply(config.mess.group);
    
    let members = groupMetadata.participants;
    let online = [];
    
    for (let member of members) {
        let presence = await sock.presenceSubscribe(member.id);
        if (presence?.lastKnownPresence === 'available') {
            online.push(member.id);
        }
    }
    
    let text = `👥 *Anggota Online*\nTotal: ${online.length}\n\n`;
    online.forEach((id, i) => {
        text += `${i+1}. @${id.split('@')[0]}\n`;
    });
    
    await sock.sendMessage(from, { text, mentions: online });
}
break;

case 'group': {
    if (!isGroup) return reply(config.mess.group);
    if (!isAdmin && !config.owner.includes(senderNumber)) return reply(config.mess.admin);
    if (!isBotAdmin) return reply(config.mess.botAdmin);
    
    if (args[0] === 'set') {
        let setting = args[1];
        if (!setting) return reply('Pilih: open/close');
        
        if (setting === 'open') {
            await sock.groupSettingUpdate(from, 'announcement');
            reply('✅ Grup telah dibuka!');
        } else if (setting === 'close') {
            await sock.groupSettingUpdate(from, 'not_announcement');
            reply('✅ Grup telah ditutup!');
        } else {
            reply('Pilih open atau close!');
        }
    } else {
        let setting = groupMetadata.announce ? 'Tertutup' : 'Terbuka';
        reply(`🔒 *Pengaturan Grup*\nStatus: ${setting}`);
    }
}
break;
  // ========== SEARCH FEATURES ==========
case 'ytsearch': {
    if (!text) return reply('Masukkan judul video!');
    reply(config.mess.wait);
    
    try {
        const yts = require('yt-search');
        let results = await yts(text);
        let videos = results.videos.slice(0, 5);
        
        let textMsg = `🔍 *YOUTUBE SEARCH*\nQuery: ${text}\n\n`;
        videos.forEach((video, i) => {
            textMsg += `${i+1}. *${video.title}*\n`;
            textMsg += `⏱️ ${video.timestamp} | 👁️ ${video.views}\n`;
            textMsg += `📎 ${video.url}\n\n`;
        });
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal mencari video!');
    }
}
break;

case 'spotify': {
    if (!text) return reply('Masukkan judul lagu!');
    reply(config.mess.wait);
    
    try {
        const spotify = require('spotify-url-info');
        let results = await spotify.search(text);
        
        let textMsg = `🎵 *SPOTIFY SEARCH*\nQuery: ${text}\n\n`;
        results.forEach((track, i) => {
            textMsg += `${i+1}. *${track.name}*\n`;
            textMsg += `🎤 Artist: ${track.artists[0].name}\n`;
            textMsg += `📀 Album: ${track.album.name}\n`;
            textMsg += `📎 ${track.external_urls.spotify}\n\n`;
        });
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal mencari lagu!');
    }
}
break;

case 'pixiv': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const pixiv = require('pixiv-dl');
        let results = await pixiv.search(text, 5);
        
        let textMsg = `🎨 *PIXIV SEARCH*\nQuery: ${text}\n\n`;
        results.forEach((img, i) => {
            textMsg += `${i+1}. *${img.title}*\n`;
            textMsg += `👤 Artist: ${img.artist}\n`;
            textMsg += `📎 ${img.url}\n\n`;
        });
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal mencari di Pixiv!');
    }
}
break;

case 'pinterest': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const pinterest = require('pinterest-dl');
        let results = await pinterest.search(text, 5);
        
        for (let url of results) {
            await sock.sendMessage(from, { image: { url } }, { quoted: m });
        }
    } catch {
        reply('❌ Gagal mencari gambar!');
    }
}
break;

case 'wallpaper': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://wall.alphacoders.com/api2.0/get.php?auth=12345&method=search&term=${text}&page=1`);
        if (data.success) {
            for (let i = 0; i < Math.min(5, data.wallpapers.length); i++) {
                await sock.sendMessage(from, { image: { url: data.wallpapers[i].url_image } }, { quoted: m });
            }
        }
    } catch {
        reply('❌ Gagal mencari wallpaper!');
    }
}
break;

case 'ringtone': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.ikyy.my.id/api/ringtone?query=${text}`);
        
        let textMsg = `🔔 *RINGTONE SEARCH*\nQuery: ${text}\n\n`;
        data.result.forEach((ringtone, i) => {
            textMsg += `${i+1}. *${ringtone.title}*\n`;
            textMsg += `📎 ${ringtone.audio}\n\n`;
        });
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal mencari ringtone!');
    }
}
break;

case 'google': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const googleIt = require('google-it');
        let results = await googleIt({ query: text, limit: 5 });
        
        let textMsg = `🔍 *GOOGLE SEARCH*\nQuery: ${text}\n\n`;
        results.forEach((res, i) => {
            textMsg += `${i+1}. *${res.title}*\n`;
            textMsg += `${res.link}\n`;
            textMsg += `${res.snippet}\n\n`;
        });
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal mencari di Google!');
    }
}
break;

case 'gimage': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const gis = require('g-i-s');
        gis(text, async (error, results) => {
            if (error) return reply('❌ Gagal mencari gambar!');
            
            for (let i = 0; i < Math.min(5, results.length); i++) {
                await sock.sendMessage(from, { image: { url: results[i].url } }, { quoted: m });
            }
        });
    } catch {
        reply('❌ Gagal mencari gambar!');
    }
}
break;

case 'npm': {
    if (!text) return reply('Masukkan nama package!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://registry.npmjs.org/${text}`);
        
        let textMsg = `📦 *NPM PACKAGE*\n\n`;
        textMsg += `*Nama*: ${data.name}\n`;
        textMsg += `*Versi*: ${data['dist-tags'].latest}\n`;
        textMsg += `*Deskripsi*: ${data.description || '-'}\n`;
        textMsg += `*Author*: ${data.author?.name || '-'}\n`;
        textMsg += `*License*: ${data.license || '-'}\n`;
        textMsg += `*Homepage*: ${data.homepage || '-'}\n`;
        textMsg += `*Repository*: ${data.repository?.url || '-'}`;
        
        reply(textMsg);
    } catch {
        reply('❌ Package tidak ditemukan!');
    }
}
break;

case 'style': {
    if (!text) return reply('Masukkan teks!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.ikyy.my.id/api/styletext?text=${encodeURIComponent(text)}`);
        
        let textMsg = `🎨 *STYLE TEXT*\n\n`;
        data.result.forEach((style, i) => {
            textMsg += `${i+1}. ${style.result}\n`;
        });
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal membuat style text!');
    }
}
break;

case 'cuaca': {
    if (!text) return reply('Masukkan nama kota!');
    reply(config.mess.wait);
    
    try {
        const weather = require('weather-js');
        weather.find({ search: text, degreeType: 'C' }, (err, result) => {
            if (err || !result[0]) return reply('❌ Kota tidak ditemukan!');
            
            let data = result[0];
            let textMsg = `🌤️ *CUACA*\n`;
            textMsg += `*Lokasi*: ${data.location.name}\n`;
            textMsg += `*Suhu*: ${data.current.temperature}°C\n`;
            textMsg += `*Terasa seperti*: ${data.current.feelslike}°C\n`;
            textMsg += `*Kelembaban*: ${data.current.humidity}%\n`;
            textMsg += `*Angin*: ${data.current.winddisplay}\n`;
            textMsg += `*Kondisi*: ${data.current.skytext}\n`;
            
            reply(textMsg);
        });
    } catch {
        reply('❌ Gagal mendapatkan informasi cuaca!');
    }
}
break;

case 'tenor': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://tenor.googleapis.com/v2/search?q=${text}&key=${config.tenorKey}&limit=5`);
        
        for (let gif of data.results) {
            await sock.sendMessage(from, { video: { url: gif.media_formats.mp4.url } }, { quoted: m });
        }
    } catch {
        reply('❌ Gagal mencari GIF!');
    }
}
break;

case 'urban': {
    if (!text) return reply('Masukkan kata kunci!');
    reply(config.mess.wait);
    
    try {
        const urban = require('urban-dictionary');
        let results = await urban.term(text);
        let data = results[0];
        
        let textMsg = `📚 *URBAN DICTIONARY*\n\n`;
        textMsg += `*Kata*: ${data.word}\n`;
        textMsg += `*Definisi*: ${data.definition}\n`;
        textMsg += `*Contoh*: ${data.example}\n`;
        textMsg += `*👍*: ${data.thumbs_up} | *👎*: ${data.thumbs_down}`;
        
        reply(textMsg);
    } catch {
        reply('❌ Kata tidak ditemukan!');
    }
}
break;

// ========== DOWNLOAD FEATURES ==========
case 'ytmp3': {
    if (!text) return reply('Masukkan URL YouTube!');
    reply(config.mess.wait);
    
    try {
        const ytdl = require('ytdl-core');
        const info = await ytdl.getInfo(text);
        const format = ytdl.chooseFormat(info.formats, { quality: '140' });
        
        let title = info.videoDetails.title;
        let audioStream = ytdl(text, { format });
        
        let buffer = [];
        audioStream.on('data', chunk => buffer.push(chunk));
        audioStream.on('end', async () => {
            let audioBuffer = Buffer.concat(buffer);
            await sock.sendMessage(from, { 
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                fileName: `${title}.mp3`
            }, { quoted: m });
        });
    } catch {
        reply('❌ Gagal mendownload audio!');
    }
}
break;

case 'ytmp4': {
    if (!text) return reply('Masukkan URL YouTube!');
    reply(config.mess.wait);
    
    try {
        const ytdl = require('ytdl-core');
        const info = await ytdl.getInfo(text);
        const format = ytdl.chooseFormat(info.formats, { quality: '22' });
        
        let title = info.videoDetails.title;
        let videoStream = ytdl(text, { format });
        
        let buffer = [];
        videoStream.on('data', chunk => buffer.push(chunk));
        videoStream.on('end', async () => {
            let videoBuffer = Buffer.concat(buffer);
            await sock.sendMessage(from, { 
                video: videoBuffer,
                caption: title
            }, { quoted: m });
        });
    } catch {
        reply('❌ Gagal mendownload video!');
    }
}
break;

case 'instagram':
case 'ig': {
    if (!text) return reply('Masukkan URL Instagram!');
    reply(config.mess.wait);
    
    try {
        const ig = require('instagram-url-direct');
        let result = await ig(text);
        
        if (result.url.length > 0) {
            for (let url of result.url) {
                if (url.includes('.mp4')) {
                    await sock.sendMessage(from, { video: { url } }, { quoted: m });
                } else {
                    await sock.sendMessage(from, { image: { url } }, { quoted: m });
                }
            }
        } else {
            reply('❌ Tidak ada media yang ditemukan!');
        }
    } catch {
        reply('❌ Gagal mendownload dari Instagram!');
    }
}
break;

case 'tiktok': {
    if (!text) return reply('Masukkan URL TikTok!');
    reply(config.mess.wait);
    
    try {
        const tiktok = require('tiktok-scraper');
        let result = await tiktok.video(text);
        
        await sock.sendMessage(from, { 
            video: { url: result.collector[0].videoUrl },
            caption: result.collector[0].text
        }, { quoted: m });
    } catch {
        reply('❌ Gagal mendownload dari TikTok!');
    }
}
break;

case 'tiktokmp3': {
    if (!text) return reply('Masukkan URL TikTok!');
    reply(config.mess.wait);
    
    try {
        const tiktok = require('tiktok-scraper');
        let result = await tiktok.video(text);
        
        await sock.sendMessage(from, { 
            audio: { url: result.collector[0].videoUrl },
            mimetype: 'audio/mpeg'
        }, { quoted: m });
    } catch {
        reply('❌ Gagal mendownload audio TikTok!');
    }
}
break;

case 'facebook':
case 'fb': {
    if (!text) return reply('Masukkan URL Facebook!');
    reply(config.mess.wait);
    
    try {
        const fb = require('facebook-url-direct');
        let result = await fb(text);
        
        await sock.sendMessage(from, { video: { url: result.hd } }, { quoted: m });
    } catch {
        reply('❌ Gagal mendownload dari Facebook!');
    }
}
break;

case 'spotifydl': {
    if (!text) return reply('Masukkan URL Spotify!');
    if (!isPremium) return reply(config.mess.premium);
    reply(config.mess.wait);
    
    try {
        const spotify = require('spotify-url-info');
        let data = await spotify.getData(text);
        
        reply(`🎵 *SPOTIFY*\n` +
              `Judul: ${data.name}\n` +
              `Artist: ${data.artists[0].name}\n` +
              `Album: ${data.album.name}\n` +
              `Durasi: ${Math.floor(data.duration_ms / 60000)}:${((data.duration_ms % 60000) / 1000).toFixed(0).padStart(2, '0')}\n` +
              `ℹ️ Fitur download memerlukan API Spotify`);
    } catch {
        reply('❌ Gagal mendapatkan info lagu!');
    }
}
break;

case 'mediafire': {
    if (!text) return reply('Masukkan URL MediaFire!');
    reply(config.mess.wait);
    
    try {
        const mediafire = require('mediafire-dl');
        let result = await mediafire(text);
        
        await sock.sendMessage(from, { 
            document: { url: result.link },
            fileName: result.name,
            mimetype: 'application/octet-stream'
        }, { quoted: m });
    } catch {
        reply('❌ Gagal mendownload dari MediaFire!');
    }
}
break;

// ========== QUOTES FEATURES ==========
case 'motivasi': {
    const quotes = [
        "Jangan menyerah, karena setiap usaha adalah langkah menuju kesuksesan.",
        "Kegagalan adalah kesuksesan yang tertunda.",
        "Hidup adalah petualangan, beranilah untuk menjalaninya.",
        "Mimpi tidak akan menjadi kenyataan tanpa kerja keras.",
        "Jadilah pribadi yang lebih baik dari hari ke hari.",
        "Setiap detik adalah kesempatan untuk berubah.",
        "Keberhasilan bukan milik orang pintar, tapi milik mereka yang terus berusaha."
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`💪 *MOTIVASI*\n\n${randomQuote}`);
}
break;

case 'quotes': {
    const quotes = [
        "Hidup bukan tentang menunggu badai berlalu, tapi belajar menari di tengah hujan.",
        "Kebahagiaan bukan milik mereka yang segalanya sempurna, tapi yang belajar bersyukur.",
        "Terkadang kita harus jatuh untuk tahu cara bangkit kembali.",
        "Cinta sejati adalah ketika kamu memilih seseorang setiap hari.",
        "Percaya pada proses, karena hidup mengajarkan kita dengan cara yang indah.",
        "Jangan bandingkan hidupmu dengan orang lain, karena setiap orang punya cerita masing-masing.",
        "Hidup itu seperti piano, putih dan hitam. Keduanya sama-sama indah jika dimainkan dengan benar."
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`📝 *QUOTES*\n\n${randomQuote}`);
}
break;

case 'truth': {
    const quotes = [
        "Apa hal paling memalukan yang pernah kamu alami?",
        "Siapa orang yang paling kamu cintai saat ini?",
        "Apa ketakutan terbesarmu?",
        "Apa rahasia terbesar yang belum pernah kamu ceritakan?",
        "Siapa yang pernah membuatmu patah hati?",
        "Apa hal terbodoh yang pernah kamu lakukan demi cinta?",
        "Siapa artis yang paling kamu sukai dan mengapa?"
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`🤔 *TRUTH*\n\n${randomQuote}`);
}
break;

case 'bijak': {
    const quotes = [
        "Pengalaman adalah guru yang paling berharga.",
        "Hargai orang lain sebagaimana kamu ingin dihargai.",
        "Kesabaran adalah kunci dari segala kesuksesan.",
        "Jangan pernah berhenti belajar karena hidup tak pernah berhenti mengajar.",
        "Bahagia itu sederhana, cukup bersyukur atas apa yang ada.",
        "Hidup bukan saling mendahului, tapi saling membantu.",
        "Kebaikan sekecil apapun akan kembali kepada pemiliknya."
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`🦉 *BIJAK*\n\n${randomQuote}`);
}
break;

case 'dare': {
    const quotes = [
        "Kirim pesan 'Aku suka kamu' ke mantanmu.",
        "Telpon crushmu sekarang.",
        "Nyanyi lagu favoritmu di tempat umum.",
        "Makan makanan pedas tanpa minum.",
        "Buat status WA yang memalukan.",
        "Ceritakan rahasia terbesarmu di grup ini.",
        "Sebutkan 3 orang yang pernah kamu sukai secara diam-diam."
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`😈 *DARE*\n\n${randomQuote}`);
}
break;

case 'bucin': {
    const quotes = [
        "Cinta itu buta, tapi kalau sama kamu rela buta selamanya.",
        "Aku rela jadi batu di jalan yang kamu lewati, asal bisa dekat denganmu.",
        "Kalau cinta itu buta, aku rela buta selamanya asalkan kamu yang jadi penuntunku.",
        "Jangan main-main dengan hatiku, karena aku hanya punya satu dan sudah kuberikan padamu.",
        "Lebih baik lelah berlari mengejar mimpi daripada lelah karena memikirkanmu.",
        "Cinta itu sederhana, datang tanpa diundak pergi tanpa diusir.",
        "Aku rela jadi pengecut di hadapanmu, karena aku takut kehilanganmu."
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`🥰 *BUCIN*\n\n${randomQuote}`);
}
break;

case 'renungan': {
    const quotes = [
        "Apa yang sudah kamu lakukan hari ini untuk masa depanmu?",
        "Apakah kamu sudah menjadi versi terbaik dirimu hari ini?",
        "Sudahkah kamu bersyukur atas semua nikmat hari ini?",
        "Apa yang akan kamu lakukan jika hari ini adalah hari terakhirmu?",
        "Sudahkah kamu membahagiakan orang-orang di sekitarmu hari ini?",
        "Apakah kamu sudah memaafkan dirimu sendiri atas kesalahan di masa lalu?",
        "Sudahkah kamu berbuat baik hari ini tanpa mengharap imbalan?"
    ];
    let randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    reply(`🤲 *RENUNGAN*\n\n${randomQuote}`);
}
break;

// ========== TOOLS FEATURES ==========
case 'get': {
    if (!isPremium) return reply(config.mess.premium);
    if (!text) return reply('Masukkan URL!');
    reply(config.mess.wait);
    
    try {
        const response = await axios.get(text, { responseType: 'arraybuffer' });
        const contentType = response.headers['content-type'];
        
        if (contentType.includes('image')) {
            await sock.sendMessage(from, { image: Buffer.from(response.data) }, { quoted: m });
        } else if (contentType.includes('video')) {
            await sock.sendMessage(from, { video: Buffer.from(response.data) }, { quoted: m });
        } else if (contentType.includes('audio')) {
            await sock.sendMessage(from, { audio: Buffer.from(response.data) }, { quoted: m });
        } else if (contentType.includes('pdf')) {
            await sock.sendMessage(from, { 
                document: Buffer.from(response.data),
                fileName: 'file.pdf',
                mimetype: 'application/pdf'
            }, { quoted: m });
        } else {
            let text = response.data.toString();
            reply(text.slice(0, 4000));
        }
    } catch {
        reply('❌ Gagal mengambil konten dari URL!');
    }
}
break;

case 'hd': {
    if (!isQuoted) return reply('Reply gambar yang ingin di HD-kan!');
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'image');
    
    try {
        const sharp = require('sharp');
        let hdBuffer = await sharp(buffer)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .sharpen()
            .toBuffer();
        
        await sock.sendMessage(from, { image: hdBuffer }, { quoted: m });
    } catch {
        reply('❌ Gagal meningkatkan kualitas gambar!');
    }
}
break;

case 'toaudio':
case 'tomp3':
case 'tovn': {
    if (!isQuoted) return reply('Reply video/audio yang ingin diubah!');
    let media = quoted?.videoMessage || quoted?.audioMessage || m.message?.videoMessage || m.message?.audioMessage;
    if (!media) return reply('Reply video atau audio!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, media.mimetype?.includes('video') ? 'video' : 'audio');
    
    // Convert to audio using ffmpeg
    let inputPath = path.join(__dirname, 'tmp', Date.now() + '.input');
    let outputPath = path.join(__dirname, 'tmp', Date.now() + '.mp3');
    
    fs.writeFileSync(inputPath, buffer);
    
    exec(`ffmpeg -i ${inputPath} -vn -acodec libmp3lame -q:a 4 ${outputPath}`, async (error) => {
        if (error) {
            reply('❌ Gagal mengkonversi!');
            fs.unlinkSync(inputPath);
            return;
        }
        
        let audioBuffer = fs.readFileSync(outputPath);
        
        if (command === 'tovn') {
            await sock.sendMessage(from, { 
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                ptt: true
            }, { quoted: m });
        } else {
            await sock.sendMessage(from, { 
                audio: audioBuffer,
                mimetype: 'audio/mpeg'
            }, { quoted: m });
        }
        
        // Clean up temp files
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
    });
}
break;
 case 'toimage': {
    if (!isQuoted) return reply('Reply sticker yang ingin dijadikan gambar!');
    let media = quoted?.stickerMessage;
    if (!media) return reply('Reply sticker!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'sticker');
    
    // Convert webp to png using sharp
    try {
        const sharp = require('sharp');
        let imageBuffer = await sharp(buffer).png().toBuffer();
        await sock.sendMessage(from, { image: imageBuffer }, { quoted: m });
    } catch {
        reply('❌ Gagal mengkonversi sticker ke gambar!');
    }
}
break;

case 'toptv': {
    if (!isQuoted) return reply('Reply gambar yang ingin dijadikan video!');
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'image');
    
    // Convert image to video using ffmpeg
    let inputPath = path.join(__dirname, 'tmp', Date.now() + '.jpg');
    let outputPath = path.join(__dirname, 'tmp', Date.now() + '.mp4');
    
    fs.writeFileSync(inputPath, buffer);
    
    exec(`ffmpeg -loop 1 -i ${inputPath} -c:v libx264 -t 5 -pix_fmt yuv420p -vf scale=1280:720 ${outputPath}`, async (error) => {
        if (error) {
            reply('❌ Gagal mengkonversi!');
            fs.unlinkSync(inputPath);
            return;
        }
        
        let videoBuffer = fs.readFileSync(outputPath);
        await sock.sendMessage(from, { video: videoBuffer }, { quoted: m });
        
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
    });
}
break;

case 'tourl': {
    if (!isQuoted) return reply('Reply media yang ingin diupload!');
    let media = quoted?.imageMessage || quoted?.videoMessage || quoted?.audioMessage || quoted?.documentMessage;
    if (!media) return reply('Reply media!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 
        media.imageMessage ? 'image' : 
        media.videoMessage ? 'video' : 
        media.audioMessage ? 'audio' : 'document'
    );
    
    try {
        // Upload to telegra.ph
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('file', Buffer.from(buffer), {
            filename: 'file.' + (media.imageMessage ? 'jpg' : media.videoMessage ? 'mp4' : media.audioMessage ? 'mp3' : 'bin'),
            contentType: media.mimetype
        });
        
        const response = await axios.post('https://telegra.ph/upload', formData, {
            headers: {
                ...formData.getHeaders()
            }
        });
        
        let url = 'https://telegra.ph' + response.data[0].src;
        reply(`✅ *URL:* ${url}`);
    } catch (e) {
        console.error(e);
        reply('❌ Gagal mengupload!');
    }
}
break;

case 'tts': {
    if (!text) return reply('Masukkan teks!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=id&client=tw-ob`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            audio: Buffer.from(data),
            mimetype: 'audio/mpeg',
            ptt: true
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat TTS!');
    }
}
break;

case 'toqr': {
    if (!text) return reply('Masukkan teks atau URL!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data),
            caption: '✅ QR Code berhasil dibuat!'
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat QR Code!');
    }
}
break;

case 'brat': {
    if (!text) return reply('Masukkan teks!');
    
    try {
        const { data } = await axios.get(`https://api.bratgenerator.com/generate?text=${encodeURIComponent(text)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data)
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat brat image!');
    }
}
break;

case 'bratvid': {
    if (!text) return reply('Masukkan teks!');
    
    try {
        const { data } = await axios.get(`https://api.bratgenerator.com/generate-video?text=${encodeURIComponent(text)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            video: Buffer.from(data)
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat brat video!');
    }
}
break;

case 'ssweb': {
    if (!isPremium) return reply(config.mess.premium);
    if (!text) return reply('Masukkan URL!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.screenshotmachine.com/?key=${config.screenshotKey || '12345'}&url=${encodeURIComponent(text)}&dimension=1024x768`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data),
            caption: `📸 Screenshot: ${text}`
        }, { quoted: m });
    } catch {
        reply('❌ Gagal mengambil screenshot!');
    }
}
break;

case 'sticker':
case 's': {
    let media = quoted?.imageMessage || quoted?.videoMessage || m.message?.imageMessage;
    if (!media) return reply('Kirim/reply gambar/video untuk dibuat stiker!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, media.imageMessage ? 'image' : 'video');
    
    // Convert to webp sticker
    let inputPath = path.join(__dirname, 'tmp', Date.now() + (media.imageMessage ? '.jpg' : '.mp4'));
    let outputPath = path.join(__dirname, 'tmp', Date.now() + '.webp');
    
    fs.writeFileSync(inputPath, buffer);
    
    if (media.imageMessage) {
        exec(`ffmpeg -i ${inputPath} -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" ${outputPath}`, async (error) => {
            if (error) {
                reply('❌ Gagal membuat stiker!');
                fs.unlinkSync(inputPath);
                return;
            }
            
            let stickerBuffer = fs.readFileSync(outputPath);
            
            // Add exif
            const { addExif } = require('./lib/exif');
            let webpWithExif = await addExif(stickerBuffer, config.packname, config.author);
            
            await sock.sendMessage(from, { 
                sticker: webpWithExif
            }, { quoted: m });
            
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
        });
    } else {
        exec(`ffmpeg -i ${inputPath} -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" ${outputPath}`, async (error) => {
            if (error) {
                reply('❌ Gagal membuat stiker!');
                fs.unlinkSync(inputPath);
                return;
            }
            
            let stickerBuffer = fs.readFileSync(outputPath);
            
            // Add exif
            const { addExif } = require('./lib/exif');
            let webpWithExif = await addExif(stickerBuffer, config.packname, config.author);
            
            await sock.sendMessage(from, { 
                sticker: webpWithExif
            }, { quoted: m });
            
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
        });
    }
}
break;

case 'colong': {
    if (!isQuoted) return reply('Reply stiker yang ingin diambil gambarnya!');
    let media = quoted?.stickerMessage;
    if (!media) return reply('Reply stiker!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'sticker');
    
    // Convert webp to png
    try {
        const sharp = require('sharp');
        let imageBuffer = await sharp(buffer).png().toBuffer();
        await sock.sendMessage(from, { image: imageBuffer }, { quoted: m });
    } catch {
        reply('❌ Gagal mengkonversi stiker!');
    }
}
break;

case 'smeme': {
    if (!text) return reply('Masukkan teks atas|teks bawah');
    let [topText, bottomText] = text.split('|');
    
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Kirim/reply gambar!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'image');
    
    // Add meme text using jimp
    try {
        const Jimp = require('jimp');
        const image = await Jimp.read(buffer);
        const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
        const fontBlack = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
        
        // Add top text
        if (topText) {
            image.print(font, 10, 10, {
                text: topText,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: Jimp.VERTICAL_ALIGN_TOP
            }, image.bitmap.width - 20, 100);
        }
        
        // Add bottom text
        if (bottomText) {
            image.print(font, 10, image.bitmap.height - 60, {
                text: bottomText,
                alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                alignmentY: Jimp.VERTICAL_ALIGN_BOTTOM
            }, image.bitmap.width - 20, 100);
        }
        
        let memeBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
        await sock.sendMessage(from, { image: memeBuffer }, { quoted: m });
    } catch (e) {
        console.error(e);
        reply('❌ Gagal membuat meme!');
    }
}
break;

case 'dehaze':
case 'colorize':
case 'hitamkan': {
    if (!isQuoted) return reply('Reply gambar yang ingin diproses!');
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'image');
    
    try {
        const sharp = require('sharp');
        let processedBuffer;
        
        if (command === 'dehaze') {
            processedBuffer = await sharp(buffer)
                .modulate({ brightness: 1.1, saturation: 1.2 })
                .sharpen()
                .toBuffer();
        } else if (command === 'colorize') {
            processedBuffer = await sharp(buffer)
                .modulate({ saturation: 2 })
                .toBuffer();
        } else if (command === 'hitamkan') {
            processedBuffer = await sharp(buffer)
                .greyscale()
                .toBuffer();
        }
        
        await sock.sendMessage(from, { image: processedBuffer }, { quoted: m });
    } catch {
        reply('❌ Gagal memproses gambar!');
    }
}
break;

case 'emojimix': {
    if (!text) return reply('Contoh: .emojimix 😂+😭');
    let [emoji1, emoji2] = text.split('+');
    if (!emoji1 || !emoji2) return reply('Format salah!');
    
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://emojimix-api.vercel.app/api/${encodeURIComponent(emoji1)}/${encodeURIComponent(emoji2)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data)
        }, { quoted: m });
    } catch {
        reply('❌ Gagal menggabungkan emoji!');
    }
}
break;

case 'nulis': {
    if (!text) return reply('Masukkan teks yang ingin ditulis!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.ikyy.my.id/api/nulis?text=${encodeURIComponent(text)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data),
            caption: '📝 Nulis berhasil!'
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat tulisan!');
    }
}
break;

case 'readmore': {
    if (!text) return reply('Contoh: .readmore text1|text2');
    let [text1, text2] = text.split('|');
    if (!text1 || !text2) return reply('Format salah!');
    
    let readmore = text1 + '\u200E'.repeat(8000) + text2;
    reply(readmore);
}
break;

case 'qc': {
    if (!text) return reply('Masukkan pesan!');
    reply(config.mess.wait);
    
    try {
        let ppUrl;
        try {
            ppUrl = await sock.profilePictureUrl(sender, 'image');
        } catch {
            ppUrl = 'https://telegra.ph/file/1e1e3c9d3e5e3b3c9d3e5.jpg';
        }
        
        const { data } = await axios.get(`https://api.ikyy.my.id/api/quotesmaker?text=${encodeURIComponent(text)}&type=qc&name=${encodeURIComponent(pushName)}&avatar=${encodeURIComponent(ppUrl)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data)
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat quotes!');
    }
}
break;

case 'translate':
case 'tr': {
    if (!isQuoted && !text) return reply('Reply pesan atau masukkan teks!');
    reply(config.mess.wait);
    
    let translateText = text || quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || quoted.videoMessage?.caption;
    if (!translateText) return reply('Tidak ada teks untuk diterjemahkan!');
    
    try {
        const translate = require('translate-google-api');
        const result = await translate(translateText, { to: 'id' });
        
        reply(`📝 *TERJEMAHAN*\n\n*Asli*: ${translateText}\n*Hasil*: ${result}`);
    } catch {
        reply('❌ Gagal menerjemahkan!');
    }
}
break;

case 'wasted': {
    if (!isQuoted) return reply('Reply gambar yang ingin di-wasted!');
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'image');
    
    try {
        const { data } = await axios.post('https://api.ikyy.my.id/api/wasted', buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { image: Buffer.from(data) }, { quoted: m });
    } catch {
        reply('❌ Gagal memproses gambar!');
    }
}
break;

case 'triggered': {
    if (!isQuoted) return reply('Reply gambar yang ingin di-triggered!');
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, 'image');
    
    try {
        const { data } = await axios.post('https://api.ikyy.my.id/api/triggered', buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { video: Buffer.from(data) }, { quoted: m });
    } catch {
        reply('❌ Gagal memproses gambar!');
    }
}
break;

case 'shorturl': {
    if (!text) return reply('Masukkan URL!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`);
        reply(`🔗 *Short URL*\n\n*Asli*: ${text}\n*Pendek*: ${data}`);
    } catch {
        reply('❌ Gagal memperpendek URL!');
    }
}
break;

case 'gitclone': {
    if (!text) return reply('Masukkan URL repository GitHub!');
    reply(config.mess.wait);
    
    try {
        let url = text.replace('https://github.com/', '').replace('.git', '');
        let [username, repo] = url.split('/');
        
        const { data } = await axios.get(`https://api.github.com/repos/${username}/${repo}`);
        
        let textMsg = `📦 *GITHUB REPOSITORY*\n\n`;
        textMsg += `*Nama*: ${data.name}\n`;
        textMsg += `*Owner*: ${data.owner.login}\n`;
        textMsg += `*Deskripsi*: ${data.description || '-'}\n`;
        textMsg += `*Stars*: ${data.stargazers_count}\n`;
        textMsg += `*Forks*: ${data.forks_count}\n`;
        textMsg += `*Issues*: ${data.open_issues_count}\n`;
        textMsg += `*Language*: ${data.language || '-'}\n`;
        textMsg += `*License*: ${data.license?.name || '-'}\n`;
        textMsg += `*URL*: ${data.html_url}`;
        
        reply(textMsg);
    } catch {
        reply('❌ Repository tidak ditemukan!');
    }
}
break;

// Audio effects
case 'fat':
case 'fast':
case 'bass':
case 'slow':
case 'tupai':
case 'deep':
case 'robot':
case 'blown':
case 'reverse':
case 'smooth':
case 'earrape':
case 'nightcore': {
    if (!isQuoted) return reply('Reply audio yang ingin diubah!');
    let media = quoted?.audioMessage || quoted?.videoMessage;
    if (!media) return reply('Reply audio!');
    
    reply(config.mess.wait);
    
    let buffer = await downloadMedia(media, media.audioMessage ? 'audio' : 'video');
    
    let inputPath = path.join(__dirname, 'tmp', Date.now() + '.input');
    let outputPath = path.join(__dirname, 'tmp', Date.now() + '.mp3');
    
    fs.writeFileSync(inputPath, buffer);
    
    let ffmpegCommand = '';
    switch(command) {
        case 'fat':
        case 'slow':
            ffmpegCommand = `ffmpeg -i ${inputPath} -filter:a "atempo=0.8" ${outputPath}`;
            break;
        case 'fast':
            ffmpegCommand = `ffmpeg -i ${inputPath} -filter:a "atempo=1.5" ${outputPath}`;
            break;
        case 'bass':
            ffmpegCommand = `ffmpeg -i ${inputPath} -af "bass=g=10" ${outputPath}`;
            break;
        case 'tupai':
            ffmpegCommand = `ffmpeg -i ${inputPath} -filter:a "atempo=2.0,asetrate=44100*0.8" ${outputPath}`;
            break;
        case 'deep':
            ffmpegCommand = `ffmpeg -i ${inputPath} -af "asetrate=44100*0.7,atempo=1.42857" ${outputPath}`;
            break;
        case 'robot':
            ffmpegCommand = `ffmpeg -i ${inputPath} -filter:a "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75" ${outputPath}`;
            break;
        case 'blown':
            ffmpegCommand = `ffmpeg -i ${inputPath} -af "acrusher=.1:1:64:0:log" ${outputPath}`;
            break;
        case 'reverse':
            ffmpegCommand = `ffmpeg -i ${inputPath} -af "areverse" ${outputPath}`;
            break;
        case 'smooth':
            ffmpegCommand = `ffmpeg -i ${inputPath} -filter:a "loudnorm" ${outputPath}`;
            break;
        case 'earrape':
            ffmpegCommand = `ffmpeg -i ${inputPath} -af "volume=5" ${outputPath}`;
            break;
        case 'nightcore':
            ffmpegCommand = `ffmpeg -i ${inputPath} -filter:a "atempo=1.3,asetrate=44100*1.3" ${outputPath}`;
            break;
    }
    
    exec(ffmpegCommand, async (error) => {
        if (error) {
            reply('❌ Gagal mengubah audio!');
            fs.unlinkSync(inputPath);
            return;
        }
        
        let audioBuffer = fs.readFileSync(outputPath);
        await sock.sendMessage(from, { 
            audio: audioBuffer,
            mimetype: 'audio/mpeg'
        }, { quoted: m });
        
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
    });
}
break;

case 'getexif': {
    if (!isQuoted) return reply('Reply stiker yang ingin diambil exifnya!');
    let media = quoted?.stickerMessage;
    if (!media) return reply('Reply stiker!');
    
    let buffer = await downloadMedia(media, 'sticker');
    
    try {
        const webp = require('node-webpmux');
        const img = new webp.Image();
        await img.load(buffer);
        
        if (img.exif) {
            let exif = img.exif.toString('utf-8');
            reply(`📋 *EXIF DATA*\n\n${exif}`);
        } else {
            reply('Stiker tidak memiliki data exif!');
        }
    } catch {
        reply('❌ Gagal membaca exif!');
    }
}
break;
 // ========== AI FEATURES ==========
case 'ai': {
    if (!text) return reply('Masukkan pertanyaan!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'Kamu adalah asisten AI yang membantu dan ramah. Gunakan bahasa Indonesia yang baik.' },
                { role: 'user', content: text }
            ],
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${config.openaiKey || 'sk-dummy'}`,
                'Content-Type': 'application/json'
            }
        });
        
        reply(data.choices[0].message.content.trim());
    } catch (e) {
        console.error(e);
        reply('❌ Gagal mendapatkan respon AI!');
    }
}
break;

case 'gemini': {
    if (!text) return reply('Masukkan pertanyaan!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${config.geminiKey || 'dummy'}`, {
            contents: [{
                parts: [{
                    text: text
                }]
            }]
        });
        
        reply(data.candidates[0].content.parts[0].text);
    } catch {
        reply('❌ Gagal mendapatkan respon Gemini!');
    }
}
break;

case 'txt2img': {
    if (!text) return reply('Masukkan prompt!');
    if (!isPremium) return reply(config.mess.premium);
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.post('https://api.openai.com/v1/images/generations', {
            prompt: text,
            n: 1,
            size: '1024x1024'
        }, {
            headers: {
                'Authorization': `Bearer ${config.openaiKey || 'sk-dummy'}`,
                'Content-Type': 'application/json'
            }
        });
        
        await sock.sendMessage(from, { 
            image: { url: data.data[0].url },
            caption: `🎨 *AI Generated Image*\nPrompt: ${text}`
        }, { quoted: m });
    } catch {
        reply('❌ Gagal membuat gambar!');
    }
}
break;

// ========== ANIME FEATURES ==========
case 'waifu':
case 'neko': {
    let endpoint = command === 'waifu' ? 'waifu' : 'neko';
    
    try {
        const { data } = await axios.get(`https://api.waifu.pics/sfw/${endpoint}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(from, { 
            image: Buffer.from(data)
        }, { quoted: m });
    } catch {
        reply('❌ Gagal mengambil gambar!');
    }
}
break;

// ========== GAME FEATURES ==========
case 'tictactoe':
case 'ttt': {
    if (!isGroup) return reply(config.mess.group);
    
    // Initialize game state
    if (!db.data.games) db.data.games = {};
    if (!db.data.games[from]) db.data.games[from] = {};
    
    let game = db.data.games[from].tictactoe;
    if (game) return reply('Game sedang berlangsung di grup ini!');
    
    game = {
        board: ['⬜', '⬜', '⬜', '⬜', '⬜', '⬜', '⬜', '⬜', '⬜'],
        turn: '❌',
        players: [sender, null],
        state: 'waiting'
    };
    
    db.data.games[from].tictactoe = game;
    db.save();
    
    let textMsg = `🎮 *TIC TAC TOE*\n\n`;
    textMsg += `Pemain 1: @${sender.split('@')[0]} (❌)\n`;
    textMsg += `Menunggu pemain 2...\n\n`;
    textMsg += `Ketik .join ttt untuk bergabung`;
    
    await sock.sendMessage(from, { text: textMsg, mentions: [sender] }, { quoted: m });
}
break;

case 'join': {
    if (!isGroup) return reply(config.mess.group);
    if (!args[0] || args[0] !== 'ttt') return reply('Join game apa? Contoh: .join ttt');
    
    if (!db.data.games) db.data.games = {};
    if (!db.data.games[from]) db.data.games[from] = {};
    
    let game = db.data.games[from].tictactoe;
    if (!game) return reply('Tidak ada game tictactoe yang sedang berlangsung!');
    
    if (game.players.includes(sender)) return reply('Kamu sudah bergabung dalam game!');
    if (game.players[1]) return reply('Game sudah penuh!');
    
    game.players[1] = sender;
    game.state = 'playing';
    db.save();
    
    let textMsg = `🎮 *TIC TAC TOE*\n\n`;
    textMsg += `Pemain 1: @${game.players[0].split('@')[0]} (❌)\n`;
    textMsg += `Pemain 2: @${game.players[1].split('@')[0]} (⭕)\n\n`;
    textMsg += `Giliran: ${game.turn}\n\n`;
    for (let i = 0; i < 9; i += 3) {
        textMsg += `${game.board[i]} ${game.board[i+1]} ${game.board[i+2]}\n`;
    }
    textMsg += `\nKetik angka 1-9 untuk memilih kotak`;
    
    await sock.sendMessage(from, { text: textMsg, mentions: game.players }, { quoted: m });
}
break;

// Handle tictactoe moves (akan diproses di default case)
// Untuk angka 1-9 akan diproses di bagian bawah setelah switch case

case 'akinator': {
    reply('🚧 Fitur Akinator dalam pengembangan!');
}
break;

case 'suit': {
    if (!text) return reply('Pilih: batu, kertas, gunting');
    let pilihan = text.toLowerCase();
    let komp = ['batu', 'kertas', 'gunting'][Math.floor(Math.random() * 3)];
    
    let result = '';
    if (pilihan === komp) {
        result = 'Seri!';
    } else if (
        (pilihan === 'batu' && komp === 'gunting') ||
        (pilihan === 'kertas' && komp === 'batu') ||
        (pilihan === 'gunting' && komp === 'kertas')
    ) {
        result = 'Kamu menang! +100 money';
        user.money += 100;
        db.save();
    } else {
        result = 'Kamu kalah! -50 money';
        user.money -= 50;
        db.save();
    }
    
    reply(`🤜 *SUIT*\n\nKamu: ${pilihan}\nBot: ${komp}\nHasil: ${result}`);
}
break;

case 'slot': {
    let symbols = ['🍒', '🍊', '🍋', '🍇', '💎', '7️⃣'];
    let slot1 = symbols[Math.floor(Math.random() * symbols.length)];
    let slot2 = symbols[Math.floor(Math.random() * symbols.length)];
    let slot3 = symbols[Math.floor(Math.random() * symbols.length)];
    
    let result = '';
    if (slot1 === slot2 && slot2 === slot3) {
        result = 'JACKPOT! Kamu menang 1000 money!';
        user.money += 1000;
    } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
        result = 'Menang kecil! Kamu dapat 100 money!';
        user.money += 100;
    } else {
        result = 'Kamu kalah! -50 money';
        user.money -= 50;
    }
    db.save();
    
    reply(`🎰 *SLOT*\n\n[ ${slot1} | ${slot2} | ${slot3} ]\n\n${result}`);
}
break;

case 'math': {
    let level = parseInt(args[0]) || 1;
    let operators = ['+', '-', '*', '/'];
    let op = operators[Math.floor(Math.random() * operators.length)];
    let num1 = Math.floor(Math.random() * (10 * level)) + 1;
    let num2 = Math.floor(Math.random() * (10 * level)) + 1;
    
    // Untuk pembagian, pastikan hasilnya bulat
    if (op === '/') {
        num2 = Math.max(1, Math.floor(Math.random() * 5));
        num1 = num2 * (Math.floor(Math.random() * 5) + 1);
    }
    
    let question = `${num1} ${op} ${num2}`;
    let answer = eval(question);
    
    // Simpan jawaban untuk pengecekan nanti
    if (!db.data.games) db.data.games = {};
    if (!db.data.games[from]) db.data.games[from] = {};
    db.data.games[from].math = {
        answer: answer,
        user: sender,
        time: Date.now()
    };
    db.save();
    
    reply(`🧮 *MATH LEVEL ${level}*\n\nSoal: ${question} = ?\n\nKetik jawaban dalam 30 detik!`);
    
    // Hapus jawaban setelah 30 detik
    setTimeout(() => {
        if (db.data.games?.[from]?.math) {
            delete db.data.games[from].math;
            db.save();
        }
    }, 30000);
}
break;

case 'begal': {
    reply('🚧 Fitur Begal dalam pengembangan!');
}
break;

case 'ulartangga': {
    reply('🚧 Fitur Ular Tangga dalam pengembangan!');
}
break;

case 'blackjack': {
    reply('🚧 Fitur Blackjack dalam pengembangan!');
}
break;

case 'catur': {
    reply('🚧 Fitur Catur dalam pengembangan!');
}
break;

case 'casino': {
    if (!text) return reply('Masukkan nominal taruhan!');
    let bet = parseInt(text);
    if (isNaN(bet) || bet < 100) return reply('Minimal taruhan 100 money!');
    if (user.money < bet) return reply(`Money tidak cukup! Kamu punya ${user.money} money`);
    
    let roll = Math.floor(Math.random() * 37); // 0-36
    let win = false;
    let multiplier = 0;
    
    // Aturan roulette sederhana
    if (roll === 0) {
        win = true;
        multiplier = 35; // Jackpot
    } else if (roll % 2 === 0) {
        win = true;
        multiplier = 2; // Genap
    }
    
    if (win) {
        let winAmount = bet * multiplier;
        user.money += winAmount - bet;
        reply(`🎰 *CASINO*\n\nAngka: ${roll}\nKamu menang! +${winAmount - bet} money\nSaldo: ${user.money}`);
    } else {
        user.money -= bet;
        reply(`🎰 *CASINO*\n\nAngka: ${roll}\nKamu kalah! -${bet} money\nSaldo: ${user.money}`);
    }
    db.save();
}
break;

case 'samgong': {
    if (!text) return reply('Masukkan nominal taruhan!');
    let bet = parseInt(text);
    if (isNaN(bet) || bet < 100) return reply('Minimal taruhan 100 money!');
    if (user.money < bet) return reply(`Money tidak cukup! Kamu punya ${user.money} money`);
    
    // Samgong sederhana (high-low)
    let playerCard = Math.floor(Math.random() * 10) + 1;
    let botCard = Math.floor(Math.random() * 10) + 1;
    
    let result = '';
    if (playerCard > botCard) {
        user.money += bet;
        result = `Kamu menang! +${bet} money`;
    } else if (playerCard < botCard) {
        user.money -= bet;
        result = `Kamu kalah! -${bet} money`;
    } else {
        result = 'Seri! Money kembali';
    }
    db.save();
    
    reply(`🃏 *SAMGONG*\n\nKartu kamu: ${playerCard}\nKartu bot: ${botCard}\n${result}\nSaldo: ${user.money}`);
}
break;

case 'rampok': {
    if (!isGroup) return reply(config.mess.group);
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0];
    if (!target) return reply('Tag user yang ingin dirampok!');
    if (target === sender) return reply('Tidak bisa merampok diri sendiri!');
    
    let targetUser = db.getUser(target);
    if (targetUser.money < 100) return reply('Target tidak punya cukup money untuk dirampok!');
    
    // Chance berhasil 50%
    let success = Math.random() < 0.5;
    let amount = Math.floor(Math.random() * Math.min(1000, targetUser.money)) + 100;
    
    if (success) {
        targetUser.money -= amount;
        user.money += amount;
        reply(`💰 *RAMPOK BERHASIL*\n\nKamu merampok @${target.split('@')[0]} sebesar ${amount} money!`, { mentions: [target] });
    } else {
        // Gagal, bayar denda
        let penalty = Math.floor(amount / 2);
        user.money -= penalty;
        reply(`👮 *RAMPOK GAGAL*\n\nKamu tertangkap dan didenda ${penalty} money!`, { mentions: [target] });
    }
    db.save();
}
break;

case 'tekateki':
case 'tebaklirik':
case 'tebakkata':
case 'tebakbom':
case 'susunkata':
case 'colorblind':
case 'tebakkimia':
case 'caklontong':
case 'tebakangka':
case 'tebaknegara':
case 'tebakgambar':
case 'tebakbendera': {
    reply('🚧 Fitur game sedang dalam pengembangan!');
}
break;

// ========== FUN FEATURES ==========
case 'coba':
case 'dadu': {
    let dice = Math.floor(Math.random() * 6) + 1;
    reply(`🎲 *DADU*\n\nAngka: ${dice}`);
}
break;

case 'bisakah':
case 'apakah':
case 'kapan':
case 'siapa': {
    if (!text) return reply(`Masukkan pertanyaan untuk .${command}`);
    
    let answers = {
        bisakah: ['Bisa', 'Tidak bisa', 'Mungkin bisa', 'Coba saja dulu', 'Sepertinya bisa', 'Insya Allah bisa', 'Jangan harap bisa'],
        apakah: ['Iya', 'Tidak', 'Mungkin', 'Coba tanya lagi', 'Jangan tanya saya', 'Sudah pasti', 'Tentu saja'],
        kapan: ['Nanti', 'Besok', 'Lusa', 'Tahun depan', 'Tidak lama lagi', 'Sebentar lagi', 'Tunggu waktu yang tepat'],
        siapa: ['Saya', 'Kamu', 'Dia', 'Mereka', 'Kita semua', 'Orang lain', 'Tidak ada yang tahu']
    };
    
    let answer = answers[command][Math.floor(Math.random() * answers[command].length)];
    reply(`❓ *${command.toUpperCase()}*\n\nQ: ${text}\nA: ${answer}`);
}
break;

case 'kerangajaib': {
    if (!text) return reply('Masukkan pertanyaan untuk kerang ajaib!');
    
    let answers = [
        'Iya', 'Tidak', 'Mungkin', 'Bisa jadi', 'Coba tanya lagi',
        'Tidak mungkin', 'Sudah pasti', 'Jangan harap', 'Coba lihat nanti',
        'Saya tidak tahu', 'Terserah kamu', 'Yang penting yakin',
        '100% iya', '100% tidak', '50:50', 'Tanyakan pada rumput yang bergoyang'
    ];
    
    let answer = answers[Math.floor(Math.random() * answers.length)];
    reply(`🐚 *KERANG AJAIB*\n\nQ: ${text}\nA: ${answer}`);
}
break;

case 'cekmati': {
    let name = text || pushName || 'Anonymous';
    let percentage = Math.floor(Math.random() * 101);
    let reason = percentage > 70 ? 'Waktunya sudah dekat, perbanyak amal' : 
                 percentage > 40 ? 'Masih panjang umur, tapi jaga kesehatan' : 
                 'Masih panjang umur, semangat terus';
    
    reply(`💀 *CEK MATI*\nNama: ${name}\nPersentase: ${percentage}%\nCatatan: ${reason}`);
}
break;

case 'ceksifat': {
    let sifat = [
        'Baik hati', 'Pemarah', 'Pendiam', 'Ceria', 'Misterius',
        'Romantis', 'Penyayang', 'Egois', 'Dermawan', 'Sombong',
        'Pemberani', 'Penakut', 'Rajin', 'Malas', 'Jujur',
        'Pembohong', 'Setia', 'Playboy', 'Humble', 'Ambisi'
    ];
    
    let sifat1 = sifat[Math.floor(Math.random() * sifat.length)];
    let sifat2 = sifat[Math.floor(Math.random() * sifat.length)];
    while (sifat2 === sifat1) {
        sifat2 = sifat[Math.floor(Math.random() * sifat.length)];
    }
    
    reply(`📋 *CEK SIFAT*\n\nNama: ${pushName}\nSifat: ${sifat1} dan ${sifat2}`);
}
break;

case 'cekkhodam': {
    let name = text || pushName || 'Anonymous';
    let khodam = [
        'Macan Putih', 'Naga Hijau', 'Garuda Emas', 'Kyai Slamet',
        'Eyang Sapujagad', 'Jenglot Hitam', 'Genderuwo', 'Tuyul',
        'Pocong', 'Kuntilanak', 'Buto Ijo', 'Nyi Roro Kidul',
        'Singa Barong', 'Harimau Sumatera', 'Elang Jawa', 'Komodo',
        'Ratu Pantai Selatan', 'Sunan Kalijaga', 'Syekh Siti Jenar'
    ];
    
    let selected = khodam[Math.floor(Math.random() * khodam.length)];
    let kekuatan = Math.floor(Math.random() * 100) + 1;
    
    reply(`👻 *CEK KHODAM*\n\nNama: ${name}\nKhodam: ${selected}\nKekuatan: ${kekuatan}%`);
}
break;

case 'rate': {
    let target = isQuoted ? quotedMsg.participant : sender;
    let rating = Math.floor(Math.random() * 101);
    let emoji = rating >= 90 ? '😍' : rating >= 70 ? '😊' : rating >= 50 ? '😐' : rating >= 30 ? '😒' : '💔';
    
    reply(`⭐ *RATING*\n@${target.split('@')[0]}\nRating: ${rating}/100 ${emoji}`, { mentions: [target] });
}
break;

case 'jodohku': {
    let target = isQuoted ? quotedMsg.participant : sender;
    let percentage = Math.floor(Math.random() * 101);
    let emoji = percentage >= 90 ? '❤️' : percentage >= 70 ? '💕' : percentage >= 50 ? '💛' : percentage >= 30 ? '💔' : '💀';
    
    reply(`💕 *JODOHKU*\n\nDengan: @${target.split('@')[0]}\nKecocokan: ${percentage}% ${emoji}`, { mentions: [target] });
}
break;

case 'jadian': {
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0];
    if (!target) return reply('Tag orang yang ingin diajak jadian!');
    
    let answers = ['Diterima! ❤️', 'Ditolak! 💔', 'Dipending! 🤔', 'Dikibul! 😂', 'Minta waktu dulu 🥺'];
    let answer = answers[Math.floor(Math.random() * answers.length)];
    
    reply(`💌 *JADIAN*\n\nDari: @${senderNumber}\nUntuk: @${target.split('@')[0]}\nHasil: ${answer}`, { mentions: [sender, target] });
}
break;

case 'fitnah': {
    if (!text) return reply('Contoh: .fitnah @user|fitnahannya');
    let [target, fitnahText] = text.split('|');
    target = target.replace('@', '') + '@s.whatsapp.net';
    
    reply(`👀 *FITNAH*\n\n@${senderNumber} : ${fitnahText}`, { mentions: [sender, target] });
}
break;

case 'halah':
case 'hilih':
case 'huluh':
case 'heleh':
case 'holoh': {
    if (!text) return reply('Masukkan teks!');
    
    let convert = text.replace(/[aiueo]/g, command[1]);
    reply(convert);
}
break;

// ========== RANDOM FEATURES ==========
case 'coffe':
case 'kopi': {
    try {
        const { data } = await axios.get('https://coffee.alexflipnote.dev/random.json');
        await sock.sendMessage(from, { image: { url: data.file } }, { quoted: m });
    } catch {
        reply('❌ Gagal mengambil gambar kopi!');
    }
}
break;

// ========== STALKER FEATURES ==========
case 'wastalk': {
    let number = args[0] || senderNumber;
    number = number.replace(/[^0-9]/g, '');
    
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.ikyy.my.id/api/wastalk?no=${number}`);
        
        let textMsg = `📱 *WHATSAPP STALK*\n\n`;
        textMsg += `*Nomor*: ${number}\n`;
        textMsg += `*Negara*: ${data.country || 'Indonesia'}\n`;
        textMsg += `*Provider*: ${data.provider || 'Telkomsel'}\n`;
        textMsg += `*Zona Waktu*: ${data.timezone || 'WIB'}\n`;
        textMsg += `*Status*: ${data.status || 'Terdaftar'}\n`;
        
        reply(textMsg);
    } catch {
        reply('❌ Gagal mendapatkan informasi nomor!');
    }
}
break;

case 'githubstalk': {
    if (!text) return reply('Masukkan username GitHub!');
    reply(config.mess.wait);
    
    try {
        const { data } = await axios.get(`https://api.github.com/users/${text}`);
        
        let textMsg = `🐙 *GITHUB STALK*\n\n`;
        textMsg += `*Username*: ${data.login}\n`;
        textMsg += `*Nama*: ${data.name || '-'}\n`;
        textMsg += `*Bio*: ${data.bio || '-'}\n`;
        textMsg += `*Followers*: ${data.followers}\n`;
        textMsg += `*Following*: ${data.following}\n`;
        textMsg += `*Public Repos*: ${data.public_repos}\n`;
        textMsg += `*Public Gists*: ${data.public_gists}\n`;
        textMsg += `*Company*: ${data.company || '-'}\n`;
        textMsg += `*Location*: ${data.location || '-'}\n`;
        textMsg += `*Blog*: ${data.blog || '-'}\n`;
        textMsg += `*Twitter*: ${data.twitter_username || '-'}\n`;
        textMsg += `*Created*: ${new Date(data.created_at).toLocaleDateString('id-ID')}\n`;
        textMsg += `*Profile*: ${data.html_url}`;
        
        // Get avatar
        await sock.sendMessage(from, { 
            image: { url: data.avatar_url },
            caption: textMsg
        }, { quoted: m });
    } catch {
        reply('❌ User tidak ditemukan!');
    }
}
break;

// ========== OWNER FEATURES ==========
case 'bot': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    if (args[0] === 'set') {
        // Bot settings
        reply('⚙️ *BOT SETTINGS*\n\nFitur sedang dalam pengembangan!');
    } else if (args[0] === '--settings' || args[0] === 'settings') {
        let settings = `⚙️ *BOT SETTINGS*\n\n`;
        settings += `*Prefix*: ${config.prefix}\n`;
        settings += `*Bot Name*: ${config.botName}\n`;
        settings += `*Owner*: ${config.ownerName}\n`;
        settings += `*Total User*: ${Object.keys(db.data.users).length}\n`;
        settings += `*Total Group*: ${Object.keys(db.data.groups).length}\n`;
        settings += `*Total Premium*: ${db.data.premium.length}\n`;
        settings += `*Total Banned*: ${db.data.banned.length}\n`;
        
        reply(settings);
    }
}
break;

case 'setbio': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan bio baru!');
    
    try {
        await sock.updateProfileStatus(text);
        reply('✅ Bio berhasil diubah!');
    } catch {
        reply('❌ Gagal mengubah bio!');
    }
}
break;

case 'setppbot': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let media = quoted?.imageMessage || m.message?.imageMessage;
    if (!media) return reply('Reply gambar untuk dijadikan PP bot!');
    
    let buffer = await downloadMedia(media, 'image');
    
    try {
        await sock.updateProfilePicture(botNumber, buffer);
        reply('✅ Foto profil bot berhasil diubah!');
    } catch {
        reply('❌ Gagal mengubah foto profil bot!');
    }
}
break;

case 'join': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan link grup!');
    
    let code = text.split('https://chat.whatsapp.com/')[1];
    if (!code) return reply('Link tidak valid!');
    
    try {
        let data = await sock.groupAcceptInvite(code);
        reply(`✅ Berhasil join ke grup!\nID: ${data}`);
    } catch {
        reply('❌ Gagal join ke grup!');
    }
}
break;

case 'leave': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    if (isGroup) {
        await sock.groupLeave(from);
        reply('✅ Berhasil keluar dari grup!');
    } else {
        reply('Perintah ini hanya bisa digunakan di dalam grup!');
    }
}
break;

case 'block': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin diblokir!');
    
    if (target.includes('@')) {
        try {
            await sock.updateBlockStatus(target, 'block');
            reply(`✅ Berhasil memblokir @${target.split('@')[0]}`, { mentions: [target] });
        } catch {
            reply('❌ Gagal memblokir user!');
        }
    }
}
break;

case 'listblock': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    try {
        let blockList = await sock.fetchBlocklist();
        if (blockList.length === 0) return reply('Tidak ada user yang diblokir!');
        
        let text = '📋 *DAFTAR BLOCK*\n\n';
        blockList.forEach((jid, i) => {
            text += `${i+1}. @${jid.split('@')[0]}\n`;
        });
        
        reply(text, { mentions: blockList });
    } catch {
        reply('❌ Gagal mengambil daftar block!');
    }
}
break;

case 'openblock': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin dibuka blokirnya!');
    
    if (target.includes('@')) {
        try {
            await sock.updateBlockStatus(target, 'unblock');
            reply(`✅ Berhasil membuka blokir @${target.split('@')[0]}`, { mentions: [target] });
        } catch {
            reply('❌ Gagal membuka blokir user!');
        }
    }
}
break;

case 'listpc': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    // Get all private chats
    let chats = Object.entries(db.data.chats).filter(([jid]) => !jid.endsWith('@g.us'));
    
    if (chats.length === 0) return reply('Tidak ada private chat!');
    
    let text = '💬 *DAFTAR PRIVATE CHAT*\n\n';
    chats.forEach(([jid], i) => {
        text += `${i+1}. @${jid.split('@')[0]}\n`;
    });
    
    reply(text, { mentions: chats.map(c => c[0]) });
}
break;

case 'listgc': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    // Get all group chats
    let groups = Object.entries(db.data.chats).filter(([jid]) => jid.endsWith('@g.us'));
    
    if (groups.length === 0) return reply('Tidak ada grup!');
    
    let text = '👥 *DAFTAR GRUP*\n\n';
    groups.forEach(([jid], i) => {
        text += `${i+1}. ${jid}\n`;
    });
    
    reply(text);
}
break;

case 'ban': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin di-ban!');
    
    let number = target.replace('@', '').replace('+', '');
    if (!db.data.banned.includes(number)) {
        db.data.banned.push(number);
        db.save();
        reply(`✅ Berhasil ban @${number}`, { mentions: [target] });
    } else {
        reply('User sudah di-ban!');
    }
}
break;

case 'unban': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin di-unban!');
    
    let number = target.replace('@', '').replace('+', '');
    let index = db.data.banned.indexOf(number);
    if (index !== -1) {
        db.data.banned.splice(index, 1);
        db.save();
        reply(`✅ Berhasil unban @${number}`, { mentions: [target] });
    } else {
        reply('User tidak ada dalam daftar ban!');
    }
}
break;

case 'mute': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    if (isGroup) {
        group.mute = true;
        db.save();
        reply('✅ Grup telah di-mute!');
    } else {
        reply('Perintah ini hanya untuk grup!');
    }
}
break;

case 'unmute': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    if (isGroup) {
        group.mute = false;
        db.save();
        reply('✅ Grup telah di-unmute!');
    } else {
        reply('Perintah ini hanya untuk grup!');
    }
}
break;

case 'creategc': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan nama grup!');
    
    try {
        let group = await sock.groupCreate(text, [sender]);
        reply(`✅ Berhasil membuat grup!\nID: ${group.id}`);
    } catch {
        reply('❌ Gagal membuat grup!');
    }
}
break;

case 'clearchat': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    try {
        await sock.chatModify({ clear: { jid: from } }, from);
        reply('✅ Chat berhasil dibersihkan!');
    } catch {
        reply('❌ Gagal membersihkan chat!');
    }
}
break;

case 'addprem': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin dijadikan premium!');
    
    let number = target.replace('@', '').replace('+', '');
    if (!db.data.premium.includes(number)) {
        db.data.premium.push(number);
        db.save();
        reply(`✅ Berhasil menambahkan @${number} ke premium!`, { mentions: [target] });
    } else {
        reply('User sudah premium!');
    }
}
break;

case 'delprem': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin dihapus premiumnya!');
    
    let number = target.replace('@', '').replace('+', '');
    let index = db.data.premium.indexOf(number);
    if (index !== -1) {
        db.data.premium.splice(index, 1);
        db.save();
        reply(`✅ Berhasil menghapus premium @${number}`, { mentions: [target] });
    } else {
        reply('User bukan premium!');
    }
}
break;

case 'listprem': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let premList = db.data.premium;
    if (premList.length === 0) return reply('Belum ada user premium!');
    
    let text = '👑 *DAFTAR PREMIUM*n/n'
  premList.forEach((num, i) => {
        text += `${i+1}. @${num}\n`;
    });
    
    reply(text, { mentions: premList.map(v => v + '@s.whatsapp.net') });
}
break;

case 'addlimit': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0];
    if (!target || !args[1]) return reply('Format: .addlimit @user jumlah');
    
    let amount = parseInt(args[1]);
    if (isNaN(amount)) return reply('Jumlah harus angka!');
    
    let targetUser = db.getUser(target);
    targetUser.limit += amount;
    db.save();
    
    reply(`✅ Berhasil menambah limit @${target.split('@')[0]} sebanyak ${amount}`, { mentions: [target] });
}
break;

case 'adduang': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0];
    if (!target || !args[1]) return reply('Format: .adduang @user jumlah');
    
    let amount = parseInt(args[1]);
    if (isNaN(amount)) return reply('Jumlah harus angka!');
    
    let targetUser = db.getUser(target);
    targetUser.money += amount;
    db.save();
    
    reply(`✅ Berhasil menambah money @${target.split('@')[0]} sebanyak ${amount}`, { mentions: [target] });
}
break;

case 'setbotauthor': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan author baru!');
    
    config.author = text;
    reply(`✅ Author bot diubah menjadi: ${text}`);
}
break;

case 'setbotname': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan nama bot baru!');
    
    config.botName = text;
    reply(`✅ Nama bot diubah menjadi: ${text}`);
}
break;

case 'setbotpackname': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Masukkan packname baru!');
    
    config.packname = text;
    reply(`✅ Packname diubah menjadi: ${text}`);
}
break;

case 'setapikey': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    if (!text) return reply('Format: .setapikey [name] [key]');
    
    let [name, key] = text.split(' ');
    if (!name || !key) return reply('Format salah!');
    
    config[name + 'Key'] = key;
    reply(`✅ API Key ${name} berhasil diubah!`);
}
break;

case 'addowner': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin ditambahkan sebagai owner!');
    
    let number = target.replace('@', '').replace('+', '');
    if (!config.owner.includes(number)) {
        config.owner.push(number);
        reply(`✅ Berhasil menambahkan @${number} sebagai owner!`, { mentions: [target] });
    } else {
        reply('User sudah menjadi owner!');
    }
}
break;

case 'delowner': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid[0] || args[0];
    if (!target) return reply('Tag user yang ingin dihapus dari owner!');
    
    let number = target.replace('@', '').replace('+', '');
    let index = config.owner.indexOf(number);
    if (index !== -1 && number !== config.owner[0]) {
        config.owner.splice(index, 1);
        reply(`✅ Berhasil menghapus @${number} dari owner!`, { mentions: [target] });
    } else {
        reply('User bukan owner atau owner utama!');
    }
}
break;

case 'getmsgstore': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    reply('🚧 Fitur dalam pengembangan!');
}
break;

case 'getsession': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    // Send session folder as zip
    const archiver = require('archiver');
    let archive = archiver('zip');
    let output = fs.createWriteStream('session.zip');
    
    archive.pipe(output);
    archive.directory('sessions/', false);
    await archive.finalize();
    
    await sock.sendMessage(from, { 
        document: { url: './session.zip' },
        fileName: 'session.zip',
        mimetype: 'application/zip'
    }, { quoted: m });
    
    // Clean up
    setTimeout(() => {
        if (fs.existsSync('session.zip')) fs.unlinkSync('session.zip');
    }, 60000);
}
break;

case 'delsession': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    try {
        fs.rmSync('sessions', { recursive: true, force: true });
        reply('✅ Session berhasil dihapus! Bot akan restart...');
        process.exit();
    } catch {
        reply('❌ Gagal menghapus session!');
    }
}
break;

case 'delsampah': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    try {
        let files = fs.readdirSync('tmp');
        let deleted = 0;
        files.forEach(file => {
            let filePath = path.join('tmp', file);
            let stats = fs.statSync(filePath);
            if (Date.now() - stats.mtimeMs > 3600000) { // Older than 1 hour
                fs.unlinkSync(filePath);
                deleted++;
            }
        });
        reply(`✅ Berhasil menghapus ${deleted} file sampah!`);
    } catch {
        reply('❌ Gagal menghapus file sampah!');
    }
}
break;

case 'upsw': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let media = quoted?.imageMessage || quoted?.videoMessage || m.message?.imageMessage || m.message?.videoMessage;
    let caption = text || '';
    
    if (media) {
        let buffer = await downloadMedia(media, media.imageMessage ? 'image' : 'video');
        
        let statusOptions = media.imageMessage ? 
            { image: buffer, caption } : 
            { video: buffer, caption };
        
        await sock.sendMessage('status@broadcast', statusOptions);
        reply('✅ Status berhasil diupload!');
    } else if (caption) {
        await sock.sendMessage('status@broadcast', { text: caption });
        reply('✅ Status berhasil diupload!');
    } else {
        reply('Kirim gambar/video atau teks untuk status!');
    }
}
break;

case 'backup': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    try {
        // Create backup of database
        let backupData = {
            date: new Date().toISOString(),
            database: db.data
        };
        
        let backupPath = path.join(__dirname, 'backups', `backup-${Date.now()}.json`);
        if (!fs.existsSync('backups')) fs.mkdirSync('backups');
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        
        await sock.sendMessage(from, { 
            document: { url: backupPath },
            fileName: path.basename(backupPath),
            mimetype: 'application/json'
        }, { quoted: m });
        
        reply('✅ Backup berhasil dibuat!');
    } catch (e) {
        reply('❌ Gagal membuat backup!');
    }
}
break;

case '$':
case '>':
case '<': {
    if (!config.owner.includes(senderNumber)) return reply(config.mess.owner);
    
    let evalCode = body.slice(command.length + 1).trim();
    if (!evalCode) return reply('Masukkan kode untuk dieksekusi!');
    
    try {
        let result = await eval(`(async () => { ${evalCode} })()`);
        reply(require('util').inspect(result));
    } catch (e) {
        reply(`❌ Error: ${e.message}`);
    }
}
break;

default: {
    // Check custom commands
    if (db.data.cmd[command]) {
        let cmdData = db.data.cmd[command];
        if (cmdData.locked && !isPremium && !config.owner.includes(senderNumber)) {
            return reply(config.mess.premium);
        }
        
        let randomReply = cmdData[Math.floor(Math.random() * cmdData.length)];
        reply(randomReply.reply);
    }
    
    // Handle tictactoe moves (numbers 1-9)
    if (/^[1-9]$/.test(command) && isGroup) {
        if (!db.data.games?.[from]?.tictactoe) return;
        
        let game = db.data.games[from].tictactoe;
        if (game.state !== 'playing') return;
        if (!game.players.includes(sender)) return;
        if (game.turn === '❌' && sender !== game.players[0]) return;
        if (game.turn === '⭕' && sender !== game.players[1]) return;
        
        let pos = parseInt(command) - 1;
        if (game.board[pos] !== '⬜') return reply('Kotak sudah terisi!');
        
        // Update board
        game.board[pos] = game.turn;
        
        // Check winner
        let winner = null;
        const winPatterns = [
            [0,1,2], [3,4,5], [6,7,8], // rows
            [0,3,6], [1,4,7], [2,5,8], // columns
            [0,4,8], [2,4,6] // diagonals
        ];
        
        for (let pattern of winPatterns) {
            if (game.board[pattern[0]] !== '⬜' &&
                game.board[pattern[0]] === game.board[pattern[1]] &&
                game.board[pattern[1]] === game.board[pattern[2]]) {
                winner = game.board[pattern[0]];
                break;
            }
        }
        
        // Check draw
        let isDraw = !winner && !game.board.includes('⬜');
        
        if (winner || isDraw) {
            let resultMsg = `🎮 *TIC TAC TOE*\n\n`;
            for (let i = 0; i < 9; i += 3) {
                resultMsg += `${game.board[i]} ${game.board[i+1]} ${game.board[i+2]}\n`;
            }
            
            if (winner) {
                let winnerJid = winner === '❌' ? game.players[0] : game.players[1];
                resultMsg += `\n🏆 Pemenang: @${winnerJid.split('@')[0]}`;
            } else {
                resultMsg += `\n🤝 Hasil: Seri!`;
            }
            
            await sock.sendMessage(from, { 
                text: resultMsg, 
                mentions: game.players 
            }, { quoted: m });
            
            delete db.data.games[from].tictactoe;
            db.save();
        } else {
            // Next turn
            game.turn = game.turn === '❌' ? '⭕' : '❌';
            db.save();
            
            let boardMsg = `🎮 *TIC TAC TOE*\n\n`;
            boardMsg += `Giliran: ${game.turn}\n\n`;
            for (let i = 0; i < 9; i += 3) {
                boardMsg += `${game.board[i]} ${game.board[i+1]} ${game.board[i+2]}\n`;
            }
            
            reply(boardMsg);
        }
    }
    
    // Handle math answers
    if (db.data.games?.[from]?.math) {
        let mathGame = db.data.games[from].math;
        if (mathGame.user !== sender) return;
        
        let userAnswer = parseFloat(body);
        if (isNaN(userAnswer)) return;
        
        if (userAnswer === mathGame.answer) {
            reply('✅ Jawaban benar! Kamu mendapat 50 money!');
            user.money += 50;
            db.save();
            delete db.data.games[from].math;
        }
    }
}
}
} catch (e) {
console.error('Error in command:', e);
reply('❌ Terjadi kesalahan dalam memproses perintah!');
}
}

// Update user data
if (user) {
user.exp += 1;
user.lastActive = Date.now();

// Level up logic
let expNeeded = user.level * 100;
if (user.exp >= expNeeded) {
    user.level += 1;
    user.exp -= expNeeded;
    reply(`🎉 Selamat! Kamu naik ke level ${user.level}!`);
}

db.save();
}

// Check AFK
if (isGroup && user.afk && sender !== m.key.participant) {
if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes(sender)) {
    let afkTime = (Date.now() - user.afkTime) / 1000;
    let hours = Math.floor(afkTime / 3600);
    let minutes = Math.floor((afkTime % 3600) / 60);
    let seconds = Math.floor(afkTime % 60);
    
    reply(`@${senderNumber} sedang AFK\nAlasan: ${user.afkReason}\nSelama: ${hours} jam ${minutes} menit ${seconds} detik`, { mentions: [sender] });
}
}

// Auto-unafk if user sends message
if (user.afk && sender === m.key.participant) {
user.afk = false;
user.afkReason = '';
user.afkTime = 0;
db.save();
reply('✅ Selamat datang kembali! AFK telah dinonaktifkan.');
}
}
});

// Handle group updates
sock.ev.on('groups.update', async (updates) => {
for (let update of updates) {
let groupId = update.id;
let group = db.getGroup(groupId);

if (update.announce !== undefined) {
    // Group setting changed
    console.log(`Group ${groupId} setting changed: announce = ${update.announce}`);
}

if (update.subject !== undefined) {
    // Group name changed
    console.log(`Group ${groupId} name changed to: ${update.subject}`);
    if (group.welcome) {
        // Optional: Send notification about group name change
        // await sock.sendMessage(groupId, { text: `Nama grup diubah menjadi: ${update.subject}` });
    }
}

if (update.desc !== undefined) {
    // Group description changed
    console.log(`Group ${groupId} description changed`);
}

if (update.restrict !== undefined) {
    // Group restrict setting changed
    console.log(`Group ${groupId} restrict changed to: ${update.restrict}`);
}
}
});

// Handle group participants update
sock.ev.on('group-participants.update', async (update) => {
let group = db.getGroup(update.id);

if (update.action === 'add') {
// New member joined
console.log(`New member joined ${update.id}: ${update.participants[0]}`);

if (group.welcome) {
    let welcomeMsg = group.welcomeMsg || `Halo @${update.participants[0].split('@')[0]}, selamat datang di grup!`;
    await sock.sendMessage(update.id, { 
        text: welcomeMsg,
        mentions: update.participants
    });
}
} else if (update.action === 'remove') {
// Member left/kicked
console.log(`Member left ${update.id}: ${update.participants[0]}`);

if (group.leftMsg) {
    let leftMsg = group.leftMsg || `Selamat tinggal @${update.participants[0].split('@')[0]}`;
    await sock.sendMessage(update.id, { 
        text: leftMsg,
        mentions: update.participants
    });
}
} else if (update.action === 'promote') {
// Member promoted to admin
console.log(`Member promoted ${update.id}: ${update.participants[0]}`);
} else if (update.action === 'demote') {
// Member demoted from admin
console.log(`Member demoted ${update.id}: ${update.participants[0]}`);
}
});

// Handle presence update (online/offline)
sock.ev.on('presence.update', async (update) => {
// console.log('Presence update:', update);
});

// Handle connection update
sock.ev.on('connection.update', (update) => {
const { connection, lastDisconnect, qr } = update;

if (qr) {
    console.log('QR Code received, scan with WhatsApp!');
}

if (connection === 'open') {
    console.log(chalk.green('✓ Bot connected successfully!'));
    console.log(chalk.cyan(`✓ Bot name: ${config.botName}`));
    console.log(chalk.cyan(`✓ Owner: ${config.ownerName}`));
    console.log(chalk.cyan(`✓ Prefix: ${config.prefix}`));
}

if (connection === 'close') {
    console.log(chalk.red('Connection closed!'));
}
});

// Handle creds update
sock.ev.on('creds.update', saveCreds);
}

// Create necessary directories
if (!fs.existsSync('tmp')) fs.mkdirSync('tmp');
if (!fs.existsSync('backups')) fs.mkdirSync('backups');
if (!fs.existsSync('sessions')) fs.mkdirSync('sessions');

// Start the bot with auto-reconnect
async function startBotWithRetry() {
let retries = 0;
const maxRetries = 5;

while (retries < maxRetries) {
    try {
        await startBot();
        break;
    } catch (error) {
        retries++;
        console.error(chalk.red(`Failed to start bot (attempt ${retries}/${maxRetries}):`), error);
        
        if (retries < maxRetries) {
            console.log(chalk.yellow(`Retrying in 5 seconds...`));
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            console.error(chalk.red('Max retries reached. Exiting...'));
            process.exit(1);
        }
    }
}
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
console.error(chalk.red('Uncaught Exception:'), err);
// Don't exit, just log
});

process.on('unhandledRejection', (err) => {
console.error(chalk.red('Unhandled Rejection:'), err);
// Don't exit, just log
});

// Handle process termination
process.on('SIGINT', async () => {
console.log(chalk.yellow('\nReceived SIGINT. Cleaning up...'));
try {
    // Clean up temp files
    if (fs.existsSync('tmp')) {
        const files = fs.readdirSync('tmp');
        for (const file of files) {
            fs.unlinkSync(path.join('tmp', file));
        }
    }
    if (fs.existsSync('session.zip')) {
        fs.unlinkSync('session.zip');
    }
    console.log(chalk.green('Cleanup completed. Exiting...'));
} catch (error) {
    console.error(chalk.red('Error during cleanup:'), error);
}
process.exit(0);
});

process.on('SIGTERM', async () => {
console.log(chalk.yellow('\nReceived SIGTERM. Cleaning up...'));
// Similar cleanup as SIGINT
process.exit(0);
});

// Display startup banner
console.log(chalk.cyan('╔════════════════════════════════════╗'));
console.log(chalk.cyan('║         FARID BOT WhatsApp         ║'));
console.log(chalk.cyan('║       Created by Farid - 2025      ║'));
console.log(chalk.cyan('╚════════════════════════════════════╝'));
console.log(chalk.yellow(`Starting bot with prefix: ${config.prefix}`));
console.log(chalk.yellow(`Owner: ${config.ownerName} (${config.owner[0]})`));
console.log(chalk.yellow(`Total features: 201`));
console.log('');

// Start the bot
startBotWithRetry();
