'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  createWorkspace,
  inviteTeammate,
} = require('../src/backend/workspace-service.cjs');
const { createWorkspaceMembersApp } = require('../src/http/workspace-members-app.cjs');

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
    id: 'user-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
  });
  insertUser(db, {
    id: 'user-member',
    email: 'member@example.com',
    displayName: 'Member',
  });

  const workspace = createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    createId: createIdGenerator('workspace-1', 'membership-owner'),
  });

  insertMembership(db, {
    id: 'membership-admin',
    workspaceId: workspace.id,
    userId: 'user-admin',
    role: 'admin',
  });
  insertMembership(db, {
    id: 'membership-member',
    workspaceId: workspace.id,
    userId: 'user-member',
    role: 'member',
  });

  inviteTeammate({
    db,
    workspaceId: workspace.id,
    invitedByUserId: 'user-owner',
    email: 'pending@example.com',
    expiresAt: '2026-04-06T12:00:00.000Z',
    now: () => '2026-03-30T12:00:00.000Z',
    createId: () => 'invitation-1',
    createToken: () => 'token-1',
  });

  return workspace;
}

function startServer(db) {
  return new Promise((resolve) => {
    const server = http.createServer(
      createWorkspaceMembersApp({
        db,
        getCurrentUserId: ({ requestUrl }) => requestUrl.searchParams.get('userId'),
        now: () => '2026-04-02T03:00:00.000Z',
        createId: createIdGenerator('invitation-2'),
        createToken: () => 'token-2',
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

test('workspace members page shows members, invitations, and invite controls for admins', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/members?userId=user-owner',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Acme Risk Desk/u);
    assert.match(response.body, /Current members/u);
    assert.match(response.body, /Owner/u);
    assert.match(response.body, /pending@example.com/u);
    assert.match(response.body, /Invite teammate/u);
    assert.match(response.body, /type="email"/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('workspace members page hides invite controls for non-admin members', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      path: '/workspaces/workspace-1/members?userId=user-member',
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Invite controls are limited to admins/u);
    assert.doesNotMatch(response.body, /<form method="post"/u);
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('workspace members page allows admins to submit invites by email', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/members?userId=user-admin',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'email=newhire%40example.com',
    });

    assert.equal(response.statusCode, 303);
    assert.equal(
      response.headers.location,
      '/workspaces/workspace-1/members?userId=user-admin&invited=newhire%40example.com',
    );

    const invitation = db
      .prepare(`
        SELECT email, role, status
        FROM workspace_invitation
        WHERE id = ?
      `)
      .get('invitation-2');

    assert.deepEqual({ ...invitation }, {
      email: 'newhire@example.com',
      role: 'member',
      status: 'pending',
    });
  } finally {
    await closeServer(server);
    db.close();
  }
});

test('workspace members page rejects invite submissions from non-admin members', async () => {
  const db = createDatabase();
  seedWorkspace(db);
  const server = await startServer(db);

  try {
    const response = await request(server, {
      method: 'POST',
      path: '/workspaces/workspace-1/members?userId=user-member',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'email=blocked%40example.com',
    });

    assert.equal(response.statusCode, 303);
    assert.equal(
      response.headers.location,
      '/workspaces/workspace-1/members?userId=user-member&error=Only+active+workspace+admins+can+create+invitations',
    );

    const count = db
      .prepare(`
        SELECT COUNT(*) AS invitation_count
        FROM workspace_invitation
        WHERE email = ?
      `)
      .get('blocked@example.com');

    assert.equal(count.invitation_count, 0);
  } finally {
    await closeServer(server);
    db.close();
  }
});
