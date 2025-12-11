const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MongoClient } = require('mongodb'); // [NEW] MongoDB Driver
const fs = require('fs'); // ใช้สำหรับ Multer check folder เท่านั้น

const multer = require('multer');

// --- [CONFIG] MongoDB Connection ---
// ⭐ ใส่ Connection String ของคุณที่นี่ (หรือใช้ Environment Variable)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/webboard_db';
const client = new MongoClient(MONGODB_URI);

// --- ตัวแปรสำหรับเก็บ Collection ของ MongoDB ---
let db;
let postsCollection;
let usersCollection;
let configCollection;
let transactionsCollection;
let topicsCollection;
let messagesCollection;
let zonesCollection;

// [NEW] Cloudinary Imports
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// [CONFIG] Cloudinary (ใส่ค่าของคุณที่นี่)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'drz6osqnq',
    api_key: process.env.CLOUDINARY_API_KEY || '234168627819814',
    api_secret: process.env.CLOUDINARY_API_SECRET || '5rGH8Tj3SxHIdree1j3obeZLIZw'
});

// [SETUP] Multer Storage for Cloudinary
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'webboard_uploads', // ชื่อโฟลเดอร์ที่จะไปโผล่ใน Cloudinary
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif'], // นามสกุลที่ยอมรับ
    },
});

const upload = multer({ storage: storage });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Live Exchange Rate ---
const LIVE_API_KEY = '1f39c37f85-b1b3f2287e-t6oki5'; 
const LIVE_API_URL = `https://api.fastforex.io/fetch-all?from=USD&api_key=${LIVE_API_KEY}`; 
let LIVE_EXCHANGE_RATES = { 'USD': 1.0, 'THB': 35.0 };
const DEFAULT_CURRENCY = 'THB';

// --- In-Memory Data (ข้อมูลชั่วคราว ไม่ต้องลง DB) ---
let postViewers = {}; 
let viewerGeolocation = {};

// --- Translations ---
const serverTranslations = {
    'th': {
        'post_not_found': 'ไม่พบกระทู้',
        'closed_or_finished': '⛔ กระทู้นี้ปิดรับงาน/เสร็จสิ้นแล้ว',
        'room_occupied': '⚠️ มีผู้ใช้งานอื่นกำลังดูกระทู้นี้อยู่ กรุณารอสักครู่...',
    },
    'en': {
        'post_not_found': 'Post not found',
        'closed_or_finished': '⛔ This post is closed/finished.',
        'room_occupied': '⚠️ This post is currently occupied. Please wait...',
    }
};

function translateServerMsg(key, lang = 'th') {
    const translation = serverTranslations[lang] || serverTranslations['th'];
    return translation[key] || serverTranslations['th'][key] || key;
}

// ==========================================
// Helper Functions for MongoDB
// ==========================================

async function connectDB() {
    try {
        await client.connect();
        console.log("✅ Connected successfully to MongoDB");
        
        db = client.db(); // ใช้ชื่อ DB จาก Connection String
        
        // กำหนด Collection
        postsCollection = db.collection('posts');
        usersCollection = db.collection('users');
        configCollection = db.collection('config');
        transactionsCollection = db.collection('transactions');
        topicsCollection = db.collection('topics');
        messagesCollection = db.collection('messages');
		zonesCollection = db.collection('zones');

        await seedInitialData(); // สร้างข้อมูลเริ่มต้นถ้ายังไม่มี

    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
        process.exit(1);
    }
}

async function seedInitialData() {
    // 1. Config
    if (await configCollection.countDocuments() === 0) {
        await configCollection.insertOne({ id: 'main_config', systemFee: 5, adminFee: 5, announcementText: '' }); // <-- [MODIFIED]
        console.log("Initialized Config");
    } else {
        await configCollection.updateOne({ id: 'main_config' }, { $setOnInsert: { systemFee: 5, adminFee: 5 } }, { upsert: false });
    }
    // 2. Topics
    if (await topicsCollection.countDocuments() === 0) {
        await topicsCollection.insertMany([
            { id: 'general', name: 'หัวข้อทั่วไป' },
            { id: 'tech', name: 'เทคโนโลยี' },
            { id: 'game', name: 'เกม/บันเทิง' },
            { id: 'sale', name: 'ซื้อขาย/แลกเปลี่ยน' }
        ]);
        console.log("Initialized Topics");
    }
    // 3. Admin User
    const adminUser = await usersCollection.findOne({ username: 'Admin' });
    if (!adminUser) {
        await usersCollection.insertOne({ 
            username: 'Admin', 
            coins: 1000, 
            rating: 5.0, 
            ratingCount: 1, 
            isBanned: false,
            adminLevel: 3 // ✅ กำหนดเป็นระดับสูงสุด
        });
        console.log("Initialized Admin User (Level 3)");
    } else {
        // ถ้ามีอยู่แล้ว ให้อัปเดตเป็น Level 3 เพื่อความชัวร์
        await usersCollection.updateOne({ username: 'Admin' }, { $set: { adminLevel: 3 } });
    }
}

async function getUserData(username) {
    let user = await usersCollection.findOne({ username: username });
    if (!user) {
        user = { 
            username: username, 
            coins: 0, 
            rating: 0.0, 
            ratingCount: 0, 
            isBanned: false,
            adminLevel: 0 // ✅ Default เป็น 0 (User ทั่วไป)
        };
        await usersCollection.insertOne(user);
    }
    // ป้องกันกรณี user เก่าไม่มี field นี้
    if (user.adminLevel === undefined) user.adminLevel = 0;
    
    return user;
}

async function updateUser(username, updateFields) {
    await usersCollection.updateOne({ username: username }, { $set: updateFields });
}

async function getPostCost() {
    const config = await configCollection.findOne({ id: 'main_config' });
    return { 
        systemFee: config ? (config.systemFee || 5) : 5,
        adminFee: config ? (config.adminFee || 5) : 5,
        totalCost: (config ? (config.systemFee || 5) : 5) + (config ? (config.adminFee || 5) : 5)
    };
}

// Haversine Formula Helper function to find the assigned admin for a post based on location
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // รัศมีของโลก (กม.)
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // คืนค่าระยะทางเป็นกิโลเมตร
}

	async function findResponsibleAdmin(location) {
    if (!location || !location.lat || !location.lng) {
        // คืนค่า null ที่ zoneData เพื่อบอกว่าไม่เจอโซน
        return { username: 'Admin', zoneName: 'System (No Location)', zoneData: null };
    }
    
    const allZones = await zonesCollection.find({ assignedAdmin: { $exists: true, $ne: null } }).toArray();

    if (allZones.length === 0) {
        return { username: 'Admin', zoneName: 'System (No Zones)', zoneData: null };
    }

    let closestZone = null;
    let minDistance = Infinity;

    for (const zone of allZones) {
        const dist = getDistanceFromLatLonInKm(location.lat, location.lng, zone.lat, zone.lng);
        if (dist < minDistance) {
            minDistance = dist;
            closestZone = zone;
        }
    }

    if (closestZone) {
        return { 
            username: closestZone.assignedAdmin, 
            zoneName: closestZone.name || `Zone #${closestZone.id}`,
            zoneData: closestZone // ⭐ ส่งข้อมูลโซนกลับไปด้วยเพื่อเช็ค zoneFee
        };
    }

    return { username: 'Admin', zoneName: 'System (Default)', zoneData: null };
}

	// ฟังก์ชันคำนวณค่าธรรมเนียมตาม Location (ใช้ใน API user-info)
async function getPostCostByLocation(location) {
    const globalConfig = await configCollection.findOne({ id: 'main_config' });
    const globalSystemFee = globalConfig ? (globalConfig.systemFee || 5) : 5;
    const globalDefaultAdminFee = globalConfig ? (globalConfig.adminFee || 5) : 5;

    const responsibleData = await findResponsibleAdmin(location);
    
    let finalAdminFee = globalDefaultAdminFee;
    
    // เช็คค่าธรรมเนียมของโซน
    if (responsibleData.zoneData && responsibleData.zoneData.zoneFee !== undefined && responsibleData.zoneData.zoneFee !== null) {
        finalAdminFee = parseFloat(responsibleData.zoneData.zoneFee);
    }
    
    const totalCost = globalSystemFee + finalAdminFee;

    return {
        totalCost: totalCost,
        systemFee: globalSystemFee,
        adminFee: finalAdminFee, // ค่านี้จะถูกส่งไปแสดงผลเป็น Admin Fee
        feeReceiver: responsibleData.username
    };
}


async function isUserBanned(username) {
    if (username === 'Admin') return false;
    const user = await usersCollection.findOne({ username: username });
    return user ? user.isBanned : false;
}

async function fetchLiveExchangeRates() {
    console.log('⏳ กำลังดึงอัตราแลกเปลี่ยนออนไลน์...');
    try {
        const response = await fetch(LIVE_API_URL);
        const data = await response.json();
        if (data && data.results) { 
            LIVE_EXCHANGE_RATES = {
                'USD': 1.0,
                'THB': data.results.THB || LIVE_EXCHANGE_RATES.THB,
                'EUR': data.results.EUR || LIVE_EXCHANGE_RATES.EUR,
                'JPY': data.results.JPY || LIVE_EXCHANGE_RATES.JPY,
            };
            console.log('✅ อัปเดตอัตราแลกเปลี่ยน:', LIVE_EXCHANGE_RATES);
        }
    } catch (error) {
        console.error('❌ API Error:', error.message);
    }
}

function convertUSD(amountUSD, targetCurrency) {
    const rate = LIVE_EXCHANGE_RATES[targetCurrency.toUpperCase()];
    return rate ? amountUSD * rate : amountUSD;
}

// ==========================================
// API Endpoints
// ==========================================

// 1. Admin Transactions
app.get('/api/admin/transactions', async (req, res) => {
    if (req.query.requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const query = { type: { $in: ['POST_REVENUE', 'ADMIN_GIVE', 'ADMIN_DEDUCT'] } };
    
    const totalItems = await transactionsCollection.countDocuments(query);
    const transactions = await transactionsCollection.find(query).sort({ id: -1 }).skip(skip).limit(limit).toArray();

    res.json({ transactions, totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page, limit });
});

// 2. User Info
app.get('/api/user-info', async (req, res) => {
    // 1. รับค่า location มาจาก Frontend ด้วย
    const { username, currency, location } = req.query; 
    const targetCurrency = currency || DEFAULT_CURRENCY; 

    if (!username) return res.status(400).json({ error: 'No username' });
    
    const user = await getUserData(username);
    if (!user) return res.status(404).json({ error: 'User not found' }); // เพิ่มกันเหนียว
    if (user.isBanned) return res.status(403).json({ error: '⛔ บัญชีของคุณถูกระงับการใช้งาน' });
    
    // 2. คำนวณค่าธรรมเนียม (แบบใหม่: รองรับโซน)
    let postCostData;
    try {
        // ถ้ามี location ส่งมา ให้แปลงเป็น Object, ถ้าไม่มีให้เป็น null
        const locationObj = location ? JSON.parse(location) : null;
        
        // เรียกฟังก์ชันใหม่ที่คำนวณตามพิกัด (ต้องมีฟังก์ชันนี้ใน server.js แล้วนะ)
        postCostData = await getPostCostByLocation(locationObj); 
    } catch (e) {
        console.error("Error calculating location cost:", e);
        postCostData = await getPostCostByLocation(null); // Fallback ไปใช้ค่ากลาง
    }

    const convertedCoins = convertUSD(user.coins, targetCurrency);
                    
    res.json({ 
        coins: user.coins, 
        convertedCoins: convertedCoins.toFixed(2), 
        currencySymbol: targetCurrency.toUpperCase(), 
        postCost: postCostData, // ส่งไปเป็น Object { totalCost, systemFee, adminFee }
        rating: user.rating,
        adminLevel: user.adminLevel || 0 
    });
});

// 3. User List
app.get('/api/users-list', async (req, res) => {
    // 1. ตรวจสอบสิทธิ์: ต้องเป็น Admin Level 1 ขึ้นไป (ไม่ใช่เช็คแค่ชื่อ "Admin")
    const requester = await getUserData(req.query.requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'สำหรับ Admin เท่านั้น' });
    }
    
    const users = await usersCollection.find({}).toArray();
    
    // 2. ส่งข้อมูลกลับไป (เพิ่ม field adminLevel)
    res.json(users.map(u => ({ 
        name: u.username, 
        coins: u.coins, 
        rating: u.rating, 
        isBanned: u.isBanned,
        adminLevel: u.adminLevel || 0  // ⭐ สำคัญมาก: ต้องส่งค่านี้ ไม่งั้นปุ่มถอนสิทธิ์ไม่ขึ้น
    })));
});

// 4. Contacts (Messages)
app.get('/api/contacts', async (req, res) => {
    const { username, page, limit } = req.query;
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 20;

    const messages = await messagesCollection.find({ $or: [{ sender: username }, { target: username }] }).toArray();
    const contactsMap = {};
    messages.forEach(m => {
        const isFinancialSystemMsg = m.sender === 'System' && m.msg.startsWith('💸');
        if (m.sender === username && m.target !== 'System') contactsMap[m.target] = Math.max(contactsMap[m.target] || 0, m.timestamp);
        else if (m.target === username && m.sender !== 'System' && !isFinancialSystemMsg) contactsMap[m.sender] = Math.max(contactsMap[m.sender] || 0, m.timestamp);
        else if (m.sender === 'System' && m.target === username && !isFinancialSystemMsg) contactsMap[m.sender] = Math.max(contactsMap[m.sender] || 0, m.timestamp);
    });

    const sortedContacts = Object.keys(contactsMap).sort((a, b) => contactsMap[b] - contactsMap[a]);
    const start = (p - 1) * l;
    res.json({ contacts: sortedContacts.slice(start, start + l), totalItems: sortedContacts.length, totalPages: Math.ceil(sortedContacts.length / l), currentPage: p, limit: l });
});

// 5. Member Transactions
app.get('/api/member/transactions', async (req, res) => {
    const { username, page, limit } = req.query;
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 20;
    const skip = (p - 1) * l;
    const query = { $or: [{ toUser: username }, { fromUser: username }] };
    
    const totalItems = await transactionsCollection.countDocuments(query);
    const transactions = await transactionsCollection.find(query).sort({ id: -1 }).skip(skip).limit(l).toArray();
    
    res.json({ transactions, totalItems, totalPages: Math.ceil(totalItems / l), currentPage: p, limit: l });
});

// 6. Check Active Job
app.get('/api/check-active-job', async (req, res) => {
    const username = req.query.username;
    if (!username) return res.json({ hasJob: false });
    const activeJob = await postsCollection.findOne({
        status: 'finished', isClosed: { $ne: true }, 
        $or: [{ author: username }, { acceptedViewer: username }]
    });
    if (activeJob) return res.json({ hasJob: true, postId: activeJob.id, title: activeJob.title });
    res.json({ hasJob: false });
});

// 7. Set Cost
app.post('/api/admin/set-cost', async (req, res) => {
    const requester = await getUserData(req.body.requestBy);
	// ต้องเป็น Admin Level 3 เท่านั้นในการกำหนดค่าธรรมเนียมหลัก
	if (requester.adminLevel < 3) return res.status(403).json({ error: 'Admin Level 3 only' });
    
    // รับค่า SystemFee และ AdminFee
    const systemFee = parseFloat(req.body.systemFee);
    const adminFee = parseFloat(req.body.adminFee);
    
    if (isNaN(systemFee) || isNaN(adminFee) || systemFee < 0 || adminFee < 0) {
        return res.status(400).json({ error: 'Invalid fee values.' });
    }
    
    const newConfig = { systemFee, adminFee };
    
    await configCollection.updateOne({ id: 'main_config' }, { $set: newConfig });
    io.emit('config-update', newConfig);
    res.json({ success: true, newConfig });
});

// 7.1
app.post('/api/admin/set-zone-fee', async (req, res) => {
    const { zoneId, fee, requestBy } = req.body;
    
    // ตรวจสอบคนเรียก
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied.' });
    }

    const zoneIdInt = parseInt(zoneId);
    const zone = await zonesCollection.findOne({ id: zoneIdInt });

    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    // ตรวจสอบสิทธิ์: ต้องเป็นเจ้าของโซน หรือเป็น Admin L3
    if (requester.adminLevel < 3 && zone.assignedAdmin !== requestBy) {
        return res.status(403).json({ error: 'คุณไม่ใช่ผู้ดูแลโซนนี้' });
    }

    // ถ้า fee เป็น null หรือค่าว่าง คือการ Reset ไปใช้ค่ากลาง
    let newFee = (fee === '' || fee === null) ? null : parseFloat(fee);
    if (newFee !== null && (isNaN(newFee) || newFee < 0)) {
        return res.status(400).json({ error: 'Invalid fee amount' });
    }

    await zonesCollection.updateOne({ id: zoneIdInt }, { $set: { zoneFee: newFee } });
    
    res.json({ success: true, newFee: newFee });
});


	// 8. Give Coins 
	app.post('/api/admin/give-coins', async (req, res) => {
    const { targetUser, amount, requestBy } = req.body;
    
    // ดึงข้อมูลผู้โอนและเช็คสิทธิ์ (Admin Level 1+)
    const requester = await getUserData(requestBy);
    if (requester.adminLevel < 1) { 
        return res.status(403).json({ error: 'Admin Level 1 or higher required' });
    }

    const parsedAmount = parseInt(amount);
    if (parsedAmount <= 0) return res.status(400).json({ error: 'Incorrect number' });

    const targetData = await getUserData(targetUser);
    let transactionType = 'ADMIN_GIVE'; // Default สำหรับ Admin Level 3 (สร้างเหรียญ)
    let note = `Admin (${requestBy}) Gift/Generate USD to ${targetUser}`;

    // ตรวจสอบระดับ Admin และหักเงิน ---
    if (requester.adminLevel < 3) {
        // Admin Level 1 หรือ 2: ต้องหักจากยอดคงเหลือของตัวเอง
        if (requester.coins < parsedAmount) {
            return res.status(400).json({ error: 'Insufficient coins in your admin account for this transfer.' });
        }
        
        // 1. หักเงินจาก Admin ผู้โอน
        await updateUser(requestBy, { coins: requester.coins - parsedAmount });
        transactionType = 'ADMIN_TRANSFER'; // ตั้งประเภทใหม่สำหรับการโอนจากยอดคงเหลือ
        note = `Admin (${requestBy}) Transfer USD from balance to ${targetUser}`;
    }
    // --- ⭐ [สิ้นสุดส่วนแก้ไข] ---


    // 2. เพิ่มเงินให้เป้าหมาย (เหมือนเดิม)
    await updateUser(targetUser, { coins: targetData.coins + parsedAmount });

    // 3. บันทึก Transaction (ใช้ type และ note ที่กำหนดไว้ด้านบน)
    await transactionsCollection.insertOne({
        id: Date.now(), 
        type: transactionType, 
        amount: parsedAmount, 
        fromUser: requestBy, // The Admin who initiated
        toUser: targetUser,
        note: note, 
        timestamp: Date.now()
    });

    // 4. อัปเดตยอดเงิน Realtime
    const updatedTarget = await getUserData(targetUser);
    io.emit('balance-update', { user: targetUser, coins: updatedTarget.coins });
    
    // อัปเดตยอดเงิน Admin ผู้โอน (ถ้าเป็น Level 1 หรือ 2 ที่ถูกหักเงิน)
    if (requester.adminLevel < 3) {
        const updatedRequester = await getUserData(requestBy);
        io.emit('balance-update', { user: requestBy, coins: updatedRequester.coins });
    }
    
    // 5. แจ้งเตือนผู้รับ (เหมือนเดิม)
    const notifMsg = { 
        sender: 'System', 
        target: targetUser, 
        msgKey: 'SYS_TRANSFER', 
        msgData: { amount: parsedAmount }, 
        msg: `💰 Admin has transferred the amount to you ${parsedAmount} USD`, 
        timestamp: Date.now() 
    };
    await messagesCollection.insertOne(notifMsg);
    io.to(targetUser).emit('private-message', { ...notifMsg, to: targetUser });
    
    // 6. แจ้งเตือน Admin ให้รู้ว่ามี Transaction ใหม่ (เหมือนเดิม)
    io.to('Admin').emit('admin-new-transaction');

    res.json({ success: true });
});

// 9. Set Rating
app.post('/api/admin/set-rating', async (req, res) => {
    const { targetUser, rating, requestBy } = req.body;
    if (requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const newRating = parseFloat(rating);
    if (isNaN(newRating) || newRating < 0 || newRating > 5) return res.status(400).json({ error: 'คะแนนไม่ถูกต้อง' });
    
    await updateUser(targetUser, { rating: newRating, ratingCount: 1 });
    io.emit('rating-update', { user: targetUser, rating: newRating });
    res.json({ success: true, newRating: newRating.toFixed(2) });
});

// 10. Topics
app.get('/api/topics', async (req, res) => {
    const topics = await topicsCollection.find({ id: { $ne: 'general' } }).toArray();
    res.json(topics);
});
app.get('/api/admin/topics', async (req, res) => {
    const topics = await topicsCollection.find({}).toArray();
    res.json(topics);
});
app.post('/api/admin/topics/manage', async (req, res) => {
    const { action, id, name } = req.body;
    if (action === 'add') {
        await topicsCollection.insertOne({ id: 'topic_' + Date.now(), name: name });
        const topics = await topicsCollection.find({}).toArray();
        return res.json({ success: true, message: 'เพิ่มหัวข้อสำเร็จ', topics });
    }
    if (action === 'delete') {
        const result = await topicsCollection.deleteOne({ id: id });
        if (result.deletedCount > 0) {
             const topics = await topicsCollection.find({}).toArray();
             return res.json({ success: true, message: 'ลบหัวข้อสำเร็จ', topics });
        }
        return res.status(404).json({ success: false, message: 'ไม่พบหัวข้อ' });
    }
    return res.status(400).json({ success: false, message: 'Invalid Action' });
});

// 11. Posts (List)
app.get('/api/posts', async (req, res) => {
    const ONE_HOUR = 3600000;
    // Auto-close old posts
    await postsCollection.updateMany(
        { isClosed: false, id: { $lt: Date.now() - ONE_HOUR } },
        { $set: { isClosed: true } }
    );

    // รับ view, limit, และ username เพื่อใช้ในการกรอง
    const { view, limit, username } = req.query;
    let query = {};
    let fetchLimit = parseInt(limit) || 200;

    if (view === 'closed') {
        const user = await getUserData(username); // ใช้ getUserData เพื่อดึง Admin Level
        
        // Safety check: Admin Level 1+ เท่านั้นที่ดูได้
        if (!user || user.adminLevel < 1) {
            return res.status(403).json({ error: 'Access denied.' });
        }
        query.isClosed = true; // Admin Closed View: แสดงเฉพาะกระทู้ที่ปิดแล้ว
    } else {
        // Default ('home') view: แสดงเฉพาะกระทู้ที่ยังไม่ปิด
        query.isClosed = { $ne: true };
    }

    try {
        // 3. Fetch เฉพาะกระทู้ที่ตรงตาม query
        const posts = await postsCollection.find(query)
            .sort({ isPinned: -1, id: -1 })
            .limit(fetchLimit)
            .toArray();

        // 4. Get ratings for authors (ใช้ Logic เดิมในการดึงคะแนน)
        const authorNames = [...new Set(posts.map(p => p.author))];
        const authors = await usersCollection.find({ username: { $in: authorNames } }).toArray();
        const authorMap = {};
        authors.forEach(u => authorMap[u.username] = u.rating);
        
        // 5. ส่งผลลัพธ์กลับไป (โดยไม่สนใจ Pagination เพราะ Client จะจัดการเอง)
        res.json(posts.map(post => ({ 
            ...post, 
            authorRating: authorMap[post.author] !== undefined ? authorMap[post.author].toFixed(2) : '0.00' 
        })));
        
    } catch (e) {
        console.error('Error fetching posts:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 12. Single Post
app.get('/api/posts/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const post = await postsCollection.findOne({ id: id });
    if (!post) return res.status(404).json({ error: 'ไม่พบกระทู้' });

    if(!post.isClosed && Date.now() - post.id > 3600000){ 
        await postsCollection.updateOne({ id: id }, { $set: { isClosed: true } });
        post.isClosed = true; 
    }
    const author = await getUserData(post.author);
    res.json({ ...post, authorRating: author.rating.toFixed(2) });
});

// 13. Viewer Status
app.get('/api/posts/:id/viewer-status', async (req, res) => { 
    const postId = parseInt(req.params.id);
    const requestBy = req.query.requestBy;
    const post = await postsCollection.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (requestBy !== 'Admin' && requestBy !== post.author) return res.status(403).json({ error: 'Permission denied.' });

    const currentViewer = postViewers[postId];
    if (currentViewer && currentViewer !== 'Admin' && currentViewer !== post.author) {
        const viewerUser = await getUserData(currentViewer);
        return res.json({ isOccupied: true, viewer: currentViewer, rating: viewerUser.rating });
    }
    res.json({ isOccupied: false, viewer: null });
});

// 14. Handover
app.post('/api/posts/:id/handover', async (req, res) => {
    const postId = parseInt(req.params.id);
    const { viewer, requestBy } = req.body;
    const post = await postsCollection.findOne({ id: postId });

    if (!post) return res.status(404).json({ error: 'ไม่พบกระทู้' });
    if (post.author !== requestBy && requestBy !== 'Admin') return res.status(403).json({ error: 'No Permission' });

    await postsCollection.updateOne({ id: postId }, { $set: { isClosed: true } });

    await transactionsCollection.insertOne({
        id: Date.now(), type: 'HANDOVER', amount: 0, fromUser: requestBy, toUser: viewer,
        note: `✅ ปิดดีล/ส่งงานสำเร็จ: กระทู้ ${post.title}`, timestamp: Date.now()
    });

    io.emit('update-post-status', { id: post.id, isClosed: true });
    io.to(viewer).emit('private-message', {
        sender: 'System', target: viewer, msg: `🎉 คุณได้รับงาน/ปิดดีลในกระทู้ "${post.title}" เรียบร้อยแล้ว!`,
        timestamp: Date.now(), postId: post.id
    });
    res.json({ success: true });
});

// 15. Create Post
app.post('/api/posts', upload.single('image'), async (req, res) => {
    const { author, category, content, location, title } = req.body;

    // 1. ตรวจสอบเงื่อนไขพื้นฐาน (เหมือนเดิม)
    if (author !== 'Admin') {
        if (!location || location === 'null' || location === 'undefined') {
            return res.status(400).json({ error: '⛔ กรุณาระบุตำแหน่ง (เช็คอิน) ก่อนสร้างกระทู้' });
        }
    }
    if (await isUserBanned(author)) return res.status(403).json({ error: '⛔ คุณถูกระงับสิทธิ์การสร้างกระทู้' });
    if (author !== 'Admin') {
        const activePost = await postsCollection.findOne({ author: author, isClosed: false });
        if (activePost) return res.status(400).json({ error: `⛔ คุณมีกระทู้เปิดอยู่ (ID: ${activePost.id})` });
    }
    
    const imageUrl = req.file ? req.file.path : null;
    const user = await getUserData(author);
    const topicObj = await topicsCollection.findOne({ id: category });
    const topicName = topicObj ? topicObj.name : "หัวข้อทั่วไป"; 
    let finalTitle = topicName;

    // ==================================================================
    // ส่วนคำนวณค่าธรรมเนียม (Hybrid: System + Zone)
    // ==================================================================
    
    // A. ดึงค่าธรรมเนียมกลาง (System Fee & Default Admin Fee)
    const globalConfig = await configCollection.findOne({ id: 'main_config' });
    const globalSystemFee = globalConfig ? (globalConfig.systemFee || 5) : 5;
    const globalDefaultAdminFee = globalConfig ? (globalConfig.adminFee || 5) : 5;

    // B. หาโซนและแอดมินผู้รับผิดชอบก่อน (เพื่อดูว่าโซนนั้นมีราคาพิเศษไหม)
    const responsibleData = await findResponsibleAdmin(location ? JSON.parse(location) : null);
    const feeReceiver = responsibleData.username; // คนที่จะได้รับเงิน

    // C. ตัดสินใจว่าจะใช้ Admin Fee เท่าไหร่
    let finalAdminFee = globalDefaultAdminFee; // เริ่มต้นที่ค่ากลาง
    let feeNote = `Default Fee`; // สำหรับบันทึกใน Transaction

    // เช็คว่าเจอโซน และโซนนั้นตั้งค่าราคาไว้ไหม (ไม่เป็น null)
    if (responsibleData.zoneData && responsibleData.zoneData.zoneFee !== undefined && responsibleData.zoneData.zoneFee !== null) {
        finalAdminFee = parseFloat(responsibleData.zoneData.zoneFee);
        feeNote = `Zone Fee (${responsibleData.zoneName})`;
    } else {
        feeNote = `Default Fee (${responsibleData.zoneName})`;
    }

    // D. รวมยอดที่ต้องจ่าย
    const totalCost = globalSystemFee + finalAdminFee;

    // ==================================================================
    // สิ้นสุดการคำนวณ
    // ==================================================================

    if (author !== 'Admin') {
        if (user.coins < totalCost) return res.status(400).json({ error: 'เหรียญไม่พอ (Total Cost: ' + totalCost + ' USD)' });
        
        // 1. หักเงินจากผู้สร้างกระทู้ (Total Cost)
        await updateUser(author, { coins: user.coins - totalCost });
        
        // 2. จัดการ System Fee (เข้า Admin L3)
        if (globalSystemFee > 0) {
            const adminUser = await getUserData('Admin');
            await updateUser('Admin', { coins: adminUser.coins + globalSystemFee });
            await transactionsCollection.insertOne({
                id: Date.now(), type: 'POST_REVENUE', amount: globalSystemFee, fromUser: author, toUser: 'Admin',
                note: `ค่าธรรมเนียมระบบ: ${topicName}`, postTitle: topicName, timestamp: Date.now()
            });
        }
        
        // 3. จัดการ Admin Fee (เข้า Admin เจ้าของโซน หรือ Admin กลาง ตามที่คำนวณได้)
        if (finalAdminFee > 0) {
            const receiverUser = await getUserData(feeReceiver);
            await updateUser(feeReceiver, { coins: receiverUser.coins + finalAdminFee });
            await transactionsCollection.insertOne({
                id: Date.now() + 1, type: 'ADMIN_FEE', amount: finalAdminFee, fromUser: author, toUser: feeReceiver,
                note: `ค่าดูแล: ${feeNote}`, postTitle: topicName, timestamp: Date.now() + 1
            });
        }
        
        // 4. แจ้งเตือนอัปเดตยอดเงิน
        const newAdmin = await getUserData('Admin');
        io.emit('balance-update', { user: 'Admin', coins: newAdmin.coins });
        if (feeReceiver !== 'Admin') {
            const newReceiver = await getUserData(feeReceiver);
            io.emit('balance-update', { user: feeReceiver, coins: newReceiver.coins });
        }
        io.to('Admin').emit('admin-new-transaction');
    }
    
    // สร้าง Post ลง Database (เหมือนเดิม)
    const newPost = { 
        id: Date.now(), title: finalTitle, topicId: category, content, author,
        location: location ? JSON.parse(location) : null, imageUrl: imageUrl, comments: [], 
        isClosed: false, isPinned: false // ยกเลิกการปักหมุด
    };
    await postsCollection.insertOne(newPost);
    
    if (author !== 'Admin') {
        // แจ้งเตือน user ว่าโดนหักเงินเท่าไหร่
        const notifMsg = { sender: 'System', target: author, msgKey: 'SYS_FEE', msgData: { topicName: topicName, cost: totalCost }, msg: `💸 หักค่าธรรมเนียม ${totalCost} USD`, timestamp: Date.now() + 2 };
        await messagesCollection.insertOne(notifMsg);
        io.to(author).emit('private-message', { ...notifMsg, to: author });
        
        const updatedUser = await getUserData(author);
        io.emit('balance-update', { user: author, coins: updatedUser.coins });
    }
    io.emit('new-post', newPost); 
    res.json({ success: true, post: newPost });
});

// 16. Delete Post
app.delete('/api/posts/:id', async (req, res) => { 
    const requester = await getUserData(req.body.requestBy);
	if (requester.adminLevel < 1) return res.status(403).json({ error: 'Admin only' });
    const id = parseInt(req.params.id);
    await postsCollection.deleteOne({ id: id });
    delete postViewers[id];
    io.emit('delete-post', id); 
    res.json({ success: true });
});

// 17. Manual Close
app.put('/api/posts/:id/close', async (req, res) => {
    const postId = req.params.id;
    const { requestBy } = req.body;
    
    const post = await postsCollection.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // ตรวจสอบสิทธิ์: ต้องเป็นเจ้าของโพสต์ หรือเป็น Admin Level 1 ขึ้นไป
    const requester = await getUserData(requestBy);
    if (requestBy !== post.author && requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied. Only Author or Admin (Level 1+) can close this post.' });
    }

    await postsCollection.updateOne({ id: postId }, { $set: { status: 'closed' } });
    
    const notifMsg = { sender: 'System', target: post.author, msgKey: 'POST_CLOSED', msgData: { title: post.title }, msg: `🔒 กระทู้ "${post.title}" ถูกปิดแล้ว`, timestamp: Date.now() };
    await messagesCollection.insertOne(notifMsg);
    io.to(post.author).emit('private-message', { ...notifMsg, to: post.author });

    res.json({ success: true });
});

// 18. Deduct Coins
app.post('/api/admin/deduct-coins', async (req, res) => {
    const { targetUser, amount, requestBy } = req.body;

    // ดึงข้อมูลผู้ดึงและเช็คสิทธิ์
    const requester = await getUserData(requestBy);
    if (requester.adminLevel < 1) { 
        return res.status(403).json({ error: 'Admin Level 1 or higher required' });
    }

    const parsedAmount = parseInt(amount);
    if (parsedAmount <= 0) return res.status(400).json({ error: 'Incorrect number' });

    const targetData = await getUserData(targetUser);
    if (targetData.coins < parsedAmount) {
        return res.status(400).json({ error: 'Target user has insufficient coins.' });
    }

    // 1. ดึงข้อมูล Admin ผู้ดำเนินการ (Requester) เพื่อใช้ในการเพิ่มเงิน
    const requesterData = await getUserData(requestBy); 

    // 2. เพิ่มเงินเข้าบัญชี Admin ผู้ดำเนินการ
    await updateUser(requestBy, { coins: requesterData.coins + parsedAmount });
    
    // 3. หักเงินจากเป้าหมาย
    await updateUser(targetUser, { coins: targetData.coins - parsedAmount });

    // 4. บันทึก Transaction
    await transactionsCollection.insertOne({
        id: Date.now(), 
        type: 'ADMIN_RETURN', // ประเภท: เงินถูกดึงคืน (เข้า Admin)
        amount: parsedAmount, 
        fromUser: targetUser,
        toUser: requestBy, // ⭐ [MODIFIED] เงินเข้าบัญชี Admin
        note: `Admin (${requestBy}) deduct USD from ${targetUser} and received the amount.`, 
        timestamp: Date.now()
    });

    // 5. อัปเดตยอดเงิน Realtime ของผู้ที่เกี่ยวข้อง

    // อัปเดตยอดเงินผู้ใช้เป้าหมาย
    const updatedTarget = await getUserData(targetUser);
    io.emit('balance-update', { user: targetUser, coins: updatedTarget.coins });
    
    // ⭐ อัปเดตยอดเงิน Admin ผู้ดำเนินการ
    const updatedRequester = await getUserData(requestBy);
    io.emit('balance-update', { user: requestBy, coins: updatedRequester.coins }); 
    
    // 6. แจ้งเตือนผู้รับ (เหมือนเดิม)
    const notifMsg = { 
        sender: 'System', 
        target: targetUser, 
        msgKey: 'SYS_DEDUCT', 
        msgData: { amount: parsedAmount }, 
        msg: `💰 Admin has deducted the amount from you ${parsedAmount} USD`, 
        timestamp: Date.now() 
    };
    await messagesCollection.insertOne(notifMsg);
    io.to(targetUser).emit('private-message', { ...notifMsg, to: targetUser });
    
    // 7. แจ้งเตือน Admin ให้รู้ว่ามี Transaction ใหม่ (เหมือนเดิม)
    io.to('Admin').emit('admin-new-transaction');

    res.json({ success: true });
});

// 19. Toggle Ban
app.post('/api/admin/toggle-ban', async (req, res) => {
    const { targetUser, shouldBan, requestBy } = req.body;
    const requester = await getUserData(requestBy);
	if (requester.adminLevel < 1) return res.status(403).json({ error: 'Admin only' });
    if (targetUser === 'Admin') return res.status(400).json({ error: 'Cannot ban Admin' });

    await updateUser(targetUser, { isBanned: shouldBan });
    io.to(targetUser).emit('force-logout', shouldBan ? '❌ Your account has been suspended.' : '✅ Your account has been unbanned.');

    if (shouldBan) {
        const allSockets = io.sockets.sockets;
        allSockets.forEach(socket => {
            if (socket.username === targetUser) {
                if (socket.viewingPostId) {
                    socket.emit('force-leave', '⛔ You are banned');
                    delete postViewers[socket.viewingPostId];
                    broadcastPostStatus(socket.viewingPostId, false);
                }
                socket.emit('force-logout', '⛔ You are banned'); 
            }
        });
        await postsCollection.updateMany(
            { author: targetUser, isClosed: false },
            { $set: { isClosed: true, status: 'closed_permanently' } }
        );
        io.emit('update-post-status');
    }
    res.json({ success: true, isBanned: shouldBan });
});

// 20. My Active Posts
app.get('/api/my-active-posts', async (req, res) => {
    const { username, page, limit } = req.query;
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 20;
    const skip = (p - 1) * l;
    const query = { author: username, status: { $nin: ['closed_permanently', 'closed_by_admin'] }, isClosed: false };
    const totalItems = await postsCollection.countDocuments(query);
    const activePosts = await postsCollection.find(query).sort({ id: -1 }).skip(skip).limit(l).toArray();
    
    const authorUser = await getUserData(username);
    res.json({
        posts: activePosts.map(post => ({ ...post, authorRating: authorUser.rating.toFixed(2) })),
        totalItems, totalPages: Math.ceil(totalItems / l), currentPage: p, limit: l
    });
});

// 21. My Closed Posts
app.get('/api/my-closed-posts', async (req, res) => {
    const { username, page, limit } = req.query;
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 20;
    const skip = (p - 1) * l;
    const query = { author: username, isClosed: true };
    const totalItems = await postsCollection.countDocuments(query);
    const closedPosts = await postsCollection.find(query).sort({ id: -1 }).skip(skip).limit(l).toArray();
    const authorUser = await getUserData(username);
    res.json({
        posts: closedPosts.map(post => ({ ...post, authorRating: authorUser.rating.toFixed(2) })),
        totalItems, totalPages: Math.ceil(totalItems / l), currentPage: p, limit: l
    });
});

// 22. Active Count
app.get('/api/my-active-count', async (req, res) => {
    const { username } = req.query;
    const count = await postsCollection.countDocuments({
        author: username, status: { $nin: ['closed_permanently', 'closed_by_admin'] }, isClosed: false
    });
    res.json({ count });
});

// 23. Add Comment
app.post('/api/posts/:id/comments', upload.single('image'), async (req, res) => { 
    const postId = parseInt(req.params.id);
    const { content, author } = req.body;
    const imageUrl = req.file ? req.file.path : null; 

    const post = await postsCollection.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: 'No posts found' });
    if (post.isClosed && author !== 'Admin') return res.status(403).json({ error: '⛔ Comments are closed.' });

    const newComment = { id: Date.now(), author, content, imageUrl, timestamp: Date.now() };
    await postsCollection.updateOne({ id: postId }, { $push: { comments: newComment } });
    
    io.to(`post-${postId}`).emit('new-comment', { postId: postId, comment: newComment });
    
    if (post.author !== author) {
        const notifMsg = { sender: 'System', target: post.author, msgKey: 'SYS_NEW_COMMENT', msgData: { postTitle: post.title }, msg: `💬 New comment: ${post.title}`, timestamp: Date.now(), postId: postId };
        await messagesCollection.insertOne(notifMsg);
        io.to(post.author).emit('private-message', { ...notifMsg, to: post.author });
    }
    res.json({ success: true, comment: newComment });
});

// 24. Set Admin Level (Promote / Demote)
app.post('/api/admin/set-level', async (req, res) => {
    const { targetUser, newLevel, requestBy } = req.body;
    
    const requester = await getUserData(requestBy);
    const target = await getUserData(targetUser);

    // 1. ผู้สั่งการต้องเป็น Level 2 ขึ้นไป
    if (requester.adminLevel < 2) {
        return res.status(403).json({ error: 'Permission denied. Must be Admin Level 2+' });
    }
    
    // 2. ห้ามจัดการคนที่ยศสูงกว่าหรือเท่ากับตัวเอง (เช่น 2 จะปลด 3 ไม่ได้, 2 จะปลด 2 ไม่ได้)
    if (requester.adminLevel <= target.adminLevel) {
        return res.status(403).json({ error: `Unable to manage Admins at higher or equal levels. (Target Level: ${target.adminLevel})` });
    }
    
    // 3. ห้ามแต่งตั้งให้ยศสูงกว่าหรือเท่ากับตัวเอง
    if (newLevel >= requester.adminLevel) {
        return res.status(403).json({ error: 'Cannot be appointed to a higher or equal level to oneself.' });
    }

    // อัปเดต Level
    await updateUser(targetUser, { adminLevel: newLevel });
    
    // บังคับ Logout เพื่อรีเฟรชสิทธิ์ (Optional)
    io.to(targetUser).emit('force-logout', `🔔 Your license has changed (Level ${newLevel}) please log in again.`);

    res.json({ success: true, newLevel: newLevel });
});

// 25. Get Zone Config 
app.get('/api/admin/get-zones', async (req, res) => { // Endpoint changed to plural
    // ต้องเป็น Admin Level 1 ขึ้นไปในการดูค่า
    const requester = await getUserData(req.query.requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied. Admin 1+ required' });
    }

    const zones = await zonesCollection.find({}).sort({ createdAt: -1 }).toArray(); // Fetch all zones (เรียงใหม่สุดขึ้นก่อน)
    return res.json({ success: true, zones: zones }); // Return as an array
});

// 26. Set Zone Config 
app.post('/api/admin/add-zone', async (req, res) => { // Endpoint changed
    const { lat, lng, name, requestBy } = req.body;
    
    // 1. ตรวจสอบสิทธิ์: ต้องเป็น Admin Level 3
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 3) { 
        return res.status(403).json({ error: 'Permission denied. Admin Level 3 required' });
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (isNaN(parsedLat) || isNaN(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
        return res.status(400).json({ error: 'Invalid Latitude or Longitude values.' });
    }
    
    const newZone = { 
        id: Date.now(), 
        lat: parsedLat, 
        lng: parsedLng, 
        name: name || null, // Allow null name
        createdAt: new Date()
    };

    // 2. บันทึกข้อมูลลงใน zonesCollection
    await zonesCollection.insertOne(newZone);

    res.json({ success: true, newZone: newZone });
});

// 27. Get Admin List (Level 1+)
app.get('/api/admin/admins-list', async (req, res) => {
    // Requires Admin Level 1+ to request this list
    const requester = await getUserData(req.query.requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied. Admin 1+ required' });
    }
    
    // Find users with adminLevel >= 1
    const admins = await usersCollection.find({ adminLevel: { $gte: 1 } }).sort({ adminLevel: -1, username: 1 }).toArray();

    // Return essential data: name, level, isBanned
    res.json(admins.map(a => ({ 
        name: a.username, 
        level: a.adminLevel || 0,
        isBanned: a.isBanned // Include isBanned check
    })));
});


// 28. Assign Admin to Zone
app.post('/api/admin/assign-zone', async (req, res) => {
    const { zoneId, adminUsername, requestBy } = req.body;
    
    // 1. Tidy up input
    const zoneIdInt = parseInt(zoneId);
    
    // 2. Check Permissions (Requester must be Admin Level 3)
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 3) { 
        return res.status(403).json({ error: 'Permission denied. Admin Level 3 required' });
    }
    
    // 3. Find target Zone
    const zone = await zonesCollection.findOne({ id: zoneIdInt });
    if (!zone) {
        return res.status(404).json({ error: 'Zone not found.' });
    }
    
    // 4. Validate Admin (check if target admin exists and is not banned)
    const targetAdmin = await getUserData(adminUsername);
    if (!targetAdmin || targetAdmin.adminLevel < 1 || targetAdmin.isBanned) {
         return res.status(400).json({ error: `Invalid or unauthorized Admin: ${adminUsername}` });
    }

    // 5. Update Zone document
    await zonesCollection.updateOne(
        { id: zoneIdInt }, 
        { $set: { assignedAdmin: adminUsername } }
    );

    res.json({ success: true, assignedAdmin: adminUsername });
});

// 29. Delete Zone
app.post('/api/admin/delete-zone', async (req, res) => {
    const { zoneId, requestBy } = req.body;
    
    // Check Permissions
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 3) { 
        return res.status(403).json({ error: 'Permission denied. Admin Level 3 required' });
    }

    const zoneIdInt = parseInt(zoneId);
    
    // Delete Operation
    const result = await zonesCollection.deleteOne({ id: zoneIdInt });

    if (result.deletedCount > 0) {
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Zone not found' });
    }
});

// 30. Get Assigned Zones for Admin (L1/L2)
app.get('/api/admin/get-assigned-zones', async (req, res) => {
    const { requestBy } = req.query;
    const requester = await getUserData(requestBy);
    
    // Check Permissions: Must be Admin Level 1 or 2
    if (!requester || requester.adminLevel < 1 || requester.adminLevel >= 3) {
        return res.status(403).json({ error: 'Permission denied. Admin Level 1 or 2 required.' });
    }

    // Find zones where the assignedAdmin field matches the requester's username
    const zones = await zonesCollection.find({ assignedAdmin: requestBy }).sort({ createdAt: -1 }).toArray();

    if (zones.length === 0) {
        return res.json({ success: true, zones: [], message: 'No zones assigned to you.' });
    }

    return res.json({ success: true, zones: zones });
});

// 31 Set Announcement Text
app.post('/api/admin/set-announcement', async (req, res) => {
    const { announcementText, requestBy } = req.body;
    
    const requester = await getUserData(requestBy);
    // ต้องเป็น Admin Level 1 ขึ้นไปในการตั้งค่าประกาศ
    if (requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Admin Level 1 or higher required' });
    }
    
    // อัปเดตข้อความใน Config
    await configCollection.updateOne(
        { id: 'main_config' }, 
        { $set: { announcementText: announcementText } },
        { upsert: true }
    );
    
    res.json({ success: true });
});

// 32 Get Announcement Text
app.get('/api/get-announcement', async (req, res) => {
    const config = await configCollection.findOne({ id: 'main_config' });
    const announcementText = config ? (config.announcementText || '') : '';
    res.json({ announcementText });
});

// --- Socket Helpers ---
function broadcastPostStatus(postId, isOccupied) { 
    io.emit('post-list-update', { postId: postId, isOccupied: isOccupied }); 
}

async function calculateNewRating(username, newScore) {
    const user = await getUserData(username);
    const currentCount = user.ratingCount || 0;
    const currentRating = user.rating || 0.0;
    const nextCount = currentCount + 1;
    const nextRating = ((currentRating * currentCount) + newScore) / nextCount;

    await updateUser(username, { rating: parseFloat(nextRating.toFixed(2)), ratingCount: nextCount });
    io.emit('rating-update', { user: username, rating: nextRating.toFixed(2) });
}

// ==========================================
// Socket.io Logic
// ==========================================
io.on('connection', (socket) => {
    
    socket.on('register', async (username) => {
        socket.join(username);
        socket.username = username;
        if (await isUserBanned(username)) {
            socket.emit('force-logout', '⛔ บัญชีถูกระงับ');
            return;
        }
        const occupiedPosts = Object.keys(postViewers).map(postId => ({ postId: parseInt(postId), isOccupied: true }));
        socket.emit('catch-up-post-status', occupiedPosts); 
    });

    socket.on('join-post-room', async ({ postId, username, lang }) => {
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        
        if (!post) {
            // ถ้าไม่เจอกระทู้
            socket.emit('access-denied', translateServerMsg('post_not_found', lang));
            return;
        }

        // ⭐ [NEW] ดึงข้อมูล User จากฐานข้อมูลเพื่อดู Admin Level
        const user = await usersCollection.findOne({ username: username });
        const myAdminLevel = user ? (user.adminLevel || 0) : 0;

        const isOwner = username === post.author;
        // ⭐ [EDIT] เป็น Admin ถ้าชื่อ 'Admin' หรือมี Level >= 1
        const isAdmin = (username === 'Admin') || (myAdminLevel >= 1);
        
        const isParticipant = isOwner || username === post.acceptedViewer;

        // ถ้าเป็น เจ้าของ หรือ Admin -> เข้าได้เสมอ (ทะลุทุกเงื่อนไข)
        if (isOwner || isAdmin) {
            socket.join(`post-${postId}`);
            socket.emit('access-granted', post);
            
            // ส่งข้อมูลพิกัดให้ดู (ถ้ามี)
            if (viewerGeolocation[postId]) {
                for (const [viewerName, loc] of Object.entries(viewerGeolocation[postId])) {
                    socket.emit('viewer-location-update', { 
                        viewer: viewerName, 
                        location: loc 
                    });
                }
            }
            return; 
        }

        // กรณีจบงาน หรือ ปิดกระทู้ -> คนอื่นเข้าไม่ได้ (แต่ Admin ทะลุไปแล้วด้านบน)
        if (post.status === 'finished' || post.isClosed) {
            if (isParticipant) {
                socket.join(`post-${postId}`);
                socket.emit('access-granted', post);
            } else {
                socket.emit('access-denied', translateServerMsg('closed_or_finished', lang));
            }
            return;
        }

        // กรณีห้องปกติ (เช็คว่าห้องเต็มไหม)
        const currentViewer = postViewers[postId];
        if (!currentViewer) {
            postViewers[postId] = username;
            socket.join(`post-${postId}`);
            socket.emit('access-granted', post);
        } else if (currentViewer === username) {
            socket.join(`post-${postId}`);
            socket.emit('access-granted', post);
        } else {
            socket.emit('access-denied', translateServerMsg('room_occupied', lang));
        }
    });

    // --- Private Messaging ---
    socket.on('get-private-history', async (data) => {
        const { me, partner } = data;
        const history = await messagesCollection.find({
            $or: [
                { sender: me, target: partner },
                { sender: partner, target: me },
                { sender: 'System', target: me }
            ]
        }).toArray();
        socket.emit('private-history', history);
    });

    socket.on('private-message', async (data) => {
        const newMsg = { sender: data.sender, target: data.target, msg: data.msg, timestamp: Date.now() };
        await messagesCollection.insertOne(newMsg);
        io.to(data.target).emit('private-message', { ...newMsg, to: data.target });
        io.to(data.sender).emit('private-message', { ...newMsg, to: data.target });
    });

    // --- Handover / Deals ---
    socket.on('offer-deal', (data) => {
        const { postId, targetViewer } = data;
        io.to(targetViewer).emit('receive-offer', { postId, owner: socket.username });
    });

    socket.on('reply-offer', async (data) => {
        const { postId, accepted, viewer, owner } = data;
        if (accepted) {
            await postsCollection.updateOne(
                { id: parseInt(postId) }, 
                { $set: { isClosed: true, status: 'finished', acceptedViewer: viewer } }
            );
            const post = await postsCollection.findOne({ id: parseInt(postId) });
            await transactionsCollection.insertOne({
                id: Date.now(), type: 'HANDOVER', amount: 0, fromUser: owner, toUser: viewer,
                note: `✅ ปิดดีล/ส่งงานสำเร็จ: กระทู้ ${post.title}`, timestamp: Date.now()
            });
            io.emit('post-list-update', { postId: post.id, status: 'finished' });
            io.to(owner).emit('deal-result', { success: true, viewer, msg: `🎉 ${viewer} รับงานแล้ว!` });
            io.to(viewer).emit('deal-result', { success: true, msg: `✅ ยอมรับงานแล้ว!` });
        } else {
            io.to(owner).emit('deal-result', { success: false, viewer, msg: `❌ ${viewer} ปฏิเสธ` });
        }
    });

    // --- Finish Job Logic ---
    socket.on('request-finish-job', async (data) => {
        const { postId } = data;
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post) return;
        const requester = socket.username;
        let target = '';
        if (requester === post.author) target = post.acceptedViewer;
        else if (requester === post.acceptedViewer) target = post.author;
        if (target) io.to(target).emit('receive-finish-request', { requester });
    });

    socket.on('confirm-finish-job', async ({ postId, accepted, requester }) => {
        if (accepted) {
            await postsCollection.updateOne({ id: parseInt(postId) }, { 
                $set: { status: 'rating_pending', isClosed: true, ratings: {} } 
            });
            io.emit('update-post-status');
            io.to(`post-${postId}`).emit('start-rating-phase');
        } else {
            io.to(requester).emit('finish-request-rejected', { msgKey: 'SYS_FINISH_REJECTED' });
        }
    });

    socket.on('submit-rating', async (data) => {
        const { postId, rater, rating, comment } = data;
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post || post.status !== 'rating_pending') return;

        const isAuthor = rater === post.author;
        const myRoleKey = isAuthor ? 'author' : 'acceptedViewer';
        if (post.ratings && post.ratings[myRoleKey]) {
            io.to(rater).emit('job-completed-success', { msgKey: 'SYS_RATING_ALREADY' });
            return;
        }

        const updateField = {};
        updateField[`ratings.${myRoleKey}`] = { rating: parseFloat(rating), comment };
        await postsCollection.updateOne({ id: parseInt(postId) }, { $set: updateField });

        let userToRate = isAuthor ? post.acceptedViewer : post.author;
        if(userToRate) await calculateNewRating(userToRate, parseFloat(rating));

        const updatedPost = await postsCollection.findOne({ id: parseInt(postId) });
        const otherRoleKey = isAuthor ? 'acceptedViewer' : 'author';
        if (updatedPost.ratings && updatedPost.ratings[otherRoleKey]) {
            await postsCollection.updateOne({ id: parseInt(postId) }, { $set: { status: 'closed_permanently' } });
            delete postViewers[postId];
        }

        io.to(rater).emit('job-completed-success', { msgKey: 'SYS_RATING_SUCCESS' });
        const otherUser = isAuthor ? post.acceptedViewer : post.author;
        if (otherUser && (!updatedPost.ratings || !updatedPost.ratings[otherRoleKey])) {
             const notifMsg = { sender: 'System', target: otherUser, msgKey: 'SYS_OPPONENT_RATED', msgData: {}, msg: '🔔 อีกฝ่ายให้คะแนนแล้ว', timestamp: Date.now() };
            await messagesCollection.insertOne(notifMsg);
            io.to(otherUser).emit('private-message', { ...notifMsg, to: otherUser });
        }
        io.emit('update-post-status');
    });

    // --- Geolocation & Disconnect Logic ---
    socket.on('update-viewer-location', (data) => {
        const { postId, username, location } = data;
        if (location && location.lat && location.lng) {
            if (!viewerGeolocation[postId]) viewerGeolocation[postId] = {};
            viewerGeolocation[postId][username] = location;
            io.to(`post-${postId}`).emit('viewer-location-update', { viewer: username, location: location });
        }
    });

    socket.on('disconnect', () => {
        if (socket.viewingPostId && postViewers[socket.viewingPostId] === socket.username) {
            delete postViewers[socket.viewingPostId];
            broadcastPostStatus(socket.viewingPostId, false);
            if (viewerGeolocation[socket.viewingPostId] && viewerGeolocation[socket.viewingPostId][socket.username]) {
                delete viewerGeolocation[socket.viewingPostId][socket.username];
                io.to(`post-${socket.viewingPostId}`).emit('viewer-left-location', { viewer: socket.username });
            }
        }
    });

    socket.on('leave-post-room', (postId) => { 
        if (postViewers[postId] === socket.username) {
            delete postViewers[postId];
            broadcastPostStatus(postId, false);
            if (viewerGeolocation[postId] && viewerGeolocation[postId][socket.username]) {
                delete viewerGeolocation[postId][socket.username];
                io.to(`post-${postId}`).emit('viewer-left-location', { viewer: socket.username });
            }
        }
        socket.leave(`post-${postId}`);
        socket.viewingPostId = null;
    });

    socket.on('restart-post-room', async (postId) => { 
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post || socket.username !== post.author) return;
        
        const roomName = `post-${postId}`;
        const roomRef = io.sockets.adapter.rooms.get(roomName);
        if (roomRef) {
            for (const socketId of roomRef) {
                const clientSocket = io.sockets.sockets.get(socketId);
                if (clientSocket && clientSocket.username !== post.author && clientSocket.username !== 'Admin') {
                    clientSocket.emit('force-leave', '⚠️ เจ้าของกระทู้รีเซ็ตห้องสนทนา คุณถูกเชิญออก');
                    clientSocket.leave(roomName);
                    clientSocket.viewingPostId = null;
                }
            }
        }
        delete postViewers[postId];
        broadcastPostStatus(postId, false);
        socket.emit('restart-success', '✅ รีสตาร์ทห้องสำเร็จ (Kick All)');
    });

    socket.on('force-logout', (msg) => {
        if (socket.username) {
            delete postViewers[socket.viewingPostId];
            broadcastPostStatus(socket.viewingPostId, false);
            socket.emit('force-leave', msg); 
        }
    });
	
	//  WebRTC Signaling (ระบบโทร P2P) ---

// 1. ส่งคำขอโทร (Offer)
socket.on('call-user', ({ userToCall, signalData, fromUser }) => {
    // ค้นหา Socket ID ของปลายสาย
    const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === userToCall);
    if (targetSocket) {
        io.to(targetSocket.id).emit('call-incoming', { signal: signalData, from: fromUser });
    } else {
        socket.emit('call-failed', '❌ ปลายสายไม่ได้ออนไลน์อยู่ในขณะนี้');
    }
});

// 2. รับสาย (Answer)
socket.on('answer-call', ({ signal, to }) => {
    const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === to);
    if (targetSocket) io.to(targetSocket.id).emit('call-accepted', signal);
});

// 3. ส่งข้อมูลเครือข่าย (ICE Candidate)
socket.on('ice-candidate', ({ target, candidate }) => {
    const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === target);
    if (targetSocket) io.to(targetSocket.id).emit('ice-candidate-msg', candidate);
});

// 4. วางสาย
socket.on('end-call', ({ to }) => {
    const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === to);
    if (targetSocket) io.to(targetSocket.id).emit('call-ended');
});

});

// --- Initial Tasks ---
fetchLiveExchangeRates();
setInterval(fetchLiveExchangeRates, 7200000);

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server running with MongoDB on port ${PORT}`);
    });
});