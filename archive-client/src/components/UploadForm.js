import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

function UploadForm() {
    const [filesToUpload, setFilesToUpload] = useState([]);
    const [password, setPassword] = useState('');

    // נתוני תיוג
    const [framework, setFramework] = useState('כללי');
    const [population, setPopulation] = useState('');
    const [courseNumber, setCourseNumber] = useState('');
    const [courseStage, setCourseStage] = useState('');
    const [eventName, setEventName] = useState('');
    const [description, setDescription] = useState('');
    const [userDate, setUserDate] = useState('');

    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [logs, setLogs] = useState([]);
    const fileInputRef = useRef(null);

    const [photographer, setPhotographer] = useState('');
    const [existingEvents, setExistingEvents] = useState([]);
    const [allFiles, setAllFiles] = useState([]);

    const [activeYear, setActiveYear] = useState('');
    const [period, setPeriod] = useState(''); // תקופה 1 או 2
    const [month, setMonth] = useState('');
    const [storageData, setStorageData] = useState(null);

    const uploadFile = async (file, force = false) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('framework', framework);
        formData.append('population', population);
        formData.append('courseNumber', courseNumber);
        formData.append('courseStage', courseStage);
        formData.append('eventName', eventName);
        // userDate הוסר
        formData.append('activeYear', activeYear);
        formData.append('month', month); // שדה חדש
        formData.append('period', period);
        formData.append('photographer', photographer);
        formData.append('description', description);

        if (force) formData.append('force', 'true');

        return axios.post('http://10.8.52.22:3001/api/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                'x-admin-password': password,
            }
        });
    };

    useEffect(() => {
        axios.get('http://10.8.52.22:3001/api/admin/storage-settings', {
            headers: { 'x-access-token': localStorage.getItem('archive_token') }
        }).then(res => setStorageData(res.data))
            .catch(err => console.error("Failed to fetch storage info", err));
    }, []);

    // בדיקה אוטומטית של סיסמה
    useEffect(() => {
        const savedPass = localStorage.getItem('adminPass');
        if (savedPass) {
            setPassword(savedPass);
        }
    }, []);

    useEffect(() => {
        axios.get('http://10.8.52.22:3001/api/files', {
            headers: { 'x-access-token': localStorage.getItem('archive_token') }
        }).then(res => setAllFiles(res.data));
    }, []);

    // פונקציה שמחזירה אירועים ייחודיים לפי הקטגוריה שנבחרה
    const getFilteredEvents = () => {
        return [...new Set(allFiles
            .filter(f => {
                const matchFramework = f.framework === framework;
                if (framework === 'ביסט') {
                    const matchPop = f.population === population;
                    // הוסר התנאי של courseNumber כדי להציג את כל אירועי החניכים
                    return matchFramework && matchPop;
                }
                return matchFramework;
            })
            .map(f => f.eventName)
        )].filter(Boolean);
    };
    const handleFileSelect = (e) => {
        const rawFiles = Array.from(e.target.files);
        const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'mts', 'mps', 'mxf'];
        const validFiles = rawFiles.filter(file => {
            const extension = file.name.split('.').pop().toLowerCase();
            return allowedExtensions.includes(extension) && !file.name.startsWith('.');
        });

        const rejectedCount = rawFiles.length - validFiles.length;
        setFilesToUpload(validFiles);

        let logMsg = `✅ נמצאו ${validFiles.length} קבצים תקינים.`;
        if (rejectedCount > 0) logMsg += ` (סוננו ${rejectedCount} קבצים לא נתמכים)`;
        setLogs([logMsg]);
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (filesToUpload.length === 0) return alert('אין קבצים');
        if (!password) return alert('חסרה סיסמה');
        if (!activeYear) return alert('חסרה שנה');
        const currentFolderKey = `${eventName}|${activeYear || ''}|${population || ''}|${period || ''}|${month || ''}|${courseNumber || ''}|${courseStage || ''}`;
        setIsUploading(true);
        setProgress({ current: 0, total: filesToUpload.length });

        let successCount = 0;
        let failCount = 0;

        // הגדרת כמות העלאות מקביליות
        const MAX_CONCURRENT_UPLOADS = 3;
        const queue = [...filesToUpload];
        let activeUploads = 0;
        let finishedCount = 0;
        const folderExists = allFiles.some(f => {
            // 1. שם האירוע חייב להיות זהה (זהו הבסיס לתיקייה)
            if (f.eventName !== eventName) return false;

            // 2. שאר השדות: אם המשתמש מילא אותם בטופס, הם חייבים להתאים למה שיש בארכיון.
            // אם המשתמש השאיר שדה מסוים ריק - הבדיקה מתעלמת ממנו (כך שכל מה ש*כן* הוכנס, תואם).
            if (activeYear && String(f.activeYear) !== String(activeYear)) return false;
            if (framework && f.framework !== framework) return false;
            if (population && f.population !== population) return false;
            if (period && f.period !== period) return false;
            if (month && String(f.month) !== String(month)) return false;
            if (courseNumber && String(f.courseNumber) !== String(courseNumber)) return false;
            if (courseStage && f.courseStage !== courseStage) return false;
            if (description && f.description !== description) return false;

            // * צלם (photographer) לא נכלל בהשוואה, ולכן המערכת תתריע גם אם הצלם שונה.

            // אם עברנו את כל הבדיקות - יש התאמה!
            return true;
        });

        if (folderExists) {
            // מקפיצים התראה למשתמש לבחירת פעולה
            const wantsToMerge = window.confirm(
                `⚠️ שים לב: כבר קיימת תיקייה בשם "${eventName}" עם נתונים זהים בארכיון.\n\n` +
                `האם להוסיף את הקבצים החדשים לתיקייה הקיימת?\n\n` +
                `• לחץ 'אישור' (OK) כדי למזג את הקבצים אל תוך התיקייה הקיימת.\n` +
                `• לחץ 'ביטול' (Cancel) כדי לעצור ולשנות את שם האירוע (לדוגמה: "${eventName} חלק ב").`
            );

            if (!wantsToMerge) {
                return; // עוצרים את ההעלאה ונותנים למשתמש לשנות את השם בטופס
            }
            setIsUploading(true);
            setProgress({ current: 0, total: filesToUpload.length });
        }
        return new Promise((resolve) => {
            const next = async () => {
                if (queue.length === 0 && activeUploads === 0) {
                    finish();
                    return;
                }

                while (activeUploads < MAX_CONCURRENT_UPLOADS && queue.length > 0) {
                    const file = queue.shift();
                    activeUploads++;

                    uploadFile(file).then(() => {
                        successCount++;
                        setLogs(prev => [...prev, { type: 'success', msg: `✅ הועלה: ${file.name}` }]);
                    }).catch(err => {
                        failCount++;
                        // זיהוי כפילות מהשרת
                        if (err.response && err.response.status === 409) {
                            setLogs(prev => [...prev, { type: 'conflict', msg: `⚠️ כפילות: ${file.name} כבר קיים בארכיון`, file }]);
                        } else {
                            setLogs(prev => [...prev, { type: 'error', msg: `❌ נכשל: ${file.name}` }]);
                        }
                    }).finally(() => {
                        activeUploads--;
                        finishedCount++;
                        setProgress({ current: finishedCount, total: filesToUpload.length });
                        next(); // מושך את הקובץ הבא בתור
                    });
                }
            };

            const finish = () => {
                setIsUploading(false);
                setLogs(prev => [...prev, `🎉 סיום! הצליח: ${successCount}, נכשל: ${failCount}`]);
                setFilesToUpload([]);
                resolve();
            };

            next(); // התחלת התהליך
        });
    };

    return (
        <div style={{ maxWidth: '600px', margin: '20px auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', position: 'relative' }}>

            <h2>העלאת תיקייה לארכיון</h2>

            <form onSubmit={handleUpload}>
                <div style={{ marginBottom: '20px', padding: '15px', background: '#f9f9f9', border: '1px dashed #999' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>1. בחר תיקייה לסריקה:</label>
                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} webkitdirectory="true" directory="" multiple style={{ width: '100%' }} />
                    {filesToUpload.length > 0 && <p style={{ color: 'blue' }}>נבחרו {filesToUpload.length} קבצים</p>}
                </div>

                {filesToUpload.length > 0 && (
                    <>
                        <div style={{ marginBottom: '15px' }}>
                            <label>מסגרת:</label>
                            <select value={framework} onChange={(e) => setFramework(e.target.value)} style={{ width: '100%', padding: '5px' }}>
                                <option value="כללי">כללי</option>
                                <option value='בחא'>בח"א</option>
                                <option value="ביסט">ביסט</option>
                            </select>
                        </div>

                        {framework === 'ביסט' && (
                            <div style={{ marginBottom: '15px', paddingRight: '10px', borderRight: '2px solid #007bff' }}>
                                <label>אוכלוסייה:</label>
                                <select value={population} onChange={(e) => setPopulation(e.target.value)} style={{ width: '100%', padding: '5px' }}>
                                    <option value="">-- בחר --</option>
                                    <option value="סגל">סגל</option>
                                    <option value="אירועים ביסטים">אירועים ביסטים</option>
                                    <option value="חניכים">חניכים</option>
                                </select>

                                {population === 'חניכים' && (
                                    <div style={{ marginTop: '10px' }}>
                                        <label>מספר קורס:</label>
                                        <input type="number" value={courseNumber} onChange={(e) => setCourseNumber(e.target.value)} placeholder="180" style={{ width: '100%', padding: '5px' }} />
                                    </div>

                                )}
                                {courseNumber && (
                                    <div style={{ marginTop: '10px' }}>
                                        <label>שלב בקורס:</label>
                                        <select value={courseStage} onChange={(e) => setCourseStage(e.target.value)} style={{ width: '100%', padding: '5px' }}>
                                            <option value="">-- בחר --</option>
                                            <option value="מכין">מכין</option>
                                            <option value="בסיסי">בסיסי</option>
                                            <option value="ראשוני">ראשוני</option>
                                            <option value="מבואות">מבואות</option>
                                            <option value="מסלולים">מסלולים</option>
                                            <option value="מתקדם">מתקדם</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ marginBottom: '15px' }}>
                            <label>שם אירוע (בחר מהרשימה או הקלד חדש):</label>
                            <input
                                list="events-list"
                                value={eventName}
                                onChange={(e) => setEventName(e.target.value)}
                                placeholder="בחר או הקלד אירוע..."
                                style={{ width: '100%', padding: '5px' }}
                            />
                            <datalist id="events-list">
                                {getFilteredEvents().map(ev => <option key={ev} value={ev} />)}
                            </datalist>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <label>תיאור וטקסט חופשי:</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="לדוגמה: תגיות, שמות מפקדים, פירוט על האירוע..."
                                style={{ width: '100%', padding: '8px', minHeight: '60px', borderRadius: '4px', border: '1px solid #ccc' }}
                            />
                        </div>

                        {/* שדה חדש לשם צלם */}
                        <div style={{ marginBottom: '15px' }}>
                            <label>שם צלם:</label>
                            <input
                                type="text"
                                value={photographer}
                                onChange={(e) => setPhotographer(e.target.value)}
                                style={{ width: '100%', padding: '5px' }}
                            />
                        </div>

                        {/* שדה תאריך - כעת חובה */}
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ fontWeight: 'bold' }}>תאריך (אופציונלי):</label>
                            <input
                                type="date"
                                value={userDate}
                                onChange={(e) => setUserDate(e.target.value)}
                                style={{ width: '100%', padding: '5px' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontWeight: 'bold' }}>שנה (חובה):</label>
                                <input
                                    type="number"
                                    value={activeYear}
                                    onChange={(e) => setActiveYear(e.target.value)}
                                    placeholder="2026"
                                    required
                                    style={{ width: '100%', padding: '5px', border: '1px solid red' }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label>חודש (אופציונלי):</label>
                                <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: '100%', padding: '5px' }}>
                                    <option value="">-- כללי --</option>
                                    <option value="01">ינואר (01)</option>
                                    <option value="02">פברואר (02)</option>
                                    <option value="03">מרץ (03)</option>
                                    <option value="04">אפריל (04)</option>
                                    <option value="05">מאי (05)</option>
                                    <option value="06">יוני (06)</option>
                                    <option value="07">יולי (07)</option>
                                    <option value="08">אוגוסט (08)</option>
                                    <option value="09">ספטמבר (09)</option>
                                    <option value="10">אוקטובר (10)</option>
                                    <option value="11">נובמבר (11)</option>
                                    <option value="12">דצמבר (12)</option>
                                </select>
                            </div>
                        </div>

                        {/* שדה תקופה נשאר כאן */}
                        <div style={{ marginBottom: '15px' }}>
                            <label>תקופה (אופציונלי):</label>
                            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: '100%', padding: '5px' }}>
                                <option value="">-- בחר --</option>
                                <option value="תקופה 1">תקופה 1</option>
                                <option value="תקופה 2">תקופה 2</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <label>סיסמת מנהל:</label>
                            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: '5px' }} />
                        </div>

                        {!isUploading ? (
                            <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: 'green', color: 'white', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>
                                התחל העלאה ({filesToUpload.length} קבצים)
                            </button>
                        ) : (
                            <div style={{ marginTop: '20px' }}>
                                <p>מעלה קובץ {progress.current} מתוך {progress.total}...</p>
                                <div style={{ width: '100%', background: '#eee', height: '20px', borderRadius: '10px', overflow: 'hidden' }}>
                                    <div style={{ width: `${(progress.current / progress.total) * 100}%`, background: '#007bff', height: '100%', transition: 'width 0.3s ease' }}></div>
                                </div>
                            </div>
                        )}
                        {storageData && (
                            <div style={{ marginTop: '30px', padding: '15px', background: '#333', color: 'white', borderRadius: '8px', textAlign: 'right', direction: 'rtl' }}>
                                <h4 style={{ marginTop: 0, borderBottom: '1px solid #555', paddingBottom: '10px' }}>💾 מצב כונני אחסון</h4>

                                <div style={{ marginBottom: '15px' }}>
                                    <strong style={{ color: '#4caf50' }}>יעד העלאה נוכחי:</strong><br />
                                    <span style={{ direction: 'ltr', display: 'inline-block' }}>{storageData.currentPath}</span>
                                    <span style={{ marginRight: '10px', fontSize: '0.9rem' }}>(פנוי: {storageData.currentSpace?.freeGB}GB)</span>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </form>

            <div style={{ marginTop: '20px', maxHeight: '200px', overflowY: 'auto', background: '#f1f1f1', padding: '10px' }}>
                <strong>יומן פעילות:</strong>
                {logs.map((log, idx) => (
                    <div key={idx} style={{
                        color: log.type === 'error' ? 'red' : log.type === 'conflict' ? 'orange' : 'black',
                        marginBottom: '5px',
                        display: 'flex',
                        justifyContent: 'space-between'
                    }}>
                        <span>{log.msg}</span>
                        {log.type === 'conflict' && (
                            <button
                                onClick={() => uploadFile(log.file, true).then(() => alert('הועלה בכל זאת!'))}
                                style={{ fontSize: '0.7rem', cursor: 'pointer', backgroundColor: '#ddd' }}
                            >
                                העלה בכל זאת
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* כפתור חזרה - מיקום קבוע למטה בשמאל */}
            <Link to="/" style={{ position: 'fixed', bottom: '20px', left: '20px', zIndex: 1000 }}>
                <button style={{
                    padding: '10px 20px',
                    fontSize: '1rem',
                    cursor: 'pointer',
                    backgroundColor: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '30px',
                    boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                }}>
                    🏠 חזרה לגלריה
                </button>
            </Link>
        </div>
    );
}

export default UploadForm;