import { render } from 'preact';
// oxlint-disable import/no-unassigned-import -- stylesheets
import '@/ui/tokens.css';
import '@/ui/base.css';
import './popup.css';
// oxlint-enable import/no-unassigned-import
import { App } from './App';

const root = document.getElementById('app');
if (root) render(<App />, root);
