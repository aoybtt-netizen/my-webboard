const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MongoClient } = require('mongodb'); // [NEW] MongoDB Driver
const fs = require('fs'); // ใช้สำหรับ Multer check folder เท่านั้น
const { ObjectId } = require('mongodb');
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
//const LIVE_API_URL = `https://v6.exchangerate-api.com/v6/{LIVE_API_KEY}/latest/USD`; 
const LIVE_API_URL = `https://api.fastforex.io/fetch-all?from=USD&api_key=${LIVE_API_KEY}`; 
let LIVE_EXCHANGE_RATES = { 'USD': 1.0, 'THB': 32.0 };
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
		'deduct_perm_denied': '⛔ ปฏิเสธการเข้าถึง: ต้องการ Admin Level 1 ขึ้นไป',
        'deduct_invalid_amt': '⛔ จำนวนเหรียญไม่ถูกต้อง',
        'deduct_user_not_found': '⛔ ไม่พบผู้ใช้งาน',
        'deduct_insufficient': '⛔ เป้าหมายมีเหรียญไม่เพียงพอ',
        'deduct_hierarchy_err': '⛔ ไม่สามารถดึงเหรียญจากผู้ที่มีระดับเท่ากันหรือสูงกว่าได้ (Level {level})',
        'deduct_zone_missing': '⛔ ไม่สามารถตรวจสอบโซนได้ เนื่องจากขาดข้อมูลพิกัด (Location)',
        'deduct_zone_mismatch': '⛔ ไม่อนุญาตให้ดึงเหรียญข้ามโซน (คุณ: {zoneA} / เป้าหมาย: {zoneB})',
		'ban_perm_denied': '⛔ ปฏิเสธการเข้าถึง: ต้องการ Admin Level 1 ขึ้นไป',
        'ban_cannot_admin': '⛔ ไม่สามารถแบนบัญชี Admin หลักได้',
        'ban_user_not_found': '⛔ ไม่พบผู้ใช้งาน',
        'ban_hierarchy_err': '⛔ ไม่สามารถแบน/ปลดแบน ผู้ที่มีระดับเท่ากันหรือสูงกว่าได้ (Level {level})',
        'ban_zone_missing': '⛔ ไม่สามารถตรวจสอบโซนได้ เนื่องจากขาดข้อมูลพิกัด (Location)',
        'ban_zone_mismatch': '⛔ ไม่อนุญาตให้แบนข้ามโซน (คุณ: {zoneA} / เป้าหมาย: {zoneB})',
    },
    'en': {
        'post_not_found': 'Post not found',
        'closed_or_finished': '⛔ This post is closed/finished.',
        'room_occupied': '⚠️ This post is currently occupied. Please wait...',
		'deduct_perm_denied': '⛔ Permission denied: Admin Level 1+ required',
        'deduct_invalid_amt': '⛔ Invalid coin amount',
        'deduct_user_not_found': '⛔ User not found',
        'deduct_insufficient': '⛔ Target user has insufficient coins',
        'deduct_hierarchy_err': '⛔ Cannot deduct coins from user with equal or higher level (Level {level})',
        'deduct_zone_missing': '⛔ Cannot verify zone (Missing location data)',
        'deduct_zone_mismatch': '⛔ Cross-zone deduction is not allowed (You: {zoneA} / Target: {zoneB})',
		'ban_perm_denied': '⛔ Permission denied: Admin Level 1+ required',
        'ban_cannot_admin': '⛔ Cannot ban main Admin account',
        'ban_user_not_found': '⛔ User not found',
        'ban_hierarchy_err': '⛔ Cannot ban/unban user with equal or higher level (Level {level})',
        'ban_zone_missing': '⛔ Cannot verify zone (Missing location data)',
        'ban_zone_mismatch': '⛔ Cross-zone ban is not allowed (You: {zoneA} / Target: {zoneB})',
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
        await configCollection.insertOne({ id: 'main_config', systemFee: 5, adminFee: 5 });
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
            banExpires: null, // เพิ่มฟิลด์เก็บวันหมดอายุแบนสำหรับ User ใหม่
            adminLevel: 0 
        };
        await usersCollection.insertOne(user);
    }

    // =========================================================
    // 🎯 เพิ่ม Logic ตรวจสอบการพ้นโทษแบนอัตโนมัติ (ใส่เพิ่มตรงนี้)
    // =========================================================
    if (user.isBanned && user.banExpires) {
        const now = new Date();
        const expiry = new Date(user.banExpires);

        if (now > expiry) {
            // ถ้าเวลาปัจจุบันเลยเวลาที่กำหนดแบนไว้แล้ว -> ปลดแบนในฐานข้อมูล
            await usersCollection.updateOne(
                { username: username },
                { $set: { isBanned: false, banExpires: null } }
            );
            // อัปเดตตัวแปร user ในหน่วยความจำเพื่อให้ด่านตรวจสอบถัดไปผ่าน
            user.isBanned = false;
            user.banExpires = null;
        }
    }
    // =========================================================

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
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

	function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // รัศมีโลกเป็นเมตร
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
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
    // 1. รับค่า country เพิ่มเข้ามา (ส่งมาจาก Frontend)
    const { username, currency, location, country, lang } = req.query; 
	const currentLang = lang || 'th'; // ป้องกันค่าว่าง 
    const targetCurrency = currency || DEFAULT_CURRENCY; 

    if (!username) return res.status(400).json({ error: 'No username' });
    
    const user = await getUserData(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) {
    // กำหนดหัวข้อหลักเป็นภาษาอังกฤษตามที่คุณต้องการ
    let banMessage = "❌ Your account is suspended.";
    
    if (user.banExpires) {
        const expireDate = new Date(user.banExpires);
        // เลือก Format ตาม lang ที่ส่งมา (ถ้า th จะเห็นเป็นวันที่ไทย ถ้า en จะเห็นสากล)
        const dateStr = expireDate.toLocaleDateString(currentLang === 'th' ? 'th-TH' : 'en-US');
        const timeStr = expireDate.toLocaleTimeString(currentLang === 'th' ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit' });
        
        // คอมเมนต์ไทย: ต่อท้ายด้วยวันเวลาหมดอายุ
        banMessage += (currentLang === 'th') 
            ? ` until ${dateStr} Time ${timeStr}` 
            : ` until ${dateStr} at ${timeStr}.`;
    } else {
        // คอมเมนต์ไทย: กรณีแบนถาวร
        banMessage += " permanently.";
    }

    return res.status(403).json({ error: banMessage });
}
    
    let userZoneId = null;
    let postCostData;
    
    try {
        const locationObj = location ? JSON.parse(location) : null;

        // อัปเดตพิกัดล่าสุด และ [NEW] ประเทศ ลง Database
        if (locationObj && locationObj.lat && locationObj.lng) {
            const updateFields = { 
                lastLocation: locationObj, 
                lastSeen: new Date() 
            };
            
            // ถ้ามีการส่งค่า country มา ให้บันทึกด้วย
            if (country) {
                updateFields.country = country; 
            }

            await usersCollection.updateOne(
                { username: username }, 
                { $set: updateFields }
            );
        }

        // ... (ส่วนคำนวณค่าธรรมเนียมเดิม) ...
        postCostData = await getPostCostByLocation(locationObj);
        const zoneInfo = await findResponsibleAdmin(locationObj);
        if (zoneInfo.zoneData) {
            userZoneId = zoneInfo.zoneData.id;
        }

    } catch (e) {
        console.error("Error calculating location cost/zone:", e);
        postCostData = await getPostCostByLocation(null);
    }
    
    // ... (ส่วน return response เดิม) ...
    const convertedCoins = convertUSD(user.coins, targetCurrency);
    res.json({
        coins: user.coins,
        convertedCoins: convertedCoins.toFixed(2),
        currencySymbol: targetCurrency.toUpperCase(),
        postCost: postCostData,
        rating: user.rating,
        adminLevel: user.adminLevel || 0,
        userZoneId: userZoneId,
        country: user.country || 'TH', 
		totalPosts: user.totalPosts || 0,     
        completedJobs: user.completedJobs || 0
    });
});

// 3. User List
app.get('/api/users-list', async (req, res) => {
    try {
        // แก้ไขบรรทัดนี้: ปิดปีกกาให้ถูกต้อง และกำหนดค่าเริ่มต้นให้ limit เป็น 50
        const { requestBy, search, page = 1, limit = 50} = req.query;
        
        const pageNum = parseInt(page) || 1;
		const limitNum = parseInt(limit) || 50;
		const skip = (pageNum - 1) * limitNum;

        // 1. ตรวจสอบสิทธิ์
        const requester = await getUserData(requestBy);
        if (!requester || requester.adminLevel < 1) {
            return res.status(403).json({ error: 'สำหรับ Admin เท่านั้น' });
        }
        
        // ดึงข้อมูล User ทั้งหมดมาก่อน
        const allUsers = await usersCollection.find({}).toArray();

        const mapUserResponse = (u) => ({ 
            name: u.username, 
            coins: u.coins, 
            rating: u.rating, 
            isBanned: u.isBanned,
            adminLevel: u.adminLevel || 0,
            country: u.country || 'N/A',
            assignedLocation: u.assignedLocation || null,
            relationType: u.relationType || 'OTHER',
			totalPosts: u.totalPosts || 0,
			completedJobs: u.completedJobs || 0
        });

        let finalResults = [];

        // CASE A: Admin Level 3
        if (requester.adminLevel >= 3) {
            finalResults = allUsers.filter(u => u.username !== requester.username);
        }
        // CASE B: Admin Level 2 + Search
        else {
            // 1. ดึงโซนที่เกี่ยวข้องก่อนเสมอ
            let myOwnedZones = await zonesCollection.find({ assignedAdmin: requester.username }).toArray();
            let myRefZones = (requester.adminLevel === 2) 
                ? await zonesCollection.find({ "refLocation.sourceUser": requester.username }).toArray() 
                : [];
            const allZones = await zonesCollection.find({}).toArray();

            // 2. กรอง User ตามโซนพิกัด (Logic เดิมของคุณ)
            finalResults = allUsers.filter(u => {
                if (u.username === requester.username) return false;
                
                // --- เพิ่มส่วนนี้: ถ้า Admin Level 2 กำลัง Search และอยู่ประเทศเดียวกัน ให้ผ่านเลย (ไม่ต้องเช็คพิกัด) ---
                if (requester.adminLevel === 2 && search && u.country === requester.country) {
                    return true; 
                }

                // --- ถ้าไม่ใช่กรณี Search ข้ามโซน ให้เช็คตามพิกัดปกติ ---
                if (!u.lastLocation || !u.lastLocation.lat || !u.lastLocation.lng) return false;
                let minDistance = Infinity;
                let closestZone = null;
                allZones.forEach(zone => {
                    const dist = getDistanceFromLatLonInKm(u.lastLocation.lat, u.lastLocation.lng, zone.lat, zone.lng);
                    if (dist < minDistance) { minDistance = dist; closestZone = zone; }
                });

                if (closestZone) {
                    const isOwned = myOwnedZones.some(mz => mz.id === closestZone.id);
                    const isRef = myRefZones.some(mz => mz.id === closestZone.id);
                    if (isOwned) { u.relationType = 'OWNED'; return true; }
                    if (isRef) { u.relationType = 'REF'; return true; }
                }
                return false;
            });
        }

        // 3. กรองด้วยชื่อ (Search Keyword) ในขั้นตอนสุดท้าย
        if (search && search.trim() !== "") {
            const lowerSearch = search.toLowerCase();
            finalResults = finalResults.filter(u => u.username.toLowerCase().includes(lowerSearch));
        }
		
		const totalOwned = finalResults.filter(u => u.relationType === 'OWNED').length;
		const totalRef = finalResults.filter(u => u.relationType === 'REF').length;
		const totalOther = finalResults.filter(u => u.relationType !== 'OWNED' && u.relationType !== 'REF').length;
     

        // --- ทำ Pagination ---
        const totalUsers = finalResults.length;
        const pagedUsers = finalResults.slice(skip, skip + limitNum);

        res.json({
			users: pagedUsers.map(mapUserResponse),
			currentPage: pageNum,
			totalPages: Math.ceil(finalResults.length / limitNum),
			counts: {
			owned: totalOwned,
			ref: totalRef,
			other: totalOther
    }
});

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 4. Contacts (Messages)
app.get('/api/contacts', async (req, res) => {
    const { username } = req.query; 
    if (!username) return res.status(400).json({ error: 'No username' });

    try {
        const contacts = await messagesCollection.aggregate([
            {
                $match: {
                    $or: [{ sender: username }, { target: username }]
                }
            },
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: {
                        $cond: [{ $eq: ["$sender", username] }, "$target", "$sender"]
                    },
                    lastMessage: { $first: "$msg" },
                    timestamp: { $first: "$timestamp" },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$target", username] }, { $eq: ["$isRead", false] }] },
                                1, 
                                0 
                            ]
                        }
                    }
                }
            },
            { $sort: { timestamp: -1 } }
        ]).toArray();

        // ดึงข้อมูล User เพิ่มเติมเพื่อเช็คว่าเป็น Admin หรือไม่
        const formattedContacts = [];
        for (const c of contacts) {
            const partnerUser = await usersCollection.findOne({ username: c._id });
            formattedContacts.push({
                partner: c._id,
                lastMessage: c.lastMessage,
                timestamp: c.timestamp,
                unreadCount: c.unreadCount,
                // เพิ่ม Flag บอกว่าเป็น Admin หรือไม่ (Level > 0)
                isAdmin: partnerUser ? (partnerUser.adminLevel > 0) : false
            });
        }

        res.json(formattedContacts);

    } catch (e) {
        console.error("Error fetching contacts:", e);
        res.status(500).json({ error: 'Server error' });
    }
});

// 4.1 API หา Admin ที่ใกล้ที่สุด (สำหรับแนะนำใน Inbox)
app.get('/api/nearest-admin', async (req, res) => {
    const { lat, lng } = req.query;
    
    // ถ้าไม่มีพิกัดมา ให้คืนค่า Admin กลาง
    if (!lat || !lng) {
        return res.json({ found: true, admin: 'Admin', zoneName: 'System Default' });
    }

    try {
        const location = { lat: parseFloat(lat), lng: parseFloat(lng) };
        // ใช้ฟังก์ชันที่มีอยู่แล้วใน server.js
        const responsibleData = await findResponsibleAdmin(location);
        
        res.json({
            found: true,
            admin: responsibleData.username,
            zoneName: responsibleData.zoneName
        });
    } catch (e) {
        console.error(e);
        res.json({ found: false, admin: 'Admin' });
    }
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

// 7.2 API สำหรับ Admin Level 1/2 เพื่อตั้งชื่อโซนของตนเอง
app.post('/api/admin/set-zone-name', async (req, res) => {
    const { zoneId, newZoneName, requestBy } = req.body;
    
    // 1. ตรวจสอบสิทธิ์ (Admin Level 1+)
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) {
        // แก้ไข: ส่ง 403 และข้อความที่ชัดเจนขึ้น
        return res.status(403).json({ success: false, error: 'Permission denied. Admin access required.' });
    }
    
    // 2. ตรวจสอบข้อมูล
    if (!zoneId || !newZoneName || typeof newZoneName !== 'string' || newZoneName.trim() === '') {
        return res.status(400).json({ success: false, error: 'Invalid zone ID or zone name.' });
    }
    
    const zoneIdInt = parseInt(zoneId);
    const trimmedName = newZoneName.trim();
    
    const zone = await zonesCollection.findOne({ id: zoneIdInt });

    if (!zone) return res.status(404).json({ success: false, error: 'Zone not found.' });
    
    // 3. ตรวจสอบสิทธิ์: ต้องเป็น Admin L3 หรือเป็น Assigned Admin (เจ้าของโซน) ของโซนนี้
    if (requester.adminLevel < 3 && zone.assignedAdmin !== requestBy) {
        // แก้ไข: ส่ง 403 และข้อความที่ชัดเจนขึ้น
        return res.status(403).json({ success: false, error: 'คุณไม่ใช่ผู้ดูแลโซนนี้ หรือไม่มีสิทธิ์แก้ไขชื่อโซนนี้' });
    }

    try {
        // 4. อัปเดตชื่อโซนในฐานข้อมูล
        const updateResult = await zonesCollection.updateOne(
            { id: zoneIdInt },
            { $set: { name: trimmedName } }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Zone not found or no changes made.' });
        }
        
        // 5. ส่งผลลัพธ์กลับไป
        res.json({ success: true, message: `Zone ID ${zoneId} name updated to ${trimmedName}` });
    } catch (error) {
        console.error('Error updating zone name:', error);
        res.status(500).json({ success: false, error: 'Server error during zone name update.' });
    }
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
    
    // 5. แจ้งเตือน Admin ให้รู้ว่ามี Transaction ใหม่ (เหมือนเดิม)
    io.to('Admin').emit('admin-new-transaction');

    res.json({ success: true });
});

	// 8.1 API สำหรับ Admin อัปโหลดรูปพื้นหลังโซน
app.post('/api/admin/upload-zone-bg', upload.single('image'), async (req, res) => {
    const { zoneId, requestBy } = req.body;
    
    // ตรวจสอบสิทธิ์
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied.' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const zoneIdInt = parseInt(zoneId);
    const zone = await zonesCollection.findOne({ id: zoneIdInt });

    if (!zone) return res.status(404).json({ error: 'Zone not found.' });

    // ตรวจสอบว่าเป็นเจ้าของโซนหรือไม่
    if (requester.adminLevel < 3 && zone.assignedAdmin !== requestBy) {
        return res.status(403).json({ error: 'Not authorized for this zone.' });
    }

    try {
        // อัปเดต URL รูปภาพลงในฐานข้อมูลโซน
        const imageUrl = req.file.path; // Cloudinary URL
        await zonesCollection.updateOne(
            { id: zoneIdInt },
            { $set: { bgImage: imageUrl } }
        );

        res.json({ success: true, imageUrl: imageUrl, message: 'Zone background updated.' });
    } catch (error) {
        console.error('Error uploading zone bg:', error);
        res.status(500).json({ error: 'Server error.' });
    }
});

// 8.2 API สำหรับสมาชิกเช็คพื้นหลังตามพิกัด (Public)
app.get('/api/zone-check-bg', async (req, res) => {
    const { lat, lng } = req.query;
    
    // หากไม่มีพิกัด ให้ส่งค่าเริ่มต้นกลับไป
    if (!lat || !lng) return res.json({ bgImage: null, zoneName: "Webboard" });

    try {
        const location = { lat: parseFloat(lat), lng: parseFloat(lng) };
        const responsible = await findResponsibleAdmin(location);

        // ✅ แก้ไขตรงนี้: ส่ง zoneName กลับไปเสมอ ไม่ว่าจะเจอรหัสรูปภาพหรือไม่
        res.json({ 
            bgImage: (responsible.zoneData && responsible.zoneData.bgImage) ? responsible.zoneData.bgImage : null,
            zoneName: responsible.zoneName || "Webboard" 
        });

    } catch (e) {
        console.error(e);
        res.json({ bgImage: null, zoneName: "Webboard" });
    }
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
    // 1. รับค่า Params
    let adminUsername = req.query.username; 
    const { lat, lng } = req.query;

    try {
        // 2. ถ้ามีการส่งพิกัดมา (จากหน้าสร้างกระทู้) ให้หา Admin ที่ดูแลโซนนั้น
        if (lat && lng) {
            const loc = { lat: parseFloat(lat), lng: parseFloat(lng) };
            // ใช้ Logic เดิมที่มีอยู่แล้วในการหา Responsible Admin
            const responsible = await findResponsibleAdmin(loc); 
            if (responsible && responsible.username) {
                adminUsername = responsible.username; // เปลี่ยนเป้าหมายเป็น Admin คนนี้
                console.log(`📍 Topic Request from [${lat}, ${lng}] -> Assigned to: ${adminUsername}`);
            }
        }

        let topics = [];
        let fallbackTopics = [];

        // 3. ค้นหาหัวข้อของ Admin คนนั้น (หรือคนที่ระบุมา)
        if (adminUsername) {
            topics = await topicsCollection.find({ adminUsername: adminUsername }).toArray();
        }

        // 4. Fallback: ถ้าไม่เจอหัวข้อ หรือไม่ได้ระบุ Admin ให้ใช้ "ค่ากลาง"
        if (topics.length === 0) {
            fallbackTopics = await topicsCollection.find({ 
                $or: [
                    { adminUsername: { $exists: false } }, 
                    { adminUsername: 'Admin' }, // หรือ Level 3 Default
                    { isDefault: true } 
                ] 
            }).toArray();

            // กรองเอาเฉพาะที่ไม่มี adminUsername ซ้ำซ้อน (ถ้า Logic ซับซ้อน)
            // แต่เบื้องต้นใช้ fallbackTopics ได้เลยถ้า topics หลักว่างเปล่า
            topics = fallbackTopics;
        }

        res.json(topics);

    } catch (err) {
        console.error('Error fetching topics:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/admin/topics', async (req, res) => {
    const { requestBy } = req.query; // รับชื่อคนขอ

    try {
        let query = {};
        
        // ถ้ามีการระบุชื่อคนขอมา ให้ดึงเฉพาะหัวข้อของคนนั้น
        if (requestBy) {
            query = { adminUsername: requestBy };
        }

        // ดึงข้อมูลตาม Query ที่กรองแล้ว
        const topics = await topicsCollection.find(query).toArray();
        res.json(topics);
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error fetching topics' });
    }
});

app.post('/api/admin/topics/manage', async (req, res) => {
    const { action, id, name, requestBy } = req.body; // รับ requestBy (username) มาด้วย
    
    // 1. ตรวจสอบสิทธิ์
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied. Admin 1+ required' });
    }
    
    const adminUsername = requestBy; // กำหนดให้หัวข้อผูกกับ username ของแอดมินที่ทำรายการ
    
    if (action === 'add') {
        if (!name || name.trim() === '') return res.status(400).json({ error: 'Topic name is required.' });
        
        const newTopic = {
            id: Date.now().toString(), // ใช้ timestamp เป็น ID
            name: name,
            adminUsername: adminUsername, // ⭐ [NEW] ผูกกับแอดมินที่สร้าง
            created: new Date()
        };
        await topicsCollection.insertOne(newTopic);
        // ไม่ต้องใช้ io.emit ทั่วไป เพราะตอนนี้เป็นหัวข้อเฉพาะบุคคลแล้ว
        return res.json({ success: true, topic: newTopic });
    }
    
    if (action === 'edit') {
        if (!id || !name) return res.status(400).json({ error: 'Missing topic ID or name.' });
        
        // ต้องแก้ไขหัวข้อที่ผูกกับ adminUsername ของตนเองเท่านั้น
        const result = await topicsCollection.updateOne(
            { id: id, adminUsername: adminUsername }, 
            { $set: { name: name } }
        );
        
        if (result.matchedCount > 0) {
            // io.emit('topic-update', { id: id, newName: name }); // ยกเลิกการ emit ทั่วไป
            return res.json({ success: true, message: 'แก้ไขหัวข้อสำเร็จ' });
        } else {
            // อาจจะไม่พบ หรือแอดมินพยายามแก้ไขหัวข้อของคนอื่น
            return res.status(404).json({ success: false, error: 'ไม่พบหัวข้อหรือคุณไม่มีสิทธิ์แก้ไข' });
        }
    }
    
    if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'Missing topic ID.' });

        // ต้องลบหัวข้อที่ผูกกับ adminUsername ของตนเองเท่านั้น
        const result = await topicsCollection.deleteOne({ id: id, adminUsername: adminUsername });

        if (result.deletedCount > 0) {
            // io.emit('topic-delete', { id: id }); // ยกเลิกการ emit ทั่วไป
            return res.json({ success: true, message: 'ลบหัวข้อสำเร็จ' });
        } else {
             // อาจจะไม่พบ หรือแอดมินพยายามลบหัวข้อของคนอื่น
            return res.status(404).json({ success: false, error: 'ไม่พบหัวข้อหรือคุณไม่มีสิทธิ์ลบ' });
        }
    }
    
    return res.status(400).json({ success: false, error: 'Invalid action' });
});

// 10.1  Admin Announcement Endpoint (Save & Update) ---
app.post('/api/admin/set-announcement', async (req, res) => {
    const { announcementText, requestBy } = req.body;
    
    // ตรวจสอบสิทธิ์ Admin Level 1 ขึ้นไป
    const user = await usersCollection.findOne({ username: requestBy }); 
    if (!user || user.adminLevel < 1) {
        return res.status(403).json({ error: 'Forbidden: Requires Admin Level 1 or higher.' });
    }

    try {
        // บันทึกประกาศลงในข้อมูลของ Admin คนนั้นโดยเฉพาะ
        await usersCollection.updateOne(
            { username: requestBy },
            { $set: { announcement: announcementText || '' } }
        );

        // แจ้งเตือนว่ามีการอัปเดต (ส่งชื่อ admin ไปด้วย เพื่อให้ Client กรองได้ว่าต้องอัปเดตไหม)
        io.emit('announcement-update', { admin: requestBy, text: announcementText || '' });

        res.json({ success: true, message: 'Announcement saved to your profile.' });
    } catch (e) {
        console.error('Error setting announcement:', e);
        res.status(500).json({ error: 'Server error while saving announcement.' });
    }
});

// 10.2 Get Announcement (Location Based)
app.get('/api/admin/get-announcement', async (req, res) => {
    try {
        const { requestBy, lat, lng } = req.query;

        // กรณี 1: Admin ขอมา (เพื่อเอาไปแสดงในหน้าแก้ไข) -> ส่งของตัวเองกลับไป
        if (requestBy) {
            const adminUser = await usersCollection.findOne({ username: requestBy });
            return res.json({ announcement: adminUser ? (adminUser.announcement || '') : '' });
        }

        // กรณี 2: User ทั่วไปขอมา (พร้อมพิกัด) -> คำนวณหาเจ้าถิ่น
        let targetAdmin = 'Admin'; // Default เป็น Admin ใหญ่
        
        if (lat && lng) {
            const location = { lat: parseFloat(lat), lng: parseFloat(lng) };
            // ใช้ฟังก์ชันเดิมที่มีอยู่แล้ว หาเจ้าของพื้นที่
            const responsible = await findResponsibleAdmin(location);
            if (responsible && responsible.username) {
                targetAdmin = responsible.username;
            }
        }

        // ดึงข้อความจาก Admin ผู้รับผิดชอบ
        const responsibleUser = await usersCollection.findOne({ username: targetAdmin });
        
        // ถ้าเจ้าถิ่นไม่มีประกาศ ให้ไปดึงของ Admin ใหญ่ (Fallback)
        let finalAnnouncement = responsibleUser ? responsibleUser.announcement : '';
        
        if (!finalAnnouncement && targetAdmin !== 'Admin') {
            const mainAdmin = await usersCollection.findOne({ username: 'Admin' });
            finalAnnouncement = mainAdmin ? mainAdmin.announcement : '';
        }

        res.json({ announcement: finalAnnouncement || '' });

    } catch (e) {
        console.error('Error fetching announcement:', e);
        res.status(500).json({ error: 'Server error while fetching announcement.' });
    }
});

// 11. Posts (List)
app.get('/api/posts', async (req, res) => {
    const ONE_HOUR = 3600000;
    await postsCollection.updateMany(
        { isClosed: false, isPinned: false, id: { $lt: Date.now() - ONE_HOUR } },
        { $set: { isClosed: true } }
    );

    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const allPosts = await postsCollection.find({}).toArray();
    const sortedPosts = allPosts.sort((a, b) => {
        const aIsPinnedActive = a.isPinned && !a.isClosed;
        const bIsPinnedActive = b.isPinned && !b.isClosed;
        if (aIsPinnedActive && !bIsPinnedActive) return -1;
        if (!aIsPinnedActive && bIsPinnedActive) return 1;
        return b.id - a.id;
    });

    const paginatedPosts = sortedPosts.slice(skip, skip + limit);
    const authorNames = [...new Set(paginatedPosts.map(p => p.author))];
    const authors = await usersCollection.find({ username: { $in: authorNames } }).toArray();
    const authorMap = {};
    authors.forEach(u => authorMap[u.username] = u.rating);

    res.json({
        posts: paginatedPosts.map(post => ({ ...post, authorRating: authorMap[post.author] !== undefined ? authorMap[post.author].toFixed(2) : '0.00' })),
        totalItems: sortedPosts.length, totalPages: Math.ceil(sortedPosts.length / limit), currentPage: page, limit
    });
});

// 12. Single Post	
app.get('/api/posts/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const post = await postsCollection.findOne({ id: id });
        
        if (!post) {
            return res.status(404).json({ error: 'ไม่พบกระทู้' });
        }

        // --- ระบบปิดกระทู้อัตโนมัติ (1 ชม.) ---
        if(!post.isClosed && Date.now() - post.id > 3600000 && !post.isPinned){ 
            await postsCollection.updateOne({ id: id }, { $set: { isClosed: true } });
            post.isClosed = true; 
        }

        // --- ดึงข้อมูลสถิติเจ้าของกระทู้ ---
        const author = await getUserData(post.author);
        

        // --- เตรียมข้อมูลส่งกลับ (Response) ---
        const responseData = { 
            ...post, 
            authorRating: author.rating ? author.rating.toFixed(2) : '0.00',
            authorTotalPosts: author.totalPosts || 0,     // ส่งไปชื่อนี้ตรงกับ post.html
            authorCompletedJobs: author.completedJobs || 0 // ส่งไปชื่อนี้ตรงกับ post.html
        };

        res.json(responseData);

    } catch (err) {
        console.error("🔥 [Error] API /api/posts/:id Failed:", err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// 13. Viewer Status
app.get('/api/posts/:id/viewer-status', async (req, res) => { 
    const postId = parseInt(req.params.id);
    const requestBy = req.query.requestBy;
    const post = await postsCollection.findOne({ id: postId });

    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.isPinned) return res.json({ isOccupied: false, viewer: null });

    if (requestBy !== 'Admin' && requestBy !== post.author) {
        return res.status(403).json({ error: 'Permission denied.' });
    }

    const currentViewer = postViewers[postId];
    if (currentViewer && currentViewer !== 'Admin' && currentViewer !== post.author) {
        // ดึงข้อมูล User ของคนดู (Viewer) มาทั้งหมด
        const viewerUser = await getUserData(currentViewer);

        // 🎯 ส่งค่าสถิติออกไปใน JSON Response
        return res.json({ 
            isOccupied: true, 
            viewer: currentViewer, 
            rating: viewerUser.rating,
            totalPosts: viewerUser.totalPosts || 0,     // เพิ่มตรงนี้
            completedJobs: viewerUser.completedJobs || 0 // เพิ่มตรงนี้
        });
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
    let finalTitle = (author === 'Admin' && title) ? title.trim() : topicName;

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
    //ดึง Zone ID จาก responsibleData เพื่อบันทึกลงกระทู้
    const postZoneId = responsibleData.zoneData ? responsibleData.zoneData.id : null;

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
        isClosed: false, isPinned: (author === 'Admin'),
        zoneId: postZoneId
    };
	await postsCollection.insertOne(newPost);
    await usersCollection.updateOne(
    { username: author },
    { $inc: { totalPosts: 1 } } // $inc คือการบวกค่าเพิ่มไป 1
		);
	
    
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
    
    try {
        // 1. ตรวจสอบเรื่องเลข ID (แปลงเป็นตัวเลข)
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post) return res.status(404).json({ error: 'Post not found' });

        // 2. ตรวจสอบสิทธิ์
        const requester = await getUserData(requestBy);
        if (requestBy !== post.author && (!requester || requester.adminLevel < 1)) {
            return res.status(403).json({ error: 'ไม่มีสิทธิ์ปิดกระทู้นี้' });
        }

        // 3. อัปเดตทั้ง status และ isClosed (เพื่อให้สอดคล้องกับ API อื่น)
        await postsCollection.updateOne(
            { id: parseInt(postId) }, 
            { $set: { 
                status: 'closed', 
                isClosed: true, 
                closedAt: Date.now() 
            } }
        );
        
        // 4. ส่งแจ้งเตือน (Notification)
        const notifMsg = { 
            sender: 'System', 
            target: post.author, 
            msgKey: 'POST_CLOSED', 
            msgData: { title: post.title }, 
            msg: `🔒 กระทู้ "${post.title}" ถูกปิดแล้ว`, 
            timestamp: Date.now() 
        };
        await messagesCollection.insertOne(notifMsg);
        io.to(post.author).emit('private-message', { ...notifMsg, to: post.author });

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// 18. Deduct Coins (แก้ไข: แยกเงื่อนไข Level 3 กับ 1-2)
app.post('/api/admin/deduct-coins', async (req, res) => {
    const { targetUser, amount, requestBy, lang } = req.body;
    const currentLang = lang || 'th';

    // 1. ตรวจสอบสิทธิ์เบื้องต้น
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) { 
        return res.status(403).json({ error: translateServerMsg('deduct_perm_denied', currentLang) });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: translateServerMsg('deduct_invalid_amt', currentLang) });

    const targetData = await getUserData(targetUser);
    if (!targetData) return res.status(404).json({ error: translateServerMsg('deduct_user_not_found', currentLang) });
    
    if (targetData.coins < parsedAmount) {
        return res.status(400).json({ error: translateServerMsg('deduct_insufficient', currentLang) });
    }

    // =========================================================
    // ตรวจสอบความปลอดภัย (Security Checks)
    // =========================================================
    const requesterLevel = requester.adminLevel || 0;
    const targetLevel = targetData.adminLevel || 0;

    if (targetLevel >= requesterLevel) {
        let msg = translateServerMsg('deduct_hierarchy_err', currentLang);
        msg = msg.replace('{level}', targetLevel);
        return res.status(403).json({ error: msg });
    }

    if (requesterLevel < 3) {
        if (!requester.lastLocation || !targetData.lastLocation) {
            return res.status(400).json({ error: translateServerMsg('deduct_zone_missing', currentLang) });
        }
        const requesterZoneInfo = await findResponsibleAdmin(requester.lastLocation);
        const targetZoneInfo = await findResponsibleAdmin(targetData.lastLocation);
        const rZoneId = requesterZoneInfo.zoneData ? requesterZoneInfo.zoneData.id : 'no-zone';
        const tZoneId = targetZoneInfo.zoneData ? targetZoneInfo.zoneData.id : 'no-zone';

        if (rZoneId !== tZoneId) {
            let msg = translateServerMsg('deduct_zone_mismatch', currentLang);
            msg = msg.replace('{zoneA}', requesterZoneInfo.zoneName).replace('{zoneB}', targetZoneInfo.zoneName);
            return res.status(403).json({ error: msg });
        }
    }

    // =========================================================
    // แยกการทำงานตามระดับ Admin
    // =========================================================

    // CASE A: Admin Level 3 -> ดึงเงินทันที (ไม่ต้องรออนุมัติ)
    if (requesterLevel >= 3) {
        await updateUser(requestBy, { coins: requester.coins + parsedAmount });
        await updateUser(targetUser, { coins: targetData.coins - parsedAmount });

        await transactionsCollection.insertOne({
            id: Date.now(), 
            type: 'ADMIN_RETURN', 
            amount: parsedAmount, 
            fromUser: targetUser,
            toUser: requestBy, 
            note: `Admin (${requestBy}) deduct USD from ${targetUser} (Force)`, 
            timestamp: Date.now()
        });

        const updatedTarget = await getUserData(targetUser);
        io.emit('balance-update', { user: targetUser, coins: updatedTarget.coins });
        
        const updatedRequester = await getUserData(requestBy);
        io.emit('balance-update', { user: requestBy, coins: updatedRequester.coins });        
            
        io.to('Admin').emit('admin-new-transaction');

        return res.json({ success: true, message: '✅ ดึงเงินคืนสำเร็จ (Force Deduct)' });
    }

    // CASE B: Admin Level 1-2 -> ส่งคำขอให้ User ยืนยัน
    else {
        // ค้นหา Socket ของ User เป้าหมาย
        const targetSocket = [...io.sockets.sockets.values()].find(s => s.username === targetUser);
        
        if (!targetSocket) {
             return res.json({ success: false, error: '❌ ผู้ใช้งานไม่ออนไลน์ ไม่สามารถส่งคำขอยืนยันได้' });
        }

        // ส่ง Event ไปยัง Client ของ User
        io.to(targetSocket.id).emit('request-deduct-confirm', {
            amount: parsedAmount,
            requester: requestBy
        });

        return res.json({ success: true, waitConfirm: true, message: `⏳ ส่งคำขอไปยัง ${targetUser} แล้ว กรุณารอการยืนยัน` });
    }
});

// 19. Toggle Ban
app.post('/api/admin/toggle-ban', async (req, res) => {
    // 1. รับค่า banDays เพิ่มเติมจาก req.body
    const { targetUser, shouldBan, requestBy, lang, banDays } = req.body;
    const currentLang = lang || 'th';

    // ตรวจสอบผู้สั่งการ (Requester)
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: translateServerMsg('ban_perm_denied', currentLang) });
    }

    if (targetUser === 'Admin') {
        return res.status(400).json({ error: translateServerMsg('ban_cannot_admin', currentLang) });
    }

    const targetData = await getUserData(targetUser);
    if (!targetData) {
        return res.status(404).json({ error: translateServerMsg('ban_user_not_found', currentLang) });
    }

    // A. Hierarchy Check
    const requesterLevel = requester.adminLevel || 0;
    const targetLevel = targetData.adminLevel || 0;
    if (targetLevel >= requesterLevel) {
        let msg = translateServerMsg('ban_hierarchy_err', currentLang);
        msg = msg.replace('{level}', targetLevel);
        return res.status(403).json({ error: msg });
    }

    // B. Zone Check (Admin Level 1-2)
    if (requesterLevel < 3) {
        if (!requester.lastLocation || !targetData.lastLocation) {
            return res.status(400).json({ error: translateServerMsg('ban_zone_missing', currentLang) });
        }
        const requesterZoneInfo = await findResponsibleAdmin(requester.lastLocation);
        const targetZoneInfo = await findResponsibleAdmin(targetData.lastLocation);
        const rZoneId = requesterZoneInfo.zoneData ? requesterZoneInfo.zoneData.id : 'no-zone';
        const tZoneId = targetZoneInfo.zoneData ? targetZoneInfo.zoneData.id : 'no-zone';

        if (rZoneId !== tZoneId) {
            let msg = translateServerMsg('ban_zone_mismatch', currentLang);
            msg = msg.replace('{zoneA}', requesterZoneInfo.zoneName).replace('{zoneB}', targetZoneInfo.zoneName);
            return res.status(403).json({ error: msg });
        }
    }

    // =========================================================
    // คำนวณวันหมดอายุ (New Logic)
    // =========================================================
    let banExpires = null;
    if (shouldBan && banDays > 0) {
        // สร้างวันหมดอายุ: เวลาปัจจุบัน + (จำนวนวัน * 24 ชม. * 60 นาที * 60 วิ * 1000 มิลลิวินาที)
        banExpires = new Date();
        banExpires.setDate(banExpires.getDate() + parseInt(banDays));
    }

    // ดำเนินการ Update Database
    // เพิ่มการบันทึก banExpires ลงไปใน Document ของ User
    await updateUser(targetUser, { 
        isBanned: shouldBan, 
        banExpires: banExpires 
    });

    // เตรียมข้อความแจ้งเตือน
    let expiryMsg = "";
    if (shouldBan) {
        if (banExpires) {
            const dateStr = banExpires.toLocaleDateString(currentLang === 'th' ? 'th-TH' : 'en-US');
            expiryMsg = currentLang === 'th' ? ` จนถึงวันที่ ${dateStr}` : ` until ${dateStr}`;
        } else {
            expiryMsg = currentLang === 'th' ? ` แบบถาวร` : ` permanently`;
        }
    }

    const kickMsg = shouldBan 
        ? (currentLang === 'th' ? `❌ บัญชีของคุณถูกระงับการใช้งาน${expiryMsg}` : `❌ Your account has been suspended${expiryMsg}`) 
        : (currentLang === 'th' ? '✅ บัญชีของคุณได้รับการปลดแบนแล้ว' : '✅ Your account has been unbanned.');

    // =========================================================
    // การเตะออกจากระบบ (Action)
    // =========================================================
    io.to(targetUser).emit('force-logout', kickMsg);

    if (shouldBan) {
        const allSockets = io.sockets.sockets;
        allSockets.forEach(socket => {
            if (socket.username === targetUser) {
                if (socket.viewingPostId) {
                    socket.emit('force-leave', kickMsg);
                    delete postViewers[socket.viewingPostId];
                    broadcastPostStatus(socket.viewingPostId, false);
                }
                socket.emit('force-logout', kickMsg); 
            }
        });
        
        await postsCollection.updateMany(
            { author: targetUser, isClosed: false },
            { $set: { isClosed: true, status: 'closed_permanently' } }
        );
        io.emit('update-post-status');
    }

    res.json({ success: true, isBanned: shouldBan, banExpires: banExpires });
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
    const { username, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    try {
		
		query = { author: username, isClosed: true };
    
        // 2. สั่ง Query ข้อมูลตามเงื่อนไขที่ตั้งไว้
        const posts = await postsCollection.find(query)
            .sort({ id: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();

        const totalItems = await postsCollection.countDocuments(query);

        res.json({
            success: true,
            posts,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: parseInt(page)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 21.2
app.get('/api/myzone-closed-posts', async (req, res) => {
    const { username, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    try {
        const user = await usersCollection.findOne({ username: username });
        let query = { isClosed: true };

        if (user && user.adminLevel >= 1) {
            const myZones = await zonesCollection.find({ 
                $or: [
                    { assignedAdmin: username },
                    { "refLocation.sourceUser": username }
                ]
            }).toArray();

            if (myZones.length > 0) {
                const zoneIds = myZones.map(z => z.id || z._id.toString());
                query.zoneId = { $in: zoneIds };
                
            } else {
                query.author = username;
            }
        } else {
            query.author = username;
        }

        const posts = await postsCollection.find(query)
            .sort({ id: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();

        const totalItems = await postsCollection.countDocuments(query);

        res.json({
            success: true,
            posts,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
            currentPage: parseInt(page)
        });
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
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

// 26.1. ดึงรายการโซนทั้งหมด (เพื่อไปแสดงในหน้าจัดการ)
app.get('/api/admin/all-zones', async (req, res) => {
    const zones = await zonesCollection.find({}).sort({ id: -1 }).toArray();
    res.json(zones);
});

// 27. Get Admin List (Level 1+)
app.get('/api/admin/admins-list', async (req, res) => {
    try {
        const { requestBy } = req.query;
        if (!requestBy) return res.status(400).json({ error: 'Username required' });

        const requester = await usersCollection.findOne({ username: requestBy });
        if (!requester || requester.adminLevel < 1) {
            return res.status(403).json({ error: 'Permission denied. Admin 1+ required' });
        }

        let finalAdminsList = [];

        //  Admin Level 2 
        if (requester.adminLevel === 2) {
            const myZones = await zonesCollection.find({
                $or: [
                    { assignedAdmin: requestBy },
                    { "refLocation.sourceUser": requestBy }
                ]
            }).toArray();

            const myZoneIds = myZones.map(z => z.id);

            if (myZoneIds.length === 0) return res.json([]);

            const allL1 = await usersCollection.find({ adminLevel: 1 }).toArray();
            for (const admin of allL1) {
                if (!admin.lastLocation) continue;
                const responsible = await findResponsibleAdmin(admin.lastLocation);
                if (responsible.zoneData && myZoneIds.includes(responsible.zoneData.id)) {
                    finalAdminsList.push(admin);
                }
            }
        }
    
        // Admin Level 3
        else if (requester.adminLevel >= 3) {
            finalAdminsList = await usersCollection.find({ adminLevel: { $gte: 1 } })
                .sort({ adminLevel: -1, username: 1 })
                .toArray();
        } 
        
        //Admin Level 1 
        else {
            finalAdminsList = await usersCollection.find({ adminLevel: 1 })
                .sort({ username: 1 })
                .toArray();
        }

        const responseData = finalAdminsList
            .filter(a => a.username !== requestBy) 
            .map(a => ({ 
                name: a.username, 
                level: a.adminLevel || 0,
                isBanned: a.isBanned 
            }));

        res.json(responseData);

    } catch (err) {
        console.error('Error fetching admin list:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// 28. Assign Admin to Zone
app.post('/api/admin/assign-zone', async (req, res) => {
    const { zoneId, adminUsername, requestBy } = req.body;
    
    // 1. Check Permissions (ปรับเป็นระดับ 2 ตามที่ต้องการ)
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 2) { 
        return res.status(403).json({ error: 'Permission denied. Admin Level 2+ required' });
    }
    
    // 2. Find target Zone (ปรับปรุงการค้นหาให้รองรับ _id ของ MongoDB)
    let zone;
    try {
        const { ObjectId } = require('mongodb'); // เรียกใช้ ObjectId
        
        // ลองหาด้วย _id ก่อน (เพราะหน้าบ้านส่ง zone._id มาเป็น String)
        if (ObjectId.isValid(zoneId)) {
            zone = await zonesCollection.findOne({ _id: new ObjectId(zoneId) });
        }
        
        // ถ้าไม่เจอ และ zoneId เป็นตัวเลข ให้ลองหาด้วยฟิลด์ id (เผื่อระบบเก่า)
        if (!zone && !isNaN(parseInt(zoneId))) {
            zone = await zonesCollection.findOne({ id: parseInt(zoneId) });
        }
    } catch (err) {
        return res.status(400).json({ error: 'รูปแบบ ID ไม่ถูกต้อง' });
    }

    if (!zone) {
        return res.status(404).json({ error: 'Zone not found.' });
    }
    
    // 3. Validate Admin ปลายทาง
    const targetAdmin = await getUserData(adminUsername);
    if (!targetAdmin || targetAdmin.adminLevel < 1 || targetAdmin.isBanned) {
         return res.status(400).json({ error: `Invalid or unauthorized Admin: ${adminUsername}` });
    }

    // 4. Update Zone document (ใช้ _id ที่หาเจอจริงจากฐานข้อมูล)
    await zonesCollection.updateOne(
        { _id: zone._id }, 
        { $set: { assignedAdmin: adminUsername } }
    );

    res.json({ success: true, assignedAdmin: adminUsername });
});

// 29. Delete Zone
app.post('/api/admin/delete-zone', async (req, res) => {
    const { zoneId, requestBy } = req.body;
    const requester = await getUserData(requestBy);
    
    if (!requester || requester.adminLevel < 3) {
        return res.status(403).json({ error: 'เฉพาะ Admin Level 3 เท่านั้น' });
    }

    await zonesCollection.deleteOne({ id: parseInt(zoneId) });
    res.json({ success: true });
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

// 31 ดึงรายชื่อ Admin ที่มีการระบุพิกัด Assigned Location แล้ว
app.get('/api/admin/admins-with-location', async (req, res) => {
    try {
        // ดึง Admin ทุกคนที่มีการตั้งค่า Assigned Location แล้ว
        const admins = await usersCollection.find({
            adminLevel: { $gt: 0 }, // Level มากกว่า 0
            "assignedLocation.lat": { $exists: true, $ne: null }
        }).project({ 
            name: 1,      // ตรวจสอบว่าใน DB ใช้ name หรือ username
            username: 1,  // เพื่อความชัวร์ให้ดึงมาทั้งคู่
            adminLevel: 1, 
            assignedLocation: 1 
        }).toArray();

        res.json({ success: true, admins });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// 32 ตั้งค่า Reference Location ของโซน โดยคัดลอกมาจาก Admin
app.post('/api/admin/set-zone-ref-from-user', async (req, res) => {
    const { zoneId, targetAdmin, requestBy } = req.body;

    try {
        // 1. ตรวจสอบสิทธิ์ผู้ขอ (ต้องเป็น Admin Level 3)
        const requester = await usersCollection.findOne({ username: requestBy });
        if (!requester || requester.adminLevel < 3) {
            return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ดำเนินการ (ต้องเป็น Admin Level 3)' });
        }

        // 2. ดึงข้อมูลพิกัดจาก Admin ที่ถูกเลือก
        const adminUser = await usersCollection.findOne({ username: targetAdmin });
        if (!adminUser || !adminUser.assignedLocation || !adminUser.assignedLocation.lat) {
            return res.status(400).json({ error: 'แอดมินคนนี้ยังไม่มีการตั้งค่าพิกัดอ้างอิง' });
        }

        const correctAddressName = adminUser.assignedLocation.address || 
                                   adminUser.assignedLocation.addressName || 
                                   'Unknown Location';

        await zonesCollection.updateOne(
            { id: parseInt(zoneId) },
            { 
                $set: { 
                    refLocation: {
                        lat: adminUser.assignedLocation.lat,
                        lng: adminUser.assignedLocation.lng,
                        addressName: correctAddressName, // บันทึกชื่อที่ถูกต้อง
                        sourceUser: targetAdmin,
                        updatedAt: Date.now()
                    }
                } 
            }
        );

        res.json({ success: true, message: `ตั้งค่าจุดอ้างอิงสำเร็จ: ${correctAddressName}` });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
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

// API กำหนดพิกัดอ้างอิงให้ Admin Level 2 (เฉพาะ Level 3 ทำได้)
app.post('/api/admin/set-assigned-location', async (req, res) => {
    // รับค่า addressName เพิ่มเข้ามาด้วย
    const { targetUser, lat, lng, addressName, requestBy } = req.body;

    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 3) {
        return res.status(403).json({ error: 'Permission denied. Admin Level 3 required' });
    }

    const target = await getUserData(targetUser);
    if (!target) return res.status(404).json({ error: 'User not found' });

    // ถ้าค่าว่างมา คือการลบ
    if (lat === '' || lng === '' || lat === null || lng === null) {
        await updateUser(targetUser, { assignedLocation: null });
        return res.json({ success: true, message: `🗑️ ลบพิกัดอ้างอิงของ ${targetUser} แล้ว` });
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // บันทึกทั้งพิกัด และชื่อสถานที่ (ถ้ามี)
    await updateUser(targetUser, { 
    assignedLocation: { 
        lat: parsedLat, 
        lng: parsedLng,
        addressName: addressName || 'Unknown Location'
        } 
    });

    res.json({ success: true, message: `✅ กำหนดพิกัดให้ ${targetUser} เรียบร้อย\n📍 ${addressName || ''}` });
});

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
    // 1. ค้นหากระทู้
    const post = await postsCollection.findOne({ id: parseInt(postId) });
    
    if (!post) {
        socket.emit('access-denied', translateServerMsg('post_not_found', lang));
        return;
    }

    const authorData = await getUserData(post.author);
    
    const postWithStats = {
        ...post,
        authorRating: authorData.rating ? authorData.rating.toFixed(2) : '0.00',
        authorTotalPosts: authorData.totalPosts || 0,
        authorCompletedJobs: authorData.completedJobs || 0
    };


    // ดึงข้อมูล User คนที่กำลังเข้าร่วม (Viewer)
    const user = await usersCollection.findOne({ username: username });
    const myAdminLevel = user ? (user.adminLevel || 0) : 0;

    const isOwner = username === post.author;
    const isAdmin = (username === 'Admin') || (myAdminLevel >= 1);
    const isParticipant = isOwner || username === post.acceptedViewer;

    // --- ตรวจสอบสิทธิ์การเข้าถึง ---
    
    // CASE A: เจ้าของ หรือ Admin เข้าได้เสมอ
    if (isOwner || isAdmin) {
        socket.join(`post-${postId}`);
        // ✅ ส่ง postWithStats แทน post
        socket.emit('access-granted', { post: postWithStats, isAdmin });
        
        if (viewerGeolocation[postId]) {
            for (const [viewerName, loc] of Object.entries(viewerGeolocation[postId])) {
                socket.emit('viewer-location-update', { viewer: viewerName, location: loc });
            }
        }
        return; 
    }

    // CASE B: กระทู้จบงาน หรือ ปิดแล้ว
    if (post.status === 'finished' || post.isClosed) {
        if (isParticipant) {
            socket.join(`post-${postId}`);
            socket.emit('access-granted', { post: postWithStats, isAdmin: false });
        } else {
            socket.emit('access-denied', translateServerMsg('closed_or_finished', lang));
        }
        return;
    }

    // CASE C: กรณีการเข้าชมปกติ (เช็คห้องเต็ม)
    const currentViewer = postViewers[postId];
    if (!currentViewer || currentViewer === username) {
        postViewers[postId] = username;
        socket.join(`post-${postId}`);
        socket.emit('access-granted', { post: postWithStats, isAdmin: false });
    } else {
        socket.emit('access-denied', translateServerMsg('room_occupied', lang));
    }
});

	

    // --- Private Messaging ---
    socket.on('get-private-history', async (data) => {
        const { me, partner } = data;
        
        let targetPartners = [partner];
        
        // ถ้าเป็นการขอประวัติการสนทนากับ 'Admin'
        if (partner === 'Admin') {
            // ค้นหา Admin Level 1 ขึ้นไปทั้งหมด (เพื่อรวม Admin ที่ถูก Route)
            const allAdmins = await usersCollection.find({ adminLevel: { $gte: 1 } }).toArray();
            const adminUsernames = allAdmins.map(a => a.username);
            targetPartners = adminUsernames; // กำหนดให้ค้นหาข้อความที่คุยกับ Admin เหล่านี้
        }

        const query = {
            $or: [
                // ข้อความที่ 'me' ส่งไปหา Admin (รวมข้อความที่ถูก Route ไปหา Admin L1/L2)
                { sender: me, target: { $in: targetPartners } },
                // ข้อความที่ Admin ส่งมาหา 'me' (รวม Admin L1/L2 ที่ตอบกลับมา)
                { sender: { $in: targetPartners }, target: me },
                // ข้อความจาก System ถึง 'me' (คงไว้)
                { sender: 'System', target: me }
            ]
        };

        const history = await messagesCollection.find(query).sort({ timestamp: 1 }).toArray();
		
		await messagesCollection.updateMany(
        { sender: partner, target: me, isRead: false },
        { $set: { isRead: true } }
    );
        
        socket.emit('private-history', history);
    });

    socket.on('private-message', async (data) => {
        const newMsg = { sender: data.sender, target: data.target, msg: data.msg, timestamp: Date.now() };
        
        let finalTarget = data.target; // ผู้รับจริงที่บันทึกลง DB และส่ง Socket
        let displayTarget = data.target; // ชื่อที่แสดงให้ผู้ส่งเห็นใน UI (เพื่อให้เธรดคุยไม่เปลี่ยน)

        // 1. ตรวจสอบว่าสมาชิก (Level 0) กำลังส่งหา 'Admin' หรือไม่
        if (data.target === 'Admin') {
            const senderUser = await usersCollection.findOne({ username: data.sender });
            
            // ถ้าเป็นสมาชิกทั่วไป (Level 0)
            if (senderUser && (senderUser.adminLevel || 0) === 0) {
                
                // --- Start Routing Logic ---
                
                // 1. ค้นหา Admin เจ้าของโซนจากตำแหน่งล่าสุดของผู้ส่ง
                const responsibleAdminData = await findResponsibleAdmin(senderUser.lastLocation);
                
                // ถ้าเจอ Admin ที่รับผิดชอบโซนนั้นและไม่ใช่ 'Admin' (Level 3)
                if (responsibleAdminData && responsibleAdminData.username !== 'Admin') {
                    finalTarget = responsibleAdminData.username; // กำหนด Admin L1/L2 เป็นผู้รับจริง
                } 
                // ถ้าไม่เจอ Admin โซน finalTarget จะยังคงเป็น 'Admin' (Level 3 Fallback)
                
                // --- End Routing Logic ---
            }
        }
        
        // อัปเดตผู้รับจริงใน Message Object ก่อนบันทึก
        newMsg.target = finalTarget; 

        // 1. บันทึกข้อความลง DB โดยใช้ finalTarget (ผู้รับจริง)
        await messagesCollection.insertOne(newMsg);
        
        // 2. ส่งข้อความไปยังผู้รับจริง (finalTarget)
        io.to(finalTarget).emit('private-message', { ...newMsg, to: finalTarget });
        
        // 3. ส่งข้อความสะท้อนกลับไปหาผู้ส่ง โดยใช้ displayTarget ('Admin') เพื่อให้เธรดสนทนาถูกต้อง
        io.to(data.sender).emit('private-message', { ...newMsg, to: displayTarget });
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
        // 1. ดึงข้อมูลกระทู้มาก่อนเพื่อดูว่าใครคือคนโพสต์ (Author) และใครคือคนรับงาน (AcceptedViewer)
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        
        if (post) {
            // 2. อัปเดตสถานะกระทู้ตามปกติ
            await postsCollection.updateOne({ id: parseInt(postId) }, { 
                $set: { status: 'rating_pending', isClosed: true, ratings: {} } 
            });

            // 🎯 3. [เพิ่มใหม่] นับจำนวน "จบงาน" ให้กับทั้ง 2 ฝ่าย
            // เพิ่มให้เจ้าของกระทู้ (Employer)
            await usersCollection.updateOne(
                { username: post.author },
                { $inc: { completedJobs: 1 } }
            );

            // เพิ่มให้ผู้รับงาน (Worker)
            if (post.acceptedViewer) {
                await usersCollection.updateOne(
                    { username: post.acceptedViewer },
                    { $inc: { completedJobs: 1 } }
                );
            }

            console.log(`📊 Updated completedJobs for ${post.author} and ${post.acceptedViewer}`);
            
            io.emit('update-post-status');
            io.to(`post-${postId}`).emit('start-rating-phase');
        }
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

// รับคำตอบการดึงเงินคืน (User กดปุ่มยอมรับ/ปฏิเสธ)
socket.on('reply-deduct-confirm', async (data) => {
        const { requester, amount, accepted, fromUser } = data;
        
        // หา Socket ของ Admin ที่ขอมา เพื่อแจ้งผล
        const requesterSocket = [...io.sockets.sockets.values()].find(s => s.username === requester);

        if (!accepted) {
            // กรณีปฏิเสธ
            if (requesterSocket) {
                requesterSocket.emit('deduct-result', { success: false, message: `❌ ${fromUser} ปฏิเสธคำขอคืนเงิน` });
            }
            return;
        }

        // กรณียอมรับ -> ดำเนินการตัดเงิน
        const targetData = await getUserData(fromUser);
        const adminData = await getUserData(requester);
        const parsedAmount = parseFloat(amount);

        // เช็คเงินอีกรอบกันพลาด
        if (targetData.coins < parsedAmount) {
            if (requesterSocket) requesterSocket.emit('deduct-result', { success: false, message: `❌ ${fromUser} มีเงินไม่พอแล้ว` });
            return;
        }

        // ตัดเงิน User -> เพิ่มเงิน Admin
        await updateUser(fromUser, { coins: targetData.coins - parsedAmount });
        await updateUser(requester, { coins: adminData.coins + parsedAmount });

        // บันทึก Transaction
        await transactionsCollection.insertOne({
            id: Date.now(),
            type: 'ADMIN_RETURN',
            amount: parsedAmount,
            fromUser: fromUser,
            toUser: requester,
            note: `User (${fromUser}) accepted return request from ${requester}`,
            timestamp: Date.now()
        });

        // อัปเดตยอดเงิน Realtime
        const newTarget = await getUserData(fromUser);
        io.emit('balance-update', { user: fromUser, coins: newTarget.coins });
        
        const newAdmin = await getUserData(requester);
        io.emit('balance-update', { user: requester, coins: newAdmin.coins });

        // แจ้ง Admin ว่าสำเร็จ
        if (requesterSocket) {
            requesterSocket.emit('deduct-result', { success: true, message: `✅ ${fromUser} ยืนยันการคืนเงินเรียบร้อยแล้ว` });
        }
    });
	
	// --- [ADMIN LEVEL 2] Get Assigned Zones ---
    socket.on('get-assigned-zones', async () => {
        if (!socket.username) return;

        try {
            const user = await usersCollection.findOne({ username: socket.username });

            // ตรวจสอบสิทธิ์ Admin Level 2 ขึ้นไป
            if (!user || !user.adminLevel || user.adminLevel < 2) {
                socket.emit('receive-assigned-zones', { 
                    success: false, 
                    message: '⛔ เฉพาะแอดมินระดับ 2 ขึ้นไป' 
                });
                return;
            }

            // ค้นหา Zone โดยใช้โครงสร้างที่คุณเจอ: refLocation.sourceUser
            // โดยให้หา Zone ที่มี sourceUser ตรงกับชื่อ Admin ที่ล็อกอินอยู่
            const zones = await zonesCollection.find({ 
                "refLocation.sourceUser": socket.username 
            }).toArray();

            socket.emit('receive-assigned-zones', { 
                success: true, 
                zones: zones,
                adminName: socket.username
            });

        } catch (err) {
            console.error(err);
            socket.emit('receive-assigned-zones', { success: false, message: '❌ เกิดข้อผิดพลาด' });
        }
    });
	
	
	
	socket.on('find-zone-admin', async (coords, callback) => {
    try {
        // ดึง requesterName (ชื่อคนกดเช็คอิน) เพิ่มจาก coords
        const { lat, lng, requesterName } = coords; 

        // 1. หาโซนที่พิกัดหลัก (Pin) ใกล้ที่สุด
        const allZones = await zonesCollection.find({
            "lat": { $exists: true, $ne: null },
            "lng": { $exists: true, $ne: null },
            "assignedAdmin": { $exists: true, $ne: null }
        }).toArray();

        let closestZone = null;
        let minPinDistance = Infinity;

        allZones.forEach((zone) => {
            const d = calculateDistance(lat, lng, parseFloat(zone.lat), parseFloat(zone.lng));
            if (d < minPinDistance) {
                minPinDistance = d;
                closestZone = zone;
            }
        });

        if (closestZone) {
            const adminUsername = closestZone.assignedAdmin;
            
            // 2. ดึงพิกัดปัจจุบัน (Live) ของแอดมินจากฐานข้อมูล User
            const adminUser = await usersCollection.findOne({ username: adminUsername });
            
            let adminLiveLocation = null;
            let distanceToAdmin = null;

            if (adminUser && adminUser.currentLocation) {
                adminLiveLocation = adminUser.currentLocation;
                
                // 3. คำนวณระยะห่างระหว่าง "ผู้ใช้" กับ "แอดมินตัวจริง"
                distanceToAdmin = calculateDistance(
                    lat, 
                    lng, 
                    parseFloat(adminLiveLocation.lat), 
                    parseFloat(adminLiveLocation.lng)
                );
            }

            // 🔥 [ส่วนที่แทรกใหม่]: ส่งสัญญาณแจ้งเตือนไปที่หน้าจอของ Admin คนนั้นโดยเฉพาะ
            const adminSockets = await io.fetchSockets();
            const targetAdminSocket = adminSockets.find(s => s.username === adminUsername);

            if (targetAdminSocket) {
                io.to(targetAdminSocket.id).emit('notify-admin-verify', {
                    member: requesterName || socket.username || "Member", // ชื่อคนส่ง
                    zone: closestZone.name,
                    distance: minPinDistance.toFixed(0)
                });
                console.log(`🚀 Sent verify notification to admin: ${adminUsername}`);
            }

            console.log(`[Debug] Admin: ${adminUsername} | Live Distance: ${distanceToAdmin ? distanceToAdmin.toFixed(0) : 'N/A'} m`);

            // 4. ส่งข้อมูลกลับไปหาคนกด (User)
            callback({
                success: true,
                zoneName: closestZone.name,
                adminName: adminUsername,
                pinDistance: minPinDistance.toFixed(0),
                adminDistance: distanceToAdmin ? distanceToAdmin.toFixed(0) : null,
                adminLive: !!adminLiveLocation
            });
        } else {
            callback({ success: false });
        }
    } catch (err) {
        console.error("Error in find-zone-admin:", err);
        callback({ success: false });
    }
});

	
	socket.on('update-admin-live-location', async (coords) => {
    if (!socket.username) return;
    await usersCollection.updateOne(
        { username: socket.username },
        { $set: { currentLocation: coords } }
    );
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