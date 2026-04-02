'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPublishedAt(value) {
  if (typeof value !== 'string' || !value) {
    return 'Publish time pending';
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
  renderArticleDashboardPage,
  renderArticleDashboardResults,
};
