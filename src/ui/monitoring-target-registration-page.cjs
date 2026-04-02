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

function getKeywordSourceLabel(sourceType) {
  if (sourceType === 'seed') {
    return 'Seed keywords';
  }

  if (sourceType === 'expanded') {
    return 'Expanded keywords';
  }

  return 'Excluded keywords';
}

function getKeywordSourceDescription(sourceType) {
  if (sourceType === 'seed') {
    return 'The original operator-provided terms that establish subject scope.';
  }

  if (sourceType === 'expanded') {
    return 'Generated or manually added discovery terms that broaden collection coverage.';
  }

  return 'Terms that should stay out of collection even if they share the same surface wording.';
}

function getKeywordEmptyMessage(sourceType) {
  if (sourceType === 'seed') {
    return 'No seed keywords were saved yet.';
  }

  if (sourceType === 'expanded') {
    return 'No expanded keyword candidates are stored yet.';
  }

  return 'No excluded keywords are stored yet.';
}

function renderKeywordActionButton({
  action,
  label,
  targetKeywordId,
  disabled,
}) {
  return `
    <form method="post" class="keyword-action-form">
      <input type="hidden" name="action" value="${escapeHtml(action)}" />
      <input type="hidden" name="targetKeywordId" value="${escapeHtml(targetKeywordId)}" />
      <button type="submit"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>
    </form>
  `;
}

function renderKeywordList({
  sourceType,
  keywords,
  canEdit,
}) {
  if (!keywords.length) {
    return `<p class="muted-copy">${escapeHtml(getKeywordEmptyMessage(sourceType))}</p>`;
  }

  return `
    <ul class="keyword-editor-list">
      ${keywords
        .map((keyword) => {
          const statusLabel = keyword.isActive ? 'active' : 'disabled';

          return `
            <li class="keyword-card${keyword.isActive ? '' : ' keyword-card-disabled'}">
              <div class="keyword-card-copy">
                <strong>${escapeHtml(keyword.keyword)}</strong>
                <div class="keyword-meta">
                  <span>Order ${escapeHtml(keyword.displayOrder + 1)}</span>
                  <span class="status-pill">${escapeHtml(statusLabel)}</span>
                </div>
              </div>
              <div class="keyword-card-actions">
                ${keyword.isActive
                  ? renderKeywordActionButton({
                      action: 'disable-keyword',
                      label: 'Disable',
                      targetKeywordId: keyword.id,
                      disabled: !canEdit,
                    })
                  : ''}
                ${renderKeywordActionButton({
                  action: 'remove-keyword',
                  label: 'Remove',
                  targetKeywordId: keyword.id,
                  disabled: !canEdit,
                })}
              </div>
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

function renderKeywordEditorSection(reviewWorkflow, sourceType, keywords) {
  const canEdit = reviewWorkflow.keywordEditor.canEdit;
  const inputId = `${sourceType}-keyword-input`;

  return `
    <section class="keyword-section">
      <div class="keyword-section-header">
        <h3>${escapeHtml(getKeywordSourceLabel(sourceType))}</h3>
        <p class="muted-copy">${escapeHtml(getKeywordSourceDescription(sourceType))}</p>
      </div>
      ${renderKeywordList({
        sourceType,
        keywords,
        canEdit,
      })}
      <form method="post" class="keyword-add-form">
        <input type="hidden" name="action" value="add-keyword" />
        <input type="hidden" name="sourceType" value="${escapeHtml(sourceType)}" />
        <label for="${escapeHtml(inputId)}">Add ${escapeHtml(sourceType)} keyword</label>
        <div class="keyword-inline-form">
          <input
            id="${escapeHtml(inputId)}"
            name="keyword"
            type="text"
            autocomplete="off"
            placeholder="Add a ${escapeHtml(sourceType)} keyword"
            ${canEdit ? '' : 'disabled'}
          />
          <button type="submit"${canEdit ? '' : ' disabled'}>Add</button>
        </div>
      </form>
    </section>
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

      .tag-list,
      .search-result-list,
      .keyword-editor-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 0.7rem;
      }

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

      .keyword-editor-grid {
        display: grid;
        gap: 1rem;
      }

      .keyword-section {
        display: grid;
        gap: 0.9rem;
        padding: 1rem;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.48);
        border: 1px solid rgba(40, 78, 59, 0.12);
      }

      .keyword-section-header {
        display: grid;
        gap: 0.35rem;
      }

      .keyword-card {
        display: grid;
        gap: 0.85rem;
        padding: 0.95rem 1rem;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.68);
        border: 1px solid rgba(40, 78, 59, 0.1);
      }

      .keyword-card-disabled {
        opacity: 0.82;
      }

      .keyword-card-copy,
      .keyword-card-actions,
      .keyword-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        align-items: center;
      }

      .keyword-meta {
        color: var(--muted);
        font-size: 0.92rem;
      }

      .keyword-card-actions {
        justify-content: flex-start;
      }

      .keyword-action-form {
        margin: 0;
      }

      .keyword-action-form button,
      .keyword-add-form button {
        padding-inline: 1rem;
      }

      .keyword-inline-form {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .keyword-inline-form input {
        flex: 1 1 220px;
      }

      .keyword-add-form {
        display: grid;
        gap: 0.6rem;
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

      .panel-highlighted,
      .target-policy-card-highlighted {
        border-color: rgba(40, 78, 59, 0.24);
        box-shadow: 0 24px 60px rgba(22, 49, 35, 0.18);
      }

      .policy-summary-grid,
      .target-policy-grid,
      .channel-grid,
      .policy-overview-list {
        display: grid;
        gap: 1rem;
      }

      .policy-summary-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-bottom: 1rem;
      }

      .policy-stat,
      .channel-card,
      .target-policy-card,
      .policy-overview-list li {
        padding: 1rem;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.56);
        border: 1px solid rgba(40, 78, 59, 0.1);
      }

      .policy-stat strong,
      .target-policy-card-header strong {
        display: block;
        margin-bottom: 0.35rem;
      }

      .policy-stat p {
        margin: 0;
        color: var(--muted);
      }

      .target-policy-card,
      .alert-settings-form {
        display: grid;
        gap: 1rem;
      }

      .target-policy-card-header,
      .toggle-option {
        display: flex;
        gap: 0.9rem;
        align-items: flex-start;
        justify-content: space-between;
      }

      .target-policy-card-header {
        flex-wrap: wrap;
      }

      .toggle-option input {
        width: auto;
        margin-top: 0.25rem;
      }

      .toggle-option span {
        display: grid;
        gap: 0.2rem;
        flex: 1 1 auto;
      }

      .toggle-option small {
        color: var(--muted);
        font-weight: 400;
      }

      .channel-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .channel-card {
        display: grid;
        gap: 0.75rem;
      }

      .field-error {
        margin: 0;
        color: var(--error);
        font-size: 0.92rem;
      }

      .form-error {
        padding: 0.9rem 1rem;
        border-radius: 16px;
        background: rgba(249, 227, 222, 0.96);
      }

      .policy-overview-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .body-${bodyClass} .hero-copy strong {
        color: var(--accent-strong);
      }

      @media (max-width: 820px) {
        .layout,
        .field-grid,
        .meta-list,
        .policy-summary-grid,
        .channel-grid {
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
        const keywordAddForms = document.querySelectorAll('.keyword-add-form');

        if (targetForm && seedKeywordsField) {
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
        }

        for (const keywordAddForm of keywordAddForms) {
          const keywordField = keywordAddForm.querySelector('input[name="keyword"]');

          if (!keywordField) {
            continue;
          }

          const validateKeyword = () => {
            const hasKeyword = keywordField.value.trim().length > 0;

            keywordField.setCustomValidity(
              hasKeyword ? '' : 'Enter a keyword before saving.',
            );

            return hasKeyword;
          };

          keywordField.addEventListener('input', validateKeyword);
          keywordAddForm.addEventListener('submit', (event) => {
            if (validateKeyword()) {
              return;
            }

            event.preventDefault();
            keywordField.reportValidity();
          });
        }
      })();
    </script>
  </body>
</html>`;
}

function getAlertPolicySourceLabel(scope) {
  if (scope === 'target') {
    return 'Target override';
  }

  if (scope === 'workspace') {
    return 'Workspace default';
  }

  if (scope === 'monitoring_target_default') {
    return 'Target default threshold';
  }

  return 'Platform default threshold';
}

function getAlertPolicySourceDescription(scope, options = {}) {
  const isWorkspacePolicy = options.isWorkspacePolicy === true;

  if (scope === 'target') {
    return 'This target has a saved override, so it no longer inherits the workspace default.';
  }

  if (scope === 'workspace') {
    return isWorkspacePolicy
      ? 'Targets without overrides inherit the current workspace default policy.'
      : 'This target is inheriting the current workspace default policy.';
  }

  if (scope === 'monitoring_target_default') {
    return 'No saved workspace or target policy exists yet, so only the target threshold is active.';
  }

  return 'No workspace policy row exists yet, so the platform threshold remains the fallback.';
}

function getEnabledChannelSummary(policy) {
  const enabledChannels = [];

  if (policy.slackEnabled) {
    enabledChannels.push('Slack');
  }

  if (policy.emailEnabled) {
    enabledChannels.push('Email');
  }

  if (policy.smsEnabled) {
    enabledChannels.push('SMS');
  }

  return enabledChannels.length ? enabledChannels.join(', ') : 'No channels enabled';
}

function renderFieldError(errors, fieldName) {
  if (!errors || !errors[fieldName]) {
    return '';
  }

  return `<p class="field-error">${escapeHtml(errors[fieldName])}</p>`;
}

function renderAlertPolicySummary(policy) {
  return `
    <div class="policy-summary-grid">
      <article class="policy-stat">
        <strong>Effective threshold</strong>
        <p>${escapeHtml(policy.riskThreshold)}</p>
      </article>
      <article class="policy-stat">
        <strong>Enabled channels</strong>
        <p>${escapeHtml(getEnabledChannelSummary(policy))}</p>
      </article>
      <article class="policy-stat">
        <strong>Policy source</strong>
        <p>${escapeHtml(getAlertPolicySourceLabel(policy.scope))}</p>
      </article>
    </div>
  `;
}

function renderAlertSettingsForm({
  action,
  formState,
  submitLabel,
  monitoringTargetId = null,
}) {
  const values = formState.values;
  const errors = formState.errors ?? {};
  const scopeId = monitoringTargetId ? escapeHtml(monitoringTargetId) : 'workspace';

  return `
    <form method="post" class="alert-settings-form">
      <input type="hidden" name="action" value="${escapeHtml(action)}" />
      ${monitoringTargetId
        ? `<input type="hidden" name="monitoringTargetId" value="${scopeId}" />`
        : ''}
      ${errors.form ? `<p class="field-error form-error">${escapeHtml(errors.form)}</p>` : ''}
      <div class="field-grid">
        <div>
          <label for="risk-threshold-${scopeId}">Risk threshold</label>
          <input
            id="risk-threshold-${scopeId}"
            name="riskThreshold"
            type="number"
            min="0"
            max="100"
            step="1"
            inputmode="numeric"
            value="${escapeHtml(values.riskThreshold)}"
            placeholder="70"
          />
          <p class="field-help">Alerts trigger when the stored risk score meets or exceeds this value.</p>
          ${renderFieldError(errors, 'riskThreshold')}
        </div>
      </div>
      <div class="channel-grid">
        <section class="channel-card">
          <label class="toggle-option">
            <input type="checkbox" name="slackEnabled" value="1"${values.slackEnabled ? ' checked' : ''} />
            <span>
              <strong>Slack</strong>
              <small>Send alert notifications to a Slack webhook destination.</small>
            </span>
          </label>
          <div>
            <label for="slack-url-${scopeId}">Webhook URL</label>
            <input
              id="slack-url-${scopeId}"
              name="slackWebhookUrl"
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value="${escapeHtml(values.slackWebhookUrl)}"
            />
            <p class="field-help">Use a valid Slack incoming webhook URL.</p>
            ${renderFieldError(errors, 'slackWebhookUrl')}
          </div>
        </section>
        <section class="channel-card">
          <label class="toggle-option">
            <input type="checkbox" name="emailEnabled" value="1"${values.emailEnabled ? ' checked' : ''} />
            <span>
              <strong>Email</strong>
              <small>Enter one address per line or separate multiple recipients with commas.</small>
            </span>
          </label>
          <div>
            <label for="email-recipients-${scopeId}">Recipients</label>
            <textarea
              id="email-recipients-${scopeId}"
              name="emailRecipients"
              placeholder="risk@example.com&#10;legal@example.com"
            >${escapeHtml(values.emailRecipients)}</textarea>
            <p class="field-help">The backend normalizes duplicate addresses before saving.</p>
            ${renderFieldError(errors, 'emailRecipients')}
          </div>
        </section>
        <section class="channel-card">
          <label class="toggle-option">
            <input type="checkbox" name="smsEnabled" value="1"${values.smsEnabled ? ' checked' : ''} />
            <span>
              <strong>SMS</strong>
              <small>Use E.164 formatting such as <code>+12025550100</code>.</small>
            </span>
          </label>
          <div>
            <label for="sms-recipients-${scopeId}">Recipients</label>
            <textarea
              id="sms-recipients-${scopeId}"
              name="smsRecipients"
              placeholder="+12025550100&#10;+12025550101"
            >${escapeHtml(values.smsRecipients)}</textarea>
            <p class="field-help">Enter one number per line or separate them with commas.</p>
            ${renderFieldError(errors, 'smsRecipients')}
          </div>
        </section>
      </div>
      <div class="form-actions">
        <p class="muted-copy">Only workspace admins can save or update these settings.</p>
        <button type="submit">${escapeHtml(submitLabel)}</button>
      </div>
    </form>
  `;
}

function renderAlertSettingsTargetCard(alertSettingsPage, monitoringTarget) {
  const targetReviewHref = `/workspaces/${escapeHtml(alertSettingsPage.workspace.id)}/targets/${escapeHtml(monitoringTarget.id)}/review?userId=${escapeHtml(alertSettingsPage.viewer.userId)}`;

  return `
    <article class="target-policy-card${monitoringTarget.alertSettingsForm.isHighlighted ? ' target-policy-card-highlighted' : ''}">
      <div class="target-policy-card-header">
        <div>
          <h3>${escapeHtml(monitoringTarget.displayName)}</h3>
          <p class="muted-copy">
            ${escapeHtml(monitoringTarget.type)} target, status <strong>${escapeHtml(monitoringTarget.status)}</strong>, default threshold ${escapeHtml(monitoringTarget.defaultRiskThreshold)}.
          </p>
        </div>
        <span class="status-pill">${escapeHtml(getAlertPolicySourceLabel(monitoringTarget.effectivePolicy.scope))}</span>
      </div>
      ${renderAlertPolicySummary(monitoringTarget.effectivePolicy)}
      <p class="muted-copy">${escapeHtml(getAlertPolicySourceDescription(monitoringTarget.effectivePolicy.scope))}</p>
      ${renderAlertSettingsForm({
        action: 'save-target-alert-settings',
        formState: monitoringTarget.alertSettingsForm,
        submitLabel: 'Save target override',
        monitoringTargetId: monitoringTarget.id,
      })}
      <div class="form-actions">
        <p class="muted-copy">${monitoringTarget.note ? escapeHtml(monitoringTarget.note) : 'No operator note is stored for this target.'}</p>
        <a class="link-button" href="${targetReviewHref}">Open review workflow</a>
      </div>
    </article>
  `;
}

function renderAlertSettingsPage({
  alertSettingsPage,
  flashMessage,
}) {
  return renderLayout({
    title: `Alert settings | ${alertSettingsPage.workspace.name}`,
    eyebrow: `${alertSettingsPage.workspace.name} | Alerts`,
    bodyClass: 'alert-settings',
    heroTitle: 'Alert settings',
    heroCopy:
      'Workspace defaults set the baseline delivery policy. Each monitoring target can inherit that policy or save a dedicated override when a subject needs a different threshold or channel mix.',
    content: `
      ${renderFlashMessage(flashMessage)}
      <div class="layout">
        <section class="stack">
          <section class="panel${alertSettingsPage.workspacePolicy.form.isHighlighted ? ' panel-highlighted' : ''}">
            <div class="panel-intro">
              <h2>Workspace defaults</h2>
              <p class="muted-copy">Use this as the baseline policy for every target that does not have its own override.</p>
            </div>
            ${renderAlertPolicySummary(alertSettingsPage.workspacePolicy.effectivePolicy)}
            <p class="muted-copy">${escapeHtml(getAlertPolicySourceDescription(alertSettingsPage.workspacePolicy.effectivePolicy.scope, { isWorkspacePolicy: true }))}</p>
            ${renderAlertSettingsForm({
              action: 'save-workspace-alert-settings',
              formState: alertSettingsPage.workspacePolicy.form,
              submitLabel: 'Save workspace defaults',
            })}
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Target overrides</h2>
              <p class="muted-copy">Targets without an override inherit the workspace policy automatically, while new overrides start from the currently effective settings.</p>
            </div>
            <div class="target-policy-grid">
              ${alertSettingsPage.monitoringTargets.length
                ? alertSettingsPage.monitoringTargets
                    .map((monitoringTarget) =>
                      renderAlertSettingsTargetCard(alertSettingsPage, monitoringTarget),
                    )
                    .join('')
                : '<p class="muted-copy">No monitoring targets exist yet, so only workspace defaults can be configured right now.</p>'}
            </div>
          </section>
        </section>
        <aside class="stack">
          <section class="panel">
            <div class="panel-intro">
              <h2>Policy precedence</h2>
              <p class="muted-copy">Alert resolution follows the same backend order used by dispatch jobs.</p>
            </div>
            <ol class="policy-overview-list">
              <li><strong>Target override</strong> wins when a target-specific row exists.</li>
              <li><strong>Workspace default</strong> applies when no target override is saved.</li>
              <li><strong>Target threshold</strong> is the fallback when no alert policy row exists yet.</li>
            </ol>
          </section>
          <section class="panel">
            <div class="panel-intro">
              <h2>Operator context</h2>
            </div>
            <p class="muted-copy">Signed in as <strong>${escapeHtml(alertSettingsPage.viewer.role)}</strong> for this workspace. Save actions write directly into the auditable <code>alert_policy</code> table.</p>
            <p style="margin-top: 1rem;">
              <a class="link-button" href="/workspaces/${escapeHtml(alertSettingsPage.workspace.id)}/targets/new?userId=${escapeHtml(alertSettingsPage.viewer.userId)}">Register another target</a>
            </p>
          </section>
        </aside>
      </div>
    `,
  });
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
              <h2>Keyword editor</h2>
              <p class="muted-copy">
                Edits save immediately on this review route. Only active seed, expanded, and excluded keywords will feed the collector once the target is activated.
              </p>
            </div>
            <div class="keyword-editor-grid">
              ${renderKeywordEditorSection(reviewWorkflow, 'seed', target.seedKeywords)}
              ${renderKeywordEditorSection(reviewWorkflow, 'expanded', target.expandedKeywords)}
              ${renderKeywordEditorSection(reviewWorkflow, 'excluded', target.excludedKeywords)}
            </div>
            ${reviewWorkflow.keywordEditor.canEdit
              ? ''
              : `
                  <p class="muted-copy">${escapeHtml(reviewWorkflow.keywordEditor.blockedReason ?? 'Keyword editing is unavailable.')}</p>
                `}
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
  renderAlertSettingsPage,
  renderMonitoringTargetRegistrationPage,
  renderMonitoringTargetReviewPage,
};
