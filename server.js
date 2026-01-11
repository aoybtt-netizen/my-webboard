require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb'); 
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');

// --- Google Auth Imports ---
const { OAuth2Client } = require('google-auth-library');
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(CLIENT_ID);

// --- Cloudinary Imports ---
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- App & Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Middleware ---
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// --- Global Database Variables (ปรับให้เหลือชุดเดียว) ---
let db;
let usersCollection, postsCollection, configCollection, transactionsCollection;
let topicsCollection, messagesCollection, zonesCollection, merchantLocationsCollection;
let merchantTemplatesCollection;
let topupChatsCollection;
let topupRequestsCollection;
let adminSettingsCollection;

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb+srv://aoyfos:Webboard1234@cluster0.r3jl20m.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

// --- Global Logic Variables ---
const activePostTimers = {};

// --- Cloudinary Config ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'drz6osqnq',
    api_key: process.env.CLOUDINARY_API_KEY || '234168627819814',
    api_secret: process.env.CLOUDINARY_API_SECRET || '5rGH8Tj3SxHIdree1j3obeZLIZw'
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'webboard_uploads',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif'],
    },
});

const upload = multer({ storage: storage });

const slipStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'topup_slips', // แยกโฟลเดอร์ออกมา
        allowed_formats: ['jpg', 'png', 'jpeg'],
    },
});

const uploadSlip = multer({ storage: slipStorage });


//ส่วนลบรูปภาพอัตโนมัติ2เดือน
const cron = require('node-cron');




// --- Live Exchange Rate & Data ---
const LIVE_API_KEY = '1f39c37f85-b1b3f2287e-t6oki5'; 
const LIVE_API_URL = `https://api.fastforex.io/fetch-all?from=USD&api_key=${LIVE_API_KEY}`; 
let LIVE_EXCHANGE_RATES = { 'USD': 1.0, 'THB': 32.0 };
const DEFAULT_CURRENCY = 'THB';
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
		'sys_starting': 'ระบบกำลังเริ่มต้น กรุณารอสักครู่...',
        'error_username_taken': 'ชื่อนี้มีผู้ใช้แล้ว กรุณาใช้ชื่ออื่น',
        'error_user_not_found': 'ไม่พบผู้ใช้งาน',
        'error_invalid_password': 'รหัสผ่านไม่ถูกต้อง',
		'error_username_exists': 'ชื่อนี้ถูกใช้ไปแล้ว กรุณาใช้ชื่ออื่น',
        'error_server_fault': 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์',
        'error_fetch_members': 'ไม่สามารถดึงข้อมูลสมาชิกได้',
        'error_fetch_zones': 'ไม่สามารถดึงข้อมูลโซนได้',
        'error_admin_l3_required': 'ปฏิเสธการเข้าถึง: ต้องเป็นแอดมินระดับ 3 เท่านั้น',
		'cat_delivery': 'หาไรเดอร์ส่งของหรือทำธุระแทน',
        'cat_transport': 'หาไรเดอร์รับ-ส่งคน',
        'cat_general': 'หาคนทำงานทั่วไป',
        'cat_heavy': 'หาคนทำงานหนักทั่วไป',
		'msg_job_timeout': '⛔ หมดเวลาส่งงาน! ระบบได้ปิดกระทู้อัตโนมัติ',
		'zone_outside_service': 'นอกพื้นที่บริการ',
        'zone_no_owner': 'ไม่มีผู้ดูแล',
        'zone_anonymous': 'โซนนิรนาม',
        'user_email_not_set': 'ยังไม่ระบุ',
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
		'sys_starting': 'System is starting, please wait...',
        'error_username_taken': 'Username is already taken, please choose another.',
        'error_user_not_found': 'User not found',
        'error_invalid_password': 'Invalid password',
		'error_username_exists': 'Username already exists, please use another name.',
        'error_server_fault': 'Internal server error occurred.',
        'error_fetch_members': 'Unable to fetch member data.',
        'error_fetch_zones': 'Unable to fetch zone data.',
        'error_admin_l3_required': 'Access Denied: Admin Level 3 required.',
		'cat_delivery': 'Delivery & Errands',
        'cat_transport': 'Ride Hailing / Transport',
        'cat_general': 'General Tasks',
        'cat_heavy': 'General Manual Labor',
		'msg_job_timeout': '⛔ Delivery timeout! The post has been closed automatically.',
		'zone_outside_service': 'Outside Service Area',
        'zone_no_owner': 'No Administrator',
        'zone_anonymous': 'Anonymous Zone',
        'user_email_not_set': 'Not specified',
    },'pt': {
        'post_not_found': 'Postagem não encontrada',
        'closed_or_finished': '⛔ Esta postagem foi encerrada ou concluída.',
        'room_occupied': '⚠️ Outro usuário está visualizando esta postagem. Por favor, aguarde...',
        'deduct_perm_denied': '⛔ Acesso negado: Requer Admin Nível 1 ou superior',
        'deduct_invalid_amt': '⛔ Quantidade de moedas inválida',
        'deduct_user_not_found': '⛔ Usuário não encontrado',
        'deduct_insufficient': '⛔ O destino não possui moedas suficientes',
        'deduct_hierarchy_err': '⛔ Não é possível retirar moedas de usuários com nível igual ou superior (Nível {level})',
        'deduct_zone_missing': '⛔ Não é possível verificar a zona devido à falta de localização (GPS)',
        'deduct_zone_mismatch': '⛔ Não é permitido retirar moedas de outra zona (Você: {zoneA} / Alvo: {zoneB})',
        'ban_perm_denied': '⛔ Acesso negado: Requer Admin Nível 1 ou superior',
        'ban_cannot_admin': '⛔ Não é possível banir a conta de Admin principal',
        'ban_user_not_found': '⛔ Usuário não encontrado',
        'ban_hierarchy_err': '⛔ Não é possível banir/desbanir usuários com nível igual ou superior (Nível {level})',
        'ban_zone_missing': '⛔ Não é possível verificar a zona devido à falta de localização (GPS)',
        'ban_zone_mismatch': '⛔ Não é permitido banir usuários de outra zona (Você: {zoneA} / Alvo: {zoneB})',
		'sys_starting': 'O sistema está iniciando, por favor aguarde...',
        'error_username_taken': 'Este nome de usuário já existe, por favor escolha outro.',
        'error_user_not_found': 'Usuário não encontrado',
        'error_invalid_password': 'Senha incorreta',
		'error_username_exists': 'Este nome já está em uso, por favor use outro.',
        'error_server_fault': 'Ocorreu um erro interno no servidor.',
        'error_fetch_members': 'Não foi possível buscar os dados dos membros.',
        'error_fetch_zones': 'Não foi possível buscar os dados da zona.',
        'error_admin_l3_required': 'Acesso Negado: Requer Admin Nível 3.',
		'cat_delivery': 'Entregas e Tarefas',
        'cat_transport': 'Transporte de Pessoas',
        'cat_general': 'Serviços Gerais',
        'cat_heavy': 'Trabalho Pesado em Geral',
		'msg_job_timeout': '⛔ Tempo de entrega esgotado! A postagem foi encerrada automaticamente.',
		'zone_outside_service': 'Fora da Área de Serviço',
        'zone_no_owner': 'Sem Administrador',
        'zone_anonymous': 'Zona Anônima',
        'user_email_not_set': 'Não especificado',
    }
};

function translateServerMsg(key, lang = 'th') {
    const translation = serverTranslations[lang] || serverTranslations['th'];
    return translation[key] || serverTranslations['th'][key] || key;
}

// ==========================================
// ROUTES
// ==========================================
app.use((req, res, next) => {
    if (!usersCollection) {
        return res.status(503).send(serverTranslations[lang].sys_starting);
    }
    next();
});

// Endpoint สำหรับรับข้อมูลการ Login จาก Google
app.post('/api/auth/google', async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({ idToken: token, audience: CLIENT_ID });
        const payload = ticket.getPayload();
        const { sub, email, name, picture } = payload;

        let user = await usersCollection.findOne({ $or: [{ googleId: sub }, { email: email }] });

        if (!user) {
            // ยังไม่มีในระบบ ให้ส่งข้อมูลไปให้หน้าบ้านตั้งชื่อก่อน
            return res.json({ success: true, isNewUser: true, googleData: { sub, email, picture } });
        }

        // ถ้ามีแล้ว (หรือผูกบัญชีแล้ว) ก็ Login เลย
        res.json({ success: true, isNewUser: false, user });
    } catch (e) { res.status(400).json({ success: false }); }
});


// API สำหรับ Google ตั้งชื่อสมาชิกใหม่ (เช็คชื่อซ้ำ)
app.post('/api/auth/google-register', async (req, res) => {
    const { username, googleData } = req.body;

    // เช็คว่าชื่อซ้ำไหม
    const exists = await usersCollection.findOne({ username: username });
    if (exists) return res.json({ success: false, error: serverTranslations[lang].error_username_taken });

    const newUser = {
        username: username,
        googleId: googleData.sub,
        email: googleData.email,
        avatar: googleData.picture,
        coins: 0,
        adminLevel: 0,
        createdAt: Date.now()
    };
    await usersCollection.insertOne(newUser);
    res.json({ success: true, user: newUser });
});


//API สำหรับ "Login แบบปกติ" (ชื่อ + รหัสผ่าน)
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await usersCollection.findOne({ username });

    if (!user) return res.json({ success: false, error: serverTranslations[lang].error_user_not_found });

    // ถ้าเป็นยูสเก่าที่ยังไม่มีรหัสผ่าน
    if (!user.password) {
        return res.json({ success: false, needPasswordSetup: true });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
        res.json({ success: true, user });
    } else {
        res.json({ success: false, error: serverTranslations[lang].error_invalid_password });
    }
});


// API สำหรับลงทะเบียนรหัสผ่าน (ใช้ทั้งคนใหม่และคนเก่าที่ยังไม่มีรหัส)
app.post('/api/auth/set-password', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await usersCollection.updateOne(
        { username: username },
        { $set: { password: hashedPassword } }
    );
    res.json({ success: true });
});

// Route สำหรับสมัครสมาชิกใหม่
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 1. ตรวจสอบว่าชื่อซ้ำไหม
        const existingUser = await usersCollection.findOne({ username: username });
        if (existingUser) {
            return res.status(400).json({ success: false, error: serverTranslations[lang].error_username_exists });
        }

        // 2. Hash รหัสผ่าน
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. บันทึก User ใหม่ (ใส่ค่าเริ่มต้นที่จำเป็นไปด้วยเลย)
        const newUser = {
            username: username,
            password: hashedPassword,
            coins: 0,           // เงินในระบบ
            mercNum: 0,        // สถานะการรับงาน
            createdAt: new Date()
        };

        await usersCollection.insertOne(newUser);

        res.json({ 
            success: true, 
            user: { username: newUser.username } 
        });
        
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ success: false, error: serverTranslations[lang].error_server_fault });
    }
});


//API ADMIN HTML
// 1. API ดึงรายชื่อสมาชิกทั้งหมด
app.get('/api/admin/all-users', async (req, res) => {
    try {
        // ดึงสมาชิกทั้งหมด เรียงตามระดับแอดมินจากสูงไปต่ำ
        const users = await db.collection('users').find({}).sort({ adminLevel: -1 }).toArray();
        res.json(users);
    } catch (err) {
        res.status(500).json({ success: false, message: serverTranslations[lang].error_fetch_members });
    }
});

// 2. API ดึงรายชื่อโซนทั้งหมด
app.get('/api/admin/all-zones', async (req, res) => {
    try {
        const zones = await db.collection('zones').find({}).sort({ id: 1 }).toArray();
        res.json(zones);
    } catch (err) {
        res.status(500).json({ success: false, message: serverTranslations[lang].error_fetch_zones });
    }
});

// 3. 🔥 API หัวใจหลัก: Universal Update (เวอร์ชันอัปเดตเพื่อรองรับระบบโซน)
app.post('/api/admin/universal-update', async (req, res) => {
    const { adminUsername, targetCollection, targetId, field, newValue } = req.body;

    try {
        // --- 🛡️ ตรวจสอบสิทธิ์แอดมิน (Security Check) ---
        const admin = await db.collection('users').findOne({ username: adminUsername });
        if (!admin || admin.adminLevel < 3) {
            return res.status(403).json({ success: false, message: serverTranslations[lang].error_admin_l3_required });
        }

        // --- ⚙️ จัดการประเภทข้อมูล (Data Casting) ---
        let finalValue = newValue;

        // 🚩 [เพิ่มแล้ว] รายการฟิลด์ที่เป็นตัวเลข (เพิ่ม systemZone และ zoneFee)
        const numericFields = [
            'coins', 'adminLevel', 'id', 'zoneExchangeRate', 
            'totalPosts', 'completedJobs', 'rating', 
            'BRL', 'THB', 'VND', 'systemZone', 'zoneFee'
        ];

        if (numericFields.includes(field)) {
            // แยกกรณี parseInt สำหรับ ID/Level และ parseFloat สำหรับยอดเงิน/เรท
            if (field === 'adminLevel' || field === 'id') {
                finalValue = parseInt(newValue);
            } else {
                finalValue = parseFloat(newValue);
            }
            
            // ป้องกันค่า NaN ถ้าใส่ข้อมูลมาผิดประเภท
            if (isNaN(finalValue)) {
                return res.status(400).json({ success: false, message: "ค่าที่ระบุต้องเป็นตัวเลขเท่านั้น" });
            }
        }

        // 🚩 [เพิ่มแล้ว] รายการฟิลด์ที่เป็น Boolean (เพิ่ม isFree ของโซนเข้าไปด้วย)
        const booleanFields = ['isBanned', 'isFree'];
        if (booleanFields.includes(field)) {
            finalValue = (newValue === 'true' || newValue === true);
        }

        // --- 📝 ทำการอัปเดตลง Database ---
        // กำหนดเงื่อนไขการหา: ถ้าแก้ user ให้หาจาก username, ถ้าแก้ zone ให้หาจาก id
        const query = targetCollection === 'users' ? { username: targetId } : { id: parseInt(targetId) };

        const result = await db.collection(targetCollection).updateOne(
            query,
            { 
                $set: { 
                    [field]: finalValue,
                    lastModifiedBy: adminUsername, 
                    updatedAt: new Date()
                } 
            }
        );

        if (result.matchedCount > 0) {
            res.json({ success: true, message: `อัปเดต [${field}] เป็น [${finalValue}] เรียบร้อยแล้ว` });
        } else {
            res.status(404).json({ success: false, message: "ไม่พบข้อมูลที่ต้องการแก้ไข" });
        }

    } catch (err) {
        console.error("Universal Update Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
    }
});







// API สำหรับอัปโหลดสลิปไปที่ Cloudinary
app.post('/api/upload-slip', uploadSlip.single('slip'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'File not found.' });
        // ส่ง URL ของ Cloudinary กลับไป
        res.json({ success: true, url: req.file.path });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



//kyc
// API สำหรับดึงประวัติแชทเฉพาะหมวด KYC
app.get('/api/kyc/chat-history', async (req, res) => {
    try {
        const { requestId } = req.query;
        if (!requestId) return res.status(400).json({ error: "Missing requestId" });

        // ดึงข้อมูลจากคอลเลกชัน kyc_chats (ที่เราแยกไว้เพื่อความเป็นระเบียบ)
        const history = await db.collection('kyc_chats')
            .find({ requestId: requestId })
            .sort({ timestamp: 1 }) // เรียงจากเก่าไปใหม่ตามลำดับเวลา
            .toArray();

        res.json(history);
    } catch (err) {
        console.error("❌ Get KYC Chat History Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ API สำหรับสมาชิกเช็คสถานะ KYC ของตัวเอง
app.get('/api/kyc/my-status', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: "Missing username" });
        const kycRequest = await db.collection('kycRequests')
            .findOne({ username: username }, { sort: { submittedAt: -1 } });

        if (!kycRequest) {
            return res.json({ status: 'none' });
        }

        res.json({
            status: kycRequest.status,
            adminName: kycRequest.targetAdmin,
            details: {
                fullName: kycRequest.fullName,
                idNumber: kycRequest.idNumber,
                phone: kycRequest.phone,
                address: kycRequest.address,
                userImg: kycRequest.userImg 
            }
        });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});



// ==========================================
// Helper Functions for MongoDB
// ==========================================

async function connectDB() {
    try {
        // ตรวจสอบว่าถ้าเชื่อมต่ออยู่แล้วไม่ต้องเชื่อมซ้ำ
        if (db) return; 

        await client.connect();
        console.log("✅ Connected successfully to MongoDB");
        
        db = client.db(); 

        // กำหนดค่าให้ Collection ต่างๆ
        merchantLocationsCollection = db.collection('merchant_locations');
        merchantTemplatesCollection = db.collection('merchant_templates');
        postsCollection = db.collection('posts');
        usersCollection = db.collection('users');
        configCollection = db.collection('config');
        transactionsCollection = db.collection('transactions');
        topicsCollection = db.collection('topics');
        messagesCollection = db.collection('messages');
        zonesCollection = db.collection('zones');
        topupRequestsCollection = db.collection('topup_requests');
        adminSettingsCollection = db.collection('admin_settings');
        topupChatsCollection = db.collection('topup_chats');

        if (typeof seedInitialData === 'function') {
            await seedInitialData();
        }
        
        console.log("📦 All Collections Initialized");

        // === รวมส่วน Cron Job ไว้ที่เดียว ทำงานเวลา 03:00 น. ===
        cron.schedule('0 3 * * *', async () => {
            console.log('🧹 [System] เริ่มต้นทำความสะอาดรูปภาพที่หมดอายุ (เงื่อนไข 60 วัน)...');
            
            try {
                const sixtyDaysAgo = new Date();
                sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

                // --- 1. จัดการรูปสลิปเติมเงิน (60 วัน) ---
                const oldTopups = await topupRequestsCollection.find({
                    createdAt: { $lt: sixtyDaysAgo },
                    slipUrl: { $ne: null }
                }).toArray();

                for (let req of oldTopups) {
                    // ลบจาก Cloudinary
                    if (req.slipPublicId) {
                        await cloudinary.uploader.destroy(req.slipPublicId);
                    }
                    // อัปเดตฐานข้อมูล
                    await topupRequestsCollection.updateOne(
                        { _id: req._id },
                        { $set: { slipUrl: null, slipNote: "รูปภาพหมดอายุและถูกลบอัตโนมัติโดยระบบ" } }
                    );
                }

                // --- 2. จัดการรูปภาพในโพสต์/กระทู้ (60 วัน ตามเงื่อนไขใหม่) ---
                const oldPosts = await postsCollection.find({
                    createdAt: { $lt: sixtyDaysAgo },
                    images: { $exists: true, $not: { $size: 0 } }
                }).toArray();

                for (let post of oldPosts) {
                    // ลบทุกรูปในโพสต์นั้นจาก Cloudinary
                    if (post.imagePublicIds && Array.isArray(post.imagePublicIds)) {
                        for (let publicId of post.imagePublicIds) {
                            await cloudinary.uploader.destroy(publicId);
                        }
                    }
                    // อัปเดตฐานข้อมูล
                    await postsCollection.updateOne(
                        { _id: post._id },
                        { 
                            $set: { 
                                images: [], 
                                imagePublicIds: [], 
                                contentNote: "(รูปภาพประกอบถูกลบอัตโนมัติเนื่องจากหมดอายุการใช้งาน 60 วัน)" 
                            } 
                        }
                    );
                }

                console.log(`✅ [System] ทำความสะอาดเรียบร้อย: สลิป (${oldTopups.length}) และรูปโพสต์ (${oldPosts.length})`);
                
            } catch (cronErr) {
                console.error('❌ [System] Cron Job Error:', cronErr);
            }
        });
        // ===============================================

    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err);
    }
}

// เรียกใช้งานฟังก์ชันเชื่อมต่อ
//connectDB();

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
            { id: 'general', name: translations[currentLang].cat_delivery },
			{ id: 'tech',    name: translations[currentLang].cat_transport },
			{ id: 'game',    name: translations[currentLang].cat_general },
			{ id: 'sale',    name: translations[currentLang].cat_heavy }
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





// เริ่มต้นเชื่อมต่อ DB
connectDB();

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
    const isGlobalFree = globalConfig ? (globalConfig.isFree === true) : false;

    const responsibleData = await findResponsibleAdmin(location);
	const systemZone = responsibleData.zoneData && responsibleData.zoneData.systemZone !== undefined 
        ? responsibleData.zoneData.systemZone 
        : (globalConfig.systemFee || 0);
    
    // ⭐ เช็คสถานะฟรีรายโซน
    const isZoneFree = responsibleData.zoneData ? (responsibleData.zoneData.isFree === true) : false;
    
    let finalAdminFee = globalDefaultAdminFee;
    if (responsibleData.zoneData && responsibleData.zoneData.zoneFee !== undefined && responsibleData.zoneData.zoneFee !== null) {
        finalAdminFee = parseFloat(responsibleData.zoneData.zoneFee);
    }
    
    const totalCost = globalSystemFee + finalAdminFee;

    return {
        totalCost: totalCost,
        systemFee: globalSystemFee,
		systemZone: systemZone,
        adminFee: finalAdminFee,
        feeReceiver: responsibleData.username,
        // ⭐ ส่งค่าสรุปไปให้หน้าบ้านด้วย
        isFree: isGlobalFree || isZoneFree 
    };
}





async function isUserBanned(username) {
    if (username === 'Admin') return false;
    const user = await usersCollection.findOne({ username: username });
    return user ? user.isBanned : false;
}


async function processJobTimeout(postId, io) {
    try {
        const targetId = parseInt(postId);
        console.log(`[Timeout Handler] ⏳ เริ่มจัดการหมดเวลาสำหรับ ID: ${targetId}`);

        const currentPost = await postsCollection.findOne({ id: targetId });

        if (currentPost && (currentPost.status === 'finished' || currentPost.status === 'in_progress')) {
            
            // 🚩 1. ปลดล็อก User (ตรวจสอบชื่อให้เป๊ะ)
            const usersToUnlock = [currentPost.author, currentPost.acceptedViewer, currentPost.acceptedBy].filter(Boolean);
            
            const userUpdate = await usersCollection.updateMany(
                { username: { $in: usersToUnlock } },
                { $set: { working: null, status: 'idle' } }
            );

            // 🚩 2. ปิดกระทู้
            await postsCollection.updateOne(
                { id: targetId },
                { $set: { status: 'closed_permanently', isClosed: true, closedAt: Date.now() } }
            );

            // 🚩 3. ส่งสัญญาณเตะ
            const kickMsg = { message: serverTranslations[lang].msg_job_timeout };
			io.to(room).emit('system_kick', kickMsg);
            
            // ส่งรายตัว (ต้องมั่นใจว่า socket.join(username) ไว้แล้ว)
            usersToUnlock.forEach(user => {
                io.to(user).emit('force-close-job', kickMsg);
            });
            
            // ส่งเข้าห้องเลขงาน
            io.to(targetId.toString()).emit('force-close-job', kickMsg);

            console.log(`[Timeout Handler] ✅ งาน ${targetId} ถูกปิดถาวรและปลดล็อกสมาชิกแล้ว`);
        } else {
            console.log(`[Timeout Handler] ℹ️ งาน ${targetId} ไม่ต้องจัดการ (สถานะปัจจุบัน: ${currentPost ? currentPost.status : 'ไม่พบงาน'})`);
        }

        if (activePostTimers[postId]) delete activePostTimers[postId];

    } catch (err) {
        console.error(`[Timeout Handler] ❌ Error:`, err);
    }
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


// ฟังก์ชันพนักงานทำความสะอาดหลังบ้าน
async function runPostCleanup() {
    const ONE_HOUR = 3600000;
    const expirationTime = Date.now() - ONE_HOUR;

    try {
        console.log(`[${new Date().toLocaleTimeString()}] 🧹 เริ่มระบบ Cleanup...`);

        // 1. ค้นหางานร้านค้าที่หมดอายุ (ต้องไม่มีคนรับ และยังไม่ปิด)
        const expiredMerchantTasks = await postsCollection.find({
            isClosed: false,
            // 🚩 กันพลาด: เช็คทั้งค่า Boolean และ String
            isMerchantTask: { $in: [true, 'true'] }, 
            // 🚩 สำคัญ: ปิดเฉพาะงานที่ยังไม่มีไรเดอร์รับ (ไม่มี acceptedBy) 
            // และสถานะต้องไม่ใช่กำลังทำหรือทำเสร็จแล้ว
            acceptedBy: { $exists: false },
            status: { $nin: ['in_progress', 'finished'] },
            id: { $lt: expirationTime }
        }).toArray();

        console.log(`🔍 พบงานร้านค้าหมดอายุ: ${expiredMerchantTasks.length} งาน`);

        for (const task of expiredMerchantTasks) {
            // ลดแต้ม mercNum ให้เจ้าของงาน
            const userUpdate = await usersCollection.updateOne(
                { username: task.author },
                { $inc: { mercNum: -1 } }
            );

            if (userUpdate.modifiedCount > 0) {
                console.log(`📉 ลดแต้มสำเร็จ: [${task.author}] mercNum -1 (Job ID: ${task.id})`);
            } else {
                console.log(`⚠️ ไม่สามารถลดแต้มได้: ไม่พบผู้ใช้ [${task.author}] หรือ mercNum ไม่เปลี่ยนแปลง`);
            }
        }

        if (expiredMerchantTasks.length > 0) {
            const expiredIds = expiredMerchantTasks.map(t => t.id);
            await postsCollection.updateMany(
                { id: { $in: expiredIds } },
                { $set: { isClosed: true, closedAt: Date.now(), closeReason: 'expired' } }
            );
        }

        // 2. จัดการงานทั่วไป (Non-Merchant) ที่หมดอายุ
        const res = await postsCollection.updateMany(
            { 
                isClosed: false, 
                isPinned: false, 
                // 🚩 ต้องมั่นใจว่าเงื่อนไขนี้ไม่ไปทับซ้อนกับงานร้านค้า
                isMerchantTask: { $nin: [true, 'true'] }, 
                id: { $lt: expirationTime } 
            },
            { $set: { isClosed: true, closedAt: Date.now() } }
        );

        if (res.modifiedCount > 0 || expiredMerchantTasks.length > 0) {
            console.log(`✅ Cleanup เรียบร้อย: ปิดงานทั่วไป ${res.modifiedCount} งาน, งานร้านค้า ${expiredMerchantTasks.length} งาน`);
            io.emit('update-post-status'); 
        }

    } catch (err) {
        console.error("🚨 Cleanup Error:", err);
    }
}
setInterval(runPostCleanup, 5 * 60 * 1000);


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
    const { username, currency, location, country, lang } = req.query; 
    const currentLang = lang || 'th'; 
    const targetCurrency = currency || 'USD'; 

    if (!username) return res.status(400).json({ error: 'No username' });
    
    const user = await getUserData(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // --- ส่วนเช็คการแบน (คงเดิม) ---
    if (user.isBanned) {
        let banMessage = "❌ Your account is suspended.";
        if (user.banExpires) {
            const expireDate = new Date(user.banExpires);
            const dateStr = expireDate.toLocaleDateString(currentLang === 'th' ? 'th-TH' : 'en-US');
            const timeStr = expireDate.toLocaleTimeString(currentLang === 'th' ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit' });
            banMessage += (currentLang === 'th') ? ` until ${dateStr} Time ${timeStr}` : ` until ${dateStr} at ${timeStr}.`;
        } else {
            banMessage += " permanently.";
        }
        return res.status(403).json({ error: banMessage });
    }
    
    let userZoneId = null;
    let postCostData;
    let zoneCurrency = 'USD'; // ค่าเริ่มต้น
    
    try {
        const locationObj = location ? JSON.parse(location) : null;

        // อัปเดตพิกัด (คงเดิม)
        if (locationObj && locationObj.lat && locationObj.lng) {
            const updateFields = { lastLocation: locationObj, lastSeen: new Date() };
            if (country) updateFields.country = country; 
            await usersCollection.updateOne({ username: username }, { $set: updateFields });
        }

        postCostData = await getPostCostByLocation(locationObj);
        const zoneInfo = await findResponsibleAdmin(locationObj);

        if (zoneInfo && zoneInfo.zoneData) {
            userZoneId = zoneInfo.zoneData.id;
            // ✅ ดึงชื่อสกุลเงินของโซน (เช่น BRL)
            zoneCurrency = zoneInfo.zoneData.zoneCurrency || 'USD';
        }

    } catch (e) {
        console.error("Error:", e);
        postCostData = await getPostCostByLocation(null);
    }
    
    // ✅ [จุดที่แก้ไข] ดึงยอดเงินดิบจากกระเป๋าที่ตรงกับโซน (ไม่ใช้การคูณเรท)
    // ถ้าสมาชิกอยู่ในโซน BRL ระบบจะดึงค่าจาก user.BRL มาส่งให้โดยตรง
    const localBalance = user[zoneCurrency] || 0;

    res.json({
        coins: user.coins,             // ส่ง 100 (USDT)
        convertedCoins: localBalance,  // ส่ง 100 (BRL - ค่าดิบจากกระเป๋า)
        currencySymbol: zoneCurrency.toUpperCase(),
        postCost: postCostData,
        rating: user.rating,
        adminLevel: user.adminLevel || 0,
        userZoneId: userZoneId,
        country: user.country || 'TH', 
        totalPosts: user.totalPosts || 0,     
        completedJobs: user.completedJobs || 0
    });
});


// 2.1 API ใหม่สำหรับหน้า Profile โดยเฉพาะ เพื่อไม่ให้กระทบระบบหลัก
app.get('/api/profile-details', async (req, res) => {
    try {
        const { username, location } = req.query;
        if (!username) return res.status(400).json({ error: 'No username' });

        const user = await usersCollection.findOne({ username: username });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // ค่า Default กรณีอยู่นอกพื้นที่
        let zoneName = translations[currentLang].zone_outside_service;
		let zoneOwner = translations[currentLang].zone_no_owner;
        let currentCurrency = 'USD';
        let currentBalance = user.coins || 0; // ค่า Default (กระเป๋าหลัก)

        // ตรวจสอบพิกัดเพื่อหาโซน
        if (location) {
            const locationObj = JSON.parse(decodeURIComponent(location));
            // ใช้ฟังก์ชันเดิมที่คุณมีเพื่อหา Admin/Zone
            const zoneInfo = await findResponsibleAdmin(locationObj);
            
            if (zoneInfo && zoneInfo.zoneData) {
                zoneName = zoneInfo.zoneData.name || translations[currentLang].zone_anonymous;
				zoneOwner = zoneInfo.zoneData.assignedAdmin || translations[currentLang].zone_no_owner;
                
                // ✅ 1. ดึงสกุลเงินของโซนนั้นมา (เช่น 'THB', 'BRL')
                if (zoneInfo.zoneData.zoneCurrency) {
                    currentCurrency = zoneInfo.zoneData.zoneCurrency;
                    
                    // ✅ 2. ดึงยอดเงินจาก "กระเป๋าที่ตรงกับสกุลเงิน" (เช่น user.THB)
                    // ถ้าไม่มีให้เป็น 0 (ห้ามแปลงค่า ให้ดึงค่าดิบ)
                    currentBalance = user[currentCurrency] || 0; 
                }
            }
        }

        // ส่งข้อมูลกลับไปหน้าบ้าน
        res.json({
            coins: currentBalance,      // ส่งยอดเงินของกระเป๋านั้นๆ
            currency: currentCurrency,  // ส่งชื่อสกุลเงินไปด้วย
            
            rating: user.rating || 5.0,
            totalPosts: user.totalPosts || 0,
            completedJobs: user.completedJobs || 0,
            const userEmailDisplay = user.email || translations[currentLang].user_email_not_set,
            zoneName: zoneName,
            zoneOwner: zoneOwner
        });

    } catch (e) {
        console.error("Profile API Error:", e);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// 2.2 ดึงสกุลเงินจากโซนและจำนวนเงิน
app.get('/api/merchant/balance', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username || username === 'undefined') {
            return res.status(400).json({ success: false, error: 'Invalid username' });
        }

        // 🚩 ตรวจสอบว่า DB พร้อมใช้งานหรือไม่
        if (typeof usersCollection === 'undefined') {
            return res.status(500).json({ success: false, error: 'Database not initialized' });
        }

        const user = await usersCollection.findOne({ username });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
		
		const storeData = await db.collection('merchant_locations').findOne({ 
            owner: username, 
            isStore: true 
        });

        const location = user.lastLocation || null; 
        
        // 🚩 ตรวจสอบว่าฟังก์ชันหาโซนมีอยู่จริงหรือไม่
        let zoneCurrency = 'USDT';
        let zoneName = 'Global';

        if (typeof findResponsibleAdmin === 'function') {
            const zoneInfo = await findResponsibleAdmin(location);
            if (zoneInfo && zoneInfo.zoneData) {
                zoneCurrency = zoneInfo.zoneData.zoneCurrency || 'USDT';
                zoneName = zoneInfo.zoneName || 'Zone';
            }
        }

        const balance = user[zoneCurrency] || 0;

        res.json({
            success: true,
            balance: balance,
            currency: zoneCurrency,
            zoneName: zoneName,
            storeName: storeData ? storeData.label : "GedGo Merchant"
        });

    } catch (err) {
        // 🚩 ตัวนี้จะช่วยให้คุณเห็น Error จริงใน Terminal ของ Node.js
        console.error("🔴 Merchant Balance API Crash:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});



// 3. User List
app.get('/api/users-list', async (req, res) => {
    try {
        const { requestBy, search, page = 1, limit = 50 } = req.query;
        
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        const skip = (pageNum - 1) * limitNum;

        // 1. ตรวจสอบสิทธิ์ผู้เรียก (Admin)
        const requester = await getUserData(requestBy);
        if (!requester || requester.adminLevel < 1) {
            return res.status(403).json({ error: 'สำหรับ Admin เท่านั้น' });
        }
        
        // 2. ดึงข้อมูลพื้นฐาน
        const allUsers = await usersCollection.find({}).toArray();
        const allZones = await db.collection('zones').find({}).toArray(); 

        // ฟังก์ชันช่วยหาโซนที่ใกล้ที่สุด เพื่อดึง "ชื่อฟิลด์สกุลเงิน" (เช่น 'x', 'thb')
        const getCurrencyKeyForUser = (u) => {
            if (!u.lastLocation || !u.lastLocation.lat || !u.lastLocation.lng) return 'usd';
            
            let minDistance = Infinity;
            let closestZone = null;
            allZones.forEach(zone => {
                const dist = getDistanceFromLatLonInKm(u.lastLocation.lat, u.lastLocation.lng, zone.lat, zone.lng);
                if (dist < minDistance) { 
                    minDistance = dist; 
                    closestZone = zone; 
                }
            });
            // ส่งคืนชื่อสกุลเงิน (ซึ่งจะใช้เป็นชื่อฟิลด์ในตัว User)
            return closestZone ? (closestZone.zoneCurrency || 'usd') : 'usd';
        };

        // ฟังก์ชันช่วยในการจัดกลุ่มและส่งข้อมูลกลับ
        const mapUserResponse = (u) => {
            const totalScore = (u.totalRatingScore || 0) + (u.merchantRatingScore || 0);
            const totalRatingCount = (u.ratingCount || 0) + (u.merchantRatingCount || 0);
            const averageRating = totalRatingCount > 0 ? (totalScore / totalRatingCount) : 0;
            const combinedCompleted = (u.completedJobs || 0) + (u.authorCompletedJobs || 0);

            // ดึงชื่อฟิลด์สกุลเงินที่หามาได้ (เช่น 'x')
            const currencyKey = u.zoneCurrencyKey || 'usd';

            return { 
                name: u.username, 
                fullName: u.fullName || '', 
                profileImg: u.profileImg || '', 
                
                // ✨ จุดสำคัญ: ดึงยอดเงินจากฟิลด์ที่ชื่อตรงกับสกุลเงินโซน ( u['x'] หรือ u['thb'] )
                // จะได้ค่าดิบๆ จากฟิลด์นั้นเลย ไม่มีการคูณเลข
                coins: u[currencyKey] || 0, 
                
                currency: currencyKey, // ส่งชื่อสกุลเงินไปแสดงเป็นป้ายหน่วย
                
                rating: averageRating,
                ratingCount: totalRatingCount,
                totalPosts: u.totalPosts || 0,
                totalJobs: u.totalJobs || 0,
                completedJobs: combinedCompleted,
                isBanned: u.isBanned || false,
                isVerified: u.isVerified || false,
                relationType: u.relationType || 'OTHER',
                idNumber: u.idNumber || '',
                phone: u.phone || '',
                address: u.address || ''
            };
        };

        let finalResults = [];

        // --- Logic การคัดกรองตามระดับ Admin ---
        if (requester.adminLevel >= 3) {
            finalResults = allUsers
                .filter(u => u.username !== requester.username)
                .map(u => {
                    u.zoneCurrencyKey = getCurrencyKeyForUser(u);
                    return u;
                });
        } else {
            let myOwnedZones = await db.collection('zones').find({ assignedAdmin: requester.username }).toArray();
            let myRefZones = (requester.adminLevel === 2) 
                ? await db.collection('zones').find({ "refLocation.sourceUser": requester.username }).toArray() 
                : [];

            finalResults = allUsers.filter(u => {
                if (u.username === requester.username) return false;

                // ระบุชื่อฟิลด์สกุลเงินให้ User ตามพิกัด
                u.zoneCurrencyKey = getCurrencyKeyForUser(u);

                if (requester.adminLevel === 2 && search && u.country === requester.country) {
                    return true; 
                }

                if (!u.lastLocation) return false;
                
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

        // --- กรองด้วย Search Keyword (เหมือนเดิม) ---
        if (search && search.trim() !== "") {
            const lowerSearch = search.toLowerCase();
            finalResults = finalResults.filter(u => 
                u.username.toLowerCase().includes(lowerSearch) || 
                (u.fullName && u.fullName.toLowerCase().includes(lowerSearch))
            );
        }

        const totalOwned = finalResults.filter(u => u.relationType === 'OWNED').length;
        const totalRef = finalResults.filter(u => u.relationType === 'REF').length;
        const totalOther = finalResults.filter(u => u.relationType !== 'OWNED' && u.relationType !== 'REF').length;

        const pagedUsers = finalResults.slice(skip, skip + limitNum);

        res.json({
            users: pagedUsers.map(mapUserResponse),
            currentPage: pageNum,
            totalPages: Math.ceil(finalResults.length / limitNum),
            counts: { owned: totalOwned, ref: totalRef, other: totalOther }
        });

    } catch (err) {
        console.error("🚨 API Users-List Error:", err);
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
    if (!username) return res.json({ success: false, hasJob: false });

    try {
        // 🚩 โลจิกใหม่: ค้นหาเฉพาะงานที่ "เป็นงานจ้าง" และ "ยังไม่ปิดระบบจริงๆ"
        const activeJob = await postsCollection.findOne({
            isMerchantTask: true,             // 1. ต้องเป็นงานจ้างเท่านั้น (ไม่ใช่กระทู้คุยเล่น)
            isClosed: { $ne: true },          // 2. ต้องยังไม่ถูกปิด (isClosed ต้องไม่ใช่ true)
            status: { $ne: 'closed_by_merchant' }, // 3. ร้านค้าต้องยังไม่ได้กดจบงานเอง
            $or: [
                { author: username },         // กรณีเป็นเจ้าของร้าน
                { acceptedBy: username },     // กรณีเป็นไรเดอร์ (รับงานแล้ว)
                { acceptedViewer: username }  // กรณีเป็นไรเดอร์ (กำลังขอ)
            ]
        }, { sort: { id: -1 } }); // 4. เอาอันล่าสุดเสมอ (ID มากสุด)

        if (activeJob) {
            const isMerchant = (activeJob.author === username);
            return res.json({ 
                success: true,
                hasJob: true, 
                postId: activeJob.id, 
                title: activeJob.title,
                isMerchantTask: isMerchant,
                isRiderJob: !isMerchant
            });
        }
        
        res.json({ success: true, hasJob: false });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/set-cost', async (req, res) => {
    try {
        const { requestBy, zoneId, systemFee, adminFee, isFree } = req.body;

        // 1. ตรวจสอบสิทธิ์แอดมินระดับ 3
        const requester = await getUserData(requestBy);
        if (!requester || requester.adminLevel < 3) {
            return res.status(403).json({ error: 'Admin Level 3 only' });
        }

        // 2. ตรวจสอบค่าที่ส่งมา
        const systemZoneValue = parseFloat(systemFee); // เราจะบันทึกในชื่อ systemZone
        const zoneFeeValue = parseFloat(adminFee);     // ส่วนของแอดมินโซน
        const targetZoneId = parseInt(zoneId);

        if (isNaN(systemZoneValue) || isNaN(zoneFeeValue) || !targetZoneId) {
            return res.status(400).json({ error: 'Incomplete information.' });
        }

        // 3. บันทึกลงใน Collection: zones (ผูกกับโซนนั้นๆ)
        const updateData = { 
            systemZone: systemZoneValue, // เปลี่ยนชื่อจาก systemFee เป็น systemZone ตามที่ต้องการ
            zoneFee: zoneFeeValue,       // ค่าธรรมเนียมส่วนของแอดมินโซน
            isFree: isFree === true      // สถานะโพสต์ฟรีเฉพาะโซน
        };

        const result = await db.collection('zones').updateOne(
            { id: targetZoneId }, 
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'The specified zone was not found.' });
        }

        // 4. แจ้งเตือนการอัปเดตผ่าน Socket (ส่งข้อมูลโซนที่เปลี่ยนไป)
        io.emit('zone-config-update', { zoneId: targetZoneId, ...updateData });

        res.json({ success: true, message: `อัปเดตค่าธรรมเนียมโซน ${targetZoneId} เรียบร้อย`, updateData });

    } catch (err) {
        console.error("Set Cost Error:", err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 7.1
app.post('/api/admin/set-zone-fee', async (req, res) => {
    // 1. รับค่า isFree เพิ่มมาจาก req.body
    const { zoneId, fee, isFree, requestBy } = req.body;
    
    // ตรวจสอบคนเรียก (เหมือนเดิม)
    const requester = await getUserData(requestBy);
    if (!requester || requester.adminLevel < 1) {
        return res.status(403).json({ error: 'Permission denied.' });
    }

    const zoneIdInt = parseInt(zoneId);
    const zone = await zonesCollection.findOne({ id: zoneIdInt });

    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    // ตรวจสอบสิทธิ์ (เหมือนเดิม)
    if (requester.adminLevel < 3 && zone.assignedAdmin !== requestBy) {
        return res.status(403).json({ error: 'คุณไม่ใช่ผู้ดูแลโซนนี้' });
    }

    // จัดการเรื่องค่าธรรมเนียม (เหมือนเดิม)
    let newFee = (fee === '' || fee === null) ? null : parseFloat(fee);
    if (newFee !== null && (isNaN(newFee) || newFee < 0)) {
        return res.status(400).json({ error: 'Invalid fee amount' });
    }

    // ⭐ ส่วนที่เพิ่มเข้ามา: บันทึกทั้งค่าธรรมเนียม และ สถานะโซนฟรี
    // เราใช้ $set เพื่อเพิ่มหรืออัปเดตฟิลด์ isFree ลงไปใน zonesCollection
    await zonesCollection.updateOne(
        { id: zoneIdInt }, 
        { 
            $set: { 
                zoneFee: newFee,
                isFree: isFree === true // บันทึกเป็น true หรือ false
            } 
        }
    );
    
    res.json({ 
        success: true, 
        newFee: newFee,
        isFree: isFree === true 
    });
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

// 7.3  API สำหรับบันทึกการตั้งค่าสกุลเงินของโซน
app.post('/api/admin/set-zone-currency', async (req, res) => {
    const { zoneId, currency, rate } = req.body;

    try {
        // 1. ตรวจสอบความถูกต้องของข้อมูลพื้นฐาน
        if (!zoneId || !currency || isNaN(rate)) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน หรือรูปแบบไม่ถูกต้อง' });
        }

        const zoneIdInt = parseInt(zoneId);

        // 2. อัปเดตข้อมูลลง Database
        const result = await db.collection('zones').findOneAndUpdate(
            { id: zoneIdInt }, 
            { 
                $set: { 
                    zoneCurrency: currency,       
                    zoneExchangeRate: parseFloat(rate),
                    updatedAt: new Date()
                } 
            },
            { returnDocument: 'after' } 
        );

        // 3. ส่งผลลัพธ์กลับ
        if (result) {
            res.json({ 
                success: true, 
                message: 'อัปเดตสกุลเงินสำเร็จ',
                zoneCurrency: currency,
                zoneExchangeRate: rate
            });
        } else {
            res.status(404).json({ success: false, message: 'ไม่พบโซนที่ระบุ' });
        }
    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
    }
});

// 7.4 ระบบหัก USDT และ เพิ่มเงินโซน ให้แอดมิน
app.post('/api/admin/convert-currency', async (req, res) => {
    const { adminId, usdtToConvert, zoneId } = req.body;
    try {
        const zoneIdInt = parseInt(zoneId);
        const amount = parseFloat(usdtToConvert);

        const zone = await db.collection('zones').findOne({ id: zoneIdInt });
        const admin = await db.collection('users').findOne({ username: adminId });

        if (!zone || !admin) {
            return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลโซนหรือแอดมิน' });
        }

        if (admin.coins < amount) {
            return res.status(400).json({ success: false, message: 'เหรียญ (USDT) ของคุณไม่เพียงพอ' });
        }

        // ✅ แก้ไข: ใช้ค่าตรงๆ จาก DB (เช่น "BRL") ไม่มีการแปลงตัวเล็ก
        const currencyField = zone.zoneCurrency || 'USD'; 
        const receiveAmount = amount * (zone.zoneExchangeRate || 1.0);

        // บันทึกเข้ากระเป๋าตามชื่อสกุลเงินเป๊ะๆ
        await db.collection('users').updateOne(
            { username: adminId },
            { 
                $inc: { 
                    coins: -amount,
                    [currencyField]: receiveAmount 
                } 
            }
        );

        res.json({ 
            success: true, 
            received: receiveAmount, 
            currency: currencyField 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 7.5 
app.get('/api/admin/get-zone-detail/:id', async (req, res) => {
    try {
        const zoneIdInt = parseInt(req.params.id);
        const adminUsername = req.query.adminId;

        const zone = await db.collection('zones').findOne({ id: zoneIdInt });
        if (!zone) return res.status(404).json({ success: false, message: 'ไม่พบโซน' });

        const adminProfile = await db.collection('users').findOne(
            { username: adminUsername },
            { projection: { nickname: 1, coins: 1 } } // *** เปลี่ยนจาก usdtBalance เป็น coins ***
        );

        res.json({
            success: true,
            zone: {
                id: zone.id,
                name: zone.zoneName,
                currency: zone.zoneCurrency || 'USD',
                rate: zone.zoneExchangeRate || 1.0
            },
            admin: {
                // *** เปลี่ยนจาก usdtBalance เป็น coins ***
                usdtBalance: adminProfile && adminProfile.coins ? adminProfile.coins : 0, 
                nickname: adminProfile ? adminProfile.nickname : 'Unknown'
            }
        });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 7.6 API สำหรับดึงข้อมูลโซนที่แอดมินรับผิดชอบ
app.get('/api/admin/my-zone-info', async (req, res) => {
    try {
        const adminUsername = req.query.admin;
        
        // 1. ดึงข้อมูลโซนที่แอดมินคนนี้รับผิดชอบ
        const zone = await db.collection('zones').findOne({ assignedAdmin: adminUsername });

        if (!zone) return res.status(404).json({ success: false, message: 'ไม่พบโซน' });

        // 2. กำหนดชื่อฟิลด์กระเป๋าเงินตามค่าที่ตั้งไว้ในโซน
        const currencyKey = zone.zoneCurrency || 'USD';

        // 3. ดึงข้อมูลโปรไฟล์ของแอดมิน
        const adminProfile = await db.collection('users').findOne({ username: adminUsername });

        res.json({
            success: true,
            zone: {
                id: zone.id,
                zoneCurrency: zone.zoneCurrency || 'USD',
                zoneExchangeRate: zone.zoneExchangeRate || 1.0
            },
            adminCoins: adminProfile ? (adminProfile.coins || 0) : 0,
            // ✅ ดึงยอดเงินจากกระเป๋าที่ชื่อตรงกับสกุลเงิน
            zoneWallet: adminProfile ? (adminProfile[currencyKey] || 0) : 0 
        });
    } catch (err) { 
        console.error("My Zone Info Error:", err);
        res.status(500).json({ success: false, message: 'Server Error' }); 
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
                adminUsername = responsible.username; 
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

// 11. Posts (List) - ปรับปรุงใหม่ให้ทำงานเร็วขึ้น
app.get('/api/posts', async (req, res) => {
    try {

        const page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // ดึงเฉพาะข้อมูลมาแสดงผล (Logic เดิมของคุณ)
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
            posts: paginatedPosts.map(post => ({ 
                ...post, 
                authorRating: authorMap[post.author] !== undefined ? authorMap[post.author].toFixed(2) : '0.00' 
            })),
            totalItems: sortedPosts.length, 
            totalPages: Math.ceil(sortedPosts.length / limit), 
            currentPage: page, 
            limit
        });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 12. Single Post	
app.get('/api/posts/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const post = await postsCollection.findOne({ id: id });
        
        if (!post) {
            return res.status(404).json({ success: false, error: 'ไม่พบกระทู้' });
        }

        // --- ระบบปิดกระทู้อัตโนมัติ (1 ชม.) ---
        if(!post.isClosed && Date.now() - post.id > 3600000 && !post.isPinned){ 
            await postsCollection.updateOne({ id: id }, { $set: { isClosed: true } });
            post.isClosed = true; 
        }

        // --- ดึงข้อมูลสถิติเจ้าของกระทู้ ---
        const author = await getUserData(post.author);

        // --- เตรียมข้อมูลส่งกลับ (Response) ---
        // 🚩 ปรับปรุง: กระจายค่า post และเติมสถิติเข้าไป
        const responseData = { 
            ...post, 
            authorRating: author.rating ? author.rating.toFixed(2) : '0.00',
            authorTotalPosts: author.totalPosts || 0,
            authorCompletedJobs: author.completedJobs || 0
        };

        // 🚩 จุดสำคัญ: ส่งกลับในรูปแบบ { success: true, post: ... } 
        // เพื่อให้ตรงกับที่หน้า riderjobmerchant.html และ post.html รอรับอยู่
        res.json({
            success: true,
            post: responseData
        });

    } catch (err) {
        console.error("🔥 [Error] API /api/posts/:id Failed:", err);
        res.status(500).json({ success: false, error: 'Server Error' });
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

// 15. Create Post (เวอร์ชันรองรับ Merchant โดยเฉพาะ)
app.post('/api/posts', upload.single('image'), async (req, res) => {
    // 🚩 รับค่าที่ส่งมาจากหน้า Merchant
    const { author, category, content, location, title, budget, stops } = req.body;
    const isMerchantTask = req.body.isMerchantTask === 'true' || req.body.isMerchantTask === true;

    // 1. ตรวจสอบเงื่อนไขพื้นฐาน (รักษาของเดิมไว้ทั้งหมด)
    if (author !== 'Admin') {
        if (!location || location === 'null' || location === 'undefined') {
            return res.status(400).json({ error: '⛔ กรุณาระบุตำแหน่ง (เช็คอิน) ก่อนสร้างกระทู้' });
        }
    }
    if (await isUserBanned(author)) return res.status(403).json({ error: '⛔ คุณถูกระงับสิทธิ์การสร้างกระทู้' });
    if (author !== 'Admin') {
    const activePost = await postsCollection.findOne({ author: author, isClosed: false });

    if (activePost) {
        if (isMerchantTask !== true) {
            return res.status(400).json({ 
                error: `⛔ คุณมีกระทู้เปิดอยู่แล้ว 1 กระทู้ กรุณาปิดกระทู้เก่าก่อนสร้างใหม่` 
				});
			}
		}
	}
    
    const imageUrl = req.file ? req.file.path : null;
    const user = await getUserData(author);
    const topicObj = await topicsCollection.findOne({ id: category });
    const topicName = topicObj ? topicObj.name : "หัวข้อทั่วไป"; 
    
	let finalTitle = (author === 'Admin' && title) ? title.trim() : (title && title !== "undefined" ? title : topicName);

    // --- ส่วนคำนวณค่าธรรมเนียม (รักษาของเดิมไว้ทั้งหมด) ---
    const globalConfig = await configCollection.findOne({ id: 'main_config' });
    const globalSystemFee = globalConfig ? (globalConfig.systemFee || 5) : 5;
    const globalDefaultAdminFee = globalConfig ? (globalConfig.adminFee || 5) : 5;
    const isGlobalFree = globalConfig ? (globalConfig.isFree === true) : false;

    const responsibleData = await findResponsibleAdmin(location ? JSON.parse(location) : null);
    const feeReceiver = responsibleData.username;
    const isZoneFree = responsibleData.zoneData ? (responsibleData.zoneData.isFree === true) : false;
    const isFreePostFinal = isGlobalFree || isZoneFree;

    // ดึงค่า systemZone จากโซน ถ้าไม่มีให้ใช้ค่า Global เป็นตัวสำรอง
    let currentSystemZone = parseFloat(responsibleData.zoneData?.systemZone ?? globalConfig?.systemFee ?? 0);
    if (responsibleData.zoneData && responsibleData.zoneData.systemZone !== undefined) {
        currentSystemZone = parseFloat(responsibleData.zoneData.systemZone);
    } else {
        currentSystemZone = globalConfig ? (globalConfig.systemFee || 0) : 0; 
    }

    let finalAdminFee = 0;
    if (responsibleData.zoneData && responsibleData.zoneData.zoneFee !== undefined) {
        finalAdminFee = parseFloat(responsibleData.zoneData.zoneFee);
    } else {
        finalAdminFee = globalConfig ? (globalConfig.adminFee || 0) : 0;
    }

    // 2. รวมยอดจ่าย (เป็นหน่วยเงินโซนตรงๆ)
    const totalCostLocal = currentSystemZone + finalAdminFee;
    const zoneCurrency = responsibleData.zoneData?.zoneCurrency || 'USD';
    const postZoneId = responsibleData.zoneData ? responsibleData.zoneData.id : null;

    // --- ส่วนการจัดการเงิน ---
    if (author !== 'Admin' && !isFreePostFinal) {
        const userLocalBalance = user[zoneCurrency] || 0;

        // เช็คเงินในกระเป๋าสกุลโซนนั้นๆ
        if (userLocalBalance < totalCostLocal) {
            return res.status(400).json({ 
                error: `⛔ ยอดเงิน ${zoneCurrency} ไม่เพียงพอ (ต้องการ ${totalCostLocal.toFixed(2)})` 
            });
        }

        // 3. หักเงินสมาชิกจากกระเป๋าโซน
        await usersCollection.updateOne(
            { username: author },
            { $inc: { [zoneCurrency]: -totalCostLocal } }
        );

        // 4. โอนเงินให้ Admin (คุณ) เข้ากระเป๋าสกุลเงินนั้นๆ
        if (currentSystemZone > 0) {
            await usersCollection.updateOne(
                { username: 'Admin' },
                { $inc: { [zoneCurrency]: currentSystemZone } }
            );
            await transactionsCollection.insertOne({
                id: Date.now(), type: 'POST_REVENUE', amount: currentSystemZone, 
                currency: zoneCurrency, fromUser: author, toUser: 'Admin',
                note: `Fee (${responsibleData.zoneName}): ${topicName}`, 
                timestamp: Date.now()
            });
        }

        // 5. โอนเงินให้แอดมินโซน เข้ากระเป๋าสกุลเงินนั้นๆ
        if (finalAdminFee > 0) {
            await usersCollection.updateOne(
                { username: feeReceiver },
                { $inc: { [zoneCurrency]: finalAdminFee } }
            );
            await transactionsCollection.insertOne({
                id: Date.now() + 1, type: 'ADMIN_FEE', amount: finalAdminFee, 
                currency: zoneCurrency, fromUser: author, toUser: feeReceiver,
                note: `Zone fee: ${responsibleData.zoneName}`, 
                timestamp: Date.now() + 1
            });
        }

        // อัปเดต Real-time (ส่งยอดกระเป๋าที่เปลี่ยนแปลงไปหาทุกคน)
        const updatedUser = await getUserData(author);
        const adminUser = await getUserData('Admin');
        const receiverUser = await getUserData(feeReceiver);

        io.emit('balance-update', { user: author, [zoneCurrency]: updatedUser[zoneCurrency] });
        io.emit('balance-update', { user: 'Admin', [zoneCurrency]: adminUser[zoneCurrency] });
        if (feeReceiver !== 'Admin') {
            io.emit('balance-update', { user: feeReceiver, [zoneCurrency]: receiverUser[zoneCurrency] });
        }
        io.to('Admin').emit('admin-new-transaction');
    }

    // ==================================================================
    // 🚩 เตรียมข้อมูล Merchant (แก้ไขการดึงชื่อร้านและพิกัด)
    // ==================================================================
    let parsedStops = stops ? (typeof stops === 'string' ? JSON.parse(stops) : stops) : null;
    let storeName = author; // กันพลาดให้เป็นชื่อคนโพสต์ไว้ก่อน
    let storeCoords = location ? JSON.parse(location) : null;

    if (isMerchantTask && parsedStops && parsedStops.length > 0) {
        // ใช้ชื่อจากจุดรับงาน (Pickup) เป็นชื่อร้าน
        storeName = parsedStops[0].label || author; 
        // ใช้พิกัดร้านที่ปักไว้เป็นพิกัดหลักของโพสต์
        storeCoords = { lat: parsedStops[0].lat, lng: parsedStops[0].lng };
    }

    const newPost = { 
        id: Date.now(), 
        title: finalTitle, 
        topicId: category, 
        content, 
        author, 
        location: storeCoords, 
        imageUrl: imageUrl, 
        comments: [], 
        isClosed: false, 
        isPinned: (author === 'Admin'),
        zoneId: postZoneId,
        isFreePost: isFreePostFinal,

        // 🚩 ข้อมูลสำหรับการแสดงผล
        isMerchantTask: isMerchantTask,
        storeName: storeName, // ชื่อร้านค้า (ไม่โชว์ชื่อคนโพสต์)
        budget: budget,
        stops: parsedStops
    };

    await postsCollection.insertOne(newPost);
    await usersCollection.updateOne({ username: author }, { $inc: { totalPosts: 1 } });
	if (isMerchantTask) {
    await usersCollection.updateOne(
        { username: author },
        { $inc: { mercNum: 1 } } // บวก 1 เมื่อร้านค้าสร้างงาน
    );
    console.log(`📈 Merchant Task Created: ${author} (mercNum +1)`);
}
    
    if (author !== 'Admin') {

        let msgText = isFreePostFinal 
            ? `✨ โพสต์สำเร็จ! (ฟรีค่าธรรมเนียม)` 
            : `💸 หักค่าธรรมเนียม ${totalCostLocal.toFixed(2)} ${zoneCurrency}`;

        const notifMsg = { 
            sender: 'System', target: author, msgKey: 'SYS_FEE', 
            msgData: { topicName: topicName, cost: isFreePostFinal ? 0 : totalCostLocal }, 
            msg: msgText, timestamp: Date.now() + 2 
        };
        await messagesCollection.insertOne(notifMsg);
        io.to(author).emit('private-message', { ...notifMsg, to: author });
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

// 23. Add Comment (เวอร์ชันปรับปรุงให้รองรับหน้า Merchant)
app.post('/api/posts/:id/comments', upload.single('image'), async (req, res) => {
    const postId = parseInt(req.params.id);
    // 🚩 ปรับตรงนี้: รับได้ทั้ง content (แบบเก่า) และ text (แบบใหม่จาก Merchant)
    const { content, text, author } = req.body;
    const finalContent = content || text; // เลือกใช้อันที่มีค่า

    const imageUrl = req.file ? req.file.path : null; 

    const post = await postsCollection.findOne({ id: postId });
    if (!post) return res.status(404).json({ error: 'No posts found' });

    if (!finalContent && !imageUrl) return res.status(400).json({ error: 'กรุณากรอกข้อความ' });

    const isOwner = (author === post.author);
    const isAcceptedViewer = (author === post.acceptedViewer);
    const isAcceptedBy = (author === post.acceptedBy); // 🚩 เพิ่มเช็คคนรับงานขนส่ง
    const isAdmin = (author === 'Admin');

    if (post.status === 'closed_permanently' && !isAdmin) {
        return res.status(403).json({ error: '⛔ กระทู้นี้ปิดถาวรแล้ว' });
    }

    // ปรับเงื่อนไขให้ครอบคลุม Rider ที่รับงานด้วย (acceptedBy)
    if (post.isClosed && !isOwner && !isAcceptedViewer && !isAcceptedBy && !isAdmin && post.status !== 'finished') {
        return res.status(403).json({ error: '⛔ เฉพาะผู้เกี่ยวข้องที่ส่งข้อความได้' });
    }

    // 🚩 ใช้ชื่อฟิลด์ 'text' ให้ตรงกับระบบใหม่ หรือจะใช้ 'content' ก็ได้แต่ต้องแก้ให้ตรงกัน
    // ในที่นี้ผมใช้ 'text' เพื่อให้เข้ากับโค้ด Merchant ที่เราเขียนไปก่อนหน้านี้ครับ
    const newComment = { 
        id: Date.now(), 
        author, 
        text: finalContent, // เก็บลงฟิลด์ text
        content: finalContent, // เก็บลง content ด้วยเพื่อรองรับหน้า index เดิม (กันเหนียว)
        imageUrl, 
        timestamp: Date.now() 
    };

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


//ส่วนของร้านค้าาาาา
// API: ลบงานร้านค้า และคืนค่า mercNum
app.delete('/api/merchant/tasks/:id', async (req, res) => {
    // 🚩 ลองใส่ console.log เพื่อดูว่าค่ามาถึง Server หรือไม่
    console.log("🗑️ Delete Request - ID:", req.params.id, "User:", req.body.username);

    const postId = parseInt(req.params.id); // แปลงเป็นตัวเลข
    const { username } = req.body;

    if (!username) return res.status(400).json({ success: false, error: 'ไม่พบชื่อผู้ใช้ใน Request' });

    try {
        // ค้นหาโดยระบุเลข ID ให้ชัดเจน
        const post = await postsCollection.findOne({ id: postId });
        
        if (!post) {
            console.log("❌ ไม่พบงาน ID:", postId);
            return res.status(404).json({ success: false, error: 'ไม่พบงานในระบบ' });
        }

        if (post.acceptedBy) {
            return res.status(400).json({ success: false, error: 'มีไรเดอร์รับงานไปแล้ว ลบไม่ได้' });
        }

        await postsCollection.deleteOne({ id: postId });
        
        // 🚩 ตรวจสอบว่าลดแต้ม mercNum ถูกคน
        const updateResult = await usersCollection.updateOne(
            { username: username }, 
            { $inc: { mercNum: -1 } }
        );

        console.log(`✅ ลบงานสำเร็จและลดแต้มให้ ${username}`);
        res.json({ success: true });
    } catch (err) {
        console.error("🚨 Server Error:", err);
        res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดที่ Server' });
    }
});

// API: รีเซ็ตค่า mercNum ให้เป็น 0 (ใช้สำหรับล้างสถานะร้านค้า)
app.post('/api/merchant/reset-mercnum', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: 'Username is missing' });

    try {
        // 🚩 ล้างทั้ง mercNum (ของร้านค้า) และ riderWorking (กรณีร้านค้าเป็นไรเดอร์ด้วย)
        await usersCollection.updateOne(
            { username: username },
            { 
                $set: { 
                    mercNum: 0, 
                    riderWorking: null,
                    working: null // ล้างสถานะงานทั่วไปด้วยเพื่อความชัวร์
                } 
            }
        );

        console.log(`🧹 Manual Clean: mercNum for ${username} is now 0`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// 2. API: ดึงพิกัดทั้งหมดของร้านค้า
app.get('/api/merchant/locations', async (req, res) => {
    const username = req.query.username; // รับชื่อจาก Query String
    if (!username) return res.status(400).json({ success: false, error: 'ไม่พบชื่อผู้ใช้' });

    try {
        const locations = await merchantLocationsCollection.find({ owner: username }).toArray();
        res.json({ success: true, locations });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// 3. API: บันทึกพิกัดใหม่ (ปรับปรุง)
app.post('/api/merchant/locations', async (req, res) => {
    // 🚩 รับ isStore เพิ่มเข้ามา
    const { username, label, voiceKeyword, lat, lng, phone, isStore } = req.body;

    try {
        const newLocation = {
            owner: username,
            label,
            phone: phone || "",
            voiceKeyword,
            lat,
            lng,
            isStore: isStore === true, // 🚩 บันทึกสถานะว่าเป็นร้านค้าหรือไม่
            createdAt: Date.now()
        };
        const result = await merchantLocationsCollection.insertOne(newLocation);
        res.json({ success: true, location: { ...newLocation, _id: result.insertedId } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'ไม่สามารถบันทึกได้' });
    }
});

// API: แก้ไขข้อมูลพิกัด (ปรับปรุง)
app.put('/api/merchant/locations/:id', async (req, res) => {
    try {
        const { label, voiceKeyword, lat, lng, phone, isStore } = req.body;
        await merchantLocationsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { 
                $set: { 
                    label, 
                    voiceKeyword, 
                    phone: phone || "",
                    lat: parseFloat(lat), 
                    lng: parseFloat(lng),
                    isStore: isStore === true, // 🚩 อัปเดตสถานะด้วย
                    updatedAt: Date.now() 
                } 
            }
        );
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ success: false, error: 'ไม่สามารถอัปเดตข้อมูลได้' }); 
    }
});




// API: ดึงงานของร้านค้า (Merchant) เฉพาะที่ยังไม่จบกระบวนการ
app.get('/api/merchant/tasks', async (req, res) => {
    const username = req.query.username;
    if (!username) return res.status(400).json({ success: false, error: 'ไม่พบชื่อผู้ใช้' });

    try {
        const posts = await postsCollection.find({ 
            author: username, 
            isMerchantTask: true,
            status: { $ne: 'closed_by_merchant' } // 🚩 ดึงทุกงานที่ยังไม่ได้ถูก "ร้านค้ากดยืนยันจบงานเอง"
        }).sort({ id: -1 }).toArray();

        const activeTasks = posts.filter(post => {
            const now = Date.now();
            const isExpiredAndNoRider = (now - post.id > 3600000) && !post.isPinned && !post.acceptedBy;

            // 🚩 แก้ไขจุดนี้: งานจะหายไปก็ต่อเมื่อ status คือ 'closed_by_merchant'
            // ถ้าเป็น 'finished' (ไรเดอร์ส่งครบ) ต้องยัง return true เพื่อให้ร้านเห็นปุ่มให้คะแนน
            if (post.status === 'closed_by_merchant' || isExpiredAndNoRider) {
                return false; 
            }

            // แสดงงานที่: กำลังรอ, ไรเดอร์รับแล้ว, หรือไรเดอร์ส่งเสร็จแล้วแต่ร้านยังไม่ปิดงาน
            if (post.status === 'finished' || post.acceptedBy || !post.isClosed) {
                return true;
            }

            return false;
        });
        
        res.json({ success: true, posts: activeTasks });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

	// API: ดึงข้อความแชท/คอมเมนต์ ของโพสต์นั้นๆ
app.get('/api/posts/:id/comments', async (req, res) => {
    const postId = parseInt(req.params.id);
    try {
        const post = await postsCollection.findOne({ id: postId });
        if (!post) return res.status(404).json({ success: false, error: 'ไม่พบโพสต์' });
        
        // ส่งคอมเมนต์ออกไป ถ้าไม่มีให้ส่งอาเรย์ว่าง
        res.json(post.comments || []);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// API: ส่งข้อความแชท/คอมเมนต์ เข้าไปในโพสต์
app.post('/api/posts/:id/comments', async (req, res) => {
    const postId = parseInt(req.params.id);
    const { author, text } = req.body;

    if (!text) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความ' });

    try {
        const newComment = {
            id: Date.now(),
            author: author,
            text: text,
            timestamp: Date.now()
        };

        // ใช้ $push เพื่อเพิ่มคอมเมนต์เข้าไปใน Array ในฐานข้อมูล
        await postsCollection.updateOne(
            { id: postId },
            { $push: { comments: newComment } }
        );

        res.json({ success: true, comment: newComment });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Database Error' });
    }
	io.to(`post-${postId}`).emit('new-comment', { postId: postId, comment: newComment });
});

	// API: ดึงสถิติของ Rider เพื่อให้ร้านค้าดูประกอบการตัดสินใจ
app.get('/api/rider-stats/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const user = await usersCollection.findOne({ username: username });

        // 🚩 แก้ไขจุดนับงาน: เช็คทั้งสองฟิลด์ (acceptedBy และ acceptedViewer) 
        // และเช็คทุกสถานะที่ถือว่างานสำเร็จ/จบแล้ว
        const completedJobs = await postsCollection.countDocuments({ 
            $or: [
                { acceptedBy: username }, 
                { acceptedViewer: username }
            ],
            status: { $in: ['finished', 'success', 'completed', 'closed_permanently', 'rating_pending'] } 
        });

        // ตรวจสอบใน Terminal ว่ารอบนี้นับได้เลขอะไร
        console.log(`📊 Stats for ${username}: Found ${completedJobs} jobs`);

        res.json({
            success: true,
            stats: {
                username: username,
                rating: user?.rating || 0,
                totalJobs: completedJobs, 
                avatar: user?.avatar || null
            }
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});


// API: ร้านค้ากดบายพาสจุดส่ง
app.post('/api/posts/:postId/bypass-stop/:stopIndex', async (req, res) => {
    const { postId, stopIndex } = req.params;
    const { author } = req.body;

    console.log(`\n--- ⏩ Start Bypass Debug ---`);
    console.log(`📦 PostID: ${postId} | 📍 StopIndex: ${stopIndex} | 👤 Merchant: ${author}`);

    try {
        // 1. ค้นหางาน
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post) return res.status(404).json({ success: false, error: 'ไม่พบงาน' });
        
        if (post.author !== author) return res.status(403).json({ success: false, error: 'ไม่มีสิทธิ์จัดการงานนี้' });
		if (!post.acceptedBy) {
            return res.status(400).json({ 
                success: false, 
                error: 'ไม่สามารถ Bypass ได้เนื่องจากยังไม่มีไรเดอร์รับงาน' 
            });
        }
        // 2. เตรียมอัปเดตสถานะจุด
        const updateKey = `stops.${stopIndex}.status`;
        let updateData = { [updateKey]: 'success' };

        // 3. ตรวจสอบว่างานจะจบเลยหรือไม่
        const currentStops = post.stops;
        currentStops[stopIndex].status = 'success';
        const allFinished = currentStops.every(s => s.status === 'success');

        if (allFinished) {
            console.log(`🚩 All stops finished via Bypass. Closing job...`);
            updateData.status = 'closed_permanently';
            updateData.isClosed = true;
            updateData.finishTimestamp = Date.now();

            // 🚩 ปลดล็อค Rider ทันที (เพราะร้านค้าเป็นคนปิดงานให้)
            const riderName = post.acceptedBy || post.acceptedViewer;
            if (riderName) {
                await usersCollection.updateOne(
                    { username: riderName },
                    { $set: { riderWorking: null } }
                );
                console.log(`✅ Unlocked Rider: ${riderName} (riderWorking = null)`);
                
                // อัปเดตสถิติไรเดอร์ (optional)
                await usersCollection.updateOne(
                    { username: riderName },
                    { $inc: { totalJobs: 1 } }
                );
            }

            // อัปเดตสถิติร้านค้า
            await usersCollection.updateOne(
                { username: author },
                { $inc: { totalJobs: 1, authorCompletedJobs: 1 } }
            );
        }

        await postsCollection.updateOne(
            { id: parseInt(postId) },
            { $set: updateData }
        );

        // 4. แจ้งเตือนผ่าน Socket
        io.to(postId.toString()).emit('update-job-status', { 
            postId, 
            stopIndex, 
            status: 'success',
            allFinished 
        });

        // ถ้าจบงาน ให้ส่งสัญญาณให้ Rider เด้งหน้าให้คะแนน (ถ้าคุณยังต้องการให้ไรเดอร์ประเมินร้าน)
        if (allFinished) {
            io.to(postId.toString()).emit('job-finished-complete', { postId });
        }
        
        io.emit('update-post-status');

        res.json({ success: true, allFinished });

    } catch (err) {
        console.error("🚨 Bypass Error:", err);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});


// API: ร้านค้ายืนยันจบงาน และให้คะแนนไรเดอร์
app.post('/api/posts/:postId/finish-job', async (req, res) => {
    const { postId } = req.params;
    const { rating, author } = req.body; 

    try {
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post) return res.status(404).json({ success: false, error: 'ไม่พบงานนี้' });

        const riderName = post.acceptedBy || post.acceptedViewer;

        // 1. อัปเดตสถานะโพสต์เป็นปิดถาวร
        await postsCollection.updateOne(
            { id: parseInt(postId) },
            { 
                $set: { 
                    status: 'closed_permanently', 
                    isClosed: true,
                    merchantRating: rating, 
                    finishTimestamp: Date.now()
                } 
            }
        );

        // 🚩 2. ปลดล็อค Rider ทันทีเพื่อให้เขาไปรับงานอื่นได้ (ล้างค่า working)
        if (riderName) {
            await usersCollection.updateOne(
                { username: riderName },
                { $set: { working: null } } // ✅ ล้างงานที่ผูกไว้
            );
            
            // 3. อัปเดตสถิติและคะแนนให้ไรเดอร์ (Rider)
            await usersCollection.updateOne(
                { username: riderName },
                { 
                    $inc: { 
                        totalJobs: 1, 
                        totalRatingScore: parseFloat(rating), 
                        ratingCount: 1 
                    }
                }
            );
        }

        // 4. อัปเดตสถิติจบงานให้ร้านค้า (Merchant)
        await usersCollection.updateOne(
            { username: post.author },
            { $inc: { totalJobs: 1, authorCompletedJobs: 1, mercNum: -1 } }
        );

        // 5. แจ้งเตือนผ่าน Socket
        io.to(postId.toString()).emit('job-finished-complete', { postId, rating });
        io.emit('update-post-status'); 

        res.json({ success: true, message: 'จบงานและปลดล็อคไรเดอร์เรียบร้อย' });

    } catch (error) {
        console.error("Finish Job Error:", error);
        res.status(500).json({ success: false, error: 'Database Error' });
    }
});

// บันทึกออเดอร์สำเร็จรูป (Templates)
app.post('/api/merchant/templates', async (req, res) => {
    const { username, templateName, voiceKeyword, category, budget, stops, content } = req.body;
    try {
        const newTemplate = {
            owner: username,
            templateName,   // เช่น "ออเดอร์เอ"
            voiceKeyword: voiceKeyword.replace(/\s+/g, ''), // คำสั่งเสียง
            category, budget, stops, content,
            createdAt: Date.now()
        };
        await merchantTemplatesCollection.insertOne(newTemplate);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'ไม่สามารถบันทึกเทมเพลตได้' });
    }
});

//  ดึงรายการออเดอร์สำเร็จรูป
app.get('/api/merchant/templates', async (req, res) => {
    const username = req.query.username;
    try {
        const templates = await merchantTemplatesCollection.find({ owner: username }).toArray();
        res.json({ success: true, templates });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// API: ลบออเดอร์สำเร็จรูป (Template)
app.delete('/api/merchant/templates/:id', async (req, res) => {
    try {
        const templateId = req.params.id;
        
        // ลบข้อมูลโดยอ้างอิงจาก _id
        const result = await merchantTemplatesCollection.deleteOne({ 
            _id: new ObjectId(templateId) 
        });

        if (result.deletedCount === 1) {
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'ไม่พบข้อมูลที่ต้องการลบ' });
        }
    } catch (error) {
        console.error("Delete Template Error:", error);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});


//ใรเดอร์รับงานร้านค้า

// API: ไรเดอร์เช็คอินพิกัดรายจุด และปิดงานอัตโนมัติ
app.post('/api/posts/:id/checkin', async (req, res) => {
    const postId = parseInt(req.params.id);
    const { stopIndex, riderName, lat, lng } = req.body;

    try {
        const post = await postsCollection.findOne({ id: postId });
        if (!post) return res.status(404).json({ success: false, error: 'ไม่พบงานนี้' });

        const updateKey = `stops.${stopIndex}.status`;
        const timeKey = `stops.${stopIndex}.completedAt`;
        const riderCoordKey = `stops.${stopIndex}.checkInLocation`;

        // 1. อัปเดตสถานะจุดที่เช็คอิน
        await postsCollection.updateOne(
            { id: postId },
            { 
                $set: { 
                    [updateKey]: 'success',
                    [timeKey]: Date.now(),
                    [riderCoordKey]: { lat, lng }
                } 
            }
        );

        // 2. ตรวจสอบว่าเช็คอินครบทุกจุดหรือยัง
        const updatedPost = await postsCollection.findOne({ id: postId });
        const allDone = updatedPost.stops.every(s => s.status === 'success');

        if (allDone) {
            // 🚩 แก้ไข: เปลี่ยนเฉพาะ status เป็น finished แต่ห้ามใส่ isClosed: true
            await postsCollection.updateOne(
                { id: postId },
                { $set: { status: 'finished',riderWorking: null, finishedAt: Date.now() } }
            );
            
            // 🔔 ส่งสัญญาณบอกร้านค้าว่าไรเดอร์ส่งครบแล้ว (เพิ่อให้อัปเดต UI อัตโนมัติ)
            io.emit('update-job-status', { postId: postId, status: 'finished' });
            
            return res.json({ success: true, isFinished: true, message: '🎉 ส่งงานครบทุกจุดแล้ว! รอร้านค้ายืนยัน' });
        }

        // 🔔 ส่งสัญญาณอัปเดตจุดรายทาง (เพื่อให้ Progress Bar เลื่อน)
        io.emit('update-job-status', { postId: postId, stopIndex: stopIndex, status: 'success' });

        res.json({ success: true, isFinished: false, message: 'บันทึกการเช็คอินเรียบร้อย' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});


// API: ให้คะแนนเรตติ้ง (ใช้ได้ทั้งร้านค้าให้ไรเดอร์ และไรเดอร์ให้ร้านค้า)
app.post('/api/posts/:id/rate', async (req, res) => {
    const { targetUser, rating, comment, role } = req.body; // role: 'merchant' หรือ 'rider'

    try {
        const user = await usersCollection.findOne({ username: targetUser });
        if (!user) return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้' });

        // คำนวณคะแนนเฉลี่ยใหม่
        const currentRating = user.rating || 0;
        const totalReviews = user.totalReviews || 0;
        const newRating = ((currentRating * totalReviews) + parseFloat(rating)) / (totalReviews + 1);

        await usersCollection.updateOne(
            { username: targetUser },
            { 
                $set: { rating: newRating },
                $inc: { totalReviews: 1 }
            }
        );

        res.json({ success: true, message: 'บันทึกคะแนนเรียบร้อย' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Rating Error' });
    }
});

// API: Rider ส่งคำขอรับงาน
app.post('/api/posts/:id/apply', async (req, res) => {
    const postId = parseInt(req.params.id);
    const { riderName } = req.body;
    try {
        await postsCollection.updateOne(
            { id: postId },
            { $set: { pendingRider: riderName, applyTimestamp: Date.now() } }
        );

        // 🔔 เพิ่มบรรทัดนี้: ส่งสัญญาณบอกร้านค้าว่ามีคนของาน
        io.emit('rider-applied', { postId: postId, riderName: riderName });

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// API: ร้านค้ากดยืนยันรับ Rider คนนี้
app.post('/api/posts/:id/approve-rider', async (req, res) => {
    const postId = parseInt(req.params.id);
    try {
        const post = await postsCollection.findOne({ id: postId });
        if (!post || !post.pendingRider) return res.json({ success: false, error: 'ไม่มีคำขอจาก Rider' });

        const acceptedRider = post.pendingRider;

        // 1. อัปเดตฝั่งงาน (Posts)
        await postsCollection.updateOne(
            { id: postId },
            { $set: { acceptedBy: acceptedRider, pendingRider: null, status: 'in_progress' } }
        );

        // 🚩 2. ผูกงานไว้กับ Rider (เพิ่มจุดนี้)
        // เพื่อให้ Rider คนนี้ติดสถานะ "กำลังทำงาน" และรับงานอื่นไม่ได้
        await usersCollection.updateOne(
            { username: acceptedRider },
            { $set: { riderWorking: postId } }
        );

        io.emit('update-post-status');
        io.to(postId.toString()).emit('update-job-status', { status: 'in_progress' });

        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ success: false }); 
    }
});

// API: ร้านค้ากดปฏิเสธคำขอของไรเดอร์
app.post('/api/posts/:id/reject-rider', async (req, res) => {
    const postId = parseInt(req.params.id);
    try {
        await postsCollection.updateOne(
            { id: postId },
            { $set: { pendingRider: null } } // ล้างค่าไรเดอร์ที่ขอมา
        );
        
        // ส่งสัญญาณบอกไรเดอร์ว่าคำขอถูกปฏิเสธ (Rider จะได้กดรับงานใหม่ได้)
        io.emit('rider-rejected', { postId: postId });
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// API: ไรเดอร์ให้คะแนนร้านค้า (ปลดล็อคสถานะ working)
app.post('/api/posts/:postId/rate-merchant', async (req, res) => {
    const { postId } = req.params;
    const { rating, riderName } = req.body;

    try {
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        if (!post) {
            return res.status(404).json({ success: false, error: 'ไม่พบงาน' });
        }

        // 1. บันทึกคะแนนลงในงาน
        const updatePost = await postsCollection.updateOne(
            { id: parseInt(postId) },
            { $set: { riderToMerchantRating: rating, riderProcessStatus: 'rated' } }
        );

        // 🚩 2. ปลดล็อค Rider ให้ว่างงาน (ลบตัวแปร working ออก)
        const updateRider = await usersCollection.updateOne(
            { username: riderName },
            { $set: { riderWorking: null } }
        );

        // 3. อัปเดตคะแนนสะสมให้ร้านค้า
        const updateMerchant = await usersCollection.updateOne(
            { username: post.author },
            { $inc: { merchantRatingScore: rating, merchantRatingCount: 1 } }
        );

        res.json({ success: true });
    } catch (err) {
        console.error("🚨 Rate-Merchant Error:", err);
        res.status(500).json({ success: false });
    }
});


// API สำหรับหน้า index.html ไว้เช็คว่าต้องดีดไปหน้างานไหม
app.get('/api/rider/check-working-status', async (req, res) => {
    const { username } = req.query;
    try {
        const user = await usersCollection.findOne({ username: username });
        if (!user) return res.json({ success: false });

        // 🚩 ดึงค่า mercNum (ถ้าไม่มีให้เป็น 0)
        const mercNum = user.mercNum || 0;

        // เช็คการ Lock งานปัจจุบัน (ระบบเดิม)
        const activeJobId = user.working || user.riderWorking;
        const jobType = user.riderWorking ? 'merchant' : 'handover';

        // กรณีมีเลขงานผูก (In Progress)
        if (activeJobId) {
            const post = await postsCollection.findOne({ id: parseInt(activeJobId) });
            const isOwner = post && post.author === username;

            res.json({ 
                success: true, 
                workingJobId: activeJobId,
                jobType: jobType,
                isOwner: isOwner,
                mercNum: mercNum // 🚩 ส่งจำนวนงานไปด้วย
            });
        } 
        // 🚩 กรณีไม่มีงานล็อค แต่ mercNum > 0 (คือร้านค้ามีงานที่ยังไม่จบกระบวนการ)
        else if (mercNum > 0) {
            res.json({
                success: true,
                mercNum: mercNum,
                jobType: 'merchant',
                isOwner: true 
            });
        } 
        else {
            res.json({ success: false, mercNum: 0 });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});






//================ส่วนเติมเงิน

// ==========================================
// [SECTION] สำหรับฝั่ง USER (สมาชิก)
// ==========================================

// 1.1 ส่งคำขอเติมเงิน
app.post('/api/topup/request', async (req, res) => {
    try {
        const { username, amount, location, type, bankInfo } = req.body;
        const locationObj = JSON.parse(decodeURIComponent(location));
        
        // 1. หาโซนรับผิดชอบ
        const zoneInfo = await findResponsibleAdmin(locationObj);
        
        if (!zoneInfo || !zoneInfo.zoneData.assignedAdmin) {
            return res.status(400).json({ error: "ไม่อยู่ในพื้นที่บริการ" });
        }

        const adminId = zoneInfo.zoneData.assignedAdmin;
        const amountNum = parseFloat(amount);

        // ✅ 2. ระบุชื่อฟิลด์กระเป๋าเงิน (เช่น 'thb', 'brl', 'usd')
        // ถ้าโซนไม่มีสกุลเงินระบุ ให้ใช้ 'coins' หรือ 'usd' เป็นค่า default
        const currencyField = zoneInfo.zoneData.zoneCurrency || 'usd';

        // --- Logic สำหรับการถอนเงิน (WITHDRAW) ---
        if (type === 'WITHDRAW') {
            const user = await usersCollection.findOne({ username });
            
            // ✅ 3. เช็คเงินจากฟิลด์ที่ถูกต้อง (user[currencyField])
            const currentBalance = user[currencyField] || 0;

            if (!user || currentBalance < amountNum) {
                return res.status(400).json({ error: `ยอดเงิน ${currencyField} ของคุณไม่เพียงพอสำหรับการถอน` });
            }
            
            // ✅ 4. หักเงินออกจากฟิลด์ที่ถูกต้อง (Dynamic Key)
            // ใช้ [currencyField] เพื่อบอก MongoDB ว่าให้อัปเดตฟิลด์ชื่อนี้
            await usersCollection.updateOne(
                { username }, 
                { $inc: { [currencyField]: -amountNum } } 
            );
        }

        const newRequest = {
            username,
            amount: amountNum,
            adminId,
            type: type || 'TOPUP',
            bankInfo: bankInfo || null,
            status: 'pending',
            createdAt: new Date(),
            // ✅ 5. บันทึกสกุลเงินไว้ในประวัติด้วย เพื่อให้ Admin รู้ว่านี่คือยอดของสกุลอะไร
            currency: currencyField 
        };

        const result = await topupRequestsCollection.insertOne(newRequest);
        res.json({ success: true, adminId, requestId: result.insertedId }); 
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1.2 เช็คสถานะคำขอที่ค้างอยู่ (เพื่อสลับไปหน้าแชทอัตโนมัติ)
app.get('/api/topup/status', async (req, res) => {
    try {
        const { username } = req.query;
        const pending = await topupRequestsCollection.findOne({ username, status: 'pending' });

        if (pending) {
            const settings = await adminSettingsCollection.findOne({ adminName: pending.adminId });

            res.json({
                hasPending: true,
                requestId: pending._id,
                adminName: pending.adminId,
                type: pending.type,   // 🚩 ส่งประเภท (TOPUP/WITHDRAW)
                amount: pending.amount, // ส่งจำนวนเงิน
                bankInfo: pending.bankInfo, // ส่งข้อมูลบัญชี (ถ้ามี)
                adminMessage: {
                    bankInfo: settings ? settings.bankInfo : "โปรดรอแอดมินแจ้งเลขบัญชีในแชท",
                    desc: settings ? settings.desc : "กำลังรอการตรวจสอบหลักฐาน"
                }
            });
        } else {
            res.json({ hasPending: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1.3 API สำหรับดึงประวัติการเติมเงินของสมาชิก (Approved / Rejected)
app.get('/api/topup/history', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).send("Missing username");

        // ค้นหาคำขอที่สถานะไม่ใช่ pending และเรียงจากใหม่ไปเก่า
        const history = await topupRequestsCollection
            .find({ username: username, status: { $ne: 'pending' } })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(history);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ==========================================
// [SECTION] สำหรับฝั่ง ADMIN (เจ้าของโซน)
// ==========================================

// 2.1 ดึงจำนวนคำขอที่ค้างอยู่ (สำหรับ Badge จุดแดง)
app.get('/api/admin/pending-counts', async (req, res) => {
    try {
        const { admin } = req.query;
        const topupCount = await db.collection('topupRequests').countDocuments({ targetAdmin: admin, status: 'pending' });
        const kycCount = await db.collection('kycRequests').countDocuments({ targetAdmin: admin, status: 'pending' });
        
        res.json({ topupCount, kycCount });
    } catch (e) {
        res.json({ topupCount: 0, kycCount: 0 });
    }
});

// 2.2 บันทึกข้อความอัตโนมัติ (เลขบัญชี)
app.post('/api/admin/save-settings', async (req, res) => {
    try {
        const { adminName, bankInfo, desc } = req.body;
        
        // ใช้ updateOne แบบ upsert: true (ถ้ายังไม่มีชื่อแอดมินคนนี้ให้สร้างใหม่ ถ้ามีแล้วให้อัปเดต)
        await db.collection('admin_settings').updateOne(
            { adminName: adminName },
            { 
                $set: { 
                    bankInfo: bankInfo, 
                    desc: desc,
                    updatedAt: new Date() 
                } 
            },
            { upsert: true }
        );

        res.json({ success: true, message: "Settings saved successfully" });
    } catch (err) {
        console.error("❌ Save Settings Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// 2.3 ดึงรายการคำขอทั้งหมดของแอดมิน (ใช้แสดงในหน้าจอแอดมิน)
app.get('/api/admin/topup-list', async (req, res) => {
    const { admin } = req.query;
    const requests = await topupRequestsCollection.find({ 
        adminId: admin, 
        status: 'pending' 
    }).sort({ createdAt: -1 }).toArray();
    res.json(requests);
});

// 2.4 อนุมัติการเติมเงิน
app.post('/api/admin/process-topup', async (req, res) => {
    try {
        const { requestId, status, adminName, finalAmount, currency } = req.body;
        const topupReq = await topupRequestsCollection.findOne({ _id: new ObjectId(requestId) });

        if (!topupReq || topupReq.status !== 'pending') {
            return res.status(400).json({ error: "คำขอนี้ไม่พร้อมสำหรับการดำเนินการ" });
        }

        // ✅ แก้ไข: ใช้ค่าเดิมจาก Database หรือที่ส่งมาตรงๆ (เช่น 'BRL', 'THB')
        // ไม่มีการใช้ .toLowerCase() เพื่อให้ตรงกับกระเป๋าเงินตัวพิมพ์ใหญ่
        const currencyField = topupReq.currency || currency || 'USD';
        const amountToProcess = parseFloat(finalAmount || topupReq.amount);

        // --- ❌ กรณีปฏิเสธ (Rejected) ---
        if (status !== 'approved') {
            if (topupReq.type === 'WITHDRAW') {
                // คืนเงินเข้ากระเป๋าที่ถูกต้อง (ตามชื่อสกุลเงินเดิม เช่น BRL)
                await usersCollection.updateOne(
                    { username: topupReq.username }, 
                    { $inc: { [currencyField]: topupReq.amount } } 
                );
            }

            await topupRequestsCollection.updateOne(
                { _id: new ObjectId(requestId) },
                { $set: { status: 'rejected', processedBy: adminName, processedAt: new Date() } }
            );
            return res.json({ success: true, message: "ปฏิเสธคำขอและคืนเงินเรียบร้อย" });
        }

        // --- ✅ กรณีอนุมัติ (Approved) ---
        
        if (topupReq.type === 'TOPUP') {
            // โหมดเติมเงิน: หักเงินจากแอดมิน และเพิ่มให้สมาชิก
            const adminUser = await usersCollection.findOne({ username: adminName });
            
            // ดึงยอดเงินจากกระเป๋าที่ถูกต้อง (ใช้ชื่อฟิลด์จริง เช่น 'BRL')
            const adminBalance = adminUser ? (adminUser[currencyField] || 0) : 0;

            if (!adminUser || adminBalance < amountToProcess) {
                // แจ้งเตือนยอดเงินไม่พอ โดยใช้ชื่อสกุลเงินที่ส่งมา
                return res.status(400).json({ error: `ยอดเงิน ${currencyField} ของแอดมินไม่เพียงพอ` });
            }
            
            // หักแอดมิน เติมสมาชิก (ใช้ Dynamic Key ตาม currencyField)
            await usersCollection.updateOne({ username: adminName }, { $inc: { [currencyField]: -amountToProcess } });
            await usersCollection.updateOne({ username: topupReq.username }, { $inc: { [currencyField]: amountToProcess } });
        } else {
            // โหมดถอนเงิน: แอดมินได้รับเหรียญจากสมาชิกเข้ากระเป๋าตัวเอง
            await usersCollection.updateOne({ username: adminName }, { $inc: { [currencyField]: amountToProcess } });
        }

        await topupRequestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            { 
                $set: { 
                    status: 'approved', 
                    amount: amountToProcess,
                    processedBy: adminName,
                    processedAt: new Date()
                } 
            }
        );

        // ตอบกลับสำเร็จโดยใช้ชื่อสกุลเงินเดิม
        res.json({ success: true, message: `อนุมัติรายการ ${topupReq.type} (${currencyField}) สำเร็จ` });

    } catch (err) {
        console.error("Process Topup Error:", err);
        res.status(500).json({ error: "เกิดข้อผิดพลาดในการประมวลผล" });
    }
});

// API สำหรับดึงประวัติที่แอดมินจัดการ (Approved / Rejected)
app.get('/api/admin/topup-history', async (req, res) => {
    try {
        const { admin } = req.query;
        if (!admin) return res.status(400).send("Missing admin name");

        // ค้นหาคำขอที่แอดมินคนนี้เป็นคนประมวลผล (processedBy)
        const history = await topupRequestsCollection
            .find({ processedBy: admin, status: { $ne: 'pending' } })
            .sort({ processedAt: -1 }) // เรียงตามเวลาที่จัดการล่าสุด
            .toArray();

        res.json(history);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/get-settings', async (req, res) => {
    try {
        const adminName = req.query.admin;
        if (!adminName) return res.status(400).json({ error: "Missing admin name" });

        // ค้นหาข้อมูลจาก Database
        const settings = await db.collection('admin_settings').findOne({ adminName: adminName });

        if (settings) {
            // ส่งข้อมูลกลับไป (ถ้ามี)
            res.json({
                bankInfo: settings.bankInfo || "",
                desc: settings.desc || ""
            });
        } else {
            // ถ้าไม่เคยเซฟเลย ให้ส่งค่าว่างกลับไป
            res.json({ bankInfo: "", desc: "" });
        }
    } catch (err) {
        console.error("❌ Get Settings Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

//admin kyc
// --- API สำหรับดึงรายการ KYC ของแอดมินคนนั้นๆ ---
app.get('/api/admin/kyc-list', async (req, res) => {
    try {
        const adminName = req.query.admin;
        if (!adminName) return res.status(400).json({ error: "Missing admin name" });

        // ค้นหาในคอลเลกชัน kycRequests โดยระบุ targetAdmin และสถานะ pending
        const requests = await db.collection('kycRequests')
            .find({ targetAdmin: adminName, status: 'pending' })
            .sort({ submittedAt: -1 }) // เอาล่าสุดขึ้นก่อน
            .toArray();

        res.json(requests);
    } catch (err) {
        console.error("❌ Get KYC List Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- API สำหรับ อนุมัติ หรือ ปฏิเสธ KYC ---
app.post('/api/admin/process-kyc', async (req, res) => {
    try {
        const { requestId, status, adminName } = req.body;

        // 1. อัปเดตสถานะในรายการคำขอ (kycRequests)
        const request = await db.collection('kycRequests').findOne({ _id: new ObjectId(requestId) });
        if (!request) return res.status(404).json({ error: "Request not found" });

        await db.collection('kycRequests').updateOne(
            { _id: new ObjectId(requestId) },
            { $set: { status: status, processedAt: new Date(), processedBy: adminName } }
        );

        // 2. ถ้าอนุมัติ ให้ไปอัปเดตสถานะในบัญชี User ด้วย (usersCollection)
        if (status === 'approved') {
            await db.collection('users').updateOne(
                { username: request.username },
                { $set: { kycVerified: true, verifiedAt: new Date() } }
            );
        }

        res.json({ message: `ดำเนินการ ${status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'} เรียบร้อยแล้ว` });
    } catch (err) {
        console.error("❌ Process KYC Error:", err);
        res.status(500).json({ error: "Failed to process request" });
    }
});

// ✅ API สำหรับแอดมินลบคำขอยืนยันตัวตน (ปฏิเสธและลบ)
app.post('/api/admin/delete-kyc', async (req, res) => {
    try {
        const { requestId, username } = req.body;

        if (!requestId) {
            return res.status(400).json({ error: "Missing Request ID" });
        }

        // 1. ลบรายการออกจากคอลเลกชัน kycRequests
        const result = await db.collection('kycRequests').deleteOne({ 
            _id: new ObjectId(requestId) 
        });

        // 2. ลบประวัติแชทที่เกี่ยวข้องกับคำขอนี้ด้วย (เพื่อความสะอาดของ DB)
        await db.collection('kyc_chats').deleteMany({ requestId: username });

        if (result.deletedCount === 1) {
            // 3. ส่งสัญญาณ Socket บอกสมาชิกคนนั้นว่าคำขอถูกลบแล้วนะ (ให้เขากลับไปหน้ากรอกฟอร์ม)
            io.emit('kyc-status-updated', {
                username: username,
                status: 'deleted',
                message: 'คำขอของคุณถูกปฏิเสธโดยแอดมิน กรุณาส่งข้อมูลใหม่อีกครั้ง'
            });

            res.json({ success: true, message: "ลบคำขอเรียบร้อยแล้ว" });
        } else {
            res.status(404).json({ error: "ไม่พบคำขอที่ต้องการลบ" });
        }
    } catch (err) {
        console.error("❌ Delete KYC Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});





// ==========================================
// Socket.io Logic
// ==========================================
io.on('connection', (socket) => {
	
	socket.on('join-post', (postId) => {
        const roomName = `post-${postId}`;
        socket.join(roomName);
    });
	
	socket.on('admin_reset_user_status', async ({ targetUsername }) => {
    // เช็คว่าเป็น Admin หรือไม่ (ความปลอดภัย)
    // if (!currentUser || currentUser.adminLevel < 1) return; 

    try {
        await usersCollection.updateOne(
            { username: targetUsername },
            { 
                $set: { 
                    isWorking: false,    // ไม่ได้ทำงาน
                    currentJobId: null,  // ไม่มีงานค้าง
                    role: 'user'         // กลับเป็น user ปรกติ (หรือตามระบบคุณ)
                } 
            }
        );
        
        // แจ้งกลับมาที่ Admin
        socket.emit('reset_status_success', `รีเซ็ตสถานะของ ${targetUsername} แล้ว`);
        
        // อัปเดตข้อมูลให้คนอื่นเห็นด้วย (ถ้าจำเป็น)
        io.emit('update-user-list', await fetchAllUsers()); 

    } catch (err) {
        console.error(err);
    }
});

    
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
	
	socket.on('check-my-active-job', async ({ username }) => {
        if (!username) return;

        const activeJob = await postsCollection.findOne({
            status: 'finished',
            $or: [{ author: username }, { acceptedViewer: username }]
        });

        if (activeJob) {
            // ส่งกลับไปบอก Client เฉพาะคนนั้น
            socket.emit('active-job-found', { 
                postId: activeJob.id, 
                status: activeJob.status,
                title: activeJob.title
            });
        }
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

    const user = await usersCollection.findOne({ username: username });
    const myAdminLevel = user ? (user.adminLevel || 0) : 0;

    const isOwner = username === post.author;
    const isAdmin = (username === 'Admin') || (myAdminLevel >= 1);
    const isParticipant = isOwner || username === post.acceptedViewer;

    // --- ตรวจสอบสิทธิ์การเข้าถึง ---
    const roomName = `post-${postId}`; // ตั้งชื่อ Room ให้เป็นมาตรฐานเดียวกัน

    if (isOwner || isAdmin) {
        socket.join(roomName);
        socket.emit('access-granted', { post: postWithStats, isAdmin });
        
        if (viewerGeolocation[postId]) {
            for (const [viewerName, loc] of Object.entries(viewerGeolocation[postId])) {
                socket.emit('viewer-location-update', { viewer: viewerName, location: loc });
            }
        }
        return; 
    }

    if (post.status === 'finished' || post.isClosed) {
        if (isParticipant) {
            socket.join(roomName);
            socket.emit('access-granted', { post: postWithStats, isAdmin: false });
            
            // 🌟 เพิ่มส่วนนี้: ส่งพิกัดเจ้าของให้ผู้รับงานทันทีที่เข้าห้อง (กรณีงานจบแล้วแต่อยากดูตำแหน่ง)
            const ownerUser = await usersCollection.findOne({ username: post.author });
            if (ownerUser && (ownerUser.lastLocation || ownerUser.currentLocation)) {
                socket.emit('update-owner-location', ownerUser.lastLocation || ownerUser.currentLocation);
            }
        } else {
            socket.emit('access-denied', translateServerMsg('closed_or_finished', lang));
        }
        return;
    }

    const currentViewer = postViewers[postId];
    if (!currentViewer || currentViewer === username) {
        postViewers[postId] = username;
        socket.join(roomName);
        socket.emit('access-granted', { post: postWithStats, isAdmin: false });

        // 🌟 เพิ่มส่วนนี้: ส่งพิกัดเจ้าของให้ผู้รับงาน (Viewer) ทันทีที่เข้าห้องสำเร็จ
        // เพื่อให้ ownerLastLocation ในเครื่อง Client ไม่เป็น null
        const ownerUser = await usersCollection.findOne({ username: post.author });
        if (ownerUser && (ownerUser.lastLocation || ownerUser.currentLocation)) {
            socket.emit('update-owner-location', ownerUser.lastLocation || ownerUser.currentLocation);
            console.log(`✅ Sent owner location to ${username} on join`);
        }
        
    } else {
        socket.emit('access-denied', translateServerMsg('room_occupied', lang));
    }
});

	socket.on('share-map-access', ({ postId }) => {
    console.log(`Owner shared map for post: ${postId}`);
    
    // ส่งสัญญาณไปหาทุกคนที่อยู่ในห้อง 'post-ID' นั้นๆ
    // ใช้ชื่อห้องให้ตรงกับตอน join (คือ post-${postId})
    io.to(`post-${postId}`).emit('map-access-granted', {
        postId: postId,
        message: "เจ้าของกระทู้อนุญาตให้ดูแผนที่แล้ว"
    });
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
    // 1. รับค่า timeLimit เพิ่มเข้ามา
    const { postId, targetViewer, requireProximity, timeLimit } = data; 
    
    // 2. ส่งต่อข้อมูลไปให้ผู้รับงาน (receive-offer)
    io.to(targetViewer).emit('receive-offer', { 
        postId, 
        owner: socket.username, 
        requireProximity: requireProximity,
        timeLimit: timeLimit // [NEW] ส่งเวลาต่อให้คนรับดูเพื่อตัดสินใจ
    });
});

    socket.on('reply-offer', async (data) => {
    // 1. รับค่า timeLimit (มิลลิวินาที) เพิ่มเข้ามาจาก data
    const { postId, accepted, viewer, owner, requireProximity, timeLimit } = data; 

    if (accepted) {
        // คำนวณเวลาสิ้นสุด (Deadline)
        const duration = parseInt(timeLimit) || 0; // ถ้าไม่ส่งมา หรือเป็น 0 คือไม่จำกัดเวลา
        const deadline = duration > 0 ? Date.now() + duration : null;

        await postsCollection.updateOne(
            { id: parseInt(postId) }, 
            { $set: { 
                isClosed: true, 
                status: 'finished', 
                acceptedViewer: viewer, 
                requireProximity: requireProximity || false, 
                jobDeadline: deadline // [NEW] บันทึกเวลาหมดอายุลง DB
            }}
        );
		await usersCollection.updateMany(
            { username: { $in: [owner, viewer] } },
            { $set: { working: parseInt(postId) } }
        );
        console.log(`🔒 Locked working status for Owner: ${owner} and Viewer: ${viewer}`);
		
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        await transactionsCollection.insertOne({
            id: Date.now(), type: 'HANDOVER', amount: 0, fromUser: owner, toUser: viewer,
            note: `✅ ปิดดีล/ส่งงานสำเร็จ: กระทู้ ${post.title}`, timestamp: Date.now()
        });
        
        io.emit('post-list-update', { postId: post.id, status: 'finished' });
        
        // ส่งข้อมูลกลับไปหา Owner
        io.to(owner).emit('deal-result', { 
            success: true, 
            viewer, 
            msg: `🎉 ${viewer} รับงานแล้ว!`,
            requireProximity: requireProximity,
            jobDeadline: deadline 
        });

        // ส่งข้อมูลกลับไปหา Viewer
        io.to(viewer).emit('deal-result', { 
            success: true, 
            msg: `✅ ยอมรับงานแล้ว!`, 
            requireProximity: requireProximity,
            jobDeadline: deadline 
        });

        // ส่งพิกัดล่าสุด
        const ownerUser = await usersCollection.findOne({ username: owner });
        if(ownerUser && ownerUser.lastLocation) {
             io.to(viewer).emit('update-owner-location', ownerUser.lastLocation);
        }

        // [NEW] ฟังก์ชันตั้งเวลาตัดจบอัตโนมัติ (Server-side Timeout)
        if (duration > 0) {
            console.log(`⏳ Timer started for post ${postId}: ${duration/60000} mins`);
            
            // 1. เคลียร์ Timer เก่าทิ้งก่อน (ถ้ามี)
            if (activePostTimers[postId]) clearTimeout(activePostTimers[postId]);

            // 2. ตั้ง Timer ใหม่ โดยเรียกใช้ฟังก์ชันกลาง processJobTimeout
            activePostTimers[postId] = setTimeout(() => {
                processJobTimeout(postId, io); // <--- เรียกใช้ตรงนี้
            }, duration);
        }

    } else {
        io.to(owner).emit('deal-result', { success: false, viewer, msg: `❌ ${viewer} ปฏิเสธ` });
    }
});


socket.on('request-extend-time', async (data) => {
    const { postId, minutes } = data;
    const post = await postsCollection.findOne({ id: parseInt(postId) });
    
    // เช็คสิทธิ์ว่าเป็นคนรับงานจริงไหม
    if (post && post.acceptedViewer === socket.username) {
        io.to(post.author).emit('receive-extension-request', { 
            minutes, 
            requester: socket.username 
        });
    }
});

socket.on('reply-extension-request', async (data) => {
    const { postId, minutes, approved } = data;
    const post = await postsCollection.findOne({ id: parseInt(postId) });

    if (!post) return;

    if (approved) {
        // คำนวณ Deadline ใหม่ (ของเดิม + นาทีที่ขอเพิ่ม)
        const addedMillis = minutes * 60000;
        const newDeadline = (post.jobDeadline || Date.now()) + addedMillis;
        
        // เวลาที่เหลืออยู่จริง ณ ตอนนี้ (Time Remaining + Added Time)
        const timeRemaining = newDeadline - Date.now();

        console.log(`[Extension] Post ${postId} extended by ${minutes}m. New remaining: ${timeRemaining/1000}s`);

        // 1. อัปเดต DB
        await postsCollection.updateOne(
            { id: parseInt(postId) },
            { $set: { jobDeadline: newDeadline } }
        );

        // 2. ⚠️ ยกเลิก Timer เก่าก่อนเสมอ ⚠️
        if (activePostTimers[postId]) {
            clearTimeout(activePostTimers[postId]);
            console.log(`🔄 Timer reset for post ${postId}.`);
        }

        // 3. ตั้ง Timer ใหม่ถ้าเวลายังเหลือ (เรียกใช้ฟังก์ชันกลาง processJobTimeout)
        if (timeRemaining > 0) {
            activePostTimers[postId] = setTimeout(() => {
                processJobTimeout(postId, io); // <--- เรียกใช้ตัวเดิม! มั่นใจได้ว่าปิดงานแน่นอน
            }, timeRemaining);
        }

        // 4. แจ้งทุกคนในห้องให้ปรับเลขเวลาบนหน้าจอ
        const updateMsg = { 
            newDeadline, 
            addedMinutes: minutes 
        };

        // ทางที่ 1: ส่งเข้าห้อง (เผื่อคนอื่นดูอยู่)
        io.to(postId.toString()).emit('time-extended-success', updateMsg);

        // ทางที่ 2: ส่งหาเจ้าของงานโดยตรง (User ID)
        io.to(post.author).emit('time-extended-success', updateMsg);

        // ทางที่ 3: ส่งหาคนรับงานโดยตรง (User ID)
        if (post.acceptedViewer) {
            io.to(post.acceptedViewer).emit('time-extended-success', updateMsg);
        }

        console.log(`📡 Broadcasted time extension to Post:${postId}, Owner:${post.author}, Viewer:${post.acceptedViewer}`);

    } else {
        // ถ้าไม่อนุมัติ แจ้งกลับคนขอ
        if (post.acceptedViewer) {
            io.to(post.acceptedViewer).emit('extension-rejected');
        }
    }
});

    // --- Finish Job Logic ---
    socket.on('request-finish-job', async (data) => {
    const { postId } = data;
    const post = await postsCollection.findOne({ id: parseInt(postId) });
    if (!post) return;

    // --- [NEW] เพิ่มการตรวจสอบเวลาตรงนี้ ---
    if (post.jobDeadline && Date.now() > post.jobDeadline) {
         // ถ้าเวลาปัจจุบัน เกินเวลา Deadline
         socket.emit('force-close-job', { message: '❌ ไม่สามารถจบงานได้ เนื่องจากหมดเวลาแล้ว!' });
         return; // หยุดการทำงานทันที (ไม่ส่ง receive-finish-request ไปหาอีกฝั่ง)
    }
    // -------------------------------------

    const requester = socket.username;
    let target = '';
    if (requester === post.author) target = post.acceptedViewer;
    else if (requester === post.acceptedViewer) target = post.author;
    
    if (target) io.to(target).emit('receive-finish-request', { requester });
});

socket.on('confirm-finish-job-post', async ({ postId, accepted, requester }) => {
    if (accepted) {
        // 1. ดึงข้อมูลกระทู้มาก่อนเพื่อดูว่าใครคือคนโพสต์ (Author) และใครคือคนรับงาน (AcceptedViewer)
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        
        if (post) {
            // 2. อัปเดตสถานะกระทู้ตามปกติ
            await postsCollection.updateOne({ id: parseInt(postId) }, { 
                $set: { status: 'rating_pending', isClosed: true, ratings: {} } 
            });
			
			await usersCollection.updateMany(
                { username: { $in: [post.author, post.acceptedViewer] } },
                { $set: { working: null } }
            );
			console.log(`🔓 Unlocked working status for ${post.author} and ${post.acceptedViewer}`);
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

    socket.on('confirm-finish-job', async ({ postId, accepted, requester }) => {
    if (accepted) {
        const post = await postsCollection.findOne({ id: parseInt(postId) });
        
        if (post) {
            // 🚩 แก้ไขสถานะให้เป็น 'finished' (เพื่อให้สถิติที่หน้า Merchant นับเจอ)
            await postsCollection.updateOne({ id: parseInt(postId) }, { 
                $set: { 
                    status: 'closed_by_merchant', // เปลี่ยนจาก finished เป็นตัวนี้เพื่อให้หายจากหน้า Active
                    isClosed: true, 
                    finishTimestamp: Date.now()
                } 
            });

            
            // เพิ่มให้เจ้าของกระทู้
            await usersCollection.updateOne(
                { username: post.author },
                { $inc: { totalJobs: 1 } } // เปลี่ยนชื่อให้ตรงกับหน้า stats
            );

            // เพิ่มให้ผู้รับงาน (เช็คทั้ง 2 ฟิลด์เลยเพื่อกันพลาด)
            const worker = post.acceptedViewer || post.acceptedBy; 
            if (worker) {
                await usersCollection.updateOne(
                    { username: worker },
                    { $inc: { totalJobs: 1 } } 
                );
            }

            io.emit('update-post-status');
            io.to(`post-${postId}`).emit('job-fully-closed');
        }
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
	
	
	
	
	//=======CHAT TOPUP แชทเติมเงิน
	// 1. เข้าร่วมห้องแชทตาม ID ของคำขอ (RequestId)
    socket.on('joinRequest', (requestId) => {
        socket.join(requestId);
    });

    // 2. รับและส่งข้อความแชท
    socket.on('sendMessage', async (data) => {
    const chatMsg = {
        requestId: data.requestId,
        sender: data.sender,
        message: data.message,
        type: data.type || 'text',
        category: data.category || 'topup', // เพิ่มบรรทัดนี้เพื่อเก็บประเภทแชท
        timestamp: new Date()
    };

    try {
        // แนะนำให้ใช้ Collection กลางชื่อ 'all_chats' หรือแยกตาม category
        if (data.category === 'kyc') {
            await db.collection('kyc_chats').insertOne(chatMsg);
        } else {
            await db.collection('topup_chats').insertOne(chatMsg);
        }

        // ส่งต่อให้สมาชิกและแอดมินที่อยู่ในห้องเดียวกัน
        io.to(data.requestId).emit('receiveMessage', chatMsg);
    } catch (err) {
        console.error("❌ Chat Save Error:", err);
    }
});

	// 2.1
	app.get('/api/topup/chat-history', async (req, res) => {
    try {
        const { requestId } = req.query;
        if (!requestId) return res.status(400).send("Missing requestId");

        const history = await topupChatsCollection
            .find({ requestId: requestId })
            .sort({ timestamp: 1 }) // เรียงจากเก่าไปใหม่
            .toArray();

        res.json(history);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

    // 3. แจ้งเตือนเมื่อสถานะเปลี่ยน (เช่น อนุมัติแล้ว)
    socket.on('statusChanged', (data) => {
        // data ประกอบด้วย { requestId, status }
        io.to(data.requestId).emit('updateStatus', data);
    });
	
	//
	socket.on('newTopupRequest', (data) => {
    console.log(`📣 มีรายการเติมเงินใหม่จาก ${data.username} ถึงแอดมิน ${data.adminId}`);
    
    // ส่งสัญญาณไปบอกแอดมินทุกคน (หรือส่งเฉพาะคนด้วย io.to(data.adminId) ถ้าทำระบบ Room ไว้)
    io.emit('notifyAdminNewRequest', data);
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
	
	
	
	
//KYC
socket.on('submit-kyc', async (kycData) => {
    try {
        const { username, fullName, idNumber, phone, address, coords, adminName, userImg } = kycData; // รับ userImg มาด้วย
        
        const newRequest = {
            username: username || "Unknown",
            fullName,
            idNumber,
            phone,
            address,
            coords: coords, // ใช้ชื่อ 'coords' ให้ตรงกับหน้าแอดมิน
            userImg: userImg, // เก็บรูปภาพ (Base64) ลงไปด้วย
            targetAdmin: adminName,
            status: 'pending',
            submittedAt: new Date()
        };

        await db.collection('kycRequests').insertOne(newRequest);
        console.log(`📩 KYC Submitted from ${socket.username} to Admin: ${adminName}`);

        // 3. ส่งแจ้งเตือน Real-time ไปที่แอดมินทุกคน
        // ใช้ io.emit เพื่อให้แอดมินที่เปิดหน้าจออยู่ได้รับทราบทันที
        io.emit('admin-notification', {
            type: 'KYC_REQUEST',
            message: `มีคำขอ KYC ใหม่จากคุณ ${fullName}`,
            adminId: adminName // เพื่อให้ฝั่ง Admin เช็คว่าใช่ของตัวเองไหม
        });

    } catch (err) {
        console.error("❌ KYC Submit Backend Error:", err);
    }
});

// ✅ รับสัญญาณการอัปเดตสถานะ KYC จาก Server
socket.on('kyc-status-updated', (data) => {
    const myName = localStorage.getItem('myUsername');
    
    // 1. ตรวจสอบก่อนว่าข้อมูลที่ส่งมาเป็นของชื่อผู้ใช้เราจริงๆ หรือไม่
    if (data.username !== myName) return;

    // 2. กรณีแอดมิน "อนุมัติ" (Approved)
    if (data.status === 'approved') {
        Swal.fire({
            icon: 'success',
            title: 'ยืนยันตัวตนสำเร็จ!',
            text: `บัญชีของคุณได้รับการตรวจสอบและยืนยันโดย ${data.adminName} เรียบร้อยแล้ว`,
            confirmButtonColor: '#11998e'
        }).then(() => {
            // อัปเดต UI ของหน้าจอทันที
            updateKYCMenuUI('approved', data.adminName);
            
            // ปิด Modal KYC (ถ้าเปิดค้างไว้)
            const modal = document.getElementById('kyc-modal');
            if(modal) modal.style.display = 'none';
            
            // บันทึกสถานะลงเครื่อง (เผื่อรีเฟรชหน้า)
            localStorage.setItem('kyc_status', 'approved');
        });
    } 
	
    // 3. กรณีแอดมิน "ปฏิเสธและลบคำขอ" (Deleted)
    else if (data.status === 'deleted') {
        Swal.fire({
            icon: 'warning',
            title: 'คำขอถูกปฏิเสธ',
            text: data.message || 'ข้อมูลของคุณไม่ผ่านการตรวจสอบ กรุณาส่งข้อมูลใหม่อีกครั้ง',
            confirmButtonColor: '#e74c3c'
        }).then(() => {
            // ล้างค่าสถานะในเครื่อง
            localStorage.removeItem('kyc_status');
            localStorage.removeItem('kyc_id_request');

            // สลับหน้าจอกลับไปที่หน้าฟอร์มกรอกข้อมูลใหม่
            const formView = document.getElementById('kyc-form-view');
            const summaryView = document.getElementById('kyc-summary-view');
            
            if (formView) formView.style.display = 'block';
            if (summaryView) summaryView.style.display = 'none';
            
            // เปลี่ยนปุ่มเมนูให้กลับมาเป็น "ยืนยันตัวตน" สีเขียวปกติ
            updateKYCMenuUI('normal');
        });
    }
});




socket.on('update-kyc-location', async (data) => {
    try {
        // 1. อัปเดตพิกัดใหม่ลงใน Database (kycRequests)
        await db.collection('kycRequests').updateOne(
            { username: data.username, status: 'pending' },
            { $set: { coords: data.coords } }
        );

        // 2. ส่งสัญญาณบอกแอดมินในห้องนั้นว่า "พิกัดเปลี่ยนแล้วนะ"
        io.to(data.username).emit('kyc-location-updated', {
            username: data.username,
            coords: data.coords
        });

        console.log(`📍 Location updated for ${data.username}`);
    } catch (err) { console.error(err); }
});




	
	
	
// --- [Step 1] จ่ายค่าธรรมเนียมและส่งข้อความหาแอดมิน (ใช้ระบบ Coins เดิม) ---
socket.on('send-request-verify', async (data, callback) => {
    try {
        const username = socket.username;
        if (!username) return callback({ success: false, message: "กรุณาเข้าสู่ระบบ / Please Login" });

        const { lat, lng } = data; 
        const amount = 50; 
        
        const user = await usersCollection.findOne({ username: username });
        
        if (!user || (user.coins || 0) < amount) {
            return callback({ success: false, message: "ยอดเงิน USD ของคุณไม่เพียงพอ / Insufficient coins" });
        }

        const allZones = await zonesCollection.find({ "lat": { $exists: true } }).toArray();
        let closestZone = null;
        let minD = Infinity;
        
        if (lat && lng) {
            allZones.forEach(z => {
                const zoneLat = parseFloat(z.lat);
                const zoneLng = parseFloat(z.lng);
                if (!isNaN(zoneLat) && !isNaN(zoneLng)) {
                    const d = calculateDistance(lat, lng, zoneLat, zoneLng);
                    if (d < minD) {
                        minD = d;
                        closestZone = z;
                    }
                }
            });
        }

        if (!closestZone) {
            return callback({ success: false, message: "ไม่พบข้อมูลโซนในพิกัดของคุณ กรุณาเช็คว่าเปิด GPS หรือยัง" });
        }

        const targetAdmin = closestZone.assignedAdmin;
        
        if (!targetAdmin) {
            return callback({ success: false, message: "โซนนี้ยังไม่มีแอดมินดูแล กรุณาติดต่อแอดมินกลาง" });
        }

        console.log(`[Debug] Closest Zone found: ${closestZone.name}, Admin: ${targetAdmin}`);

        await usersCollection.updateOne(
            { username: username },
            { 
                $inc: { coins: -amount },
                $set: { 
                    verifyStep: 1, 
                    lastVerifyAdmin: targetAdmin 
                } 
            }
        );

        if (typeof transactionsCollection !== 'undefined') {
            await transactionsCollection.insertOne({
                id: Date.now(),
                type: 'VERIFY_FEE_STEP1',
                amount: amount, 
                fromUser: username,
                toUser: 'SYSTEM',
                note: `Identity Verification Step 1 (Admin: ${targetAdmin})`,
                timestamp: Date.now()
            });
        }

        if (typeof messagesCollection !== 'undefined') {
            const timestamp = Date.now();

            // 1. System Notification (Displayed in the center)
            const systemMsg = { 
                sender: 'System',
                target: targetAdmin,
                realSender: username,
                msgKey: 'VERIFY_PAYMENT_SYSTEM',
                msgData: { member: username },
                // English System Message
                msg: `🔔 SYSTEM: Member "${username}" has successfully paid the 50 USD Verification Fee. (Status: Awaiting Proximity Check)`,
                timestamp: timestamp,
                isSystem: true,
                isRead: false
            };

            // 2. Automated Member Message (Displayed as user chat)
            const userMsg = { 
                sender: username,
                target: targetAdmin,
                // English User Message
                msg: `💳 I have completed the identity verification payment. I am now heading to your location for the proximity check.`,
                timestamp: timestamp + 1, // Ensure it appears after the system message
                isRead: false
            };

            // บันทึกลงฐานข้อมูลทั้งสองข้อความ (แอดมินจะเห็นประวัติครบถ้วน)
            await messagesCollection.insertMany([systemMsg, userMsg]);

            // --- ส่ง Socket ให้แอดมิน ---
            io.to(targetAdmin).emit('private-message', { ...systemMsg, to: targetAdmin });
            io.to(targetAdmin).emit('private-message', { ...userMsg, to: targetAdmin });

            // --- ส่ง Socket สะท้อนกลับให้สมาชิก ---
            socket.emit('private-message', { ...systemMsg, to: targetAdmin });
            socket.emit('private-message', { ...userMsg, to: targetAdmin });

            console.log(`🔒 Sent Double-Notification (System & User) to ${targetAdmin}`);
        }

        const newCoins = (user.coins || 0) - amount;
        io.emit('balance-update', { user: username, coins: newCoins });

        console.log(`[Step 1] ${username} paid 50 coins. Notified Admin: ${targetAdmin}`);
        callback({ success: true, adminName: targetAdmin });

    } catch (err) {
        console.error("Step 1 Error:", err);
        callback({ success: false, message: "เกิดข้อผิดพลาดในระบบ / Server Error" });
    }
});
	
	
	
	socket.on('find-zone-admin', async (coords, callback) => {
    try {
        const { lat, lng } = coords;
        const username = socket.username;

        // 🔥 [เพิ่มใหม่] ตรวจสอบก่อนว่าผ่าน Step 1 (จ่ายเงิน) มาหรือยัง
        const user = await usersCollection.findOne({ username: username });
        if (!user || user.verifyStep !== 1) {
            return callback({ 
                success: false, 
                message: "กรุณาชำระค่าธรรมเนียม 50 USD ก่อน (Step 1)" 
            });
        }

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
            const adminUser = await usersCollection.findOne({ username: adminUsername });
            
            let adminLiveLocation = null;
            let distanceToAdmin = null;

            if (adminUser && adminUser.currentLocation) {
                adminLiveLocation = adminUser.currentLocation;
                distanceToAdmin = calculateDistance(
                    lat, lng, 
                    parseFloat(adminLiveLocation.lat), 
                    parseFloat(adminLiveLocation.lng)
                );
            }

            // 🔥 [เงื่อนไขระยะห่าง] ต้องไม่เกิน 10 เมตร
            if (distanceToAdmin === null || distanceToAdmin > 10) {
                return callback({ 
                    success: false, 
                    message: `แอดมินอยู่ไกลเกินไป (${distanceToAdmin ? distanceToAdmin.toFixed(0) : '?'} ม.) ต้องเข้าใกล้กันไม่เกิน 10 เมตร` 
                });
            }

            // ✅ ระยะผ่าน! (Step 2 สำเร็จ) -> อัปเดต Step เป็น 2
            await usersCollection.updateOne(
                { username: username },
                { $set: { verifyStep: 2 } }
            );

            // ส่งสัญญาณแจ้งเตือน Modal ให้แอดมิน
            const adminSockets = await io.fetchSockets();
            const targetAdminSocket = adminSockets.find(s => s.username === adminUsername);

            if (targetAdminSocket) {
                io.to(targetAdminSocket.id).emit('notify-admin-verify', {
                    member: username,
                    zone: closestZone.name,
                    distance: distanceToAdmin.toFixed(0),
                    adminTarget: adminUsername
                });
                console.log(`🚀 [Step 2] Proximity OK. Modal sent to: ${adminUsername}`);
            }

            callback({
                success: true,
                zoneName: closestZone.name,
                adminName: adminUsername,
                adminDistance: distanceToAdmin.toFixed(0)
            });
        } else {
            callback({ success: false, message: "ไม่พบข้อมูลโซนในพื้นที่นี้" });
        }
    } catch (err) {
        console.error("Error in find-zone-admin:", err);
        callback({ success: false, message: "เกิดข้อผิดพลาดในการตรวจสอบระยะทาง" });
    }
});


	socket.on('submit-final-verification', async (data, callback) => {
    try {
        const username = socket.username;
        const { lat, lng } = data; // พิกัดที่ส่งมาจากมือถือ User

        const user = await usersCollection.findOne({ username: username });

        // 1. ตรวจสอบว่าผ่าน Step 1 มาหรือยัง
        /*if (!user || (user.verifyStep || 0) < 1) { 
            return callback({ success: false, message: "Please pay the verification fee first. (Step 1)" });
        }*/

        const targetAdmin = user.lastVerifyAdmin;
        const adminUser = await usersCollection.findOne({ username: targetAdmin });

    

        // 3. คำนวณระยะห่างระหว่าง User กับ Admin (ใช้หน่วยเมตร)
        const distanceToAdmin = calculateDistance(
            lat, 
            lng, 
            parseFloat(adminUser.currentLocation.lat), 
            parseFloat(adminUser.currentLocation.lng)
        );

        // 4. ใช้เกณฑ์การเช็คเหมือน find-zone-admin (ปรับเป็น 10-30 เมตรตามที่คุณต้องการ)
        // แนะนำให้ใช้ 30 เมตรเพื่อให้เสถียรกลางแจ้ง
        const maxAllowedDistance = 30; 
        if (distanceToAdmin === null || distanceToAdmin > maxAllowedDistance) {
            return callback({ 
                success: false, 
                message: `Too far! You are ${Math.round(distanceToAdmin)}m away from Admin. Must be within ${maxAllowedDistance}m.` 
            });
        }

        // ✅ ระยะผ่าน! บันทึกข้อมูลเข้า Profile สมาชิก
        await usersCollection.updateOne(
            { username: username },
            { 
                $set: { 
                    verifyStep: 2, 
                    identityData: {
                        fullName: data.fullName,
                        phone: data.phone,
                        address: data.address,
                        idCardImage: data.idCardImage, 
                        selfieImage: data.selfieImage,
                        verifiedAt: new Date(),
                        managedBy: targetAdmin,
                        verifiedDistance: Math.round(distanceToAdmin)
                    }
                } 
            }
        );

        // 🔔 แจ้งเตือนแอดมินให้ตรวจสอบ
        io.to(targetAdmin).emit('admin-review-request', {
            fromUser: username,
            fullName: data.fullName,
            distance: Math.round(distanceToAdmin)
        });

        console.log(`🔒 Step 2 Success: ${username} submitted ID data. Proximity: ${Math.round(distanceToAdmin)}m`);
        callback({ success: true });

    } catch (err) {
        console.error("Final Verify Error:", err);
        callback({ success: false, message: "Server Error during processing." });
    }
});


socket.on('admin-action-verify', async (data, callback) => {
    try {
        const adminUsername = socket.username; 
        const { targetUser, status, reason } = data;

        if (status === 'APPROVE') {
            const amountToAdmin = 50;

            // 1. อัปเดตสถานะสมาชิก
            await usersCollection.updateOne(
                { username: targetUser },
                { $set: { verifyStep: 3, isVerified: true, verifiedBy: adminUsername, verifiedDate: new Date() } }
            );

            // 2. โอนเงินให้แอดมิน
            await usersCollection.updateOne(
                { username: adminUsername },
                { $inc: { coins: amountToAdmin } }
            );

            // 3. บันทึก Transaction
            if (typeof transactionsCollection !== 'undefined') {
                await transactionsCollection.insertOne({
                    id: Date.now(),
                    type: 'VERIFY_EARNING',
                    amount: amountToAdmin,
                    fromUser: 'SYSTEM',
                    toUser: adminUsername,
                    note: `Verification Fee from ${targetUser}`,
                    timestamp: Date.now()
                });
            }

            // 4. แจ้งเตือนยอดเงินแอดมิน
            const adminData = await usersCollection.findOne({ username: adminUsername });
            io.to(adminUsername).emit('balance-update', { 
                user: adminUsername, 
                coins: adminData.coins 
            });

            // 5. ✅ เพิ่มการแจ้งเตือนใน "กล่องข้อความ" (ช่องแชท)
            if (typeof messagesCollection !== 'undefined') {
                const approveMsg = {
                    sender: 'System',
                    target: targetUser,
                    msgKey: 'VERIFY_SUCCESS', // สำหรับแปลภาษา
                    msg: `✅ SYSTEM: Your identity has been verified by Admin: ${adminUsername}. You are now a Verified Member!`,
                    timestamp: Date.now(),
                    isSystem: true,
                    isRead: false
                };
                await messagesCollection.insertOne(approveMsg);
                // ส่ง Socket ให้สมาชิกเห็นในแชททันที
                io.to(targetUser).emit('private-message', { ...approveMsg, to: targetUser });
            }

            // แจ้งสมาชิกผ่าน Alert/Popup
            io.to(targetUser).emit('verify-result', { success: true, message: "Identity Verified Successfully!" });

            callback({ success: true });

        } else {
            // --- ❌ กรณี REJECT (ปฏิเสธ) ---
            
            // 1. อัปเดตสถานะกลับไปเริ่มต้น (Step 0) เพื่อให้กรอกใหม่
            await usersCollection.updateOne(
                { username: targetUser },
                { $set: { verifyStep: 0 } }
            );

            // 2. ✅ แจ้งเตือนใน "กล่องข้อความ" ถึงเหตุผลที่ไม่ผ่าน
            if (typeof messagesCollection !== 'undefined') {
                const rejectMsg = {
                    sender: 'System',
                    target: targetUser,
                    msgKey: 'VERIFY_REJECTED',
                    msg: `❌ SYSTEM: Verification Rejected by Admin. Reason: ${reason}. Please update your profile and try again.`,
                    timestamp: Date.now(),
                    isSystem: true,
                    isRead: false
                };
                await messagesCollection.insertOne(rejectMsg);
                io.to(targetUser).emit('private-message', { ...rejectMsg, to: targetUser });
            }

            // แจ้งสมาชิกผ่าน Alert/Popup
            io.to(targetUser).emit('verify-result', { success: false, message: `Rejected: ${reason}` });

            callback({ success: true });
        }
    } catch (err) {
        console.error(err);
        callback({ success: false, message: "Error" });
    }
});


	
	socket.on('update-admin-live-location', async (coords) => {
    if (!socket.username) return;
    await usersCollection.updateOne(
        { username: socket.username },
        { $set: { currentLocation: coords } }
    );
});

//***
	socket.on('update-live-location', async (data) => {
    try {
        const { postId, coords, role } = data;

        if (!socket.username || !coords) {
            return;
        }

        // 1. บันทึกลง Database
        const updateResult = await usersCollection.updateOne(
            { username: socket.username },
            { $set: { 
                lastLocation: coords, 
                currentLocation: coords, 
                locationTimestamp: Date.now() 
            } }
        );
        

        // 2. ถ้าเป็นเจ้าของกระทู้ ให้ส่งพิกัดนี้ไปให้คนอื่นในห้อง
        if (role === 'owner') {
            
            // ใช้ io.to(postId) แทน socket.to(postId) เพื่อความชัวร์ในการส่ง
            // หรือตรวจสอบว่าผู้รับงานได้ join room ที่ชื่อเดียวกับ postId หรือยัง
            socket.to(postId.toString()).emit('update-owner-location', coords);
            
        } else {
            console.log(`ℹ️ Role is ${role}, no broadcast needed to worker.`);
        }

    } catch (err) {
        console.error("❌ Location update error:", err);
    }
});




	




});

// --- Initial Tasks ---
fetchLiveExchangeRates();
setInterval(fetchLiveExchangeRates, 7200000);

const PORT = process.env.PORT || 3000;

// 1. สั่งให้ Server เริ่มทำงาน (Listen) เพียงที่เดียวตรงนี้
server.listen(PORT, async () => {
    console.log(`🚀 GedGoZone Server is running on http://localhost:${PORT}`);
    
    // 2. เมื่อ Server รันแล้ว ค่อยสั่งเชื่อมต่อ Database
    await connectDB();
});