// The start page: shows who is signed in. This file is yours: change or remove it.
import { review } from '/_review/review.js';

review.me().then(
  (email) => (document.getElementById('me').textContent = `Signed in as ${email}`),
  () => {}
);
