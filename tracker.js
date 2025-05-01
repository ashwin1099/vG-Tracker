const { MongoClient } = require('mongodb');
const samp = require('samp-query');
const http = require('http');

const MONGO_URI = 'mongodb+srv://vg-bot:ashwinjr10@vg-bot.eypjth3.mongodb.net/?retryWrites=true&w=majority&appName=vG-Bot';
const DB_NAME = 'valiant';

const COLLECTIONS = {
    day: 'players',
    week: 'players_week',
    month: 'players_month'
};

let client;
let collections = {};
let resetDone = { day: false, week: false, month: false };

// Tracks player name => number of consecutive minutes online
const seenPlayers = new Map();

async function connectToMongoDB() {
    try {
        client = new MongoClient(MONGO_URI);
        await client.connect();
        const db = client.db(DB_NAME);
        collections.day = db.collection(COLLECTIONS.day);
        collections.week = db.collection(COLLECTIONS.week);
        collections.month = db.collection(COLLECTIONS.month);
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
}

function querySAMP(options) {
    return new Promise((resolve, reject) => {
        samp(options, (error, response) => {
            if (error) return reject(error);
            resolve(response);
        });
    });
}

async function trackPlaytime() {
    const options = {
        host: '163.172.105.21',
        port: 7777
    };

    try {
        const response = await querySAMP(options);
        if (response && response.players && response.players.length > 0) {
            console.log(`📊 Players online: ${response.players.length}`);
            const currentPlayers = new Set();

            for (const player of response.players) {
                const name = player.name;
                currentPlayers.add(name);

                const previousMinutes = seenPlayers.get(name) || 0;
                seenPlayers.set(name, previousMinutes + 1);

                if (previousMinutes >= 2) {
                    // Player has been online for 2+ minutes
                    for (const type of Object.keys(collections)) {
                        const result = await collections[type].updateOne(
                            { name },
                            { $inc: { playtime: 60 } },
                            { upsert: true }
                        );

                        if (result.upsertedCount > 0) {
                            console.log(`🆕 [${type}] Added new player to DB: ${name}`);
                        } else {
                            console.log(`⏱️ [${type}] Updated playtime for: ${name}`);
                        }
                    }
                } else {
                    console.log(`⏳ ${name} - Online for ${previousMinutes + 1} min, waiting for 2 mins`);
                }
            }

            // Remove players who are no longer online
            for (const name of [...seenPlayers.keys()]) {
                if (!currentPlayers.has(name)) {
                    seenPlayers.delete(name);
                    console.log(`🚪 Player left: ${name}`);
                }
            }

        } else {
            console.log('⚠️ No players found in server response');
            seenPlayers.clear();
        }

        setTimeout(trackPlaytime, 60000); // Check every 1 minute
    } catch (error) {
        console.error('❌ Error querying SA-MP server:', error);
        setTimeout(trackPlaytime, 10000); // Reduced query frequency on error
    }
}

function getUKTime() {
    const now = new Date();
    return new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
}

function isFirstDayOfWeek(date) {
    return date.getDay() === 1; // Monday
}

function isFirstDayOfMonth(date) {
    return date.getDate() === 1;
}

connectToMongoDB().then(() => {
    trackPlaytime();

    // Check every minute
    setInterval(async () => {
        const now = getUKTime();
        const hours = now.getHours();
        const minutes = now.getMinutes();

        if (hours === 0 && minutes === 0) {
            if (!resetDone.day) {
                await collections.day.deleteMany({});
                console.log('🧹 Daily reset at 00:00 UK');
                resetDone.day = true;
            }

            if (isFirstDayOfWeek(now) && !resetDone.week) {
                await collections.week.deleteMany({});
                console.log('🧹 Weekly reset (Monday 00:00 UK)');
                resetDone.week = true;
            }

            if (isFirstDayOfMonth(now) && !resetDone.month) {
                await collections.month.deleteMany({});
                console.log('🧹 Monthly reset (1st 00:00 UK)');
                resetDone.month = true;
            }
        }

        // Reset the flags at 00:01 UK
        if (hours === 0 && minutes === 1) {
            resetDone = { day: false, week: false, month: false };
        }

    }, 60000); // every 1 minute
});

const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  const PORT = 8000;
  server.listen(PORT, () => {
    console.log(`✅ Health check server running on port ${PORT}`);
  });