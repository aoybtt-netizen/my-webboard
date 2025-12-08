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
// [NEW] Helper Functions for MongoDB
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

        await seedInitialData(); // สร้างข้อมูลเริ่มต้นถ้ายังไม่มี

    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
        process.exit(1);
    }
}

async function seedInitialData() {
    // 1. Config
    if (await configCollection.countDocuments() === 0) {
        await configCollection.insertOne({ id: 'main_config', postCost: 10 });
        console.log("Initialized Config");
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
    if (!(await usersCollection.findOne({ username: 'Admin' }))) {
        await usersCollection.insertOne({ 
            username: 'Admin', coins: 1000, rating: 5.0, ratingCount: 1, isBanned: false 
        });
        console.log("Initialized Admin User");
    }
}

async function getUserData(username) {
    let user = await usersCollection.findOne({ username: username });
    if (!user) {
        user = { username: username, coins: 0, rating: 0.0, ratingCount: 0, isBanned: false };
        await usersCollection.insertOne(user);
    }
    return user;
}

async function updateUser(username, updateFields) {
    await usersCollection.updateOne({ username: username }, { $set: updateFields });
}

async function getPostCost() {
    const config = await configCollection.findOne({ id: 'main_config' });
    return config ? config.postCost : 10;
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
    const { username, currency } = req.query;
    const targetCurrency = currency || DEFAULT_CURRENCY; 
    if (!username) return res.status(400).json({ error: 'No username' });
    
    const user = await getUserData(username);
    if (user.isBanned) return res.status(403).json({ error: '⛔ บัญชีของคุณถูกระงับการใช้งาน' });
    
    const postCost = await getPostCost();
    const convertedCoins = convertUSD(user.coins, targetCurrency);
                    
    res.json({ 
        coins: user.coins, 
        convertedCoins: convertedCoins.toFixed(2), 
        currencySymbol: targetCurrency.toUpperCase(), 
        postCost: postCost, 
        rating: user.rating 
    });
});

// 3. User List
app.get('/api/users-list', async (req, res) => {
    if (req.query.requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const users = await usersCollection.find({}).toArray();
    res.json(users.map(u => ({ name: u.username, coins: u.coins, rating: u.rating, isBanned: u.isBanned })));
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
    if (req.body.requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const cost = parseFloat(req.body.cost);
    await configCollection.updateOne({ id: 'main_config' }, { $set: { postCost: cost } });
    io.emit('config-update', cost);
    res.json({ success: true, newCost: cost });
});

// 8. Give Coins
app.post('/api/admin/give-coins', async (req, res) => {
    const { targetUser, amount, requestBy } = req.body;
    if (requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const parsedAmount = parseInt(amount);
    if (parsedAmount <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });

    const adminUser = await getUserData('Admin');
    if (adminUser.coins < parsedAmount) return res.status(400).json({ error: `❌ Admin มี USD ไม่พอ` });

    await updateUser('Admin', { coins: adminUser.coins - parsedAmount });
    const targetData = await getUserData(targetUser);
    await updateUser(targetUser, { coins: targetData.coins + parsedAmount });

    await transactionsCollection.insertOne({
        id: Date.now(), type: 'ADMIN_GIVE', amount: parsedAmount, fromUser: 'Admin', toUser: targetUser,
        note: `Admin โอน USD ให้ ${targetUser}`, timestamp: Date.now()
    });

    const updatedAdmin = await getUserData('Admin');
    const updatedTarget = await getUserData(targetUser);
    io.emit('balance-update', { user: targetUser, coins: updatedTarget.coins });
    io.emit('balance-update', { user: 'Admin', coins: updatedAdmin.coins }); 
    
    const notifMsg = { sender: 'System', target: targetUser, msgKey: 'SYS_TRANSFER', msgData: { amount: parsedAmount }, msg: `💰 Admin ได้โอนให้คุณจำนวน ${parsedAmount} USD`, timestamp: Date.now() };
    await messagesCollection.insertOne(notifMsg);
    io.to(targetUser).emit('private-message', { ...notifMsg, to: targetUser });
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
    const id = parseInt(req.params.id);
    const post = await postsCollection.findOne({ id: id });
    if (!post) return res.status(404).json({ error: 'ไม่พบกระทู้' });

    if(!post.isClosed && Date.now() - post.id > 3600000 && !post.isPinned){ 
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
	if (post.isPinned) return res.json({ isOccupied: false, viewer: null });

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
    if (await isUserBanned(author)) return res.status(403).json({ error: '⛔ คุณถูกระงับสิทธิ์การสร้างกระทู้' });

    if (author !== 'Admin') {
        const activePost = await postsCollection.findOne({ author: author, isClosed: false });
        if (activePost) return res.status(400).json({ error: `⛔ คุณมีกระทู้เปิดอยู่ (ID: ${activePost.id})` });
    }
    
    const imageUrl = req.file ? req.file.path : null;
    const postCost = await getPostCost();
    const user = await getUserData(author);
    
    const topicObj = await topicsCollection.findOne({ id: category });
    const topicName = topicObj ? topicObj.name : "หัวข้อทั่วไป"; 
    let finalTitle = (author === 'Admin' && title) ? title.trim() : topicName;

    if (author !== 'Admin') {
        if (user.coins < postCost) return res.status(400).json({ error: 'เหรียญไม่พอ' });
        await updateUser(author, { coins: user.coins - postCost });
        if (postCost > 0) {
            const adminUser = await getUserData('Admin');
            await updateUser('Admin', { coins: adminUser.coins + postCost });
            await transactionsCollection.insertOne({
                id: Date.now(), type: 'POST_REVENUE', amount: postCost, fromUser: author, toUser: 'Admin',
                note: `ค่าธรรมเนียมสร้างกระทู้: ${topicName}`, postTitle: topicName, timestamp: Date.now()
            });
            const newAdmin = await getUserData('Admin');
            io.emit('balance-update', { user: 'Admin', coins: newAdmin.coins });
            io.to('Admin').emit('admin-new-transaction');
        }
    }
    
    const newPost = { 
        id: Date.now(), title: finalTitle, topicId: category, content, author,
        location: location ? JSON.parse(location) : null, imageUrl: imageUrl, comments: [], 
        isClosed: false, isPinned: (author === 'Admin') 
    };
    await postsCollection.insertOne(newPost);
    
    if (author !== 'Admin') {
        const notifMsg = { sender: 'System', target: author, msgKey: 'SYS_FEE', msgData: { topicName: topicName, cost: postCost }, msg: `💸 หักค่าธรรมเนียม ${postCost} USD`, timestamp: Date.now() };
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
    if (req.body.requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const id = parseInt(req.params.id);
    await postsCollection.deleteOne({ id: id });
    delete postViewers[id];
    io.emit('delete-post', id); 
    res.json({ success: true });
});

// 17. Manual Close
app.put('/api/posts/:id/close-manual', async (req, res) => { 
    const id = parseInt(req.params.id);
    const { requestBy } = req.body;
    const post = await postsCollection.findOne({ id: id });

    if (!post) return res.status(404).json({ error: 'ไม่พบกระทู้' });
    if (requestBy !== post.author && requestBy !== 'Admin') return res.status(403).json({ error: 'No Permission' });
    if (post.isClosed) return res.json({ success: true, message: 'Closed already' });

    await postsCollection.updateOne({ id: id }, { $set: { isClosed: true, status: 'closed_by_user' } });
    
    // Kick Viewers Logic
    const viewerToKick = postViewers[id];
    if (viewerToKick && viewerToKick !== post.author && viewerToKick !== 'Admin') {
        const roomName = `post-${id}`;
        const roomRef = io.sockets.adapter.rooms.get(roomName);
        if (roomRef) {
             for (const socketId of roomRef) {
                const s = io.sockets.sockets.get(socketId);
                if (s && s.username === viewerToKick) {
                    s.emit('force-leave', '⚠️ กระทู้ถูกปิด คุณถูกเชิญออก');
                }
             }
        }
    }
    delete postViewers[id];
    io.emit('update-post-status'); 
    res.json({ success: true, message: 'ปิดกระทู้สำเร็จ' });
});

// 18. Deduct Coins
app.post('/api/admin/deduct-coins', async (req, res) => {
    const { targetUser, amount, requestBy } = req.body;
    if (requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    const parsedAmount = parseInt(amount);
    const user = await getUserData(targetUser);
    
    if (user.coins < parsedAmount) return res.status(400).json({ error: 'เหรียญไม่พอให้หัก' });
    await updateUser(targetUser, { coins: user.coins - parsedAmount });
    
    const adminUser = await getUserData('Admin');
    await updateUser('Admin', { coins: adminUser.coins + parsedAmount });
    
    await transactionsCollection.insertOne({
        id: Date.now(), type: 'ADMIN_DEDUCT', amount: parsedAmount, fromUser: targetUser, toUser: 'Admin',
        note: `Admin ดึงเหรียญคืนจาก ${targetUser}`, timestamp: Date.now()
    });

    const updatedUser = await getUserData(targetUser);
    const updatedAdmin = await getUserData('Admin');
    io.emit('balance-update', { user: targetUser, coins: updatedUser.coins });
    io.emit('balance-update', { user: 'Admin', coins: updatedAdmin.coins });
    
    const notifMsg = { sender: 'System', target: targetUser, msgKey: 'SYS_DEDUCT', msgData: { amount: parsedAmount }, msg: `💸 ดึงเงินคืน ${parsedAmount} USD`, timestamp: Date.now() };
    await messagesCollection.insertOne(notifMsg);
    io.to(targetUser).emit('private-message', { ...notifMsg, to: targetUser });
    io.to('Admin').emit('admin-new-transaction');

    res.json({ success: true });
});

// 19. Toggle Ban
app.post('/api/admin/toggle-ban', async (req, res) => {
    const { targetUser, shouldBan, requestBy } = req.body;
    if (requestBy !== 'Admin') return res.status(403).json({ error: 'Admin only' });
    if (targetUser === 'Admin') return res.status(400).json({ error: 'Cannot ban Admin' });

    await updateUser(targetUser, { isBanned: shouldBan });
    io.to(targetUser).emit('force-logout', shouldBan ? '❌ บัญชีของคุณถูกระงับ' : '✅ บัญชีของคุณถูกปลดแบน');

    if (shouldBan) {
        const allSockets = io.sockets.sockets;
        allSockets.forEach(socket => {
            if (socket.username === targetUser) {
                if (socket.viewingPostId) {
                    socket.emit('force-leave', '⛔ คุณถูกแบน');
                    delete postViewers[socket.viewingPostId];
                    broadcastPostStatus(socket.viewingPostId, false);
                }
                socket.emit('force-logout', '⛔ คุณถูกแบน'); 
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
    if (!post) return res.status(404).json({ error: 'ไม่พบกระทู้' });
    if (post.isClosed && author !== 'Admin') return res.status(403).json({ error: '⛔ ปิดรับความคิดเห็นแล้ว' });

    const newComment = { id: Date.now(), author, content, imageUrl, timestamp: Date.now() };
    await postsCollection.updateOne({ id: postId }, { $push: { comments: newComment } });
    
    io.to(`post-${postId}`).emit('new-comment', { postId: postId, comment: newComment });
    
    if (post.author !== author) {
        const notifMsg = { sender: 'System', target: post.author, msgKey: 'SYS_NEW_COMMENT', msgData: { postTitle: post.title }, msg: `💬 คอมเมนต์ใหม่: ${post.title}`, timestamp: Date.now(), postId: postId };
        await messagesCollection.insertOne(notifMsg);
        io.to(post.author).emit('private-message', { ...notifMsg, to: post.author });
    }
    res.json({ success: true, comment: newComment });
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
            socket.emit('access-denied', translateServerMsg('post_not_found', lang));
            return;
        }

        const isOwner = username === post.author;
        const isAdmin = username === 'Admin';
        const isParticipant = isOwner || username === post.acceptedViewer;

        if (isOwner || isAdmin) {
            socket.join(`post-${postId}`);
            socket.emit('access-granted', post);
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

        if (post.status === 'finished' || post.isClosed) {
            if (isParticipant) {
                socket.join(`post-${postId}`);
                socket.emit('access-granted', post);
            } else {
                socket.emit('access-denied', translateServerMsg('closed_or_finished', lang));
            }
            return;
        }

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