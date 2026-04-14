const WinReg = require('winreg'); // You might need: npm install winreg
const path = require('path');

// Replace this with the name of your generated .exe
const APP_NAME = "MyArchiveApp";
const APP_PATH = `"${path.join(process.cwd(), 'dist', 'win-unpacked', 'My Archive App.exe')}"`;

const regKey = new WinReg({
  hive: WinReg.HKCU,
  key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
});

regKey.set(APP_NAME, WinReg.REG_SZ, APP_PATH, (err) => {
  if (err) {
    console.error('❌ Failed to set startup registry key:', err);
  } else {
    console.log('✅ Success! The app will now start automatically with Windows.');
  }
});