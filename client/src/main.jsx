import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './store/authStore';
import { ThemeProvider } from './themeProvider.jsx';
import { SportProvider } from './context/SportContext.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <SportProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </SportProvider>
    </ThemeProvider>
  </StrictMode>
);
