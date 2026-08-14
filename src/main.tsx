import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/v19.css';
import './styles/react-host.css';
// Last, so the Stage 7 composition layer can override the frozen inline creative.
import './styles/campaign-overlay.css';
// Presentation-only Teams overrides, after the frozen layout they adjust.
import './styles/teams-presentation.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
