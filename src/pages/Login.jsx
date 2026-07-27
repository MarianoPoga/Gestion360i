import React, { useState } from 'react';
import { db, isSupabaseConfigured, testSupabaseConnection } from '../supabaseClient';

function Login({ onLoginSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showDbConfig, setShowDbConfig] = useState(!isSupabaseConfigured());
  const [supabaseUrl, setSupabaseUrl] = useState(
    localStorage.getItem('supabase_url') || import.meta.env.VITE_SUPABASE_URL || 'https://fpjkwqzwcmnyoiqgronu.supabase.co'
  );
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(
    localStorage.getItem('supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  );
  const [dbSaving, setDbSaving] = useState(false);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');

  const handleSaveDbConfig = async (e) => {
    e.preventDefault();
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      setError('Completá la URL y la Anon Key de Supabase.');
      return;
    }

    setDbSaving(true);
    setError('');

    const result = await testSupabaseConnection(supabaseUrl, supabaseAnonKey);
    setDbSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    localStorage.setItem('supabase_url', supabaseUrl.trim());
    localStorage.setItem('supabase_anon_key', supabaseAnonKey.trim());
    window.location.reload();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isSupabaseConfigured()) {
      setError('Primero configurá la conexión a Supabase.');
      setShowDbConfig(true);
      return;
    }
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        const res = await db.signUp(email, password, businessName, fullName);
        if (res.error) {
          setError(res.error);
        } else {
          // Auto sign in after sign up
          const loginRes = await db.signIn(email, password);
          if (loginRes.success) {
            onLoginSuccess(loginRes.user);
          }
        }
      } else {
        const res = await db.signIn(email, password);
        if (res.success) {
          onLoginSuccess(res.user);
        } else {
          setError(res.error || 'Credenciales incorrectas');
        }
      }
    } catch (err) {
      setError('Ocurrió un error inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-background">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>
      
      <div className="login-card glass">
        <div className="login-header">
          <div className="logo-icon">
            <i className="bi bi-rocket-takeoff-fill"></i>
          </div>
          <h1>Gestion<span>360i</span></h1>
          <p>{isSignUp ? 'Crea tu cuenta de negocio' : 'Bienvenido de nuevo'}</p>
        </div>

        {!isSupabaseConfigured() && (
          <div className="db-setup">
            <button type="button" className="db-setup-toggle" onClick={() => setShowDbConfig(!showDbConfig)}>
              <i className="bi bi-database-gear"></i>
              Configurar Supabase {showDbConfig ? '▲' : '▼'}
            </button>
            {showDbConfig && (
              <form onSubmit={handleSaveDbConfig} className="db-setup-form">
                <p className="db-setup-help">
                  Las credenciales se guardan en este navegador. Las encontrás en Supabase → Project Settings → API.
                </p>
                <div className="input-group">
                  <i className="bi bi-link-45deg"></i>
                  <input
                    type="text"
                    placeholder="Supabase Project URL"
                    value={supabaseUrl}
                    onChange={(e) => setSupabaseUrl(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <i className="bi bi-key"></i>
                  <input
                    type="password"
                    placeholder="Supabase Anon Key"
                    value={supabaseAnonKey}
                    onChange={(e) => setSupabaseAnonKey(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="db-save-btn" disabled={dbSaving}>
                  {dbSaving ? 'Probando conexión...' : 'Guardar y conectar'}
                </button>
                {error && showDbConfig && (
                  <div className="login-error"><i className="bi bi-exclamation-circle"></i> {error}</div>
                )}
              </form>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          {isSignUp && (
            <>
              <div className="input-group">
                <i className="bi bi-person"></i>
                <input 
                  type="text" 
                  placeholder="Tu Nombre Completo" 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required 
                />
              </div>
              <div className="input-group">
                <i className="bi bi-building"></i>
                <input 
                  type="text" 
                  placeholder="Nombre de tu Negocio" 
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  required 
                />
              </div>
            </>
          )}

          <div className="input-group">
            <i className="bi bi-envelope"></i>
            <input 
              type="email" 
              placeholder="Email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
          </div>

          <div className="input-group">
            <i className="bi bi-lock"></i>
            <input 
              type="password" 
              placeholder="Contraseña" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>

          {error && <div className="login-error"><i className="bi bi-exclamation-circle"></i> {error}</div>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            ) : (
              isSignUp ? 'Empezar ahora' : 'Ingresar'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>
            {isSignUp ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'} 
            <button onClick={() => setIsSignUp(!isSignUp)} className="toggle-btn">
              {isSignUp ? 'Inicia Sesión' : 'Crea tu Negocio'}
            </button>
          </p>
        </div>
      </div>

      <style>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          background: #0f172a;
          font-family: 'Inter', sans-serif;
        }

        .login-background {
          position: absolute;
          width: 100%;
          height: 100%;
          z-index: 0;
        }

        .blob {
          position: absolute;
          filter: blur(80px);
          border-radius: 50%;
          opacity: 0.4;
        }

        .blob-1 {
          width: 400px;
          height: 400px;
          background: #3b82f6;
          top: -100px;
          right: -100px;
        }

        .blob-2 {
          width: 400px;
          height: 400px;
          background: #10b981;
          bottom: -100px;
          left: -100px;
        }

        .login-card {
          width: 100%;
          max-width: 450px;
          padding: 3rem;
          border-radius: 24px;
          z-index: 10;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(12px);
          background: rgba(30, 41, 59, 0.7);
        }

        .login-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }

        .logo-icon {
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #3b82f6 0%, #10b981 100%);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
          font-size: 2rem;
          color: white;
          box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.4);
        }

        .login-header h1 {
          color: white;
          font-size: 2.2rem;
          margin-bottom: 0.5rem;
          font-weight: 800;
        }

        .login-header h1 span {
          background: linear-gradient(to right, #3b82f6, #10b981);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .login-header p {
          color: #94a3b8;
          font-size: 1rem;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .input-group {
          position: relative;
        }

        .input-group i {
          position: absolute;
          left: 1.25rem;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          font-size: 1.1rem;
        }

        .input-group input {
          width: 100%;
          padding: 1rem 1rem 1rem 3.5rem;
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          color: white;
          outline: none;
          transition: all 0.3s;
          font-size: 1rem;
        }

        .input-group input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
          background: rgba(15, 23, 42, 0.8);
        }

        .login-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #f87171;
          padding: 0.75rem;
          border-radius: 8px;
          font-size: 0.9rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .login-btn {
          margin-top: 1rem;
          padding: 1rem;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .login-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.4);
          filter: brightness(1.1);
        }

        .login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .login-footer {
          margin-top: 2rem;
          text-align: center;
          color: #94a3b8;
          font-size: 0.95rem;
        }

        .toggle-btn {
          background: none;
          border: none;
          color: #3b82f6;
          font-weight: 600;
          margin-left: 0.5rem;
          cursor: pointer;
          padding: 0;
        }

        .toggle-btn:hover {
          text-decoration: underline;
        }

        .db-setup {
          margin-bottom: 1.5rem;
        }

        .db-setup-toggle {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 10px;
          color: #93c5fd;
          font-size: 0.9rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .db-setup-form {
          margin-top: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .db-setup-help {
          color: #94a3b8;
          font-size: 0.85rem;
          margin: 0;
          line-height: 1.4;
        }

        .db-save-btn {
          padding: 0.75rem;
          background: rgba(16, 185, 129, 0.2);
          border: 1px solid rgba(16, 185, 129, 0.4);
          border-radius: 10px;
          color: #6ee7b7;
          font-weight: 600;
          cursor: pointer;
        }

        .db-save-btn:hover {
          background: rgba(16, 185, 129, 0.3);
        }

        @media (max-width: 480px) {
          .login-card {
            padding: 2rem;
            max-width: 90%;
          }
        }
      `}</style>
    </div>
  );
}

export default Login;
