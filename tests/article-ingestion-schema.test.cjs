'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  articleCandidatePortalNames,
  articleCandidateIngestionStatuses,
  articleIngestionStatuses,
} = require('../src/db/schema/article-ingestion.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

test('article and article candidate rows default to the shared pending statuses', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');

    INSERT INTO article (id, workspace_id, source_url)
    VALUES ('article-1', 'workspace-1', 'https://source.example.com/articles/1');

    INSERT INTO article_candidate (id, workspace_id, monitoring_target_id, portal_url, source_url)
    VALUES (
      'candidate-1',
      'workspace-1',
      'target-1',
      'https://news.naver.com/article/1',
      'https://source.example.com/articles/1'
    );
  `);

  const article = db.prepare('SELECT ingestion_status FROM article WHERE id = ?').get('article-1');
  const candidate = db
    .prepare('SELECT ingestion_status FROM article_candidate WHERE id = ?')
    .get('candidate-1');

  assert.equal(article.ingestion_status, articleIngestionStatuses[0]);
  assert.equal(candidate.ingestion_status, articleCandidateIngestionStatuses[0]);

  db.close();
});

test('article candidate tenant-scoped foreign keys block cross-workspace target or article references', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme'),
           ('workspace-2', 'globex', 'Globex');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings'),
           ('target-2', 'workspace-2', 'company', 'Globex Holdings');

    INSERT INTO article (id, workspace_id, source_url)
    VALUES ('article-1', 'workspace-1', 'https://source.example.com/articles/1');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate (id, workspace_id, monitoring_target_id, portal_url)
        VALUES (
          'candidate-cross-target',
          'workspace-2',
          'target-1',
          'https://news.naver.com/article/1'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate (
          id,
          workspace_id,
          monitoring_target_id,
          article_id,
          portal_url
        )
        VALUES (
          'candidate-cross-article',
          'workspace-1',
          'target-1',
          'missing-article',
          'https://news.naver.com/article/2'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate (
          id,
          workspace_id,
          monitoring_target_id,
          article_id,
          portal_url
        )
        VALUES (
          'candidate-cross-workspace-article',
          'workspace-2',
          'target-2',
          'article-1',
          'https://news.naver.com/article/3'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  db.close();
});

test('article candidate portal hits and article URLs are deduplicated for idempotent upserts', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');

    INSERT INTO article_candidate (id, workspace_id, monitoring_target_id, portal_url)
    VALUES (
      'candidate-1',
      'workspace-1',
      'target-1',
      'https://news.naver.com/article/1'
    );

    INSERT INTO article (id, workspace_id, source_url, canonical_url, normalized_title_hash, body_hash)
    VALUES (
      'article-1',
      'workspace-1',
      'https://source.example.com/articles/1',
      'https://source.example.com/canonical/1',
      'title-hash-1',
      'body-hash-1'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate (id, workspace_id, monitoring_target_id, portal_url)
        VALUES (
          'candidate-2',
          'workspace-1',
          'target-1',
          'https://news.naver.com/article/1'
        );
      `),
    /UNIQUE constraint failed: article_candidate\.monitoring_target_id, article_candidate\.portal_url/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article (id, workspace_id, source_url)
        VALUES ('article-2', 'workspace-1', 'https://source.example.com/articles/1');
      `),
    /UNIQUE constraint failed: article\.workspace_id, article\.source_url/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article (id, workspace_id, canonical_url)
        VALUES ('article-3', 'workspace-1', 'https://source.example.com/canonical/1');
      `),
    /UNIQUE constraint failed: article\.workspace_id, article\.canonical_url/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article (id, workspace_id, body_hash)
        VALUES ('article-4', 'workspace-1', 'body-hash-1');
      `),
    /UNIQUE constraint failed: article\.workspace_id, article\.body_hash/u,
  );

  db.exec(`
    INSERT INTO article (id, workspace_id, normalized_title_hash)
    VALUES ('article-5', 'workspace-1', 'title-hash-1');
  `);

  db.close();
});

test('article candidate portal metadata stays tenant-scoped and enforces the shared portal list', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme'),
           ('workspace-2', 'globex', 'Globex');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings'),
           ('target-2', 'workspace-2', 'company', 'Globex Holdings');

    INSERT INTO article_candidate (id, workspace_id, monitoring_target_id, portal_url)
    VALUES ('candidate-1', 'workspace-1', 'target-1', 'https://news.naver.com/article/1'),
           ('candidate-2', 'workspace-2', 'target-2', 'https://news.nate.com/article/1');

    INSERT INTO article_candidate_portal_metadata (
      article_candidate_id,
      workspace_id,
      portal_name,
      portal_title,
      portal_snippet,
      portal_published_at
    )
    VALUES (
      'candidate-1',
      'workspace-1',
      'naver',
      'Acme portal headline',
      'Snippet',
      '2026-03-30T13:00:00.000Z'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate_portal_metadata (
          article_candidate_id,
          workspace_id,
          portal_name,
          portal_title
        )
        VALUES (
          'candidate-2',
          'workspace-1',
          'naver',
          'Cross workspace headline'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate_portal_metadata (
          article_candidate_id,
          workspace_id,
          portal_name,
          portal_title
        )
        VALUES (
          'candidate-2',
          'workspace-2',
          'bing_news',
          'Invalid portal'
        );
      `),
    /CHECK constraint failed/u,
  );

  const portalMetadata = db
    .prepare(`
      SELECT article_candidate_id, workspace_id, portal_name, portal_title, portal_snippet, portal_published_at
      FROM article_candidate_portal_metadata
      WHERE article_candidate_id = ?
    `)
    .get('candidate-1');

  assert.deepEqual({ ...portalMetadata }, {
    article_candidate_id: 'candidate-1',
    workspace_id: 'workspace-1',
    portal_name: 'naver',
    portal_title: 'Acme portal headline',
    portal_snippet: 'Snippet',
    portal_published_at: '2026-03-30T13:00:00.000Z',
  });

  db.close();
});

test('article ingestion tables enforce the shared status constraints', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('target-1', 'workspace-1', 'company', 'Acme Holdings');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article (id, workspace_id, ingestion_status)
        VALUES ('article-invalid-status', 'workspace-1', 'queued');
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_candidate (id, workspace_id, monitoring_target_id, portal_url, ingestion_status)
        VALUES (
          'candidate-invalid-status',
          'workspace-1',
          'target-1',
          'https://news.naver.com/article/4',
          'completed'
        );
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('article ingestion constants match the migration contract', () => {
  assert.deepEqual(articleCandidateIngestionStatuses, ['pending', 'processing', 'linked', 'failed', 'discarded']);
  assert.deepEqual(articleIngestionStatuses, ['pending', 'processing', 'completed', 'failed']);
  assert.deepEqual(articleCandidatePortalNames, ['naver', 'nate', 'google_news']);
});
