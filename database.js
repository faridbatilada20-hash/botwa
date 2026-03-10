const fs = require('fs');

class Database {
    constructor(filepath) {
        this.filepath = filepath;
        this.data = this.load();
    }

    load() {
        try {
            return JSON.parse(fs.readFileSync(this.filepath));
        } catch (e) {
            return { users: {}, groups: {}, chats: {}, cmd: {}, premium: [], banned: [], sewa: {}, jadibot: [], msg: {} };
        }
    }

    save() {
        fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2));
    }

    getUser(jid) {
        if (!this.data.users[jid]) {
            this.data.users[jid] = {
                limit: 20,
                money: 0,
                exp: 0,
                level: 1,
                afk: false,
                afkReason: '',
                afkTime: 0,
                banned: false,
                premium: false,
                registered: false,
                name: ''
            };
            this.save();
        }
        return this.data.users[jid];
    }

    getGroup(jid) {
        if (!this.data.groups[jid]) {
            this.data.groups[jid] = {
                welcome: false,
                welcomeMsg: '',
                leftMsg: '',
                antilink: false,
                mute: false,
                nsfw: false,
                antispam: false
            };
            this.save();
        }
        return this.data.groups[jid];
    }
}

module.exports = Database;
