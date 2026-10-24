// Startup screen. Status text comes from the query string (?lang=fr&first=1); the main process
// closes the window once the Dock is on screen.
import { createTranslator } from '../../shared/i18n';

const params = new URLSearchParams(location.search);
const t = createTranslator(params.get('lang') === 'en' ? 'en' : 'fr');
document.documentElement.lang = params.get('lang') === 'en' ? 'en' : 'fr';
document.getElementById('status')!.textContent = params.get('first') === '1' ? t('splash.first') : t('splash.loading');
