const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

// 🔴 הנתיב הותאם לפי השגיאה הקודמת שלך. ודא שזה הנתיב הנכון:
const STORAGE_ROOT = 'F:/shs'; 

const db = new Database('archive.db');

function scanAndRestore(dir) {
    let count = 0;
    if (!fs.existsSync(dir)) return count;
    
    const uploadsDir = path.join(STORAGE_ROOT, 'uploads');
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
        const fullPath = path.join(dir, item);
        
        try {
            if (fs.statSync(fullPath).isDirectory()) {
                count += scanAndRestore(fullPath);
            } else {
                const ext = path.extname(item).toLowerCase();
                // סינון מדיה בלבד
                if (['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.mxf'].includes(ext) && !item.startsWith('thumb_') && !item.startsWith('stream_')) {
                    
                    const absolutePath = fullPath.replace(/\\/g, '/');
                    const relativePath = 'storage/' + path.relative(STORAGE_ROOT, fullPath).replace(/\\/g, '/');
                    const fileHash = item.replace(ext, '');
                    
                    // חילוץ חכם של נתוני התיוג מתוך הנתיב (לפי מבנה השמירה של השרת)
                    const relDir = path.relative(uploadsDir, dir); // ייראה למשל ככה: 2026\ביסט\חניכים\180\שם האירוע
                    const parts = relDir.split(path.sep);
                    
                    let activeYear = parts.length > 0 ? parts[0] : '';
                    let eventName = parts.length > 0 ? parts[parts.length - 1] : 'ללא שם';
                    let framework = parts.length > 2 ? parts[1] : '';
                    let population = parts.length > 3 ? parts[2] : '';
                    let courseNumber = parts.length > 4 ? parts[3] : '';

                    const mimeType = ['.mp4', '.mov', '.mxf'].includes(ext) ? 'video/mp4' : 'image/jpeg';
                    
                    // בדיקה אם קיימת כבר תמונה ממוזערת
                    const thumbPath = fs.existsSync(path.join(dir, `thumb_${fileHash}.jpg`)) 
                        ? 'storage/' + path.relative(STORAGE_ROOT, path.join(dir, `thumb_${fileHash}.jpg`)).replace(/\\/g, '/') 
                        : null;

                    const insert = db.prepare(`
                        INSERT OR IGNORE INTO files 
                        (id, fileHash, originalName, mimeType, path, absolutePath, eventName, activeYear, framework, population, courseNumber, thumbnailPath, processingStatus, isBackedUp)
                        VALUES (@id, @fileHash, @originalName, @mimeType, @path, @absolutePath, @eventName, @activeYear, @framework, @population, @courseNumber, @thumbnailPath, 'done', 0)
                    `);

                    const info = insert.run({
                        id: uuidv4(),
                        fileHash: fileHash,
                        originalName: item,
                        mimeType: mimeType,
                        path: relativePath,
                        absolutePath: absolutePath,
                        eventName: eventName,
                        activeYear: activeYear,
                        framework: framework,
                        population: population,
                        courseNumber: courseNumber,
                        thumbnailPath: thumbPath
                    });
                    
                    if (info.changes > 0) count++;
                }
            }
        } catch (err) {
            console.error(`❌ שגיאה בסריקת הקובץ ${fullPath}:`, err.message);
        }
    }
    return count;
}

console.log(`🔍 מתחיל סריקה ושחזור מהנתיב: ${STORAGE_ROOT}...`);

const uploadsDir = path.join(STORAGE_ROOT, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    console.error(`❌ תיקיית ${uploadsDir} לא נמצאה! אנא ודא שהנתיב STORAGE_ROOT בקוד מעלה מדויק.`);
} else {
    const restored = scanAndRestore(uploadsDir);
    console.log(`✅ סריקה הסתיימה. שוחזרו ${restored} קבצים בהצלחה למסד הנתונים! חזור לגלריה כדי לראות את התוצאות.`);
}