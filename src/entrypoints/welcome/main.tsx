import { render } from 'preact';
// oxlint-disable import/no-unassigned-import -- stylesheets
import '@/ui/tokens.css';
import '@/ui/base.css';
import '@/ui/page.css';
import './welcome.css';
// oxlint-enable import/no-unassigned-import
import { Welcome } from './Welcome';

const root = document.getElementById('app');
if (root) render(<Welcome />, root);
