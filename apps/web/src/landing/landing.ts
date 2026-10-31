// The marketing page's only script (TUI-76): its styles and fonts, and the monthly/yearly prices.
// The questions open and close as <details>, without script.
import './landing.css';

const toggle = document.querySelector<HTMLElement>('.billing-toggle');

toggle?.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-interval]');
  if (!button) return;
  const interval = button.dataset.interval === 'year' ? 'year' : 'month';
  for (const b of toggle.querySelectorAll<HTMLButtonElement>('button[data-interval]')) {
    b.setAttribute('aria-pressed', String(b === button));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-month][data-year]')) {
    el.textContent = el.dataset[interval] ?? el.textContent;
  }
});
