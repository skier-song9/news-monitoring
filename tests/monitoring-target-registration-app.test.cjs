'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const { createWorkspace } = require('../src/backend/workspace-service.cjs');
const {
  createMonitoringTargetRegistrationApp,
} = require('../src/http/monitoring-target-registration-app.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function insertUser(db, { id, email, displayName }) {
  db.prepare(`
    INSERT INTO user_account (id, email, display_name)
    VALUES (?, ?, ?)
  `).run(id, email, displayName);
}

function insertMembership(db, { id, workspaceId, userId, role, status = 'active' }) {
  db.prepare(`
    INSERT INTO workspace_membership (id, workspace_id, user_id, role, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, userId, role, status);
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

function seedWorkspace(db) {
  insertUser(db, {
    id: 'user-owner',
    email: 'owner@example.com',
    displayName: 'Owner',
  });
  insertUser(db, {
    id: 'user-member',
    email: 'member@example.com',
    displayName: 'Member',
  });
  insertUser(db, {
    id: 'user-outsider',
    email: 'outsider@example.com',
    displayName: 'Outsider',
  });

  const workspace = createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    createId: createIdGenerator('workspace-1', 'membership-owner'),
  });

  insertMembership(db, {
    id: 'membership-member',
    workspaceId: workspace.id,
    userId: 'user-member',
    role: 'member',
  });

  return workspace;
}

function startServer(db) {
  return new Promise((resolve) => {
    const server = http.createServer(
      createMonitoringTargetRegistrationApp({
        db,
        getCurrentUserId: ({ requestUrl }) => requestUrl.searchParams.get('userId'),
        now: () => '2026-04-02T03:00:00.000Z',
        createId: createIdGenerator('target-1', 'keyword-1', 'keyword-2'),
      }),
    );

    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function request(server, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

test('target registration page shows the creation form for active workspace members', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/new?userId=user-member',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Register a monitoring target/u);
    assert.match(response.body, /name="type"/u);
    assert.match(response.body, /name="displayName"/u);
    assert.match(response.body, /name="defaultRiskThreshold"/u);
    assert.match(response.body, /name="seedKeywords"/u);
    assert.match(response.body, /setCustomValidity/u);
    assert.match(response.body, /Enter at least one seed keyword\./u);
    assert.match(response.body, /Save target and continue to review/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target registration rejects empty seed keyword submissions and preserves form values', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/new?userId=user-owner',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'type=company&displayName=Acme+Holdings&note=Needs+review&defaultRiskThreshold=88&seedKeywords=++++',
    });

    assert.equal(response.statusCode, 303);
    assert.equal(
      response.headers.location,
      '/workspaces/workspace-1/targets/new?userId=user-owner&error=At+least+one+seed+keyword+is+required&type=company&displayName=Acme+Holdings&note=Needs+review&defaultRiskThreshold=88&seedKeywords=++++',
    );

    const targetCount = db
      .prepare(`
        SELECT COUNT(*) AS target_count
        FROM monitoring_target
      `)
      .get();

    assert.equal(targetCount.target_count, 0);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target registration creates the target and redirects into the review workflow', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const createResponse = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/targets/new?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'type=person&displayName=Alex+Kim&note=Track+executive+coverage&defaultRiskThreshold=82&seedKeywords=Alex+Kim%0AAlex+Kim+CEO',
    });

    assert.equal(createResponse.statusCode, 303);
    assert.equal(
      createResponse.headers.location,
      '/workspaces/workspace-1/targets/target-1/review?userId=user-member&created=1',
    );

    const target = db
      .prepare(`
        SELECT id, workspace_id, type, display_name, note, status, default_risk_threshold
        FROM monitoring_target
        WHERE id = ?
      `)
      .get('target-1');
    const savedKeywords = db
      .prepare(`
        SELECT keyword, display_order
        FROM target_keyword
        WHERE monitoring_target_id = ?
        ORDER BY display_order
      `)
      .all('target-1')
      .map((row) => ({ ...row }));

    assert.deepEqual({ ...target }, {
      id: 'target-1',
      workspace_id: 'workspace-1',
      type: 'person',
      display_name: 'Alex Kim',
      note: 'Track executive coverage',
      status: 'review_required',
      default_risk_threshold: 82,
    });
    assert.deepEqual(savedKeywords, [
      {
        keyword: 'Alex Kim',
        display_order: 0,
      },
      {
        keyword: 'Alex Kim CEO',
        display_order: 1,
      },
    ]);

    const reviewResponse = await request(server, {
      path: createResponse.headers.location,
    });

    assert.equal(reviewResponse.statusCode, 200);
    assert.match(reviewResponse.body, /Monitoring target review/u);
    assert.match(reviewResponse.body, /Target saved/u);
    assert.match(reviewResponse.body, /Alex Kim/u);
    assert.match(reviewResponse.body, /review_required/u);
    assert.match(reviewResponse.body, /Alex Kim CEO/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('target registration page rejects users outside the workspace', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/targets/new?userId=user-outsider',
    });

    assert.equal(response.statusCode, 403);
    assert.equal(
      response.body,
      'Only active workspace members can create monitoring targets',
    );
  } finally {
    await closeServer(server);
    db.close();
  }
});
