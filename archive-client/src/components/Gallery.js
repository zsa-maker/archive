import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

export const API_URL = 'http://10.8.52.22:3001';

function Gallery() {
    const ADMIN_CONFIG = {
        username: 'queen',
        password: '123'
    };
    const [authModal, setAuthModal] = useState({ isOpen: false, action: null, data: null });
    const [authInput, setAuthInput] = useState('');

    const [files, setFiles] = useState([]);
    const [filteredFiles, setFilteredFiles] = useState([]);

    const [isIpModalOpen, setIsIpModalOpen] = useState(false);
    const [allowedIps, setAllowedIps] = useState([]);

    // תצוגה
    const [viewMode, setViewMode] = useState('folders');
    const [currentFolder, setCurrentFolder] = useState(null);
    const [previewFile, setPreviewFile] = useState(null);

    // בחירות
    const [selectedFiles, setSelectedFiles] = useState(new Set());

    // אדמין
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminPassword, setAdminPassword] = useState('');

    // סינונים
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({
        framework: '', population: '', courseNumber: '',
        eventName: '', photographer: '', activeYear: '', period: '', month: ''
    });

    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
    const [tempUser, setTempUser] = useState('');
    const [tempPass, setTempPass] = useState('');

    const [currentStorageRoot, setCurrentStorageRoot] = useState('');

    // ניהול היסטוריית כוננים
    const [storageHistory, setStorageHistory] = useState([]);
    const [backupHistory, setBackupHistory] = useState([]);

    const [newDrivePath, setNewDrivePath] = useState('');
    const [backupPath, setBackupPath] = useState('D:/BackupArchive');
    const [backupOnlyNew, setBackupOnlyNew] = useState(true);

    const [storageSpace, setStorageSpace] = useState({ freeGB: '--', totalGB: '--', percent: 0 });
    const [backupSpace, setBackupSpace] = useState({ freeGB: '--', totalGB: '--', percent: 0 });

    const currentToken = localStorage.getItem('archive_token');
    const [showAdminMenu, setShowAdminMenu] = useState(false);

    const [settingsTab, setSettingsTab] = useState('ips');

    const [migrateSourceDrive, setMigrateSourceDrive] = useState('');
    const [migrateTargetDrive, setMigrateTargetDrive] = useState('');
    const [isMigrating, setIsMigrating] = useState(false);
    const openFolder = (folderObj) => { setCurrentFolder(folderObj); setViewMode('files'); };
    const goBackToFolders = () => { setCurrentFolder(null); setViewMode('folders'); };

    const canMerge = (f1, f2) => {
        if (f1.eventName !== f2.eventName) return false;
        if (f1.activeYear && f2.activeYear && String(f1.activeYear) !== String(f2.activeYear)) return false;
        if (f1.framework && f2.framework && f1.framework !== f2.framework) return false;
        if (f1.population && f2.population && f1.population !== f2.population) return false;
        if (f1.period && f2.period && f1.period !== f2.period) return false;
        if (f1.month && f2.month && String(f1.month) !== String(f2.month)) return false;
        if (f1.courseNumber && f2.courseNumber && String(f1.courseNumber) !== String(f2.courseNumber)) return false;
        if (f1.courseStage && f2.courseStage && f1.courseStage !== f2.courseStage) return false;
        return true;
    };

    useEffect(() => {
        fetchFiles();
    }, []);
    useEffect(() => {
        const hasPendingFiles = files.some(f => f.processingStatus === 'pending');

        if (hasPendingFiles) {
            const intervalId = setInterval(() => {
                fetchFiles();
            }, 30000);
            return () => clearInterval(intervalId);
        }
    }, [files]);
    const triggerProtectedAction = (action, data = null) => {
        setAuthModal({ isOpen: true, action, data });
        setAuthInput('');
    };

    const handleAuthConfirm = () => {
        if (authInput === ADMIN_CONFIG.password) {
            const { action, data } = authModal;
            setAuthModal({ isOpen: false, action: null, data: null });
            action(data);
        } else {
            alert("סיסמה שגויה!");
        }
    };

    const fetchStorageSettings = useCallback(async () => {
        try {
            const token = localStorage.getItem('archive_token');
            const res = await axios.get(`${API_URL}/api/admin/storage-settings`, {
                headers: { 'x-access-token': token }
            });
            setCurrentStorageRoot(res.data.currentPath);
            if (res.data.backupPath) setBackupPath(res.data.backupPath);

            if (res.data.currentSpace) setStorageSpace(res.data.currentSpace);
            if (res.data.backupSpace) setBackupSpace(res.data.backupSpace);

            setStorageHistory(res.data.storageHistory || []);
            setBackupHistory(res.data.backupHistory || []);

        } catch (err) {
            console.error("Failed to fetch storage settings");
        }
    }, []);

    const checkBackupSpace = async () => {
        if (!backupPath) return;
        try {
            const token = localStorage.getItem('archive_token');
            const res = await axios.post(`${API_URL}/api/admin/check-path-info`,
                { targetPath: backupPath },
                { headers: { 'x-access-token': token } }
            );
            setBackupSpace(res.data);
        } catch (err) {
            alert("לא ניתן לבדוק מקום בנתיב זה");
        }
    };

    const handleChangeDrive = async () => {
        if (!newDrivePath) return alert("נא להזין נתיב");

        let passToSend = adminPassword;
        if (!passToSend) {
            passToSend = prompt("אנא הזן סיסמת מנהל לאישור השינוי:");
            if (!passToSend) return;
        }

        try {
            const token = localStorage.getItem('archive_token');
            const res = await axios.post(`${API_URL}/api/admin/change-drive`,
                { newPath: newDrivePath, adminPassword: passToSend },
                { headers: { 'x-access-token': token } }
            );

            setCurrentStorageRoot(res.data.currentPath);
            setNewDrivePath('');
            fetchStorageSettings();
            alert("נתיב ההעלאה שונה בהצלחה!");

            if (!adminPassword) setAdminPassword(passToSend);
        } catch (err) {
            console.error(err);
            alert("שגיאה: וודא שהנתיב תקין ושהסיסמה נכונה.");
        }
    };

    const handleSaveBackupPath = async () => {
        let pass = adminPassword;
        if (!pass) {
            pass = prompt("סיסמת מנהל לשמירת נתיב גיבוי:");
            if (!pass) return;
        }
        try {
            const token = localStorage.getItem('archive_token');
            await axios.post(`${API_URL}/api/admin/save-backup-path`,
                { newBackupPath: backupPath, adminPassword: pass },
                { headers: { 'x-access-token': token } }
            );
            alert("נתיב גיבוי נשמר בהצלחה!");
            fetchStorageSettings();
            if (!adminPassword) setAdminPassword(pass);
        } catch (e) { alert("שגיאה בשמירה"); }
    };

    const handleRunBackup = async () => {
        try {
            const res = await axios.post(`${API_URL}/api/admin/run-backup`, {
                backupPath,
                onlyNewFiles: backupOnlyNew
            }, {
                headers: { 'x-access-token': localStorage.getItem('archive_token') }
            });
            alert(`הגיבוי הסתיים! ${res.data.copied} קבצים הועתקו.`);
        } catch (err) { alert('שגיאה בגיבוי'); }
    };

    const fetchFiles = () => {
        const token = localStorage.getItem('archive_token');
        axios.get(`${API_URL}/api/files`, {
            headers: { 'x-access-token': token }
        })
            .then(res => { setFiles(res.data); setFilteredFiles(res.data); })
            .catch(err => {
                if (err.response && err.response.status === 401) alert("🔒 אין הרשאה! נא להיכנס דרך כונן Z.");
            });
    };

    const fetchIps = async () => {
        try {
            const res = await axios.get(`${API_URL}/api/admin/ips`);
            setAllowedIps(res.data);
        } catch (err) { console.error("Failed to fetch IPs"); }
    };

    const handleRemoveIp = async (ip) => {
        if (!window.confirm(`האם למחוק את הגישה למחשב בכתובת ${ip}?`)) return;
        try {
            await axios.post(`${API_URL}/api/admin/delete-ip`, { ip, adminPassword: adminPassword });
            fetchIps();
        } catch (err) { alert("שגיאה במחיקה"); }
    };

    const onAddIpClick = () => {
        const ip = prompt("הכנס כתובת IP חדשה (למשל 10.8.50.50):");
        if (!ip) return;
        axios.post(`${API_URL}/api/admin/check-and-add-ip`, { newIp: ip, adminPassword: adminPassword })
            .then(() => { fetchIps(); alert("נוסף בהצלחה"); })
            .catch(() => alert("שגיאה בהוספה"));
    };

    const handleIpIconClick = () => {
        triggerProtectedAction(() => {
            fetchIps();
            fetchStorageSettings();
            setIsIpModalOpen(true);
        });
    };

    // --- לוגיקה לסינון קבצים ---
    useEffect(() => {
        let result = files;

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            result = result.filter(f =>
                (f.originalName && f.originalName.toLowerCase().includes(term)) ||
                (f.eventName && f.eventName.toLowerCase().includes(term)) ||
                (f.photographer && f.photographer.toLowerCase().includes(term)) ||
                (f.activeYear && f.activeYear.toLowerCase().includes(term)) ||
                (f.description && f.description.toLowerCase().includes(term)) // <--- הוספנו את התיאור לחיפוש
            );
        }

        if (filters.photographer) {
            result = result.filter(f => f.photographer === filters.photographer);
        }

        if (filters.activeYear) {
            result = result.filter(f => f.activeYear && f.activeYear.toString() === filters.activeYear.toString());
        }

        if (filters.month) {
            result = result.filter(f => f.month && f.month.toString() === filters.month.toString());
        }

        // חיפוש גמיש בשם האירוע
        if (filters.eventName) {
            const term = filters.eventName.toLowerCase();
            result = result.filter(f => f.eventName && f.eventName.toLowerCase().includes(term));
        }

        if (filters.period) {
            result = result.filter(f => f.period === filters.period);
        }

        if (filters.framework) result = result.filter(f => f.framework === filters.framework);
        if (filters.population) result = result.filter(f => f.population === filters.population);
        if (filters.courseNumber) result = result.filter(f => f.courseNumber === filters.courseNumber);

        if (currentFolder) {
            result = result.filter(f => canMerge(currentFolder, f))
        }

        setFilteredFiles(result);
    }, [searchTerm, filters, files, currentFolder]);

    const navigateLightbox = useCallback((direction) => {
        if (!previewFile) return;
        const currentIndex = filteredFiles.findIndex(f => f._id === previewFile._id);
        if (currentIndex === -1) return;

        let newIndex;
        if (direction === 'next') {
            newIndex = currentIndex + 1;
            if (newIndex >= filteredFiles.length) newIndex = 0;
        } else {
            newIndex = currentIndex - 1;
            if (newIndex < 0) newIndex = filteredFiles.length - 1;
        }
        setPreviewFile(filteredFiles[newIndex]);
    }, [filteredFiles, previewFile]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!previewFile) return;
            if (e.key === 'ArrowRight') navigateLightbox('next');
            if (e.key === 'ArrowLeft') navigateLightbox('prev');
            if (e.key === 'Escape') setPreviewFile(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewFile, navigateLightbox]);

    // --- לוגיקה לסינון חכם (Dropdowns) ---
    // פונקציה זו משמשת *רק* למילוי האפשרויות ברשימות, לא לסינון הגריד
    const getAvailableOptions = (field) => {
        let relevantFiles = files;

        if (field !== 'framework' && filters.framework) relevantFiles = relevantFiles.filter(f => f.framework === filters.framework);
        if (field !== 'population' && filters.population) relevantFiles = relevantFiles.filter(f => f.population === filters.population);
        if (field !== 'courseNumber' && filters.courseNumber) relevantFiles = relevantFiles.filter(f => f.courseNumber === filters.courseNumber);

        if (field !== 'activeYear' && filters.activeYear) relevantFiles = relevantFiles.filter(f => f.activeYear && f.activeYear.toString() === filters.activeYear.toString());
        if (field !== 'month' && filters.month) relevantFiles = relevantFiles.filter(f => f.month && f.month.toString() === filters.month.toString());
        if (field !== 'period' && filters.period) relevantFiles = relevantFiles.filter(f => f.period === filters.period);

        if (field !== 'photographer' && filters.photographer) relevantFiles = relevantFiles.filter(f => f.photographer === filters.photographer);

        if (field !== 'eventName' && filters.eventName) {
            relevantFiles = relevantFiles.filter(f => f.eventName && f.eventName.toLowerCase().includes(filters.eventName.toLowerCase()));
        }

        const values = relevantFiles.map(f => f[field]).filter(v => v && v.toString().trim() !== '');
        return [...new Set(values)].sort();
    };

    // הוסיפי את הבלוק הזה לפני ה-return של הקומפוננטה
const uniqueFolders = useMemo(() => {
    const foldersMap = new Map();

    filteredFiles.forEach(f => {
        if (!f.eventName) return;
        
        // יצירת מפתח ייחודי לפי שם אירוע ושנה
        const key = `${f.eventName}-${f.activeYear}`;
        
        if (!foldersMap.has(key)) {
            foldersMap.set(key, {
                ...f,
                photographers: new Set(f.photographer ? [f.photographer] : []),
                fileCount: 0,
                folderFiles: []
            });
        }
    });

    // שיוך קבצים לתיקיות בסיבוב אחד מהיר
    files.forEach(f => {
        const key = `${f.eventName}-${f.activeYear}`;
        const target = foldersMap.get(key);
        if (target) {
            target.fileCount++;
            target.folderFiles.push(f);
            if (f.photographer) target.photographers.add(f.photographer);
        }
    });

    return Array.from(foldersMap.values()).sort((a, b) => a.eventName.localeCompare(b.eventName));
}, [filteredFiles, files]); // עיבוד אופטימלי

    const handleDeleteEvent = async (e, eventName) => {
        e.stopPropagation();
        if (!window.confirm(`⚠️ למחוק את התיקייה "${eventName}"?`)) return;
        const pass = prompt("סיסמת מנהל:");
        if (!pass) return;
        try {
            await axios.delete(`${API_URL}/api/event?eventName=${eventName}`, { headers: { 'x-admin-password': pass } });
            fetchFiles();
        } catch (err) { alert("שגיאה במחיקה"); }
    };

    const handleRenameEvent = async (e, oldName) => {
        e.stopPropagation();
        const newName = prompt("שם חדש:", oldName);
        if (!newName || newName === oldName) return;
        try {
            await axios.put(`${API_URL}/api/event/rename`, { oldName, newName }, { headers: { 'x-admin-password': adminPassword } });
            fetchFiles();
        } catch (err) { alert("שגיאה"); }
    };

    const handleBatchDelete = async () => {
        if (!window.confirm(`למחוק ${selectedFiles.size} קבצים?`)) return;
        try {
            await axios.post(`${API_URL}/api/files/batch-delete`,
                { ids: Array.from(selectedFiles) },
                { headers: { 'x-admin-password': adminPassword } }
            );
            fetchFiles();
            setSelectedFiles(new Set());
        } catch (err) { alert("שגיאה במחיקה"); }
    };

    const handleMoveFiles = async () => {
        const targetFolder = prompt("שם התיקייה החדשה להעברה:");
        if (!targetFolder) return;
        try {
            await axios.post(`${API_URL}/api/files/move`,
                { ids: Array.from(selectedFiles), newEventName: targetFolder },
                { headers: { 'x-admin-password': adminPassword } }
            );
            fetchFiles();
            setSelectedFiles(new Set());
        } catch (err) { alert("שגיאה בהעברה"); }
    };

    const downloadSelectedZip = async () => {
        try {
            const token = localStorage.getItem('archive_token');
            const response = await axios.post(`${API_URL}/api/download-zip`,
                { fileIds: Array.from(selectedFiles) },
                {
                    responseType: 'blob',
                    headers: { 'x-access-token': token }
                }
            );
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a'); link.href = url; link.download = 'selected_files.zip';
            document.body.appendChild(link); link.click(); link.remove();
            setSelectedFiles(new Set());
        } catch (err) { alert("שגיאה בהורדה"); }
    };

    // --- הורדת תיקייה (תיקון הרשאות) ---
    const downloadFolderZip = async (e, eventName) => {
        e.stopPropagation();
        const eventFiles = files.filter(f => f.eventName === eventName);
        if (eventFiles.length === 0) return alert("תיקייה ריקה");
        const fileIds = eventFiles.map(f => f._id);

        const originalText = e.target.innerText;
        e.target.innerText = '⏳';

        try {
            const token = localStorage.getItem('archive_token');
            const response = await axios.post(`${API_URL}/api/download-zip`,
                { fileIds },
                {
                    responseType: 'blob',
                    headers: { 'x-access-token': token }
                }
            );
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a'); link.href = url; link.setAttribute('download', `${eventName}.zip`);
            document.body.appendChild(link); link.click(); link.remove();

            e.target.innerText = originalText;
        } catch (err) {
            console.error(err);
            alert("שגיאה בהורדה. וודא שאתה מחובר.");
            e.target.innerText = originalText;
        }
    };

    const toggleSelect = (id) => {
        const newSel = new Set(selectedFiles);
        newSel.has(id) ? newSel.delete(id) : newSel.add(id);
        setSelectedFiles(newSel);
    };

    const submitAdminLogin = () => {
        if (tempUser === ADMIN_CONFIG.username && tempPass === ADMIN_CONFIG.password) {
            setIsAdmin(true);
            setAdminPassword(tempPass);
            setIsLoginModalOpen(false);
            alert("כניסת מנהל בוצעה בהצלחה!");
        } else {
            alert("פרטים שגויים");
        }
    };

    const getFolderCover = (eventName) => {
        const folderFiles = files.filter(f => f.eventName === eventName);
        const firstImage = folderFiles.find(f => f.mimeType.startsWith('image'));
        if (firstImage) {
            return `${API_URL}/${firstImage.thumbnailPath || firstImage.path}?token=${currentToken}`;
        }
        return null;
    };

    const getFolderDetails = (eventName) => {
        const file = files.find(f => f.eventName === eventName);
        if (!file) return "";
        const year = file.activeYear || "---";
        const month = file.month ? `/${file.month}` : "";
        return { date: `${year}${month}`, population: file.population || "כללי", period: file.period || "" };
    };

    const renderDriveList = (driveList, setPathFunc) => {
        return (
            <div style={{ maxHeight: '150px', overflowY: 'auto', background: '#333', padding: '10px', borderRadius: '10px' }}>
                {driveList.map((drive, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #444', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.9rem', direction: 'ltr' }}>{drive.path}</span>
                            {drive.status === 'offline' ?
                                <span style={{ color: 'red', fontSize: '0.8rem' }}>מנותק / לא זמין</span> :
                                <span style={{ color: '#aaa', fontSize: '0.8rem' }}>{drive.freeGB}GB פנויים ({drive.percent}%)</span>
                            }
                        </div>
                        {setPathFunc && (
                            <button
                                onClick={() => setPathFunc(drive.path)}
                                style={{ padding: '5px 10px', fontSize: '0.8rem', cursor: 'pointer', background: '#555', color: 'white', border: 'none', borderRadius: '4px' }}
                            >
                                בחר
                            </button>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    const styles = {
        container: { padding: '20px', background: '#222', minHeight: '100vh', color: 'white', fontFamily: 'Segoe UI, sans-serif' },
        header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #444', paddingBottom: '10px' },
        select: { padding: '8px', borderRadius: '4px', border: '1px solid #555', background: '#222', color: 'white', minWidth: '100px' },
        input: { padding: '8px', borderRadius: '4px', border: '1px solid #555', background: '#222', color: 'white', minWidth: '200px' },
        grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' },
        fileCard: { position: 'relative', background: '#000', border: '1px solid #444', borderRadius: '8px', overflow: 'hidden' },
        img: { width: '100%', height: '160px', objectFit: 'cover', cursor: 'pointer' },
        folderActionBtn: { position: 'absolute', top: '5px', background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', borderRadius: '50%', width: '25px', height: '25px', cursor: 'pointer', fontSize: '12px' },
        folderDownloadBtn: { position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,123,255,0.8)', border: 'none', color: 'white', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', zIndex: 20, fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        actionBar: { position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)', background: '#007bff', padding: '10px 20px', borderRadius: '50px', display: 'flex', gap: '15px', boxShadow: '0 5px 20px rgba(0,0,0,0.5)', zIndex: 100 },
        actionBtn: { background: 'none', border: 'none', color: 'white', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' },
        uploadFab: { position: 'fixed', bottom: '30px', left: '30px', padding: '15px', borderRadius: '50%', fontSize: '24px', background: '#007bff', color: 'white', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', cursor: 'pointer', zIndex: 100 },
        lightbox: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
        lightboxContent: { position: 'relative', maxWidth: '90%', maxHeight: '90%', display: 'flex', justifyContent: 'center', alignItems: 'center' },
        lightboxImg: { maxWidth: '100%', maxHeight: '90vh', borderRadius: '5px', boxShadow: '0 0 20px rgba(0,0,0,0.5)' },
        closeBtn: { position: 'absolute', top: '-40px', right: '-40px', color: 'white', fontSize: '40px', cursor: 'pointer', background: 'none', border: 'none' },
        headerTitle: {
            textAlign: 'center',
            fontSize: '3rem',
            fontWeight: 'bold',
            marginBottom: '10px',
            color: '#fff',
            letterSpacing: '2px'
        },
        filterBar: {
            display: 'flex',
            gap: '15px',
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginBottom: '40px',
            background: 'rgba(255, 255, 255, 0.05)',
            padding: '20px',
            borderRadius: '15px',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)'
        },
        folderCard: {
            cursor: 'pointer',
            background: '#333',
            borderRadius: '15px',
            height: '220px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-end',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            position: 'relative',
            overflow: 'hidden',
            border: 'none'
        },
        folderInfoOverlay: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0,
            transition: 'opacity 0.3s ease',
            fontSize: '0.9rem',
            color: '#ddd',
            padding: '10px',
            textAlign: 'center'
        },
        folderTitle: {
            background: 'rgba(0,0,0,0.6)',
            width: '100%',
            padding: '10px 0',
            textAlign: 'center',
            fontWeight: 'bold',
            fontSize: '1rem',
            backdropFilter: 'blur(5px)'
        },
        navBtn: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', fontSize: '60px', padding: '20px', cursor: 'pointer', borderRadius: '10px', transition: '0.2s' }
    };

    const handleMigrateDrive = async () => {
        if (!migrateSourceDrive || !migrateTargetDrive) return alert("נא לבחור כונן מקור ולהזין נתיב לכונן יעד.");
        if (migrateSourceDrive === migrateTargetDrive) return alert("נתיב כונן המקור וכונן היעד זהים.");

        if (!window.confirm(`⚠️ אזהרה: פעולה זו תעביר את כל הקבצים מ-${migrateSourceDrive} ל-${migrateTargetDrive}.\nהקבצים בכונן הישן יימחקו והמערכת תשלוף נתונים רק מהכונן החדש!\nהאם להמשיך?`)) return;

        let passToSend = adminPassword;
        if (!passToSend) {
            passToSend = prompt("אנא הזן סיסמת מנהל לאישור המיגרציה:");
            if (!passToSend) return;
        }

        setIsMigrating(true);
        try {
            const token = localStorage.getItem('archive_token');
            const res = await axios.post(`${API_URL}/api/admin/migrate-drive`,
                { oldDrive: migrateSourceDrive, newDrive: migrateTargetDrive, adminPassword: passToSend },
                { headers: { 'x-access-token': token } }
            );

            alert(`העברת הנתונים הסתיימה בהצלחה! ${res.data.movedCount} קבצים (ותוספותיהם) הועברו לנתיב החדש.`);
            setMigrateSourceDrive('');
            setMigrateTargetDrive('');
            fetchStorageSettings(); // רענון נתוני האחסון שמוצגים
            if (!adminPassword) setAdminPassword(passToSend);
        } catch (err) {
            console.error(err);
            alert("שגיאה בהעברת הנתונים. וודא שהנתיב תקין.");
        } finally {
            setIsMigrating(false);
        }
    };

    return (
        <div style={styles.container}>
            <h1 style={styles.headerTitle}>ארכיון הביסט</h1>
            <div style={styles.filterBar}>
                <input
                    type="text"
                    placeholder="🔍 חיפוש חופשי (שם קובץ...)"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={styles.input}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <input
                        list="gallery-events-datalist"
                        placeholder="📅 סינון לפי אירוע..."
                        value={filters.eventName}
                        onChange={e => setFilters({ ...filters, eventName: e.target.value })}
                        style={styles.select}
                    />
                    <datalist id="gallery-events-datalist">
                        {getAvailableOptions('eventName').map(v => <option key={v} value={v} />)}
                    </datalist>
                </div>

                <select
                    style={styles.select}
                    value={filters.photographer}
                    onChange={e => setFilters({ ...filters, photographer: e.target.value })}
                >
                    <option value="">📸 צלם</option>
                    {getAvailableOptions('photographer').map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select
                    style={styles.select}
                    value={filters.activeYear}
                    onChange={e => setFilters({ ...filters, activeYear: e.target.value })}
                >
                    <option value="">📅 בחר שנה</option>
                    {getAvailableOptions('activeYear').map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                {filters.activeYear && (
                    <>
                        <select
                            style={styles.select}
                            value={filters.period}
                            onChange={e => setFilters({ ...filters, period: e.target.value })}
                        >
                            <option value="">⏳ כל התקופות</option>
                            <option value="תקופה 1">תקופה 1</option>
                            <option value="תקופה 2">תקופה 2</option>
                        </select>

                        <select
                            style={styles.select}
                            value={filters.month}
                            onChange={e => setFilters({ ...filters, month: e.target.value })}
                        >
                            <option value="">🌙 בחר חודש</option>
                            {["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </>
                )}

                <select style={styles.select} value={filters.framework} onChange={e => setFilters({ ...filters, framework: e.target.value, population: '', courseNumber: '' })}>
                    <option value="">🏛️ מסגרת</option>
                    {getAvailableOptions('framework').map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                {filters.framework === 'ביסט' && (
                    <select style={styles.select} value={filters.population} onChange={e => setFilters({ ...filters, population: e.target.value, courseNumber: '' })}>
                        <option value="">👥 אוכלוסייה</option>
                        {getAvailableOptions('population').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                )}

                {filters.population === 'חניכים' && (
                    <select style={styles.select} value={filters.courseNumber} onChange={e => setFilters({ ...filters, courseNumber: e.target.value })}>
                        <option value="">🎓 קורס</option>
                        {getAvailableOptions('courseNumber').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                )}
                {filters.courseNumber && (
                    <select style={styles.select} value={filters.courseStage} onChange={e => setFilters({ ...filters, courseStage: e.target.value })}>
                        <option value=""> שלב בקורס</option>
                        {getAvailableOptions('courseStage').map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                )}

                <button
                    onClick={() => {
                        setFilters({
                            framework: '',
                            population: '',
                            courseNumber: '',
                            eventName: '',
                            photographer: '',
                            activeYear: '',
                            period: '',
                            month: ''
                        });
                        setSearchTerm('');
                        goBackToFolders();
                    }}
                    style={{ cursor: 'pointer', background: 'none', border: 'none', color: '#aaa', marginLeft: 'auto' }}
                >
                    🔄 איפוס
                </button>            </div>

            {
viewMode === 'folders' ? (
                    <div style={styles.grid}>
                        {uniqueFolders.map(folder => {
                            const folderFiles = folder.folderFiles;
                            const firstMedia = folderFiles.find(f => f.mimeType.startsWith('image') || f.thumbnailPath);
                            const coverImg = firstMedia ? `${API_URL}/${firstMedia.thumbnailPath || firstMedia.path}?token=${currentToken}` : null;

                            let yearPeriodStr = '---';
                            const shortYear = folder.activeYear ? folder.activeYear.toString().slice(-2) : '';
                            let periodNum = '';
                            if (folder.period === 'תקופה 1') periodNum = '1';
                            else if (folder.period === 'תקופה 2') periodNum = '2';

                            if (periodNum && shortYear) yearPeriodStr = `${periodNum}/${shortYear}`;
                            else if (shortYear) yearPeriodStr = shortYear;
                            else if (periodNum) yearPeriodStr = `תקופה ${periodNum}`;

                            let popStr = folder.population || 'כללי';
                            if (folder.courseNumber) popStr += ` - ${folder.courseNumber}`;
                            if (folder.courseStage) popStr += ` (${folder.courseStage})`;

                            const photogsArr = Array.from(folder.photographers);
                            const photogsStr = photogsArr.length > 0 ? photogsArr.join(', ') : 'לא צוין';

                            return (
                                <div
                                    key={folder.id}
                                    style={styles.folderCard}
                                    onClick={() => openFolder(folder)}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.querySelector('.overlay').style.opacity = '1'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.querySelector('.overlay').style.opacity = '0'; }}
                                >
                                    {coverImg ? (
                                        <img src={coverImg} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute' }} alt="" />
                                    ) : (
                                        <div style={{ fontSize: '50px', marginBottom: '40px' }}>📁</div>
                                    )}

                                    <div className="overlay" style={styles.folderInfoOverlay}>
                                        <div>📅 זמן: {yearPeriodStr}</div>
                                        <div>👥 אוכלוסייה: {popStr}</div>
                                        <div style={{ fontSize: '0.8rem', marginTop: '5px' }}>📸 צלמים: {photogsStr}</div>
                                        {folder.description && (
                                            <div style={{ fontSize: '0.8rem', marginTop: '8px', padding: '5px', background: 'rgba(0,0,0,0.6)', borderRadius: '5px', fontStyle: 'italic', maxWidth: '90%', maxHeight: '60px', overflowY: 'auto' }}>
                                                💬 {folder.description}
                                            </div>
                                        )}
                                        <div style={{ marginTop: '10px', fontSize: '0.7rem' }}>{folder.fileCount} קבצים</div>
                                    </div>

                                    <div style={styles.folderTitle}>{folder.eventName}</div>

                                    <button
                                        style={styles.folderDownloadBtn}
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            if (folderFiles.length === 0) return alert("תיקייה ריקה");
                                            try {
                                                const originalText = e.target.innerText;
                                                e.target.innerText = '⏳';
                                                const response = await axios.post(`${API_URL}/api/download-zip`, { fileIds: folderFiles.map(f => f._id) }, { responseType: 'blob', headers: { 'x-access-token': currentToken } });
                                                const url = window.URL.createObjectURL(new Blob([response.data]));
                                                const link = document.createElement('a'); link.href = url; link.setAttribute('download', `${folder.eventName}.zip`);
                                                document.body.appendChild(link); link.click(); link.remove();
                                                e.target.innerText = originalText;
                                            } catch (err) { alert("שגיאה בהורדה"); }
                                        }}
                                    >
                                        📥
                                    </button>
                                    {isAdmin && (
                                        <div style={{ position: 'absolute', top: '5px', left: '5px', display: 'flex', gap: '5px', zIndex: 10 }}>
                                            <button style={{ ...styles.folderActionBtn, position: 'static', background: 'red' }} onClick={async (e) => {
                                                e.stopPropagation();
                                                if (!window.confirm(`למחוק את התיקייה הספציפית הזו?`)) return;
                                                await axios.post(`${API_URL}/api/files/batch-delete`, { ids: folderFiles.map(f => f._id) }, { headers: { 'x-admin-password': adminPassword } });
                                                fetchFiles();
                                            }}>🗑️</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <button
                                onClick={goBackToFolders}
                                style={{
                                    padding: '10px 20px',
                                    background: '#444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                    fontSize: '1rem'
                                }}
                            >
                                חזרה
                            </button>
                            <button
                                onClick={(e) => downloadFolderZip(e, currentFolder)}
                                style={{
                                    padding: '10px 20px',
                                    background: '#007bff',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                }}
                            >
                                📥 הורד הכל
                            </button>
                        </div>

                        <div style={styles.grid}>
                            {filteredFiles.map(file => {
                                const isSelected = selectedFiles.has(file._id);
                                let filePath = file.thumbnailPath || file.path;
                                if (filePath && !filePath.startsWith('storage/')) {
                                    filePath = `storage/${filePath}`;
                                }
                                const mediaSrc = `${API_URL}/${filePath}?token=${currentToken}`; return (
                                    <div key={file._id} style={{ ...styles.fileCard, border: isSelected ? '2px solid #007bff' : styles.fileCard.border }}>
                                        {(file.mimeType.startsWith('image') || file.thumbnailPath) ? (
                                            <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setPreviewFile(file)}>
                                                <img src={mediaSrc} alt={file.originalName} style={styles.img} />
                                                {!file.mimeType.startsWith('image') && (
                                                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '40px', color: 'white', textShadow: '0 0 10px rgba(0,0,0,0.8)' }}>
                                                        ▶️
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div style={{ ...styles.img, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333', fontSize: '30px', cursor: 'pointer' }} onClick={() => setPreviewFile(file)}>🎬</div>
                                        )}
                                        <div style={{ padding: '10px', display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)' }}>
                                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(file._id)} style={{ transform: 'scale(1.3)', cursor: 'pointer' }} />
                                            <div style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100px' }}>{file.originalName}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )
            }

            {
                selectedFiles.size > 0 && (
                    <div style={styles.actionBar}>
                        <button onClick={downloadSelectedZip} style={styles.actionBtn}>📥 הורד ({selectedFiles.size})</button>
                        {isAdmin && (
                            <>
                                <div style={{ width: '1px', background: 'rgba(255,255,255,0.3)' }}></div>
                                <button onClick={handleMoveFiles} style={styles.actionBtn}>📂 העבר</button>
                                <button onClick={handleBatchDelete} style={{ ...styles.actionBtn, color: '#ffdddd' }}>🗑️ מחק</button>
                            </>
                        )}
                    </div>
                )
            }

            {
                previewFile && (
                    <div style={styles.lightbox} onClick={() => setPreviewFile(null)}>
                        <div style={styles.lightboxContent} onClick={e => e.stopPropagation()}>
                            <button style={styles.closeBtn} onClick={() => setPreviewFile(null)}>&times;</button>
                            <button style={{ ...styles.navBtn, right: '-100px' }} onClick={(e) => { e.stopPropagation(); navigateLightbox('prev'); }}>❮</button>

                            {previewFile.mimeType.startsWith('image') ? (
                                <img src={`${API_URL}/${previewFile.path}?token=${currentToken}`} style={styles.lightboxImg} alt="Preview" />
                            ) : (
                                <video controls autoPlay src={`${API_URL}/${previewFile.streamPath || previewFile.path}?token=${currentToken}`} style={styles.lightboxImg} />
                            )}

                            <button style={{ ...styles.navBtn, left: '-100px' }} onClick={(e) => { e.stopPropagation(); navigateLightbox('next'); }}>❯</button>
                        </div>
                    </div>
                )
            }
            {
                !isAdmin && (
                    <button
                        onClick={() => setIsLoginModalOpen(true)}
                        style={{
                            position: 'fixed', bottom: '30px', left: '30px',
                            width: '60px', height: '60px', borderRadius: '50%',
                            background: '#9a9ea3ff', color: 'white', border: 'none',
                            cursor: 'pointer', zIndex: 1000, fontSize: '24px',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.4)'
                        }}
                    >
                        👤                </button>
                )
            }
            {
                authModal.isOpen && (
                    <div style={styles.lightbox} onClick={() => setAuthModal({ isOpen: false, action: null, data: null })}>
                        <div style={{ background: '#333', padding: '25px', borderRadius: '15px', width: '280px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <h4>אישור פעולה מאובטחת</h4>
                            <p style={{ fontSize: '0.9rem', color: '#ccc' }}>הזן סיסמת מנהל:</p>
                            <input
                                type="password"
                                autoFocus
                                value={authInput}
                                onChange={e => setAuthInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAuthConfirm()}
                                style={{ ...styles.input, width: '100%', textAlign: 'center', marginBottom: '15px' }}
                            />
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button onClick={handleAuthConfirm} style={{ flex: 1, padding: '10px', background: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>אשר</button>
                                <button onClick={() => setAuthModal({ isOpen: false, action: null, data: null })} style={{ flex: 1, padding: '10px', background: '#666', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>ביטול</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {isIpModalOpen && (
                <div style={styles.lightbox} onClick={() => setIsIpModalOpen(false)}>
                    <div style={{ background: '#222', padding: '30px', borderRadius: '20px', width: '600px', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>

                        {/* כפתורי ניווט בין לשוניות */}
                        <div style={{ display: 'flex', borderBottom: '1px solid #444', marginBottom: '20px' }}>
                            <button
                                onClick={() => setSettingsTab('ips')}
                                style={{ flex: 1, padding: '10px', background: settingsTab === 'ips' ? '#444' : 'none', color: 'white', border: 'none', cursor: 'pointer', borderTopLeftRadius: '10px', borderTopRightRadius: '10px' }}>
                                🌐 ניהול IP
                            </button>
                            <button
                                onClick={() => { setSettingsTab('storage'); fetchStorageSettings(); }}
                                style={{ flex: 1, padding: '10px', background: settingsTab === 'storage' ? '#444' : 'none', color: 'white', border: 'none', cursor: 'pointer', borderTopLeftRadius: '10px', borderTopRightRadius: '10px' }}>
                                💾 ניהול כוננים
                            </button>
                            <button onClick={() => setIsIpModalOpen(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer', padding: '0 10px' }}>✕</button>
                        </div>

                        {settingsTab === 'ips' ? (
                            /* לשונית ניהול IP */
                            <div style={{ direction: 'rtl' }}>
                                <h3 style={{ marginBottom: '20px' }}>🖥️ מחשבים מורשים לגישה</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                                    {Array.isArray(allowedIps) && allowedIps.map(ip => (
                                        <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', background: '#333', padding: '12px 15px', borderRadius: '10px', alignItems: 'center' }}>
                                            <span style={{ fontFamily: 'monospace', fontSize: '1.1rem' }}>{ip}</span>
                                            {ip !== '127.0.0.1' && ip !== '10.8.52.22' && (
                                                <button onClick={() => handleRemoveIp(ip)} style={{ background: 'none', border: 'none', color: '#ff4d4d', cursor: 'pointer', fontSize: '1.2rem' }}>🗑️</button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <button onClick={onAddIpClick} style={{ width: '100%', padding: '12px', background: '#28a745', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    הוסף מחשב חדש
                                </button>
                            </div>
                        ) : (
                            /* לשונית ניהול כוננים (מקור וגיבוי) */
                            <div style={{ direction: 'rtl', textAlign: 'right' }}>

                                {/* ניהול כונני מקור (Source) */}
                                <div style={{ background: '#333', padding: '15px', borderRadius: '10px', marginBottom: '20px' }}>
                                    <h4 style={{ marginTop: 0 }}>📂 כונני מקור לסריקה (Source):</h4>
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '10px' }}>
                                        {storageHistory.filter(d => d.type === 'source').map((drive, idx) => (
                                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #444', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.9rem', direction: 'ltr' }}>{drive.path}</span>
                                                <span style={{ color: drive.status === 'online' ? '#28a745' : '#ff4d4d', fontSize: '0.8rem' }}>
                                                    {drive.status === 'online' ? `${drive.freeGB}GB פנוי` : 'מנותק'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={async () => {
                                            const p = prompt("הזן נתיב לכונן מקור חדש (למשל D:/MyArchiveData):");
                                            if (p) {
                                                try {
                                                    await axios.post(`${API_URL}/api/admin/add-drive`, { path: p, type: 'source' }, { headers: { 'x-access-token': currentToken } });
                                                    fetchStorageSettings();
                                                } catch (e) { alert("שגיאה בהוספת כונן"); }
                                            }
                                        }}
                                        style={{ width: '100%', padding: '8px', background: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                                    >
                                        ➕ הוסף כונן מקור חדש
                                    </button>
                                </div>

                                {/* ניהול כונני גיבוי (Backup) */}
                                <div style={{ background: '#333', padding: '15px', borderRadius: '10px', marginBottom: '20px' }}>
                                    <h4 style={{ marginTop: 0, color: '#17a2b8' }}>🛡️ כונני גיבוי (Backup):</h4>
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '10px' }}>
                                        {storageHistory.filter(d => d.type === 'backup').map((drive, idx) => (
                                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #444', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.9rem', direction: 'ltr' }}>{drive.path}</span>
                                                <span style={{ color: drive.status === 'online' ? '#17a2b8' : '#ff4d4d', fontSize: '0.8rem' }}>
                                                    {drive.status === 'online' ? `${drive.freeGB}GB פנוי` : 'מנותק'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={async () => {
                                            const p = prompt("הזן נתיב לכונן גיבוי חדש (למשל E:/Backup):");
                                            if (p) {
                                                try {
                                                    await axios.post(`${API_URL}/api/admin/add-drive`, { path: p, type: 'backup' }, { headers: { 'x-access-token': currentToken } });
                                                    fetchStorageSettings();
                                                } catch (e) { alert("שגיאה בהוספת כונן"); }
                                            }
                                        }}
                                        style={{ width: '100%', padding: '8px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                                    >
                                        🛡️ הוסף כונן גיבוי חדש
                                    </button>
                                </div>

                                {/* כפתורי פעולה כלליים */}
                                <hr style={{ borderColor: '#444', margin: '20px 0' }} />

                                <button
                                    onClick={async () => {
                                        let pass = prompt("הזן סיסמת מנהל לרענון כללי של הכוננים:");
                                        if (!pass) return;
                                        try {
                                            await axios.post(`${API_URL}/api/admin/refresh-drives`, {}, { headers: { 'x-access-token': currentToken, 'x-admin-password': pass } });
                                            alert("הרענון הסתיים! כל הקבצים נטענו מחדש מהכוננים המחוברים.");
                                            fetchFiles();
                                        } catch (e) { alert("שגיאה ברענון הכוננים"); }
                                    }}
                                    style={{ width: '100%', padding: '12px', background: '#e0a800', color: 'black', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', marginBottom: '10px' }}>
                                    🔄 רענון כוננים (סריקה מחדש)
                                </button>

                                <button
                                    onClick={handleRunBackup}
                                    style={{ width: '100%', padding: '12px', background: '#6f42c1', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' }}>
                                    🚀 הפעל גיבוי ידני עכשיו
                                </button>

                                <p style={{ fontSize: '0.75rem', color: '#888', textAlign: 'center', marginTop: '10px' }}>
                                    * המערכת מבצעת גיבוי אוטומטי פעם בשבוע לכוננים המוגדרים כ-Backup.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {
                isLoginModalOpen && (
                    <div style={styles.lightbox} onClick={() => setIsLoginModalOpen(false)}>
                        <div style={{ ...styles.filterBar, flexDirection: 'column', width: '300px', gap: '15px' }} onClick={e => e.stopPropagation()}>
                            <h3>כניסת מנהל</h3>
                            <input type="text" placeholder="שם משתמש" value={tempUser} onChange={e => setTempUser(e.target.value)} style={styles.input} />
                            <input type="password" placeholder="סיסמה" value={tempPass} onChange={e => setTempPass(e.target.value)} style={styles.input} />
                            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                                <button onClick={() => setIsLoginModalOpen(false)} style={{ ...styles.actionBtn, background: '#666', padding: '10px', flex: 1, borderRadius: '5px' }}>ביטול</button>
                                <button onClick={submitAdminLogin} style={{ ...styles.actionBtn, background: '#63a171ff', padding: '10px', flex: 1, borderRadius: '5px' }}>כניסה</button>
                            </div>
                        </div>
                    </div>
                )
            }
            {
                isAdmin && (
                    <div style={{ position: 'fixed', bottom: '30px', left: '30px', display: 'flex', flexDirection: 'column-reverse', alignItems: 'center', gap: '15px', zIndex: 1000 }}>

                        <button
                            onClick={() => setShowAdminMenu(!showAdminMenu)}
                            style={{
                                width: '65px', height: '65px', borderRadius: '50%',
                                background: '#444', color: 'white', border: '3px solid #007bff',
                                cursor: 'pointer', fontSize: '30px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}
                        >
                            👤
                        </button>

                        {showAdminMenu && (
                            <>
                                <Link to="/upload">
                                    <button
                                        title="הוספת תמונות"
                                        style={{
                                            width: '55px', height: '55px', borderRadius: '50%',
                                            background: '#28a745', color: 'white', border: 'none',
                                            cursor: 'pointer', fontSize: '24px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
                                        }}
                                    >
                                        ➕
                                    </button>
                                </Link>

                                <button
                                    onClick={handleIpIconClick}
                                    title="ניהול IP"
                                    style={{
                                        width: '45px', height: '45px', borderRadius: '50%',
                                        background: '#17a2b8', color: 'white', border: 'none',
                                        cursor: 'pointer', fontSize: '18px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
                                    }}
                                >
                                    ⚙️
                                </button>

                                <button
                                    onClick={() => { setIsAdmin(false); setAdminPassword(''); setShowAdminMenu(false); alert("התנתקת בהצלחה"); }}
                                    title="התנתקות"
                                    style={{
                                        width: '35px', height: '35px', borderRadius: '50%',
                                        background: '#dc3545', color: 'white', border: 'none',
                                        cursor: 'pointer', fontSize: '14px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
                                    }}
                                >
                                    ✖
                                </button>
                            </>
                        )}
                    </div>
                )
            }        </div >
    );
}

export default Gallery;