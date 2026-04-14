const { app, BrowserWindow } = require('electron');
const path = require('path');

// 1. Start your backend server
require('./server.js'); 

function createWindow () {
  // 2. Create the browser window.
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // 3. Load the URL your local Express server is running on
  win.loadURL('http://localhost:8080');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});