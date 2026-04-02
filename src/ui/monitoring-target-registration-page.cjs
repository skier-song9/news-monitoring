'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderFlashMessage(flashMessage) {
  if (!flashMessage) {
    return '';
  }

  const toneClass = flashMessage.type === 'success' ? 'flash-success' : 'flash-error';

  return `
    <section class="panel flash ${toneClass}" aria-live="polite">
      <strong>${escapeHtml(flashMessage.title)}</strong>
      <p>${escapeHtml(flashMessage.message)}</p>
    </section>
  `;
}

function renderTypeOptions(availableTargetTypes, selectedType) {
  return availableTargetTypes
    .map((targetType) => {
      const selectedAttribute = targetType === selectedType ? ' selected' : '';
      const label = targetType === 'company' ? 'Company' : 'Person';

      return `<option value="${escapeHtml(targetType)}"${selectedAttribute}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function renderSeedKeywordList(seedKeywords) {
  if (!seedKeywords.length) {
    return '<p class="muted-copy">No seed keywords were saved.</p>';
  }

  return `
    <ul class="seed-keyword-list">
      ${seedKeywords
        .map(
          (seedKeyword) => `
            <li>
              <strong>${escapeHtml(seedKeyword.keyword)}</strong>
              <span>Order ${escapeHtml(seedKeyword.displayOrder + 1)}</span>
            </li>
          `,
        )
        .join('')}
    </ul>
  `;
}

function renderLayout({ title, eyebrow, bodyClass, heroTitle, heroCopy, content }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1e8;
        --bg-accent: #d7ddc7;
        --panel: rgba(255, 253, 248, 0.92);
        --panel-border: rgba(44, 53, 35, 0.14);
        --text: #1e2820;
        --muted: #576658;
        --accent: #284e3b;
        --accent-strong: #163123;
        --accent-soft: #e1ecdd;
        --success: #1d5f38;
        --success-bg: #ddf1e3;
        --error: #7f231c;
        --error-bg: #f9e3de;
        --shadow: 0 24px 60px rgba(30, 40, 32, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.82), transparent 34%),
          linear-gradient(135deg, var(--bg), var(--bg-accent));
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      main {
        width: min(1120px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 3rem 0 4rem;
        animation: fade-in 240ms ease-out;
      }

      .hero {
        display: grid;
        gap: 0.9rem;
        margin-bottom: 1.5rem;
      }

      .eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.76rem;
        color: var(--muted);
      }

      h1,
      h2,
      h3 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      }

      h1 {
        font-size: clamp(2.3rem, 4vw, 3.8rem);
        line-height: 0.95;
        max-width: 13ch;
      }

      .hero-copy {
        max-width: 66ch;
        color: var(--muted);
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
        gap: 1.25rem;
      }

      .stack {
        display: grid;
        gap: 1.25rem;
      }

      .panel {
        background: var(--panel);
        backdrop-filter: blur(10px);
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        padding: 1.35rem;
      }

      .flash {
        display: grid;
        gap: 0.35rem;
      }

      .flash p,
      .panel p,
      .meta-list dd,
      .meta-list li {
        margin: 0;
      }

      .flash-success {
        background: var(--success-bg);
        color: var(--success);
      }

      .flash-error {
        background: var(--error-bg);
        color: var(--error);
      }

      .panel-intro {
        display: grid;
        gap: 0.35rem;
        margin-bottom: 1rem;
      }

      .muted-copy {
        color: var(--muted);
      }

      .step-list {
        display: grid;
        gap: 0.85rem;
        padding: 0;
        margin: 0;
        list-style: none;
      }

      .step-list li {
        padding: 0.9rem 1rem;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.56);
        border: 1px solid rgba(40, 78, 59, 0.1);
      }

      .step-list strong,
      .meta-list dt {
        display: block;
        margin-bottom: 0.2rem;
      }

      .target-form {
        display: grid;
        gap: 1rem;
      }

      .field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }

      label,
      legend {
        font-weight: 700;
        display: block;
        margin-bottom: 0.45rem;
      }

      input,
      select,
      textarea,
      button {
        width: 100%;
        font: inherit;
      }

      input,
      select,
      textarea {
        border: 1px solid rgba(40, 78, 59, 0.18);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.88);
        color: var(--text);
        padding: 0.82rem 0.95rem;
      }

      textarea {
        min-height: 8rem;
        resize: vertical;
      }

      .field-help {
        margin-top: 0.4rem;
        font-size: 0.93rem;
        color: var(--muted);
      }

      .form-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.85rem;
        align-items: center;
      }

      button,
      .link-button {
        width: auto;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: white;
        font-weight: 700;
        padding: 0.8rem 1.2rem;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent-strong);
        padding: 0.36rem 0.7rem;
        font-size: 0.84rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .meta-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.95rem 1rem;
        margin: 0;
      }

      .seed-keyword-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0.7rem;
      }

      .seed-keyword-list li {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.9rem 1rem;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.56);
        border: 1px solid rgba(40, 78, 59, 0.1);
      }

      .body-${bodyClass} .hero-copy strong {
        color: var(--accent-strong);
      }

      @media (max-width: 820px) {
        .layout,
        .field-grid,
        .meta-list {
          grid-template-columns: 1fr;
        }

        main {
          width: min(100% - 1rem, 100%);
          padding: 1.2rem 0 2rem;
        }
      }

      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </head>
  <body class="body-${escapeHtml(bodyClass)}">
    <main>
      <header class="hero">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(heroTitle)}</h1>
        <p class="hero-copy">${heroCopy}</p>
      </header>
      ${content}
    </main>
    <script>
      (() => {
        const targetForm = document.querySelector('.target-form');
        const seedKeywordsField = document.getElementById('target-seed-keywords');

        if (!targetForm || !seedKeywordsField) {
          return;
        }

        const validateSeedKeywords = () => {
          const hasSeedKeyword = seedKeywordsField.value
            .split(/\\r?\\n/u)
            .some((keyword) => keyword.trim().length > 0);

          seedKeywordsField.setCustomValidity(
            hasSeedKeyword ? '' : 'Enter at least one seed keyword.',
          );

          return hasSeedKeyword;
        };

        seedKeywordsField.addEventListener('input', validateSeedKeywords);
        targetForm.addEventListener('submit', (event) => {
          if (validateSeedKeywords()) {
            return;
          }

          event.preventDefault();
          seedKeywordsField.reportValidity();
        });
      })();
    </script>
  </body>
</html>`;
}

function renderMonitoringTargetRegistrationPage({
  registration,
  formValues,
  flashMessage,
}) {
  const heroCopy = `
    Create the first draft of a subject profile for <strong>${escapeHtml(registration.workspace.name)}</strong>.
    Seed keywords set the scope, the default threshold sets the alert baseline, and the next step moves directly into review.
  `;

  return renderLayout({
    title: `${registration.workspace.name} target registration`,
    eyebrow: `${registration.workspace.slug} monitor setup`,
    bodyClass: 'registration',
    heroTitle: 'Register a monitoring target',
    heroCopy,
    content: `
      <div class="layout">
        <section class="panel">
          ${renderFlashMessage(flashMessage)}
          <div class="panel-intro">
            <h2>Target details</h2>
            <p class="muted-copy">Every new target starts in review-required status until the subject profile is checked.</p>
          </div>
          <form method="post" class="target-form">
            <div class="field-grid">
              <div>
                <label for="target-type">Entity type</label>
                <select id="target-type" name="type">
                  ${renderTypeOptions(registration.availableTargetTypes, formValues.type || registration.defaults.type)}
                </select>
              </div>
              <div>
                <label for="target-threshold">Default risk threshold</label>
                <input
                  id="target-threshold"
                  name="defaultRiskThreshold"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value="${escapeHtml(formValues.defaultRiskThreshold || String(registration.defaults.defaultRiskThreshold))}"
                />
                <p class="field-help">Use a value between 0 and 100. Leave the default unless this target needs stricter alerts.</p>
              </div>
            </div>
            <div>
              <label for="target-display-name">Display name</label>
              <input
                id="target-display-name"
                name="displayName"
                type="text"
                autocomplete="off"
                placeholder="Acme Holdings"
                required
                value="${escapeHtml(formValues.displayName)}"
              />
            </div>
            <div>
              <label for="target-note">Operator note</label>
              <textarea
                id="target-note"
                name="note"
                placeholder="Why this subject matters, disambiguation hints, or watch-list context."
              >${escapeHtml(formValues.note)}</textarea>
            </div>
            <div>
              <label for="target-seed-keywords">Seed keywords</label>
              <textarea
                id="target-seed-keywords"
                name="seedKeywords"
                placeholder="Acme Holdings&#10;Acme chairman&#10;Acme founder"
                required
              >${escapeHtml(formValues.seedKeywords)}</textarea>
              <p class="field-help">Enter one seed keyword per line. Empty or whitespace-only submissions are rejected server-side too.</p>
            </div>
            <div class="form-actions">
              <p class="muted-copy">Signed in as <strong>${escapeHtml(registration.viewer.role)}</strong> for this workspace.</p>
              <button type="submit">Save target and continue to review</button>
            </div>
          </form>
        </section>
        <aside class="stack">
          <section class="panel">
            <div class="panel-intro">
              <h2>Workflow</h2>
              <p class="muted-copy">This screen only captures the target definition. Review follows immediately after save.</p>
            </div>
            <ol class="step-list">
              <li>
                <strong>1. Define the subject</strong>
                <span>Choose the entity type, display name, threshold, and the first seed keywords.</span>
              </li>
              <li>
                <strong>2. Review generated profile</strong>
                <span>Use the target-specific review URL to inspect generated aliases, related entities, and expanded terms.</span>
              </li>
              <li>
                <strong>3. Activate collection</strong>
                <span>Only approved targets move on to activation and scheduled collection.</span>
              </li>
            </ol>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>What gets saved</h2>
            </div>
            <dl class="meta-list">
              <div>
                <dt>Initial status</dt>
                <dd><span class="status-pill">review_required</span></dd>
              </div>
              <div>
                <dt>Seed keyword ordering</dt>
                <dd>Preserved in the same order you submit here.</dd>
              </div>
              <div>
                <dt>Membership rule</dt>
                <dd>Any active workspace member can register a target.</dd>
              </div>
              <div>
                <dt>Review handoff</dt>
                <dd>The form redirects to a target-specific review workflow URL after save.</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    `,
  });
}

function renderMonitoringTargetReviewPage({
  reviewWorkflow,
  flashMessage,
}) {
  const target = reviewWorkflow.monitoringTarget;
  const heroCopy = `
    <strong>${escapeHtml(target.displayName)}</strong> now has a stable review URL inside <strong>${escapeHtml(reviewWorkflow.workspace.name)}</strong>.
    Full profile review controls arrive next, but this workflow entry point already anchors the newly created target and its seed scope.
  `;

  return renderLayout({
    title: `${target.displayName} review workflow`,
    eyebrow: `${reviewWorkflow.workspace.slug} review workflow`,
    bodyClass: 'review',
    heroTitle: 'Monitoring target review',
    heroCopy,
    content: `
      <div class="layout">
        <section class="stack">
          ${renderFlashMessage(flashMessage)}
          <section class="panel">
            <div class="panel-intro">
              <h2>Target snapshot</h2>
              <p class="muted-copy">The target has been saved and is waiting for the rest of the review flow to populate discovery output.</p>
            </div>
            <dl class="meta-list">
              <div>
                <dt>Display name</dt>
                <dd>${escapeHtml(target.displayName)}</dd>
              </div>
              <div>
                <dt>Entity type</dt>
                <dd>${escapeHtml(target.type)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><span class="status-pill">${escapeHtml(target.status)}</span></dd>
              </div>
              <div>
                <dt>Default threshold</dt>
                <dd>${escapeHtml(target.defaultRiskThreshold)}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>${escapeHtml(reviewWorkflow.workspace.name)}</dd>
              </div>
              <div>
                <dt>Target id</dt>
                <dd>${escapeHtml(target.id)}</dd>
              </div>
            </dl>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Seed keywords</h2>
              <p class="muted-copy">These terms define the first pass of discovery and disambiguation for the subject.</p>
            </div>
            ${renderSeedKeywordList(target.seedKeywords)}
          </section>
        </section>
        <aside class="stack">
          <section class="panel">
            <div class="panel-intro">
              <h2>Review path</h2>
            </div>
            <ol class="step-list">
              <li>
                <strong>Saved</strong>
                <span>The monitoring target and ordered seed keywords are persisted.</span>
              </li>
              <li>
                <strong>Discovery output</strong>
                <span>Summary, aliases, related entities, and candidate keywords will attach here as the review surface expands.</span>
              </li>
              <li>
                <strong>Decision</strong>
                <span>Match, partial match, and mismatch decisions remain part of the next story.</span>
              </li>
            </ol>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Operator note</h2>
            </div>
            <p class="muted-copy">${target.note ? escapeHtml(target.note) : 'No note was saved for this target.'}</p>
            <p style="margin-top: 1rem;">
              <a class="link-button" href="/workspaces/${escapeHtml(reviewWorkflow.workspace.id)}/targets/new?userId=${escapeHtml(reviewWorkflow.viewer.userId)}">Register another target</a>
            </p>
          </section>
        </aside>
      </div>
    `,
  });
}

module.exports = {
  renderMonitoringTargetRegistrationPage,
  renderMonitoringTargetReviewPage,
};
