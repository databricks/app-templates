// The start page: shows whether the app is set up. This file is yours: change or remove it.
import { review } from '/_review/review.js';

const $ = (id) => document.getElementById(id);

function status(state, title, text, link) {
  $('status').dataset.state = state;
  $('status-title').textContent = title;
  $('status-text').textContent = text;
  $('status-link').hidden = !link;
}

(async () => {
  review.me().then(
    (email) => ($('me').textContent = `Signed in as ${email}`),
    () => {}
  );
  try {
    const res = await fetch('/api/review-queue/setup');
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const left = (await res.json()).checks.filter((c) => c.ok !== true).length;
    if (left)
      status(
        'todo',
        'Finish the app setup',
        `${left} ${left === 1 ? 'item' : 'items'} to fix before reviewers can start.`,
        true
      );
    else status('ready', 'The app is set up', 'It can read traces and save answers. Share it with your reviewers.');
  } catch (e) {
    status('todo', "Couldn't check the app setup", e.message, true);
  }
})();
