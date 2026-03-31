'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  OriginalArticleIngestionJobError,
  runOriginalArticleIngestionJob,
} = require('../src/backend/original-article-ingestion-job.cjs');
const {
  completedArticleIngestionStatus,
  defaultArticleCandidateIngestionStatus,
  failedArticleCandidateIngestionStatus,
  linkedArticleCandidateIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const { defaultMonitoringTargetRiskThreshold } = require('../src/db/schema/monitoring-target.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function insertWorkspace(db, { id, slug, name }) {
  db.prepare(`
    INSERT INTO workspace (id, slug, name)
    VALUES (?, ?, ?)
  `).run(id, slug, name);
}

function insertMonitoringTarget(
  db,
  {
    id,
    workspaceId,
    type = 'company',
    displayName,
    note = null,
    status = 'active',
    defaultRiskThreshold = defaultMonitoringTargetRiskThreshold,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target (
      id,
      workspace_id,
      type,
      display_name,
      note,
      status,
      default_risk_threshold
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, type, displayName, note, status, defaultRiskThreshold);
}

function insertArticleCandidate(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId = null,
    portalUrl,
    sourceUrl = null,
    ingestionStatus = defaultArticleCandidateIngestionStatus,
    ingestionError = null,
  },
) {
  db.prepare(`
    INSERT INTO article_candidate (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      portal_url,
      source_url,
      ingestion_status,
      ingestion_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    portalUrl,
    sourceUrl,
    ingestionStatus,
    ingestionError,
  );
}

function insertArticleCandidatePortalMetadata(
  db,
  {
    articleCandidateId,
    workspaceId,
    portalName,
    portalTitle,
    portalSnippet = null,
    portalPublishedAt = null,
  },
) {
  db.prepare(`
    INSERT INTO article_candidate_portal_metadata (
      article_candidate_id,
      workspace_id,
      portal_name,
      portal_title,
      portal_snippet,
      portal_published_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    articleCandidateId,
    workspaceId,
    portalName,
    portalTitle,
    portalSnippet,
    portalPublishedAt,
  );
}

function insertArticle(
  db,
  {
    id,
    workspaceId,
    sourceUrl = null,
    canonicalUrl = null,
    normalizedTitleHash = null,
    bodyHash = null,
    ingestionStatus = completedArticleIngestionStatus,
  },
) {
  db.prepare(`
    INSERT INTO article (
      id,
      workspace_id,
      source_url,
      canonical_url,
      normalized_title_hash,
      body_hash,
      ingestion_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    sourceUrl,
    canonicalUrl,
    normalizedTitleHash,
    bodyHash,
    ingestionStatus,
  );
}

function insertArticleContent(
  db,
  {
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName = null,
    publisherName = null,
    publishedAt = null,
    viewCount = null,
    fetchedAt,
  },
) {
  db.prepare(`
    INSERT INTO article_content (
      article_id,
      workspace_id,
      title,
      body_text,
      author_name,
      publisher_name,
      published_at,
      view_count,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName,
    publisherName,
    publishedAt,
    viewCount,
    fetchedAt,
  );
}

function createIdGenerator(...ids) {
  let currentIndex = 0;

  return () => {
    const id = ids[currentIndex];

    if (!id) {
      throw new Error('No deterministic id available for test');
    }

    currentIndex += 1;
    return id;
  };
}

function normalizeRow(row) {
  return row ? { ...row } : row;
}

function hashNormalizedText(value) {
  return createHash('sha256')
    .update(value.replace(/\s+/gu, ' ').trim().toLowerCase(), 'utf8')
    .digest('hex');
}

test('runOriginalArticleIngestionJob fetches source articles, stores content, and links candidates', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    portalUrl: 'https://news.naver.com/article/1',
    sourceUrl: 'https://source.example.com/articles/1',
  });
  insertArticleCandidatePortalMetadata(db, {
    articleCandidateId: 'candidate-1',
    workspaceId: 'workspace-1',
    portalName: 'naver',
    portalTitle: 'Portal headline',
    portalSnippet: 'Portal snippet',
    portalPublishedAt: '2026-03-30T11:59:00.000Z',
  });
  insertArticleCandidate(db, {
    id: 'candidate-no-source',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    portalUrl: 'https://news.google.com/articles/no-source',
  });

  const result = await runOriginalArticleIngestionJob({
    db,
    now: () => '2026-03-30T12:00:00.000Z',
    createId: createIdGenerator('article-1'),
    fetchOriginalArticle: async ({ articleCandidate }) => {
      assert.deepEqual(articleCandidate, {
        id: 'candidate-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        portalUrl: 'https://news.naver.com/article/1',
        sourceUrl: 'https://source.example.com/articles/1',
        ingestionStatus: defaultArticleCandidateIngestionStatus,
        portalMetadata: {
          portalName: 'naver',
          title: 'Portal headline',
          snippet: 'Portal snippet',
          publishedAt: '2026-03-30T11:59:00.000Z',
        },
      });

      return {
        canonicalUrl: 'https://source.example.com/canonical/1',
        title: ' Acme Holdings Faces Probe ',
        bodyText: ' Acme Holdings is facing a probe after a supplier complaint. ',
        authorName: 'Jane Reporter',
        publisherName: 'Acme Daily',
        publishedAt: '2026-03-30T11:45:00.000Z',
        viewCount: 4123,
      };
    },
  });

  const savedCandidate = db
    .prepare(`
      SELECT id, article_id, source_url, ingestion_status, ingestion_error
      FROM article_candidate
      WHERE id = ?
    `)
    .get('candidate-1');
  const savedArticle = db
    .prepare(`
      SELECT id, workspace_id, source_url, canonical_url, normalized_title_hash, body_hash, ingestion_status
      FROM article
      WHERE id = ?
    `)
    .get('article-1');
  const savedContent = db
    .prepare(`
      SELECT article_id, workspace_id, title, body_text, author_name, publisher_name, published_at, view_count, fetched_at
      FROM article_content
      WHERE article_id = ?
    `)
    .get('article-1');
  const skippedCandidate = db
    .prepare(`
      SELECT article_id, ingestion_status
      FROM article_candidate
      WHERE id = ?
    `)
    .get('candidate-no-source');

  assert.deepEqual(normalizeRow(savedCandidate), {
    id: 'candidate-1',
    article_id: 'article-1',
    source_url: 'https://source.example.com/articles/1',
    ingestion_status: linkedArticleCandidateIngestionStatus,
    ingestion_error: null,
  });
  assert.deepEqual(normalizeRow(savedArticle), {
    id: 'article-1',
    workspace_id: 'workspace-1',
    source_url: 'https://source.example.com/articles/1',
    canonical_url: 'https://source.example.com/canonical/1',
    normalized_title_hash: hashNormalizedText(' Acme Holdings Faces Probe '),
    body_hash: hashNormalizedText(
      ' Acme Holdings is facing a probe after a supplier complaint. ',
    ),
    ingestion_status: completedArticleIngestionStatus,
  });
  assert.deepEqual(normalizeRow(savedContent), {
    article_id: 'article-1',
    workspace_id: 'workspace-1',
    title: 'Acme Holdings Faces Probe',
    body_text: 'Acme Holdings is facing a probe after a supplier complaint.',
    author_name: 'Jane Reporter',
    publisher_name: 'Acme Daily',
    published_at: '2026-03-30T11:45:00.000Z',
    view_count: 4123,
    fetched_at: '2026-03-30T12:00:00.000Z',
  });
  assert.deepEqual(normalizeRow(skippedCandidate), {
    article_id: null,
    ingestion_status: defaultArticleCandidateIngestionStatus,
  });
  assert.deepEqual(result, {
    processedCandidates: [
      {
        id: 'candidate-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        sourceUrl: 'https://source.example.com/articles/1',
        canonicalUrl: 'https://source.example.com/canonical/1',
        ingestionStatus: linkedArticleCandidateIngestionStatus,
        articleIngestionStatus: completedArticleIngestionStatus,
        normalizedTitleHash: hashNormalizedText(' Acme Holdings Faces Probe '),
        bodyHash: hashNormalizedText(
          ' Acme Holdings is facing a probe after a supplier complaint. ',
        ),
      },
    ],
    totalProcessed: 1,
    linkedCandidates: 1,
    failedCandidates: 0,
  });

  db.close();
});

test('runOriginalArticleIngestionJob upserts onto an existing canonical article match', async () => {
  const db = createDatabase();

  const existingTitle = 'Acme Holdings faces probe';
  const existingBody = 'Acme Holdings is facing a probe after a supplier complaint.';

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertArticle(db, {
    id: 'article-existing',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/articles/1',
    canonicalUrl: 'https://source.example.com/canonical/1',
    normalizedTitleHash: hashNormalizedText(existingTitle),
    bodyHash: hashNormalizedText(existingBody),
  });
  insertArticleContent(db, {
    articleId: 'article-existing',
    workspaceId: 'workspace-1',
    title: existingTitle,
    bodyText: existingBody,
    publisherName: 'Initial Publisher',
    fetchedAt: '2026-03-30T10:00:00.000Z',
  });
  insertArticleCandidate(db, {
    id: 'candidate-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    portalUrl: 'https://news.google.com/articles/2',
    sourceUrl: 'https://m.source.example.com/articles/1?amp=1',
    ingestionStatus: failedArticleCandidateIngestionStatus,
    ingestionError: 'timeout',
  });
  insertArticleCandidatePortalMetadata(db, {
    articleCandidateId: 'candidate-2',
    workspaceId: 'workspace-1',
    portalName: 'google_news',
    portalTitle: 'Second portal headline',
  });

  const result = await runOriginalArticleIngestionJob({
    db,
    now: () => '2026-03-30T12:30:00.000Z',
    createId: createIdGenerator('article-new-should-not-be-used'),
    fetchOriginalArticle: async () => ({
      canonicalUrl: 'https://source.example.com/canonical/1',
      title: '  ACME HOLDINGS FACES PROBE  ',
      bodyText: 'Acme Holdings is facing a   probe after a supplier complaint.',
      authorName: 'Jane Reporter',
      publisherName: 'Acme Daily',
      publishedAt: '2026-03-30T11:45:00.000Z',
      viewCount: 5000,
    }),
  });

  const articleCount = db.prepare('SELECT COUNT(*) AS count FROM article').get();
  const savedCandidate = db
    .prepare(`
      SELECT article_id, source_url, ingestion_status, ingestion_error
      FROM article_candidate
      WHERE id = ?
    `)
    .get('candidate-2');
  const savedArticle = db
    .prepare(`
      SELECT id, source_url, canonical_url, normalized_title_hash, body_hash, ingestion_status
      FROM article
      WHERE id = ?
    `)
    .get('article-existing');
  const savedContent = db
    .prepare(`
      SELECT title, body_text, author_name, publisher_name, published_at, view_count, fetched_at
      FROM article_content
      WHERE article_id = ?
    `)
    .get('article-existing');

  assert.equal(articleCount.count, 1);
  assert.deepEqual(normalizeRow(savedCandidate), {
    article_id: 'article-existing',
    source_url: 'https://m.source.example.com/articles/1?amp=1',
    ingestion_status: linkedArticleCandidateIngestionStatus,
    ingestion_error: null,
  });
  assert.deepEqual(normalizeRow(savedArticle), {
    id: 'article-existing',
    source_url: 'https://source.example.com/articles/1',
    canonical_url: 'https://source.example.com/canonical/1',
    normalized_title_hash: hashNormalizedText('  ACME HOLDINGS FACES PROBE  '),
    body_hash: hashNormalizedText(
      'Acme Holdings is facing a   probe after a supplier complaint.',
    ),
    ingestion_status: completedArticleIngestionStatus,
  });
  assert.deepEqual(normalizeRow(savedContent), {
    title: 'ACME HOLDINGS FACES PROBE',
    body_text: 'Acme Holdings is facing a   probe after a supplier complaint.',
    author_name: 'Jane Reporter',
    publisher_name: 'Acme Daily',
    published_at: '2026-03-30T11:45:00.000Z',
    view_count: 5000,
    fetched_at: '2026-03-30T12:30:00.000Z',
  });
  assert.deepEqual(result, {
    processedCandidates: [
      {
        id: 'candidate-2',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-existing',
        sourceUrl: 'https://m.source.example.com/articles/1?amp=1',
        canonicalUrl: 'https://source.example.com/canonical/1',
        ingestionStatus: linkedArticleCandidateIngestionStatus,
        articleIngestionStatus: completedArticleIngestionStatus,
        normalizedTitleHash: hashNormalizedText('  ACME HOLDINGS FACES PROBE  '),
        bodyHash: hashNormalizedText(
          'Acme Holdings is facing a   probe after a supplier complaint.',
        ),
      },
    ],
    totalProcessed: 1,
    linkedCandidates: 1,
    failedCandidates: 0,
  });

  db.close();
});

test('runOriginalArticleIngestionJob records retryable failures and reasons', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme',
    name: 'Acme',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertArticleCandidate(db, {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    portalUrl: 'https://news.nate.com/article/1',
    sourceUrl: 'https://source.example.com/articles/failing',
  });

  const result = await runOriginalArticleIngestionJob({
    db,
    now: () => '2026-03-30T13:00:00.000Z',
    fetchOriginalArticle: async () => {
      throw new Error('fetch timeout');
    },
  });

  const savedCandidate = db
    .prepare(`
      SELECT article_id, ingestion_status, ingestion_error
      FROM article_candidate
      WHERE id = ?
    `)
    .get('candidate-1');
  const articleCount = db.prepare('SELECT COUNT(*) AS count FROM article').get();

  assert.deepEqual(normalizeRow(savedCandidate), {
    article_id: null,
    ingestion_status: failedArticleCandidateIngestionStatus,
    ingestion_error: 'fetch timeout',
  });
  assert.equal(articleCount.count, 0);
  assert.deepEqual(result, {
    processedCandidates: [
      {
        id: 'candidate-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: null,
        sourceUrl: 'https://source.example.com/articles/failing',
        canonicalUrl: null,
        ingestionStatus: failedArticleCandidateIngestionStatus,
        articleIngestionStatus: null,
        normalizedTitleHash: null,
        bodyHash: null,
        ingestionError: 'fetch timeout',
      },
    ],
    totalProcessed: 1,
    linkedCandidates: 0,
    failedCandidates: 1,
  });

  db.close();
});

test('runOriginalArticleIngestionJob rejects an invalid fetch adapter', async () => {
  const db = createDatabase();

  await assert.rejects(
    () =>
      runOriginalArticleIngestionJob({
        db,
        fetchOriginalArticle: null,
      }),
    (error) => {
      assert.equal(error instanceof OriginalArticleIngestionJobError, true);
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /fetchOriginalArticle must be a function/u);
      return true;
    },
  );

  db.close();
});
