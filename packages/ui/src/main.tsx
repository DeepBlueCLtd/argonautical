import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import '@fontsource/architects-daughter/latin-400.css';
import './styles.css';
import { installSketchFrames } from './sketch/frames.ts';

installSketchFrames();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
