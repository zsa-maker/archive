// src/components/Home.js
import React from 'react';
import { Link } from 'react-router-dom';

function Home() {
  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>ארכיון דיגיטלי</h1>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '30px' }}>
        <Link to="/Gallery">
          <button style={{ padding: '20px 40px', fontSize: '1.2rem', cursor: 'pointer' }}>
             🔍 חיפוש בארכיון
          </button>
        </Link>
        <Link to="/upload">
          <button style={{ padding: '20px 40px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#007bff', color: 'white' }}>
             📤 העלאת חומרים
          </button>
        </Link>
      </div>
    </div>
  );
}

export default Home;