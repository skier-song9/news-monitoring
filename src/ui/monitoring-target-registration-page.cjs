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

function renderOrderedKeywordList(keywords, emptyMessage) {
  if (!keywords.length) {
    return `<p class="muted-copy">${escapeHtml(emptyMessage)}</p>`;
  }

  return `
    <ul class="seed-keyword-list">
      ${keywords
        .map(
          (keyword) => `
            <li>
              <strong>${escapeHtml(keyword.keyword)}</strong>
              <span>Order ${escapeHtml(keyword.displayOrder + 1)}</span>
            </li>
          `,
        )
        .join('')}
    </ul>
  `;
}

function renderTagList(items, emptyMessage) {
  if (!items.length) {
    return `<p class="muted-copy">${escapeHtml(emptyMessage)}</p>`;
  }

  return `
    <ul class="tag-list">
      ${items
        .map(
          (item) => `
            <li class="tag-chip">${escapeHtml(item)}</li>
          `,
        )
        .join('')}
    </ul>
  `;
}

function getSafeEvidenceHref(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return parsedUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function renderSearchResultGroups(searchResults) {
  if (!searchResults.length) {
    return '<p class="muted-copy">No discovery search evidence is stored for this profile yet.</p>';
  }

  return `
    <div class="search-groups">
      ${searchResults
        .map(
          (resultGroup) => `
            <section class="search-group">
              <strong>${escapeHtml(resultGroup.keyword)}</strong>
              <ul class="search-result-list">
                ${(Array.isArray(resultGroup.results) ? resultGroup.results : [])
                  .map(
                    (result) => {
                      const safeHref = getSafeEvidenceHref(result.url);
                      const title = safeHref
                        ? `<a href="${escapeHtml(safeHref)}">${escapeHtml(result.title)}</a>`
                        : `<span>${escapeHtml(result.title)}</span>`;

                      return `
                      <li>
                        ${title}
                        <span>${escapeHtml(result.source || 'Source not provided')}</span>
                      </li>
                    `;
                    },
                  )
                  .join('')}
              </ul>
            </section>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderReviewDecisionForm(reviewWorkflow) {
  const selectedDecision = reviewWorkflow.review?.reviewDecision ?? '';
  const canSaveDecision = reviewWorkflow.reviewControls.canSaveDecision;
  const disabledAttribute = canSaveDecision ? '' : ' disabled';

  return `
    <form method="post" class="decision-form">
      <input type="hidden" name="action" value="save-review" />
      <fieldset class="decision-fieldset"${disabledAttribute}>
        <legend>Decision</legend>
        <p class="field-help">Save one of the supported review states: <strong>match</strong>, <strong>partial_match</strong>, or <strong>mismatch</strong>.</p>
        <div class="decision-grid">
          ${reviewWorkflow.reviewControls.availableDecisions
            .map((decision) => {
              const checkedAttribute = decision === selectedDecision ? ' checked' : '';

              return `
                <label class="decision-option">
                  <input type="radio" name="decision" value="${escapeHtml(decision)}"${checkedAttribute} required />
                  <span>
                    <strong>${escapeHtml(decision)}</strong>
                    <small>${escapeHtml(getDecisionDescription(decision))}</small>
                  </span>
                </label>
              `;
            })
            .join('')}
        </div>
      </fieldset>
      <div class="form-actions">
        <p class="muted-copy">
          ${canSaveDecision
            ? 'Saving a decision updates the backend review state immediately.'
            : escapeHtml(getReviewDecisionBlockedReason(reviewWorkflow))}
        </p>
        <button type="submit"${disabledAttribute}>Save review decision</button>
      </div>
    </form>
  `;
}

function getDecisionDescription(decision) {
  if (decision === 'match') {
    return 'The generated profile clearly matches the intended subject.';
  }

  if (decision === 'partial_match') {
    return 'The profile is close enough to approve, but still needs operator caution.';
  }

  return 'The generated profile is off-target and should reopen keyword editing.';
}

function getReviewDecisionBlockedReason(reviewWorkflow) {
  if (!reviewWorkflow.profile) {
    return 'Review decisions stay locked until discovery generates a profile.';
  }

  if (reviewWorkflow.monitoringTarget.status === 'active') {
    return 'This target is already active, so the review decision is now read-only.';
  }

  return `Review decisions are unavailable while the target is ${reviewWorkflow.monitoringTarget.status}.`;
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

      .step-list li,
      .decision-option,
      .search-group,
      .activation-note {
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

      .target-form,
      .decision-form,
      .activation-form {
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
        cursor: pointer;
      }

      button[disabled] {
        cursor: not-allowed;
        opacity: 0.55;
        background: linear-gradient(135deg, #809184, #536457);
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

      .seed-keyword-list,
      .tag-list,
      .search-result-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0.7rem;
      }

      .seed-keyword-list li,
      .search-result-list li {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.9rem 1rem;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.56);
        border: 1px solid rgba(40, 78, 59, 0.1);
      }

      .tag-list {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .tag-chip {
        padding: 0.8rem 0.95rem;
        border-radius: 16px;
        background: rgba(225, 236, 221, 0.8);
        border: 1px solid rgba(40, 78, 59, 0.12);
      }

      .decision-grid,
      .support-grid {
        display: grid;
        gap: 0.8rem;
      }

      .decision-fieldset {
        border: 0;
        padding: 0;
        margin: 0;
      }

      .decision-option {
        display: flex;
        align-items: flex-start;
        gap: 0.8rem;
        margin: 0;
      }

      .decision-option input {
        width: auto;
        margin-top: 0.25rem;
      }

      .decision-option small {
        display: block;
        margin-top: 0.25rem;
        color: var(--muted);
        font-weight: 400;
      }

      .decision-status {
        display: grid;
        gap: 0.4rem;
      }

      .search-groups {
        display: grid;
        gap: 0.9rem;
      }

      .search-group strong {
        display: block;
        margin-bottom: 0.7rem;
      }

      .search-result-list li {
        align-items: flex-start;
      }

      .search-result-list a {
        color: var(--accent-strong);
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
  const profile = reviewWorkflow.profile;
  const review = reviewWorkflow.review;
  const heroCopy = profile
    ? `
        <strong>${escapeHtml(target.displayName)}</strong> has generated discovery output ready inside <strong>${escapeHtml(reviewWorkflow.workspace.name)}</strong>.
        Review the summary, aliases, related entities, and keyword candidates before deciding whether collection can move forward.
      `
    : `
        <strong>${escapeHtml(target.displayName)}</strong> is already anchored in <strong>${escapeHtml(reviewWorkflow.workspace.name)}</strong>,
        but discovery still needs to generate the review profile before a decision or activation can happen.
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
              <p class="muted-copy">Review stays target-specific so the approval record, activation state, and generated profile stay tied to one subject.</p>
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
              <h2>Generated profile</h2>
              <p class="muted-copy">
                ${profile
                  ? 'The discovery job has already persisted this profile for operator review.'
                  : 'No generated profile is attached yet. Discovery needs to run before the full review decision can be saved.'}
              </p>
            </div>
            ${profile
              ? `
                  <div class="support-grid">
                    <div class="activation-note">
                      <strong>Summary</strong>
                      <p>${escapeHtml(profile.summary)}</p>
                    </div>
                    <div class="activation-note">
                      <strong>Profile metadata</strong>
                      <p>Model version: ${escapeHtml(profile.modelVersion)}</p>
                      <p>Generated at: ${escapeHtml(profile.generatedAt)}</p>
                    </div>
                  </div>
                `
              : `
                  <div class="activation-note">
                    <strong>Discovery pending</strong>
                    <p>The review URL is ready, but the generated summary, aliases, related entities, and keyword candidates will appear only after discovery completes.</p>
                  </div>
                `}
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Profile signals</h2>
              <p class="muted-copy">Use these generated signals to decide whether the monitoring subject matches your original intent.</p>
            </div>
            <div class="support-grid">
              <div>
                <h3>Related entities</h3>
                ${renderTagList(profile?.relatedEntities ?? [], 'No related entities were generated.')}
              </div>
              <div>
                <h3>Aliases</h3>
                ${renderTagList(profile?.aliases ?? [], 'No aliases were generated.')}
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Keyword candidates</h2>
              <p class="muted-copy">Seed keywords define the original scope. Expanded keywords are the candidate terms discovery generated for operator review.</p>
            </div>
            <div class="support-grid">
              <div>
                <h3>Seed keywords</h3>
                ${renderOrderedKeywordList(target.seedKeywords, 'No seed keywords were saved.')}
              </div>
              <div>
                <h3>Expanded keywords</h3>
                ${renderOrderedKeywordList(target.expandedKeywords, 'No expanded keyword candidates were generated yet.')}
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Discovery evidence</h2>
              <p class="muted-copy">Stored search results show which seed queries informed the generated profile.</p>
            </div>
            ${renderSearchResultGroups(profile?.searchResults ?? [])}
          </section>
        </section>
        <aside class="stack">
          <section class="panel">
            <div class="panel-intro">
              <h2>Review decision</h2>
              <p class="muted-copy">This screen can persist <strong>match</strong>, <strong>partial_match</strong>, or <strong>mismatch</strong> before activation is allowed.</p>
            </div>
            ${renderReviewDecisionForm(reviewWorkflow)}
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Current state</h2>
              <p class="muted-copy">Review and activation timestamps stay separate so approval history remains auditable.</p>
            </div>
            <div class="decision-status">
              <p><strong>Saved decision:</strong> ${escapeHtml(review?.reviewDecision ?? 'none')}</p>
              <p><strong>Reviewed at:</strong> ${escapeHtml(review?.reviewedAt ?? 'Not saved yet')}</p>
              <p><strong>Activated at:</strong> ${escapeHtml(review?.activatedAt ?? 'Not activated')}</p>
            </div>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Activation</h2>
              <p class="muted-copy">Activation is unavailable until a review decision is saved and approved.</p>
            </div>
            <form method="post" class="activation-form">
              <input type="hidden" name="action" value="activate" />
              <div class="activation-note">
                <strong>Availability</strong>
                <p>${escapeHtml(reviewWorkflow.activation.blockedReason ?? 'Activation is ready for this approved target.')}</p>
              </div>
              <div class="form-actions">
                <p class="muted-copy">Signed in as <strong>${escapeHtml(reviewWorkflow.viewer.role)}</strong> for this workspace.</p>
                <button type="submit"${reviewWorkflow.activation.canActivate ? '' : ' disabled'}>Activate monitoring target</button>
              </div>
            </form>
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
