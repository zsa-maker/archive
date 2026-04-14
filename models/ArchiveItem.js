// models/ArchiveItem.js
const mongoose = require('mongoose');

const ArchiveItemSchema = new mongoose.Schema({
  // --- מניעת כפילויות ---
  fileHash: { type: String, required: true, unique: true, index: true },
  
  // --- פרטים טכניים ---
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  path: { type: String, required: true }, // איפה זה יושב פיזית
  thumbnailPath: { type: String }, // תמונה קטנה לתצוגה
  streamPath: { type: String }, // וידאו מומר

  // --- היררכיה ארגונית (מה שהגדרת) ---
  framework: { type: String, required: true }, // מסגרת: ביסט/בח"א/כללי
  population: { type: String }, // אוכלוסייה
  courseNumber: { type: String }, // מספר קורס
  eventName: { type: String }, // שם אירוע
  
  // --- תאריכים ---
  originalDate: { type: Date }, // תאריך שנשלף מהקובץ (EXIF)
  displayDate: { type: Date, default: Date.now }, // תאריך לתצוגה (עריכה)
  uploadDate: { type: Date, default: Date.now },

  // --- סטטוס עיבוד (לוידאו) ---
  processingStatus: { 
    type: String, 
    enum: ['none', 'pending', 'done', 'error'], 
    default: 'none' 
  }
});

module.exports = mongoose.model('ArchiveItem', ArchiveItemSchema);
