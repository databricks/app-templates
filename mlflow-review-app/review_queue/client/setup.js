// The /setup page: checks the app's access and grants the trace tables. Template-owned.
const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
}

async function call(path, method = 'GET') {
  const res = await fetch(path, { method });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`);
  return data;
}

const isSql = (fix) => fix?.startsWith('GRANT');
const nameOf = (c) => c.label || c.name;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
let sql = ''; // the GRANT statements still needed, for Copy SQL
let pending = []; // the checks Grant access is fixing: [{ fix, label }]
let lastGrant = null; // results of the last Grant click for those checks, kept until every grant is in place

function step(id, state, text) {
  $(id).dataset.state = state;
  $(id).lastElementChild.textContent = text;
}

// The card at the top: one next action, chosen from the first step that is not done.
function action({ tone = '', icon, title, text = [], chips = [], show = [], note = '' }) {
  $('action').dataset.tone = tone;
  $('action-icon').setAttribute('href', `#i-${icon}`);
  $('action-title').textContent = title;
  $('action-text').replaceChildren(...text);
  $('chips').replaceChildren(...chips.map((c) => el('li', {}, c)));
  for (const id of ['grant', 'open-app', 'copy', 'copy-link', 'recheck']) $(id).hidden = !show.includes(id);
  $('action-note').textContent = note;
  $('grant-warn').hidden = true;
  $('grant-result').replaceChildren();
}

function row(c) {
  const status = c.ok === true ? 'Ready' : c.ok === false || isSql(c.fix) ? 'Missing' : 'Unknown';
  const li = el(
    'li',
    { className: 'row', title: c.ok === true ? '' : [c.detail, isSql(c.fix) ? '' : c.fix].filter(Boolean).join(' ') },
    el('span', { className: `dot${c.ok === true ? ' ok' : ''}`, ariaHidden: 'true' }),
    el('span', { className: 'name' }, nameOf(c)),
    c.object ? el('code', {}, c.object.split('.').pop()) : null,
    el('span', { className: 'st' }, status)
  );
  li.dataset.ok = String(c.ok === true);
  return li;
}

function renderChecks(checks) {
  const passed = checks.filter((c) => c.ok === true);
  $('rows').replaceChildren(...checks.filter((c) => c.ok !== true).map(row));
  $('passed').hidden = !passed.length;
  $('passed-text').textContent = `${plural(passed.length, 'check')} passed: ${passed.map((c) => nameOf(c)).join(', ')}`;
  $('passed-rows').replaceChildren(...passed.map(row));
}

function cannotGrantWarning(missing) {
  const cannot = missing.filter((c) => c.you_can_grant === false);
  if (!cannot.length) return;
  const owners = [...new Set(cannot.map((c) => c.owner).filter(Boolean))];
  $('grant-warn').hidden = false;
  $('grant-warn').replaceChildren(
    el('b', {}, `You can't grant ${cannot.length === 1 ? 'this table' : `${cannot.length} of these tables`}.`),
    ` Ask ${owners.length ? owners.join(' or ') : 'the table owner'} to open this page and click Grant access, or send them the SQL.`
  );
}

async function load() {
  let data;
  try {
    data = await call('/api/review-queue/setup');
  } catch (e) {
    action({ tone: 'warn', icon: 'alert', title: 'Could not check the app.', text: [e.message], show: ['recheck'] });
    return;
  }
  const sp = String(data.service_principal ?? '');
  $('sp').textContent = sp.length > 16 ? `${sp.slice(0, 8)}…${sp.slice(-4)}` : sp;
  $('sp').title = sp;
  const resources = data.checks.filter((c) => c.group !== 'access');
  const access = data.checks.filter((c) => c.group === 'access');
  const badResources = resources.filter((c) => c.ok !== true);
  const badAccess = access.filter((c) => c.ok !== true);
  const grants = badAccess.filter((c) => isSql(c.fix));
  sql = grants.map((c) => c.fix).join('\n');
  if (!lastGrant) pending = grants.map((c) => ({ fix: c.fix, label: nameOf(c) }));
  const ready = !badResources.length && !badAccess.length;
  if (ready) lastGrant = null;
  renderChecks([...resources, ...access]);

  const count = (list, bad) => `${list.length - bad.length} of ${list.length} ready`;
  step('step-resources', badResources.length ? 'bad' : 'done', count(resources, badResources));
  step(
    'step-access',
    !badAccess.length ? 'done' : badResources.length ? '' : lastGrant ? 'bad' : 'now',
    access.length ? count(access, badAccess) : "Can't check yet"
  );
  step('step-share', ready ? 'now' : '', ready ? 'Last step' : 'After step 2');
  $('title').textContent = ready ? 'This app is ready' : 'Set up this app';
  $('sub').textContent = ready
    ? 'Reviewers can start now.'
    : 'Three steps before reviewers can start. This page checks what the app can access.';
  $('share').hidden = ready;
  $('share').dataset.ready = String(ready);

  if (badResources.length) {
    action({
      tone: 'warn',
      icon: 'plug',
      title: 'Fix the app resources',
      text: [[...new Set(badResources.map((c) => c.fix).filter(Boolean))].join(' '), ' Then redeploy the app.'],
      chips: badResources.map(nameOf),
      show: ['recheck'],
    });
  } else if (grants.length) {
    const schemaCheck = access.find((c) => c.label === 'Schema');
    const schema = schemaCheck?.object ?? grants[0].object?.split('.').slice(0, 2).join('.');
    const failed = lastGrant?.filter((r) => !r.ok) ?? [];
    if (failed.length) {
      const worked = lastGrant.length - failed.length;
      action({
        tone: 'warn',
        icon: 'lock',
        title: "You can't grant all of these tables",
        text: [
          worked
            ? `${plural(worked, 'grant')} worked. The other ${failed.length} need someone with MANAGE on the tables, or their owner.`
            : `${plural(failed.length, 'grant')} failed. ${failed.length === 1 ? 'It needs' : 'They need'} someone with MANAGE on the tables, or their owner.`,
        ],
        show: ['grant', 'copy'],
      });
      $('grant-result').replaceChildren(
        ...lastGrant.map((r) =>
          el(
            'li',
            { className: r.ok ? 'ok' : 'bad' },
            el('span', { className: 'k' }, r.ok ? '✓' : '✕'),
            el('span', {}, r.label, r.ok ? '' : el('span', { className: 'why' }, ` · ${r.detail}`))
          )
        )
      );
    } else {
      action({
        icon: 'lock',
        title: 'Give the app access to the trace tables',
        text:
          schemaCheck?.ok !== true
            ? [
                "The app can't use the schema ",
                el('code', {}, schema ?? ''),
                ', so it cannot read traces or save answers.',
              ]
            : [
                `The app is missing ${plural(grants.length, 'grant')} on the trace tables in `,
                el('code', {}, schema ?? ''),
                ', so reviewers cannot use it yet.',
              ],
        chips: grants.map(nameOf),
        show: ['grant', 'copy'],
        note: `Runs ${plural(grants.length, 'GRANT statement')} as you.`,
      });
    }
    $('grant').textContent = failed.length ? 'Try again' : 'Grant access';
    cannotGrantWarning(grants);
  } else if (badAccess.length) {
    action({
      tone: 'warn',
      icon: 'alert',
      title: nameOf(badAccess[0]),
      text: [[badAccess[0].detail, badAccess[0].fix].filter(Boolean).join(' ')],
      show: ['recheck'],
    });
  } else {
    action({
      tone: 'ok',
      icon: 'check',
      title: 'Everything the app needs is in place',
      text: [
        "Share it with your reviewers: in the app's permissions, give them Can use. You can give it to all workspace users; each reviewer only sees the queues they're a member of.",
      ],
      show: ['open-app', 'copy-link'],
    });
  }
}

$('grant').addEventListener('click', async () => {
  const button = $('grant');
  button.disabled = true;
  button.textContent = 'Granting…';
  try {
    // The server grants every trace securable; report only the ones this click was meant to fix.
    const { results } = await call('/api/review-queue/setup/grant', 'POST');
    lastGrant = pending.flatMap((p) => {
      const r = results.find((x) => `${x.statement};` === p.fix);
      return r ? [{ ...r, label: p.label }] : [];
    });
  } catch (e) {
    lastGrant = [{ ok: false, label: 'Grant access', detail: e.message }];
  } finally {
    button.disabled = false;
    await load();
  }
});

async function copy(button, text, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = label;
  }, 1500);
}
$('copy').addEventListener('click', () => copy($('copy'), sql, 'Copy SQL'));
$('copy-link').addEventListener('click', () => copy($('copy-link'), `${location.origin}/`, 'Copy app link'));
$('recheck').addEventListener('click', () => load());

load();
