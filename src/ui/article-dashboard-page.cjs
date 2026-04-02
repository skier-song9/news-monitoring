'use strict';

const { URL } = require('node:url');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(value, emptyLabel) {
  if (typeof value !== 'string' || !value) {
    return emptyLabel;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}

function formatPublishedAt(value) {
  return formatTimestamp(value, 'Publish time pending');
}

function formatRiskScore(value) {
  if (typeof value !== 'number') {
    return 'Pending score';
  }

  return `${value}/100`;
}

function getRiskToneClass(riskBand) {
  if (riskBand === 'high') {
    return 'risk-high';
  }

  if (riskBand === 'medium') {
    return 'risk-medium';
  }

  if (riskBand === 'low') {
    return 'risk-low';
  }

  return 'risk-pending';
}

function getRiskLabel(article) {
  if (!article.riskBand) {
    return 'Awaiting analysis';
  }

  return `${article.riskBand} risk`;
}

function renderTopicTags(topicLabels) {
  if (!topicLabels.length) {
    return '<p class="article-meta-copy muted-copy">No topics assigned yet.</p>';
  }

  return `
    <ul class="topic-tag-list">
      ${topicLabels
        .map(
          (topicLabel) => `
            <li class="topic-tag">${escapeHtml(topicLabel)}</li>
          `,
        )
        .join('')}
    </ul>
  `;
}

function renderArticleCard(article) {
  const detailHref =
    typeof article.detailHref === 'string' && article.detailHref
      ? article.detailHref
      : null;

  return `
    <article class="article-card" data-article-analysis-id="${escapeHtml(article.articleAnalysisId)}">
      <div class="article-card-header">
        <div class="article-card-copy">
          <p class="article-eyebrow">${escapeHtml(article.targetName)}</p>
          <h3>${escapeHtml(article.title)}</h3>
        </div>
        <div class="risk-pill ${escapeHtml(getRiskToneClass(article.riskBand))}">
          <strong>${escapeHtml(formatRiskScore(article.riskScore))}</strong>
          <span>${escapeHtml(getRiskLabel(article))}</span>
        </div>
      </div>
      <dl class="article-meta-grid">
        <div>
          <dt>Publisher</dt>
          <dd>${escapeHtml(article.publisherName || 'Publisher pending')}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>${escapeHtml(article.authorName || 'Author pending')}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>${escapeHtml(formatPublishedAt(article.publishedAt))}</dd>
        </div>
        <div>
          <dt>Feed record</dt>
          <dd>${escapeHtml(article.articleAnalysisId)}</dd>
        </div>
      </dl>
      <div class="article-topics">
        <strong>Topics</strong>
        ${renderTopicTags(article.topicLabels)}
      </div>
      ${
        detailHref
          ? `
            <div class="article-card-actions">
              <a class="article-detail-link" href="${escapeHtml(detailHref)}">Inspect article</a>
            </div>
          `
          : ''
      }
    </article>
  `;
}

function countHighRiskArticles(articles) {
  return articles.filter((article) => article.riskBand === 'high').length;
}

function renderArticleDashboardResults({ dashboardPage }) {
  const articleCount = dashboardPage.articles.length;
  const highRiskCount = countHighRiskArticles(dashboardPage.articles);

  if (!articleCount) {
    return `
      <div class="results-summary">
        <strong>0 articles match the current filters.</strong>
        <p class="muted-copy">Broaden the target, topic, publisher, or date filters to see more live coverage.</p>
      </div>
      <div class="empty-state">
        <h3>No matching articles yet</h3>
        <p>The dashboard will refresh automatically when new qualifying coverage appears.</p>
      </div>
    `;
  }

  return `
    <div class="results-summary">
      <strong>${escapeHtml(String(articleCount))} live article${articleCount === 1 ? '' : 's'}</strong>
      <p class="muted-copy">${escapeHtml(String(highRiskCount))} high-risk item${highRiskCount === 1 ? '' : 's'} in the current slice.</p>
    </div>
    <div class="article-grid">
      ${dashboardPage.articles.map((article) => renderArticleCard(article)).join('')}
    </div>
  `;
}

function renderOption({ value, label, selectedValue }) {
  const selectedAttribute = value === selectedValue ? ' selected' : '';

  return `<option value="${escapeHtml(value)}"${selectedAttribute}>${escapeHtml(label)}</option>`;
}

function renderMonitoringTargetOptions(dashboardPage) {
  const options = [
    renderOption({
      value: '',
      label: 'All monitoring targets',
      selectedValue: dashboardPage.filters.values.monitoringTargetId,
    }),
  ];

  for (const monitoringTarget of dashboardPage.filters.options.monitoringTargets) {
    const targetLabel =
      monitoringTarget.status === 'active'
        ? `${monitoringTarget.displayName}`
        : `${monitoringTarget.displayName} (${monitoringTarget.status.replaceAll('_', ' ')})`;

    options.push(
      renderOption({
        value: monitoringTarget.id,
        label: targetLabel,
        selectedValue: dashboardPage.filters.values.monitoringTargetId,
      }),
    );
  }

  return options.join('');
}

function renderRiskBandOptions(dashboardPage) {
  const options = [
    renderOption({
      value: '',
      label: 'All risk bands',
      selectedValue: dashboardPage.filters.values.riskBand,
    }),
  ];

  for (const riskBand of dashboardPage.filters.options.riskBands) {
    options.push(
      renderOption({
        value: riskBand.value,
        label: riskBand.label,
        selectedValue: dashboardPage.filters.values.riskBand,
      }),
    );
  }

  return options.join('');
}

function renderTopicOptions(dashboardPage) {
  const options = [
    renderOption({
      value: '',
      label: 'All topics',
      selectedValue: dashboardPage.filters.values.topicLabel,
    }),
  ];

  for (const topicLabel of dashboardPage.filters.options.topics) {
    options.push(
      renderOption({
        value: topicLabel,
        label: topicLabel,
        selectedValue: dashboardPage.filters.values.topicLabel,
      }),
    );
  }

  return options.join('');
}

function renderSortOptions(dashboardPage) {
  return dashboardPage.filters.options.sorts
    .map((sortOption) =>
      renderOption({
        value: sortOption.value,
        label: sortOption.label,
        selectedValue: dashboardPage.filters.values.sort,
      }),
    )
    .join('');
}

function renderPublisherSuggestions(dashboardPage) {
  return dashboardPage.filters.options.publishers
    .map(
      (publisherName) => `
        <option value="${escapeHtml(publisherName)}"></option>
      `,
    )
    .join('');
}

function toSafeExternalHref(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  try {
    const parsedValue = new URL(value);

    if (parsedValue.protocol !== 'http:' && parsedValue.protocol !== 'https:') {
      return null;
    }

    return parsedValue.toString();
  } catch {
    return null;
  }
}

function renderExternalLink({ href, label }) {
  const safeHref = toSafeExternalHref(href);

  if (!safeHref) {
    return '';
  }

  return `
    <li>
      <a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>
    </li>
  `;
}

function renderSignalList(values, emptyMessage) {
  if (!Array.isArray(values) || !values.length) {
    return `<p class="detail-empty-copy">${escapeHtml(emptyMessage)}</p>`;
  }

  return `
    <ul class="detail-chip-list">
      ${values
        .map(
          (value) => `
            <li class="detail-chip">${escapeHtml(value)}</li>
          `,
        )
        .join('')}
    </ul>
  `;
}

function renderSourceLinkList(articleDetail) {
  const links = [
    renderExternalLink({
      href: articleDetail.sourceUrl,
      label: 'Original source',
    }),
    renderExternalLink({
      href: articleDetail.canonicalUrl,
      label: 'Canonical article',
    }),
    ...(articleDetail.portalUrls || []).map((portalUrl, index) =>
      renderExternalLink({
        href: portalUrl,
        label: `Portal result ${index + 1}`,
      }),
    ),
  ].filter(Boolean);

  if (!links.length) {
    return '<p class="detail-empty-copy">No source links were stored for this article.</p>';
  }

  return `
    <ul class="detail-link-list">
      ${links.join('')}
    </ul>
  `;
}

function renderTimestampRow(label, value, emptyLabel) {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(formatTimestamp(value, emptyLabel))}</dd>
    </div>
  `;
}

function renderArticleDetailPage({ articleDetail, backHref }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(articleDetail.title)} detail</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe5;
        --surface: rgba(255, 252, 245, 0.92);
        --surface-strong: #fffdf7;
        --ink: #182126;
        --muted: #5f6b72;
        --line: rgba(24, 33, 38, 0.12);
        --accent: #9f2f1d;
        --accent-soft: rgba(159, 47, 29, 0.12);
        --high: #9f2f1d;
        --medium: #8a6b16;
        --low: #1e6b52;
        --shadow: 0 28px 80px rgba(41, 35, 24, 0.14);
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(159, 47, 29, 0.12), transparent 34%),
          linear-gradient(180deg, #f8f3e9 0%, var(--bg) 100%);
        color: var(--ink);
      }

      a {
        color: inherit;
      }

      main {
        width: min(1100px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 2rem 0 3rem;
      }

      .detail-shell {
        display: grid;
        gap: 1.25rem;
      }

      .detail-nav {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        width: fit-content;
        padding: 0.7rem 1rem;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(255, 252, 245, 0.72);
        text-decoration: none;
      }

      .detail-hero,
      .detail-section {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }

      .detail-hero {
        padding: 1.5rem;
      }

      .detail-eyebrow {
        margin: 0 0 0.75rem;
        color: var(--muted);
        font-size: 0.82rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .detail-title-row {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        align-items: flex-start;
        justify-content: space-between;
      }

      h1 {
        margin: 0;
        max-width: 14ch;
        font-size: clamp(2rem, 4vw, 3.3rem);
        line-height: 0.98;
      }

      .risk-pill {
        min-width: 10rem;
        padding: 0.9rem 1rem;
        border-radius: 18px;
        display: grid;
        gap: 0.2rem;
        color: white;
      }

      .risk-high {
        background: linear-gradient(135deg, #7f1d1d, var(--high));
      }

      .risk-medium {
        background: linear-gradient(135deg, #72560d, var(--medium));
      }

      .risk-low {
        background: linear-gradient(135deg, #14543f, var(--low));
      }

      .risk-pending {
        background: linear-gradient(135deg, #4f5b63, #73808a);
      }

      .detail-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.8rem;
        margin-top: 1.5rem;
      }

      .detail-summary-grid div,
      .detail-timestamp-grid div {
        padding: 0.95rem 1rem;
        border-radius: 16px;
        background: var(--surface-strong);
        border: 1px solid rgba(24, 33, 38, 0.08);
      }

      dt {
        margin: 0 0 0.3rem;
        color: var(--muted);
        font-size: 0.84rem;
      }

      dd {
        margin: 0;
        font-size: 1rem;
      }

      .detail-grid {
        display: grid;
        gap: 1.25rem;
        grid-template-columns: 1.2fr 0.8fr;
      }

      .detail-section {
        padding: 1.25rem;
      }

      .detail-section h2 {
        margin: 0 0 0.75rem;
        font-size: 1.15rem;
      }

      .detail-copy {
        margin: 0;
        line-height: 1.65;
      }

      .detail-empty-copy {
        margin: 0;
        color: var(--muted);
      }

      .detail-chip-list,
      .detail-link-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .detail-chip {
        padding: 0.55rem 0.85rem;
        border-radius: 999px;
        background: var(--accent-soft);
        border: 1px solid rgba(159, 47, 29, 0.14);
      }

      .detail-link-list a {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.75rem 0.9rem;
        border-radius: 14px;
        background: var(--surface-strong);
        border: 1px solid rgba(24, 33, 38, 0.08);
        text-decoration: none;
      }

      .detail-timestamp-grid,
      .detail-section-stack {
        display: grid;
        gap: 0.75rem;
      }

      .detail-section-stack {
        gap: 1.25rem;
      }

      @media (max-width: 860px) {
        .detail-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="detail-shell">
        <a class="detail-nav" href="${escapeHtml(backHref)}">Back to live article dashboard</a>
        <section class="detail-hero">
          <p class="detail-eyebrow">${escapeHtml(articleDetail.targetName)} detail view</p>
          <div class="detail-title-row">
            <div>
              <h1>${escapeHtml(articleDetail.title)}</h1>
            </div>
            <div class="risk-pill ${escapeHtml(getRiskToneClass(articleDetail.riskBand))}">
              <strong>${escapeHtml(formatRiskScore(articleDetail.riskScore))}</strong>
              <span>${escapeHtml(getRiskLabel(articleDetail))}</span>
            </div>
          </div>
          <dl class="detail-summary-grid">
            <div>
              <dt>Feed record</dt>
              <dd>${escapeHtml(articleDetail.articleAnalysisId)}</dd>
            </div>
            <div>
              <dt>Publisher</dt>
              <dd>${escapeHtml(articleDetail.publisherName || 'Publisher pending')}</dd>
            </div>
            <div>
              <dt>Author</dt>
              <dd>${escapeHtml(articleDetail.authorName || 'Author pending')}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>${escapeHtml(formatPublishedAt(articleDetail.ingestionTimestamps.publishedAt))}</dd>
            </div>
          </dl>
        </section>
        <div class="detail-grid">
          <div class="detail-section-stack">
            <section class="detail-section">
              <h2>Summary</h2>
              <p class="detail-copy">${escapeHtml(articleDetail.summary || 'Summary pending.')}</p>
            </section>
            <section class="detail-section">
              <h2>Risk rationale</h2>
              <p class="detail-copy">${escapeHtml(articleDetail.rationale || 'Risk rationale pending.')}</p>
            </section>
            <section class="detail-section">
              <h2>Matched keywords</h2>
              ${renderSignalList(
                articleDetail.matchedKeywords,
                'No matched keywords were stored for this article.',
              )}
            </section>
            <section class="detail-section">
              <h2>Entity signals</h2>
              ${renderSignalList(
                articleDetail.entitySignals,
                'No entity signals were stored for this article.',
              )}
            </section>
          </div>
          <div class="detail-section-stack">
            <section class="detail-section">
              <h2>Source links</h2>
              ${renderSourceLinkList(articleDetail)}
            </section>
            <section class="detail-section">
              <h2>Latest stored analysis timestamps</h2>
              <dl class="detail-timestamp-grid">
                ${renderTimestampRow(
                  'Relevance scored',
                  articleDetail.analysisTimestamps.relevanceScoredAt,
                  'Awaiting relevance analysis',
                )}
                ${renderTimestampRow(
                  'Topics classified',
                  articleDetail.analysisTimestamps.topicsClassifiedAt,
                  'Awaiting topic classification',
                )}
                ${renderTimestampRow(
                  'Summary generated',
                  articleDetail.analysisTimestamps.summaryGeneratedAt,
                  'Awaiting summary generation',
                )}
                ${renderTimestampRow(
                  'Risk scored',
                  articleDetail.analysisTimestamps.riskScoredAt,
                  'Awaiting risk scoring',
                )}
                ${renderTimestampRow(
                  'Last updated',
                  articleDetail.analysisTimestamps.updatedAt,
                  'Awaiting updates',
                )}
                ${renderTimestampRow(
                  'Source fetched',
                  articleDetail.ingestionTimestamps.fetchedAt,
                  'Awaiting source fetch',
                )}
              </dl>
            </section>
          </div>
        </div>
      </div>
    </main>
  </body>
</html>`;
}

function renderArticleDashboardPage({ dashboardPage, clearFiltersHref }) {
  const pollIntervalSeconds = Math.round(dashboardPage.liveRefresh.intervalMs / 1000);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(dashboardPage.workspace.name)} live article dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3eee4;
        --bg-accent: #d9e2d2;
        --panel: rgba(255, 253, 248, 0.94);
        --panel-border: rgba(33, 53, 43, 0.14);
        --text: #16211b;
        --muted: #55645b;
        --accent: #214d3b;
        --accent-deep: #153426;
        --accent-soft: #dcebdc;
        --danger: #7c2a1c;
        --danger-soft: #f6dfd8;
        --warn: #885c13;
        --warn-soft: #f8ecd2;
        --calm: #235d4d;
        --calm-soft: #d8eee6;
        --shadow: 0 28px 60px rgba(22, 33, 27, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.78), transparent 32%),
          linear-gradient(135deg, var(--bg), var(--bg-accent));
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      main {
        width: min(1200px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 2.25rem 0 3rem;
      }

      .hero,
      .panel,
      .results-shell,
      .filter-card,
      .stat-card,
      .article-card {
        border-radius: 24px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .hero {
        padding: 1.5rem;
        margin-bottom: 1.2rem;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(220, 235, 220, 0.92)),
          var(--panel);
      }

      .eyebrow {
        margin: 0 0 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.74rem;
        color: var(--muted);
      }

      h1,
      h2,
      h3 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      }

      h1 {
        font-size: clamp(2.4rem, 5vw, 4.2rem);
        line-height: 0.92;
        max-width: 12ch;
      }

      .hero-copy {
        max-width: 68ch;
        color: var(--muted);
        margin-top: 0.9rem;
      }

      .top-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.9fr);
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .filter-card,
      .results-shell,
      .stat-card {
        padding: 1.25rem;
      }

      .filter-card,
      .results-shell {
        display: grid;
        gap: 1rem;
      }

      .filter-grid,
      .stat-grid,
      .article-grid,
      .article-meta-grid {
        display: grid;
        gap: 0.9rem;
      }

      .filter-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .stat-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .stat-card {
        gap: 0.35rem;
      }

      .stat-card strong {
        display: block;
        font-size: 1.55rem;
      }

      .stat-card p,
      .article-meta-copy,
      .muted-copy,
      .results-summary p,
      .empty-state p {
        margin: 0;
        color: var(--muted);
      }

      label {
        display: grid;
        gap: 0.45rem;
        font-weight: 700;
      }

      input,
      select,
      button,
      .ghost-link {
        font: inherit;
      }

      input,
      select {
        width: 100%;
        border-radius: 16px;
        border: 1px solid rgba(33, 77, 59, 0.16);
        background: rgba(255, 255, 255, 0.92);
        color: var(--text);
        padding: 0.82rem 0.92rem;
      }

      .filter-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
        justify-content: space-between;
      }

      .filter-action-group {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }

      button,
      .ghost-link {
        border: 0;
        border-radius: 999px;
        padding: 0.8rem 1.2rem;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      button {
        background: linear-gradient(135deg, var(--accent), var(--accent-deep));
        color: white;
        font-weight: 700;
      }

      .ghost-link {
        background: rgba(255, 255, 255, 0.74);
        color: var(--accent-deep);
        border: 1px solid rgba(33, 77, 59, 0.14);
      }

      .section-header,
      .article-card-header {
        display: flex;
        gap: 0.9rem;
        align-items: flex-start;
        justify-content: space-between;
      }

      .results-summary,
      .empty-state {
        padding: 1rem 1.05rem;
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.62);
        border: 1px solid rgba(33, 77, 59, 0.1);
      }

      .article-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .article-card {
        padding: 1.1rem;
        display: grid;
        gap: 1rem;
      }

      .article-card-copy {
        display: grid;
        gap: 0.45rem;
      }

      .article-eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 0.76rem;
        color: var(--muted);
      }

      .risk-pill {
        min-width: 120px;
        padding: 0.8rem 0.95rem;
        border-radius: 18px;
        display: grid;
        gap: 0.15rem;
        text-align: right;
      }

      .risk-pill strong {
        font-size: 1.2rem;
      }

      .risk-high {
        background: var(--danger-soft);
        color: var(--danger);
      }

      .risk-medium {
        background: var(--warn-soft);
        color: var(--warn);
      }

      .risk-low {
        background: var(--calm-soft);
        color: var(--calm);
      }

      .risk-pending {
        background: rgba(220, 235, 220, 0.74);
        color: var(--accent);
      }

      .article-meta-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0;
      }

      .article-meta-grid dt {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.11em;
        color: var(--muted);
        margin-bottom: 0.25rem;
      }

      .article-meta-grid dd {
        margin: 0;
      }

      .article-topics {
        display: grid;
        gap: 0.55rem;
      }

      .article-card-actions {
        margin-top: 0.15rem;
      }

      .article-detail-link {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.7rem 0.95rem;
        border-radius: 999px;
        border: 1px solid rgba(33, 77, 59, 0.14);
        background: rgba(255, 255, 255, 0.76);
        color: var(--accent-deep);
        font-size: 0.92rem;
        font-weight: 700;
        text-decoration: none;
      }

      .topic-tag-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .topic-tag {
        padding: 0.42rem 0.75rem;
        border-radius: 999px;
        background: rgba(220, 235, 220, 0.88);
        border: 1px solid rgba(33, 77, 59, 0.1);
      }

      .live-status {
        margin: 0.25rem 0 0;
        color: var(--muted);
      }

      .status-highlight {
        color: var(--accent-deep);
        font-weight: 700;
      }

      @media (max-width: 980px) {
        .top-grid,
        .filter-grid,
        .stat-grid,
        .article-grid {
          grid-template-columns: 1fr;
        }

        .section-header,
        .article-card-header,
        .filter-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .risk-pill {
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <p class="eyebrow">Live dashboard · ${escapeHtml(dashboardPage.workspace.name)}</p>
        <h1>Track incoming risk coverage without leaving the feed.</h1>
        <p class="hero-copy">
          Filter by target, topic, source, date, or risk band while the results panel
          quietly refreshes every <strong>${escapeHtml(String(pollIntervalSeconds))} seconds</strong>.
        </p>
      </header>

      <section class="top-grid">
        <form class="filter-card" method="get">
          <input type="hidden" name="userId" value="${escapeHtml(dashboardPage.viewer.userId)}" />
          <div class="section-header">
            <div>
              <h2>Dashboard filters</h2>
              <p class="muted-copy">Highest-risk and newest views are one click away, but every filter can be combined.</p>
            </div>
          </div>
          <div class="filter-grid">
            <label>
              Monitoring target
              <select name="monitoringTargetId">
                ${renderMonitoringTargetOptions(dashboardPage)}
              </select>
            </label>
            <label>
              Risk band
              <select name="riskBand">
                ${renderRiskBandOptions(dashboardPage)}
              </select>
            </label>
            <label>
              Topic
              <select name="topicLabel">
                ${renderTopicOptions(dashboardPage)}
              </select>
            </label>
            <label>
              Sort
              <select name="sort">
                ${renderSortOptions(dashboardPage)}
              </select>
            </label>
            <label>
              Publisher
              <input
                type="text"
                name="publisher"
                list="article-dashboard-publisher-list"
                value="${escapeHtml(dashboardPage.filters.values.publisher)}"
                placeholder="Any publisher"
              />
            </label>
            <label>
              Published from
              <input
                type="date"
                name="publishedFrom"
                value="${escapeHtml(dashboardPage.filters.values.publishedFrom)}"
              />
            </label>
            <label>
              Published to
              <input
                type="date"
                name="publishedTo"
                value="${escapeHtml(dashboardPage.filters.values.publishedTo)}"
              />
            </label>
          </div>
          <datalist id="article-dashboard-publisher-list">
            ${renderPublisherSuggestions(dashboardPage)}
          </datalist>
          <div class="filter-actions">
            <p class="muted-copy">Live refresh keeps the visible result slice current; filters stay untouched.</p>
            <div class="filter-action-group">
              <a class="ghost-link" href="${escapeHtml(clearFiltersHref)}">Clear filters</a>
              <button type="submit">Apply filters</button>
            </div>
          </div>
        </form>

        <section class="filter-card">
          <div class="section-header">
            <div>
              <h2>Feed pulse</h2>
              <p class="muted-copy">A compact read on what the current filter slice is surfacing right now.</p>
            </div>
          </div>
          <div class="stat-grid">
            <div class="stat-card">
              <strong>${escapeHtml(String(dashboardPage.articles.length))}</strong>
              <p>Visible article cards</p>
            </div>
            <div class="stat-card">
              <strong>${escapeHtml(String(countHighRiskArticles(dashboardPage.articles)))}</strong>
              <p>High-risk stories in view</p>
            </div>
            <div class="stat-card">
              <strong>${escapeHtml(String(dashboardPage.filters.options.monitoringTargets.length))}</strong>
              <p>Tracked targets in this workspace</p>
            </div>
          </div>
          <p class="live-status" data-live-status>
            <span class="status-highlight">Live monitoring is on.</span>
            The results pane polls the server without reloading the page.
          </p>
        </section>
      </section>

      <section class="results-shell">
        <div class="section-header">
          <div>
            <h2>Live article feed</h2>
            <p class="muted-copy">Titles, targets, risk, topics, source, author, and publish time are refreshed in place.</p>
          </div>
        </div>
        <div
          data-live-results
          data-poll-interval-ms="${escapeHtml(String(dashboardPage.liveRefresh.intervalMs))}"
          aria-live="polite"
        >${renderArticleDashboardResults({ dashboardPage })}</div>
      </section>
    </main>
    <script>
      (() => {
        const resultsNode = document.querySelector('[data-live-results]');
        const statusNode = document.querySelector('[data-live-status]');

        if (!resultsNode || !statusNode) {
          return;
        }

        const intervalMs = Number(resultsNode.dataset.pollIntervalMs || '4000');
        let refreshTimer = null;
        let refreshCount = 0;

        window.__articleDashboardRefreshCount = 0;

        const scheduleNextRefresh = () => {
          refreshTimer = window.setTimeout(refreshResults, intervalMs);
        };

        const refreshResults = async () => {
          const pollUrl = new URL(window.location.href);
          pollUrl.searchParams.set('fragment', 'results');

          try {
            const response = await fetch(pollUrl.toString(), {
              cache: 'no-store',
              headers: {
                'x-live-refresh': '1',
              },
            });

            if (!response.ok) {
              throw new Error('refresh failed');
            }

            const nextHtml = await response.text();

            if (nextHtml !== resultsNode.innerHTML) {
              resultsNode.innerHTML = nextHtml;
              refreshCount += 1;
              window.__articleDashboardRefreshCount = refreshCount;
            }

            const syncedAt = new Intl.DateTimeFormat('en-US', {
              timeStyle: 'medium',
            }).format(new Date());

            statusNode.innerHTML = '<span class="status-highlight">Live monitoring is on.</span> Last synced at ' + syncedAt + '.';
          } catch {
            statusNode.innerHTML = '<span class="status-highlight">Live refresh paused.</span> Showing the last successful dashboard snapshot.';
          } finally {
            scheduleNextRefresh();
          }
        };

        scheduleNextRefresh();

        window.addEventListener('beforeunload', () => {
          if (refreshTimer) {
            window.clearTimeout(refreshTimer);
          }
        });
      })();
    </script>
  </body>
</html>`;
}

module.exports = {
  renderArticleDetailPage,
  renderArticleDashboardPage,
  renderArticleDashboardResults,
};
