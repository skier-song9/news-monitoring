'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderOption({ value, label, selectedValue }) {
  const selectedAttribute = value === selectedValue ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selectedAttribute}>${escapeHtml(label)}</option>`;
}

function renderMonitoringTargetOptions(analyticsPage) {
  const options = [
    renderOption({
      value: '',
      label: 'All monitoring targets',
      selectedValue: analyticsPage.filters.values.monitoringTargetId,
    }),
  ];

  for (const monitoringTarget of analyticsPage.filters.options.monitoringTargets) {
    const targetLabel =
      monitoringTarget.status === 'active'
        ? monitoringTarget.displayName
        : `${monitoringTarget.displayName} (${monitoringTarget.status.replaceAll('_', ' ')})`;

    options.push(
      renderOption({
        value: monitoringTarget.id,
        label: targetLabel,
        selectedValue: analyticsPage.filters.values.monitoringTargetId,
      }),
    );
  }

  return options.join('');
}

function getSelectedTargetLabel(analyticsPage) {
  const selectedTarget = analyticsPage.filters.options.monitoringTargets.find(
    (monitoringTarget) => monitoringTarget.id === analyticsPage.filters.values.monitoringTargetId,
  );

  return selectedTarget ? selectedTarget.displayName : 'All monitoring targets';
}

function formatDateWindow(analyticsPage) {
  const { publishedFrom, publishedTo } = analyticsPage.filters.values;

  if (publishedFrom && publishedTo) {
    return `${publishedFrom} to ${publishedTo}`;
  }

  if (publishedFrom) {
    return `${publishedFrom} onward`;
  }

  if (publishedTo) {
    return `Through ${publishedTo}`;
  }

  return 'All available dates';
}

function renderSummaryRows(summaries, labelKey) {
  if (!summaries.length) {
    return `
      <div class="empty-state">
        <h3>No high-risk records match these filters</h3>
        <p>Broaden the target or date window to reveal repeat-risk patterns.</p>
      </div>
    `;
  }

  const maxCount = Math.max(...summaries.map((summary) => summary.highRiskArticleCount), 1);

  return `
    <ol class="summary-list">
      ${summaries
        .map((summary, index) => {
          const width = Math.max(
            18,
            Math.round((summary.highRiskArticleCount / maxCount) * 100),
          );

          return `
            <li>
              <a class="summary-link" href="${escapeHtml(summary.drilldownHref)}">
                <span class="summary-rank">${escapeHtml(String(index + 1).padStart(2, '0'))}</span>
                <span class="summary-meter" style="--summary-width: ${escapeHtml(String(width))}%"></span>
                <span class="summary-copy">
                  <strong>${escapeHtml(summary[labelKey])}</strong>
                  <span>${escapeHtml(String(summary.highRiskArticleCount))} high-risk article${summary.highRiskArticleCount === 1 ? '' : 's'}</span>
                </span>
                <span class="summary-meta">Open drilldown</span>
              </a>
            </li>
          `;
        })
        .join('')}
    </ol>
  `;
}

function renderSummarySection({ title, eyebrow, labelKey, summaries }) {
  return `
    <section class="panel">
      <div class="section-header">
        <div>
          <p class="section-eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <p class="section-note">Each row opens the matching high-risk article drilldown.</p>
      </div>
      ${renderSummaryRows(summaries, labelKey)}
    </section>
  `;
}

function renderArticleAnalyticsPage({
  analyticsPage,
  clearFiltersHref,
  articleDashboardHref,
}) {
  const selectedTargetLabel = getSelectedTargetLabel(analyticsPage);
  const dateWindowLabel = formatDateWindow(analyticsPage);
  const topicCount = analyticsPage.analytics.topicSummaries.length;
  const publisherCount = analyticsPage.analytics.publisherSummaries.length;
  const reporterCount = analyticsPage.analytics.reporterSummaries.length;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(analyticsPage.workspace.name)} analytics</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f1e7;
        --surface: rgba(255, 252, 246, 0.92);
        --surface-strong: #fffdf8;
        --ink: #172123;
        --muted: #5f696d;
        --line: rgba(23, 33, 35, 0.12);
        --accent: #0d5f63;
        --accent-soft: rgba(13, 95, 99, 0.12);
        --accent-strong: #b24a17;
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
          radial-gradient(circle at top left, rgba(13, 95, 99, 0.16), transparent 30%),
          radial-gradient(circle at top right, rgba(178, 74, 23, 0.14), transparent 28%),
          linear-gradient(180deg, #faf6ef 0%, var(--bg) 100%);
        color: var(--ink);
      }

      a {
        color: inherit;
      }

      main {
        width: min(1180px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 2rem 0 3rem;
      }

      .hero,
      .panel {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 28px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }

      .hero {
        padding: 1.75rem;
        display: grid;
        gap: 1.4rem;
      }

      .eyebrow,
      .section-eyebrow {
        margin: 0 0 0.7rem;
        color: var(--muted);
        font-size: 0.82rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      button,
      select,
      input {
        font-family: "Avenir Next Condensed", "Trebuchet MS", "Gill Sans", sans-serif;
      }

      h1 {
        margin: 0;
        max-width: 14ch;
        font-size: clamp(2.4rem, 4.5vw, 4.2rem);
        line-height: 0.94;
      }

      h2 {
        margin: 0;
        font-size: 1.6rem;
        line-height: 1;
      }

      h3 {
        margin: 0 0 0.4rem;
        font-size: 1.1rem;
      }

      p {
        margin: 0;
        line-height: 1.6;
      }

      .hero-copy {
        max-width: 56rem;
        font-size: 1.02rem;
      }

      .hero-grid,
      .summary-grid {
        display: grid;
        gap: 1.2rem;
      }

      .hero-grid {
        grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr);
        align-items: start;
      }

      .chip-row,
      .hero-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .filter-chip,
      .ghost-link,
      button,
      .dashboard-link {
        border-radius: 999px;
      }

      .filter-chip {
        display: inline-flex;
        gap: 0.45rem;
        align-items: center;
        padding: 0.55rem 0.9rem;
        background: var(--surface-strong);
        border: 1px solid var(--line);
        font-size: 0.92rem;
      }

      .filter-chip strong {
        font-family: "Avenir Next Condensed", "Trebuchet MS", "Gill Sans", sans-serif;
        font-size: 0.88rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .dashboard-link,
      .ghost-link,
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        min-height: 2.9rem;
        padding: 0.8rem 1.1rem;
        border: 1px solid var(--line);
        text-decoration: none;
      }

      .dashboard-link,
      button {
        background: var(--ink);
        color: #fff8f0;
      }

      .ghost-link {
        background: transparent;
      }

      .top-grid {
        display: grid;
        gap: 1.2rem;
        margin-top: 1.2rem;
        grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr);
        align-items: start;
      }

      .panel {
        padding: 1.45rem;
      }

      .section-header,
      .filter-actions {
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        align-items: flex-start;
      }

      .section-note {
        max-width: 16rem;
        color: var(--muted);
        text-align: right;
      }

      .muted-copy {
        color: var(--muted);
      }

      .filter-grid,
      .stat-grid {
        display: grid;
        gap: 0.9rem;
      }

      .filter-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 1.2rem 0 1rem;
      }

      .stat-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      label {
        display: grid;
        gap: 0.45rem;
        font-family: "Avenir Next Condensed", "Trebuchet MS", "Gill Sans", sans-serif;
        font-size: 0.92rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      input,
      select {
        width: 100%;
        min-height: 3rem;
        padding: 0.8rem 0.95rem;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.84);
        color: var(--ink);
        font-size: 0.98rem;
        letter-spacing: normal;
        text-transform: none;
      }

      .stat-card {
        padding: 1rem;
        border: 1px solid var(--line);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(245, 239, 229, 0.92));
      }

      .stat-card strong {
        display: block;
        margin-bottom: 0.35rem;
        font-family: "Avenir Next Condensed", "Trebuchet MS", "Gill Sans", sans-serif;
        font-size: 2rem;
        line-height: 0.95;
      }

      .summary-grid {
        margin-top: 1.2rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .summary-list {
        list-style: none;
        margin: 1.1rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.8rem;
      }

      .summary-link {
        position: relative;
        overflow: hidden;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 0.9rem;
        align-items: center;
        padding: 0.95rem 1rem;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.9);
        text-decoration: none;
      }

      .summary-meter {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--summary-width);
        background: linear-gradient(90deg, rgba(13, 95, 99, 0.18), rgba(178, 74, 23, 0.12));
        pointer-events: none;
      }

      .summary-rank,
      .summary-meta,
      .summary-copy strong {
        position: relative;
        z-index: 1;
      }

      .summary-rank,
      .summary-meta {
        font-family: "Avenir Next Condensed", "Trebuchet MS", "Gill Sans", sans-serif;
        font-size: 0.84rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .summary-rank {
        color: var(--muted);
      }

      .summary-copy {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 0.2rem;
      }

      .summary-copy strong {
        font-size: 1.15rem;
      }

      .summary-meta {
        color: var(--accent-strong);
      }

      .empty-state {
        margin-top: 1rem;
        padding: 1.05rem;
        border: 1px dashed var(--line);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.72);
      }

      @media (max-width: 980px) {
        .hero-grid,
        .top-grid,
        .summary-grid,
        .filter-grid,
        .stat-grid {
          grid-template-columns: 1fr;
        }

        .section-header,
        .filter-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .section-note {
          max-width: none;
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <div class="hero-grid">
          <div>
            <p class="eyebrow">Risk analytics · ${escapeHtml(analyticsPage.workspace.name)}</p>
            <h1>See which targets, publishers, and reporters keep resurfacing in high-risk coverage.</h1>
            <p class="hero-copy">
              This view compresses repeat-risk patterns into topic, publisher, and reporter summaries, then links each row straight into the matching live article drilldown.
            </p>
          </div>
          <div class="chip-row">
            <span class="filter-chip"><strong>Target</strong><span>${escapeHtml(selectedTargetLabel)}</span></span>
            <span class="filter-chip"><strong>Date window</strong><span>${escapeHtml(dateWindowLabel)}</span></span>
          </div>
        </div>
        <div class="hero-actions">
          <a class="dashboard-link" href="${escapeHtml(articleDashboardHref)}">Open live article feed</a>
        </div>
      </header>

      <section class="top-grid">
        <form class="panel" method="get">
          <input type="hidden" name="userId" value="${escapeHtml(analyticsPage.viewer.userId)}" />
          <div class="section-header">
            <div>
              <p class="section-eyebrow">Slice analytics</p>
              <h2>Filters</h2>
            </div>
            <p class="section-note">Target and date filters apply to every summary lane at once.</p>
          </div>
          <div class="filter-grid">
            <label>
              Monitoring target
              <select name="monitoringTargetId">
                ${renderMonitoringTargetOptions(analyticsPage)}
              </select>
            </label>
            <label>
              Published from
              <input
                type="date"
                name="publishedFrom"
                value="${escapeHtml(analyticsPage.filters.values.publishedFrom)}"
              />
            </label>
            <label>
              Published to
              <input
                type="date"
                name="publishedTo"
                value="${escapeHtml(analyticsPage.filters.values.publishedTo)}"
              />
            </label>
          </div>
          <div class="filter-actions">
            <p class="muted-copy">Every summary row below links into the high-risk article feed with the same target and date window preserved.</p>
            <div class="hero-actions">
              <a class="ghost-link" href="${escapeHtml(clearFiltersHref)}">Clear filters</a>
              <button type="submit">Apply filters</button>
            </div>
          </div>
        </form>

        <section class="panel">
          <div class="section-header">
            <div>
              <p class="section-eyebrow">Coverage pulse</p>
              <h2>Summary lanes</h2>
            </div>
          </div>
          <div class="stat-grid">
            <div class="stat-card">
              <strong>${escapeHtml(String(topicCount))}</strong>
              <p>Topic summaries</p>
            </div>
            <div class="stat-card">
              <strong>${escapeHtml(String(publisherCount))}</strong>
              <p>Publisher summaries</p>
            </div>
            <div class="stat-card">
              <strong>${escapeHtml(String(reporterCount))}</strong>
              <p>Reporter summaries</p>
            </div>
          </div>
          <p class="muted-copy" style="margin-top: 1rem;">
            Topic rows highlight themes, publisher rows reveal repeat source concentration, and reporter rows expose recurring bylines tied to high-risk coverage.
          </p>
        </section>
      </section>

      <section class="summary-grid">
        ${renderSummarySection({
          title: 'Topic spikes',
          eyebrow: 'Theme',
          labelKey: 'topicLabel',
          summaries: analyticsPage.analytics.topicSummaries,
        })}
        ${renderSummarySection({
          title: 'Publisher concentration',
          eyebrow: 'Source',
          labelKey: 'publisherName',
          summaries: analyticsPage.analytics.publisherSummaries,
        })}
        ${renderSummarySection({
          title: 'Reporter watchlist',
          eyebrow: 'Byline',
          labelKey: 'reporterName',
          summaries: analyticsPage.analytics.reporterSummaries,
        })}
      </section>
    </main>
  </body>
</html>`;
}

module.exports = {
  renderArticleAnalyticsPage,
};
