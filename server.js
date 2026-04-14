const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const Datastore = require('@seald-io/nedb');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const checkDiskSpace = require('check-disk-space').default;

// --- CONFIGURATION ---
const SERVER_IP = '10.8.52.22';
const SHARED_FOLDER_PATH = 'Z:';
let STORAGE_ROOT = 'C:/MyArchiveData';
let BACKUP_ROOT = 'D:/BackupArchive';
const ADMIN_PASSWORD = '123';
const APP_USERNAME = 'queen';
const APP_PASSWORD = 'bist';

let SESSION_TOKEN = uuidv4();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- DATABASE INIT ---
const Database = require('better-sqlite3');
const db = new Database('archive.db');

// יצירת הטבלה אם היא לא קיימת
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    fileHash TEXT,
    originalName TEXT,
    mimeType TEXT,
    path TEXT,
    absolutePath TEXT,
    eventName TEXT,
    activeYear TEXT,
    month TEXT,
    framework TEXT,
    population TEXT,
    courseNumber TEXT,
    courseStage TEXT,
    photographer TEXT,
    description TEXT,
    period TEXT,
    processingStatus TEXT,
    isBackedUp INTEGER DEFAULT 0,
    uploadDate TEXT,
    streamPath TEXT,
    thumbnailPath TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_event ON files(eventName);
  CREATE INDEX IF NOT EXISTS idx_year ON files(activeYear);
  CREATE INDEX IF NOT EXISTS idx_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_stream ON files(streamPath);
`);

// יצירת אינדקסים - מאיץ את טעינת התמונות פי 100!

const settingsDb = new Datastore({ filename: 'settings.db', autoload: true });
const ipsDb = new Datastore({ filename: 'allowed_ips.db', autoload: true });
const ARCHIVE_FOLDER_NAME = 'MyArchiveData';

// --- IP MANAGEMENT ---
let dynamicAllowedIps = ['127.0.0.1', '10.8.52.22'];

ipsDb.find({}, (err, docs) => {
    if (!err) docs.forEach(doc => {
        if (!dynamicAllowedIps.includes(doc.ip)) dynamicAllowedIps.push(doc.ip);
    });
});

// טעינת הגדרות ראשוניות
settingsDb.findOne({ key: 'config' }, (err, doc) => {
    if (doc) {
        if (doc.storage_root) STORAGE_ROOT = doc.storage_root;
        if (doc.backup_root) BACKUP_ROOT = doc.backup_root;
    }
});

const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
ffmpeg.setFfmpegPath(ffmpegPath);

const processingQueue = [];
let activeProcessors = 0;
const MAX_CONCURRENT = 2; // מקסימום 2 עיבודים במקביל

async function addToQueue(item) {
    processingQueue.push(item);
    processNext();
}

async function processNext() {
    if (activeProcessors >= MAX_CONCURRENT || processingQueue.length === 0) return;

    activeProcessors++;
    const item = processingQueue.shift();

    try {
        await processMediaInBackground(item);
    } catch (err) {
        console.error("Error processing:", err);
    } finally {
        activeProcessors--;
        processNext();
    }
}

// --- MIDDLEWARES ---
const protectApi = (req, res, next) => {
    try {
        const userToken = req.query.token || req.headers['x-access-token'];
        if (userToken && userToken === SESSION_TOKEN) {
            next();
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Auth Error' });
    }
};

async function registerDrive(drivePath, type = 'source') {
    const exists = await settingsDb.findOneAsync({ path: drivePath });
    if (!exists) {
        await settingsDb.insertAsync({ path: drivePath, type: type, addedAt: new Date() });
    }
}

async function buildDatabaseFromDrives() {
    console.log("🔍 מתחיל סריקה של כוננים ותיקיית ההעלאות...");

    // שליפת כוננים שהוגדרו כ'source' בלבד
    const drives = await settingsDb.findAsync({ type: 'source' });
    let totalLoaded = 0;

    // איפוס מסד הנתונים בזיכרון לפני הטעינה מחדש
    // יצירת רשימת נתיבים לסריקה - ונוודא שתיקיית ההעלאות תמיד בפנים!
    const pathsToScan = new Set(drives.map(d => d.path));
    pathsToScan.add(STORAGE_ROOT); // <--- התוספת הקריטית

    for (const scanPath of pathsToScan) {
        if (fs.existsSync(scanPath)) {
            console.log(`📂 סורק נתיב: ${scanPath}`);
            const count = await scanDir(scanPath);
            totalLoaded += count;
        } else {
            console.log(`⚠️ נתיב לא נמצא: ${scanPath}`);
        }
    }
    console.log(`✅ הסריקה הושלמה. נטענו ${totalLoaded} קבצים.`);
}

// פונקציית העזר לסריקת הקבצים (מחפשת .meta.json)
async function scanDir(dir) {
    let count = 0;
    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            count += await scanDir(fullPath);
        } else if (item.endsWith('.meta.json')) {
            const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            const actualFile = fullPath.replace('.meta.json', '');

            if (fs.existsSync(actualFile)) {
                meta.absolutePath = actualFile.replace(/\\/g, '/');
                delete meta._id; // יצירת מזהה חדש בזיכרון
                const insertStmt = db.prepare(`
                    INSERT OR IGNORE INTO files (id, fileHash, originalName, mimeType, path, absolutePath, uploadDate, framework, population, courseNumber, courseStage, eventName, photographer, period, activeYear, month, description, processingStatus, isBackedUp)
                    VALUES (@id, @fileHash, @originalName, @mimeType, @path, @absolutePath, @uploadDate, @framework, @population, @courseNumber, @courseStage, @eventName, @photographer, @period, @activeYear, @month, @description, @processingStatus, @isBackedUp)
                `);

                insertStmt.run({
                    id: meta.id || require('uuid').v4(),
                    fileHash: meta.fileHash || '',
                    originalName: meta.originalName || '',
                    mimeType: meta.mimeType || '',
                    path: meta.path || '',
                    absolutePath: meta.absolutePath || '',
                    uploadDate: meta.uploadDate || new Date().toISOString(),
                    framework: meta.framework || '',
                    population: meta.population || '',
                    courseNumber: meta.courseNumber || '',
                    courseStage: meta.courseStage || '',
                    eventName: meta.eventName || 'ללא שם',
                    photographer: meta.photographer || '',
                    period: meta.period || '',
                    activeYear: meta.activeYear || '',
                    month: meta.month || '',
                    description: meta.description || '',
                    processingStatus: meta.processingStatus || 'done',
                    isBackedUp: meta.isBackedUp || 0
                }); count++;
            }
        }
    }
    return count;
}


const ipFilter = (req, res, next) => {
    const clientIp = req.ip.replace('::ffff:', '');
    if (dynamicAllowedIps.includes(clientIp)) {
        next();
    } else {
        console.warn(`Blocked unauthorized IP: ${clientIp}`);
        res.status(403).send('<h1>Access Denied</h1>');
    }
};

app.use(ipFilter);

// --- STATIC FILES SERVING ---
app.use('/storage', protectApi, async (req, res) => {
    let requestedPath = req.path.replace(/^[\/\\]?storage[\/\\]?/, '/');
    try { requestedPath = decodeURIComponent(requestedPath); } catch (e) { }

    const searchPath = `storage${requestedPath}`;
    const fileDoc = db.prepare(`
        SELECT * FROM files 
        WHERE path = ? OR thumbnailPath = ? OR streamPath = ?
    `).get(searchPath, searchPath, searchPath);

    if (fileDoc && fileDoc.absolutePath) {
        let finalPath = fileDoc.absolutePath;
        if (requestedPath.includes('thumb_')) {
            finalPath = path.join(path.dirname(fileDoc.absolutePath), path.basename(requestedPath));
        } else if (requestedPath.includes('stream_')) {
            finalPath = path.join(path.dirname(fileDoc.absolutePath), path.basename(requestedPath));
        }
        if (fs.existsSync(finalPath)) return res.sendFile(finalPath);
    }

    const fallbackPath = path.join(STORAGE_ROOT, requestedPath);
    if (fs.existsSync(fallbackPath)) return res.sendFile(fallbackPath);

    res.status(404).send('File not found');
});

// --- API ROUTES ---

app.get('/api/files', protectApi, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;


        // שימוש בשאילתת SQL במקום findAsync
        const files = db.prepare('SELECT * FROM files ORDER BY activeYear DESC, month DESC').all();

        res.json(files);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB Error' });
    }
});

// נתיב להוספת כונן לרשימה (מקור או גיבוי)
app.post('/api/admin/add-drive', protectApi, async (req, res) => {
    const { path: drivePath, type } = req.body;
    if (!drivePath || !type) return res.status(400).json({ error: 'Missing data' });

    try {
        // בדיקה אם הכונן כבר קיים ברשימה
        const exists = await settingsDb.findOneAsync({ path: drivePath, type: type });
        if (!exists) {
            await settingsDb.insertAsync({ path: drivePath, type: type, addedAt: new Date() });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add drive' });
    }
});

// --- UPLOAD ---
app.post('/api/upload', protectApi, multer({ dest: path.join(STORAGE_ROOT, 'temp') }).single('file'), async (req, res) => {
    const file = req.file;
    const { framework, population, courseNumber, courseStage, eventName, activeYear, month, photographer, force, period, description } = req.body;
    const sentPassword = req.headers['x-admin-password'];

    if (sentPassword !== ADMIN_PASSWORD) {
        if (file) fs.unlinkSync(file.path);
        return res.status(403).json({ error: 'Wrong Password' });
    }

    try {
        const fileHash = await getFileHash(file.path);

        if (force !== 'true') {
            const existing = db.prepare('SELECT * FROM files WHERE fileHash = ?').get(fileHash);
            if (existing) {
                fs.unlinkSync(file.path);
                return res.status(409).json({ message: 'Exists', existingId: existing.id });
            }
        }

        const sanitizeFolder = (name) => name.replace(/[<>:"/\\|?*]/g, '');

        const yearFolder = activeYear || new Date().getFullYear().toString();
        let folderHierarchy = [STORAGE_ROOT, 'uploads', yearFolder];

        // עטוף כל משתנה בפונקציית הניקוי
        if (framework) folderHierarchy.push(sanitizeFolder(framework));
        if (population) folderHierarchy.push(sanitizeFolder(population));
        if (courseNumber) folderHierarchy.push(sanitizeFolder(courseNumber));
        if (eventName) folderHierarchy.push(sanitizeFolder(eventName));

        const finalDir = path.join(...folderHierarchy);
        if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

        // שמירה זמנית של הקובץ המקורי (ללא עיבוד sharp מיידי)
        const ext = path.extname(file.originalname).toLowerCase();
        let finalFilename = `${fileHash}${ext}`;
        let finalPath = path.join(finalDir, finalFilename);

        // טיפול ב-EXDEV (העברה בין כוננים) כפי שביקשת קודם
        try {
            fs.renameSync(file.path, finalPath);
        } catch (err) {
            if (err.code === 'EXDEV') {
                fs.copyFileSync(file.path, finalPath);
                fs.unlinkSync(file.path);
            } else { throw err; }
        }

        const relativePath = path.relative(STORAGE_ROOT, finalPath).replace(/\\/g, '/');
        let mimeType = file.mimetype;

        const newItem = {
            id: uuidv4(), // יצירת ID ידני ל-SQLite
            fileHash,
            originalName: file.originalname,
            mimeType,
            path: `storage/${relativePath}`,
            absolutePath: finalPath,
            uploadDate: new Date().toISOString(),
            framework: framework || '',
            population: population || '',
            courseNumber: courseNumber || '',
            courseStage: req.body.courseStage || '',
            eventName: eventName || 'ללא שם',
            photographer: photographer || '',
            period: period || '',
            activeYear: activeYear || '',
            month: month || '',
            description: description || '',
            processingStatus: 'pending',
            isBackedUp: 0
        };

        // הכנסה ל-SQLite
        const insert = db.prepare(`
            INSERT INTO files (id, fileHash, originalName, mimeType, path, absolutePath, uploadDate, framework, population, courseNumber, courseStage, eventName, photographer, period, activeYear, month, description, processingStatus, isBackedUp)
            VALUES (@id, @fileHash, @originalName, @mimeType, @path, @absolutePath, @uploadDate, @framework, @population, @courseNumber, @courseStage, @eventName, @photographer, @period, @activeYear, @month, @description, @processingStatus, @isBackedUp)
        `);

        insert.run(newItem);

        addToQueue(newItem); // הוספה לתור העיבוד
        res.json({ success: true, id: newItem.id });
    } catch (e) {
        console.error(e);
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        res.status(500).json({ error: 'Upload Failed' });
    }
});

// --- ADMIN & STORAGE ROUTES ---



// Helper function to get disk space safely
async function getDiskInfo(drivePath) {
    if (!drivePath) return { freeGB: 0, totalGB: 0, percent: 0, status: 'unknown' };
    try {
        const root = path.parse(drivePath).root;
        const info = await checkDiskSpace(root);
        return {
            path: drivePath,
            freeGB: (info.free / (1024 ** 3)).toFixed(1),
            totalGB: (info.size / (1024 ** 3)).toFixed(1),
            percent: ((info.free / info.size) * 100).toFixed(1),
            status: 'online'
        };
    } catch (e) {
        return { path: drivePath, freeGB: 0, totalGB: 0, percent: 0, status: 'offline' };
    }
}

app.get('/api/admin/storage-settings', protectApi, async (req, res) => {
    try {
        // שליפת הגדרות והיסטוריה
        const settings = await settingsDb.findOneAsync({ key: 'config' }) || {};
        const pastStorage = settings.storage_history || [];
        const pastBackup = settings.backup_history || [];

        // 1. מידע על כונן ראשי נוכחי
        const currentSpace = await getDiskInfo(STORAGE_ROOT);

        // 2. מידע על כונן גיבוי נוכחי
        const backupSpaceInfo = await getDiskInfo(BACKUP_ROOT);

        // 3. מידע על היסטוריית כונני העלאה
        // מוסיפים גם כוננים שיש להם קבצים ב-DB אבל אולי לא בהיסטוריה
        const allFiles = db.prepare('SELECT * FROM files').all();
        const fileDrives = [...new Set(allFiles.map(f => f.absolutePath ? path.parse(f.absolutePath).root : null))].filter(Boolean);
        const unifiedStorageHistory = [...new Set([...pastStorage, ...fileDrives])];

        const storageHistoryInfo = await Promise.all(unifiedStorageHistory.map(p => getDiskInfo(p)));

        // 4. מידע על היסטוריית כונני גיבוי
        const backupHistoryInfo = await Promise.all(pastBackup.map(p => getDiskInfo(p)));

        res.json({
            currentPath: STORAGE_ROOT,
            backupPath: BACKUP_ROOT,
            currentSpace,
            backupSpace: backupSpaceInfo, // תיקון ה-NaN
            storageHistory: storageHistoryInfo,
            backupHistory: backupHistoryInfo
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch storage info' });
    }
});

app.post('/api/admin/change-drive', protectApi, async (req, res) => {
    const { newPath, adminPassword } = req.body;
    if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Password' });
    if (!newPath) return res.status(400).json({ error: 'Path is required' });

    try {
        const normalizedPath = path.resolve(newPath).replace(/\\/g, '/');
        if (!fs.existsSync(normalizedPath)) fs.mkdirSync(normalizedPath, { recursive: true });

        // שמירת הכונן הישן להיסטוריה לפני העדכון
        await settingsDb.updateAsync(
            { key: 'config' },
            { $addToSet: { storage_history: STORAGE_ROOT } },
            { upsert: true }
        );

        STORAGE_ROOT = normalizedPath;

        // עדכון הכונן החדש
        await settingsDb.updateAsync(
            { key: 'config' },
            { $set: { storage_root: STORAGE_ROOT, last_updated: new Date() } },
            { upsert: true }
        );

        res.json({ success: true, currentPath: STORAGE_ROOT });
    } catch (err) {
        res.status(500).json({ error: 'Failed to change storage path' });
    }
});

// --- נתיב העברת נתונים בין כוננים (מיגרציה) ---
app.post('/api/admin/migrate-drive', protectApi, async (req, res) => {
    const { oldDrive, newDrive, adminPassword } = req.body;
    if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Password' });
    if (!oldDrive || !newDrive) return res.status(400).json({ error: 'Missing paths' });

    try {
        const normalizedOld = path.resolve(oldDrive).replace(/\\/g, '/');
        const normalizedNew = path.resolve(newDrive).replace(/\\/g, '/');

        if (normalizedOld === normalizedNew) return res.status(400).json({ error: 'Same path' });

        // מציאת כל הקבצים שיושבים פיזית בכונן הישן
        const allFiles = db.prepare('SELECT * FROM files').all();
        const filesToMove = allFiles.filter(f => f.absolutePath && f.absolutePath.replace(/\\/g, '/').startsWith(normalizedOld));

        let movedCount = 0;

        // פונקציית עזר להעתקה ומחיקה אסינכרונית (כדי לא לתקוע את השרת בזמן העברה ארוכה)
        const copyAndDel = async (src, dest) => {
            if (fs.existsSync(src)) {
                const dir = path.dirname(dest);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                await fs.promises.copyFile(src, dest);
                await fs.promises.unlink(src); // מחיקת המקור לאחר ההעתקה
            }
        };

        for (const f of filesToMove) {
            const oldAbs = f.absolutePath.replace(/\\/g, '/');
            const newAbs = oldAbs.replace(normalizedOld, normalizedNew);

            // 1. העברת הקובץ המקורי
            await copyAndDel(oldAbs, newAbs);

            // 2. העברת התמונה הממוזערת (Thumb) אם קיימת
            if (f.thumbnailPath) {
                const thumbName = path.basename(f.thumbnailPath);
                await copyAndDel(path.join(path.dirname(oldAbs), thumbName), path.join(path.dirname(newAbs), thumbName));
            }

            // 3. העברת סרטון הסטרימינג (Stream) אם קיים
            if (f.streamPath) {
                const streamName = path.basename(f.streamPath);
                await copyAndDel(path.join(path.dirname(oldAbs), streamName), path.join(path.dirname(newAbs), streamName));
            }

            // 4. עדכון הנתיב המוחלט במסד הנתונים
            await db.updateAsync({ _id: f._id }, { $set: { absolutePath: newAbs } });
            movedCount++;
        }

        // עדכון היסטוריית הכוננים: מחיקת הישן והוספת החדש
        await settingsDb.updateAsync({ key: 'config' }, { $pull: { storage_history: normalizedOld } });
        await settingsDb.updateAsync({ key: 'config' }, { $addToSet: { storage_history: normalizedNew } }, { upsert: true });

        // אם הכונן הישן היה מוגדר ככונן ההעלאות הראשי הנוכחי, נחליף גם אותו
        if (STORAGE_ROOT === normalizedOld) {
            STORAGE_ROOT = normalizedNew;
            await settingsDb.updateAsync({ key: 'config' }, { $set: { storage_root: STORAGE_ROOT } });
        }

        res.json({ success: true, message: 'Migration started in background' });
        runMigrationTask(filesToMove, normalizedOld, normalizedNew);
    } catch (e) {
        console.error("Migration error: ", e);
        res.status(500).json({ error: 'Migration failed' });
    }
});

app.post('/api/admin/save-backup-path', protectApi, async (req, res) => {
    const { newBackupPath, adminPassword } = req.body;
    if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Password' });

    try {
        const normalized = path.resolve(newBackupPath).replace(/\\/g, '/');
        if (!fs.existsSync(normalized)) fs.mkdirSync(normalized, { recursive: true });

        // שמירת הכונן הישן להיסטוריה
        await settingsDb.updateAsync(
            { key: 'config' },
            { $addToSet: { backup_history: BACKUP_ROOT } },
            { upsert: true }
        );

        BACKUP_ROOT = normalized;

        await settingsDb.updateAsync(
            { key: 'config' },
            { $set: { backup_root: BACKUP_ROOT } },
            { upsert: true }
        );

        res.json({ success: true, backupPath: BACKUP_ROOT });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.post('/api/admin/run-backup', protectApi, async (req, res) => {
    const { backupPath, onlyNewFiles } = req.body;

    if (backupPath) BACKUP_ROOT = backupPath;

    try {
        if (!fs.existsSync(BACKUP_ROOT)) fs.mkdirSync(BACKUP_ROOT, { recursive: true });

        const query = onlyNewFiles ? { $or: [{ isBackedUp: false }, { isBackedUp: { $exists: false } }] } : {};
        const filesToBackup = await db.findAsync(query);

        let copied = 0;

        for (const file of filesToBackup) {
            if (file.absolutePath && fs.existsSync(file.absolutePath)) {

                let relativeStructure = '';
                if (file.absolutePath.includes('uploads')) {
                    relativeStructure = file.absolutePath.split('uploads')[1];
                } else {
                    relativeStructure = path.basename(file.absolutePath);
                }

                if (relativeStructure.startsWith('\\') || relativeStructure.startsWith('/')) {
                    relativeStructure = relativeStructure.substring(1);
                }

                const destPath = path.join(BACKUP_ROOT, relativeStructure);
                const destDir = path.dirname(destPath);

                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(file.absolutePath, destPath);
                    copied++;
                    await db.updateAsync({ _id: file._id }, { $set: { isBackedUp: true } });
                } else {
                    await db.updateAsync({ _id: file._id }, { $set: { isBackedUp: true } });
                }
            }
        }
        res.json({ success: true, copied });
    } catch (err) {
        console.error("Backup error:", err);
        res.status(500).json({ error: 'Backup failed' });
    }
});

app.post('/api/admin/check-path-info', protectApi, async (req, res) => {
    const { targetPath } = req.body;
    try {
        const info = await getDiskInfo(targetPath);
        res.json(info);
    } catch (err) {
        res.json({ freeGB: 0, totalGB: 0, percent: 0 });
    }
});

app.post('/api/admin/refresh-drives', protectApi, async (req, res) => {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Password' });

    // מוחק את מסד הנתונים מהזיכרון, וסורק הכל מחדש מהכוננים שמחוברים עכשיו!
    db.prepare('DELETE FROM files').run();
    await buildDatabaseFromDrives();

    res.json({ success: true });
});
// --- שאר הפונקציות (IP, DELETE...) ---
app.get('/api/admin/ips', protectApi, (req, res) => {
    ipsDb.find({}, (err, docs) => {
        if (err) return res.status(500).json({ error: 'DB Error' });
        const savedIps = docs.map(d => d.ip);
        const allIps = [...new Set([...dynamicAllowedIps, ...savedIps])];
        res.json(allIps);
    });
});

app.post('/api/admin/check-and-add-ip', protectApi, async (req, res) => {
    const { newIp, adminPassword } = req.body;
    if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Pass' });
    const existing = await ipsDb.findOneAsync({ ip: newIp });
    if (existing || dynamicAllowedIps.includes(newIp)) return res.json({ exists: true });
    await ipsDb.insertAsync({ ip: newIp, addedDate: new Date() });
    dynamicAllowedIps.push(newIp);
    res.json({ success: true });
});

app.post('/api/admin/delete-ip', protectApi, async (req, res) => {
    const { ip, adminPassword } = req.body;
    if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Pass' });
    await ipsDb.removeAsync({ ip: ip }, { multi: true });
    dynamicAllowedIps = dynamicAllowedIps.filter(item => item !== ip);
    res.json({ success: true });
});

app.delete('/api/event', protectApi, async (req, res) => {
    const { eventName } = req.query;
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Pass' });
    try {
        const eventFiles = await db.findAsync({ eventName });
        for (const file of eventFiles) {
            if (fs.existsSync(file.absolutePath)) fs.unlinkSync(file.absolutePath);
        }
        await db.removeAsync({ eventName }, { multi: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Delete failed' }); }
});

app.put('/api/event/rename', protectApi, async (req, res) => {
    const { oldName, newName } = req.body;
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Pass' });
    await db.updateAsync({ eventName: oldName }, { $set: { eventName: newName } }, { multi: true });
    res.json({ success: true });
});

app.post('/api/files/move', protectApi, async (req, res) => {
    const { ids, newEventName } = req.body;
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Pass' });
    await db.updateAsync({ _id: { $in: ids } }, { $set: { eventName: newEventName } }, { multi: true });
    res.json({ success: true });
});

app.post('/api/files/batch-delete', protectApi, async (req, res) => {
    const { ids } = req.body;
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Wrong Pass' });
    const placeholders = ids.map(() => '?').join(',');
    const files = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...ids);
    for (const f of files) { if (fs.existsSync(f.absolutePath)) fs.unlinkSync(f.absolutePath); }
    db.prepare(`DELETE FROM files WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true });
});

app.post('/api/download-zip', protectApi, async (req, res) => {
    const { fileIds } = req.body;
    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment('archive.zip');
    archive.pipe(res);
    for (const id of fileIds) {
        const doc = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
        if (doc && fs.existsSync(doc.absolutePath)) {
            archive.file(doc.absolutePath, { name: doc.originalName });
        }
    }
    archive.finalize();
});

function getFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('data', d => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

// פונקציה לגיבוי שבועי
async function runWeeklyBackup() {
    const sources = await settingsDb.findAsync({ type: 'source' });
    const backups = await settingsDb.findAsync({ type: 'backup' });

    if (sources.length === 0 || backups.length === 0) return;

    console.log("🛡️ מתחיל גיבוי שבועי...");
    for (const src of sources) {
        for (const target of backups) {
            // לוגיקת העתקה (בדיקה אם הקובץ קיים בגיבוי לפני העתקה)
            // ניתן להשתמש ב-fs.copyFileSync או בספרייה כמו 'fs-extra'
        }
    }
}

// הפעלה כל 7 ימים
setInterval(runWeeklyBackup, 7 * 24 * 60 * 60 * 1000);

function copyRecursiveSync(src, dest) {
    if (!fs.existsSync(src)) return;
    if (fs.statSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(child => copyRecursiveSync(path.join(src, child), path.join(dest, child)));
    } else {
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
}

// הגדרת הטיימר - פעם בשבוע (במילישניות)
setInterval(runWeeklyBackup, 7 * 24 * 60 * 60 * 1000);

function createAccessFile() {
    const fileContent = `<html><body style="background:#222;color:white;text-align:center;padding-top:50px"><h1>Loading...</h1><script>window.location.href="http://${SERVER_IP}:${PORT}/?token=${SESSION_TOKEN}";</script></body></html>`;
    if (fs.existsSync(SHARED_FOLDER_PATH)) fs.writeFileSync(path.join(SHARED_FOLDER_PATH, 'Open_Archive.html'), fileContent);
}

const clientBuildPath = path.join(__dirname, 'archive-client', 'build');

console.log('--- Client Serving Debug ---');
console.log('Looking for build at:', clientBuildPath);

if (fs.existsSync(clientBuildPath)) {
    app.use(express.static(clientBuildPath));
}

try {
    if (fs.existsSync('files_archive.db')) {
        const fileContent = fs.readFileSync('files_archive.db', 'utf8');
        // NeDB הוא NDJSON - כל שורה היא אובייקט JSON נפרד
        const oldData = fileContent.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));

        const insert = db.prepare(`
            INSERT OR IGNORE INTO files (id, originalName, absolutePath, streamPath, thumbnailPath, processingStatus, mimeType, eventName, activeYear) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const transaction = db.transaction((data) => {
            for (const item of data) {
                insert.run(
                    item._id,
                    item.originalName,
                    item.absolutePath,
                    item.streamPath || null,
                    item.thumbnailPath || null,
                    item.processingStatus || 'done',
                    item.mimeType || null,
                    item.eventName || 'ללא שם',
                    item.activeYear || ''
                );
            }
        });

        transaction(oldData);
        console.log("✅ הנתונים הועברו בהצלחה ל-SQLite");
        // מומלץ לשנות את שם הקובץ הישן כדי שלא ירוץ שוב בכל הפעלה
        fs.renameSync('files_archive.db', 'files_archive.db.backup');
    }
} catch (e) {
    console.error("❌ שגיאה בתהליך ההגירה:", e.message);
}

app.get(/.*/, (req, res) => {
    const indexPath = path.join(clientBuildPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`
            <h1>Error 404: Build Not Found</h1>
            <p>The server looked for the website at: <br/> <code>${clientBuildPath}</code></p>
            <p>Please make sure you ran <code>npm run build</code> inside the archive-client folder.</p>
        `);
    }
});

// פונקציית עזר להרצת FFmpeg כ-Promise
function runFFmpeg(command) {
    return new Promise((resolve, reject) => {
        command
            .on('end', resolve)
            .on('error', (err) => {
                console.error("FFmpeg Error:", err.message);
                reject(err);
            })
            .run();
    });
}

async function processMediaInBackground(item) {
    try {
        const outputDir = path.dirname(item.absolutePath);
        const isVideo = item.mimeType.startsWith('video') || item.originalName.toLowerCase().endsWith('.mxf');

        if (isVideo) {
            const streamPath = path.join(outputDir, `stream_${item.fileHash}.mp4`);
            const thumbPath = path.join(outputDir, `thumb_${item.fileHash}.jpg`);

            console.log(`🎬 מתחיל עיבוד וידאו: ${item.originalName}`);

            // שלב 1: יצירת Thumbnail (פריים ראשון)
            await new Promise((resolve, reject) => {
                ffmpeg(item.absolutePath)
                    .on('end', resolve)
                    .on('error', reject)
                    .screenshots({
                        timestamps: ['00:00:01'],
                        filename: path.basename(thumbPath),
                        folder: path.dirname(thumbPath),
                        size: '320x?'
                    });
            });
            console.log(`📸 תמונה ממוזערת נוצרה עבור ${item.originalName}`);

            // שלב 2: המרת הווידאו לפורמט MP4 שמתאים לדפדפן
            const videoCommand = ffmpeg(item.absolutePath)
                .output(streamPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-pix_fmt yuv420p',
                    '-movflags faststart',
                    '-preset veryfast',
                    '-crf 23'
                ])
                .size('1280x?');

            await runFFmpeg(videoCommand);
            console.log(`✅ המרת וידאו הושלמה עבור ${item.originalName}`);

            // שלב 3: עדכון מסד הנתונים (SQLite) לאחר שהקבצים נוצרו
            if (fs.existsSync(streamPath) && fs.existsSync(thumbPath)) {
                const relStream = 'storage/' + path.relative(STORAGE_ROOT, streamPath).replace(/\\/g, '/');
                const relThumb = 'storage/' + path.relative(STORAGE_ROOT, thumbPath).replace(/\\/g, '/');

                const updateStmt = db.prepare(`
                    UPDATE files 
                    SET streamPath = ?, thumbnailPath = ?, processingStatus = 'done' 
                    WHERE id = ?
                `);
                updateStmt.run(relStream, relThumb, item.id);
            }

        } else if (item.mimeType.startsWith('image')) {
            const thumbPath = path.join(outputDir, `thumb_${item.fileHash}.jpg`);

            // עיבוד תמונה עם Sharp
            await sharp(item.absolutePath)
                .resize(400)
                .toFile(thumbPath);

            if (fs.existsSync(thumbPath)) {
                const relThumb = 'storage/' + path.relative(STORAGE_ROOT, thumbPath).replace(/\\/g, '/');

                // עדכון מסד הנתונים (SQLite)
                const updateImgStmt = db.prepare(`
                    UPDATE files 
                    SET thumbnailPath = ?, processingStatus = 'done' 
                    WHERE id = ?
                `);
                updateImgStmt.run(relThumb, item.id);
                console.log(`📸 תמונה ממוזערת נוצרה עבור ${item.originalName}`);
            }
        }
    } catch (e) {
        console.error(`❌ שגיאה בעיבוד המדיה עבור ${item.originalName}:`, e);
        throw e;
    }
}
// בתוך הקובץ server.js - עדכון פונקציית ה-listen בסוף הקובץ
app.listen(PORT, async () => {
    // יצירת תיקיית הבסיס ותיקיית temp אם הן לא קיימות
    const tempPath = path.join(STORAGE_ROOT, 'temp');
    if (!fs.existsSync(tempPath)) {
        fs.mkdirSync(tempPath, { recursive: true });
    }

    createAccessFile();
    console.log(`Server running at http://${SERVER_IP}:${PORT}`);

    // סריקה אוטומטית של כוננים רשומים בלבד
    // await buildDatabaseFromDrives();
});