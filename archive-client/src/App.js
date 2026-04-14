import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import Gallery from './components/Gallery';
import UploadForm from './components/UploadForm';

function App() {
  const [token, setToken] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');

    if (tokenFromUrl) {
      // אם הגענו מהכונן המשותף עם טוקן חדש - שמור אותו
      localStorage.setItem('archive_token', tokenFromUrl);
      // מנקה את ה-URL כדי שהטוקן לא יישאר גלוי
      window.history.replaceState({}, document.title, window.location.pathname);
      return tokenFromUrl;
    }
    return localStorage.getItem('archive_token');
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://10.8.52.22:3001/api/login', { username, password });
      const newToken = res.data.token;
      localStorage.setItem('archive_token', newToken);
      setToken(newToken);
    } catch (err) {
      setError('שם משתמש או סיסמה שגויים');
    }
  };

useEffect(() => {
    if (token) {
      axios.defaults.headers.common['x-access-token'] = token;
    }
  }, [token]);

  if (!token) {
    return (
      <div style={{ background: '#222', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontFamily: 'sans-serif' }}>
        <form onSubmit={handleLogin} style={{ background: '#333', padding: '30px', borderRadius: '10px', width: '300px', textAlign: 'center' }}>
          <h2>כניסה לארכיון</h2>
          <input type="text" placeholder="שם משתמש" value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '10px' }} />
          <input type="password" placeholder="סיסמה" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '10px' }} />
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <button type="submit" style={{ width: '100%', padding: '10px', background: '#007bff', color: 'white', border: 'none', cursor: 'pointer' }}>התחבר</button>
        </form>
      </div>
    );
  }

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Gallery />} />
          <Route path="/upload" element={<UploadForm />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;