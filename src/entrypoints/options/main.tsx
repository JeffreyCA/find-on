import { render } from 'preact';
// oxlint-disable import/no-unassigned-import -- stylesheets
import '@/ui/tokens.css';
import '@/ui/base.css';
import '@/ui/page.css';
import './options.css';
// oxlint-enable import/no-unassigned-import
import { Options } from './Options';

const root = document.getElementById('app');
if (root) render(<Options />, root);
