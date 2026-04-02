'use strict';

const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const { createWorkspace } = require('../src/backend/workspace-service.cjs');
const {
  createMonitoringTargetRegistrationApp,
} = require('../src/http/monitoring-target-registration-app.cjs');

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
      throw new Error('No deterministic id available for demo');
    }

    currentIndex += 1;
    return id;
  };
}

function seedDemoData(db) {
  insertUser(db, {
    id: 'user-owner',
    email: 'owner@acme.example',
    displayName: 'Morgan Lee',
  });
  insertUser(db, {
    id: 'user-member',
    email: 'member@acme.example',
    displayName: 'Riley Song',
  });

  const workspace = createWorkspace({
    db,
    ownerUserId: 'user-owner',
    workspaceName: 'Acme Risk Desk',
    workspaceSlug: 'acme-risk',
    now: () => '2026-04-02T01:00:00.000Z',
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

const port = Number.parseInt(process.env.PORT ?? '4311', 10);
const db = new DatabaseSync(':memory:');
applyMigrations(db);
const workspace = seedDemoData(db);

const server = createServer(
  createMonitoringTargetRegistrationApp({
    db,
    getCurrentUserId: ({ requestUrl }) => requestUrl.searchParams.get('userId'),
    now: () => '2026-04-02T03:00:00.000Z',
    createId: (() => {
      let counter = 0;

      return () => {
        counter += 1;

        if (counter === 1) {
          return 'target-demo-1';
        }

        return `keyword-demo-${counter - 1}`;
      };
    })(),
  }),
);

server.listen(port, () => {
  process.stdout.write(`Target registration demo running on http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/new?userId=user-owner\n`);
  process.stdout.write(`Member demo view: http://127.0.0.1:${port}/workspaces/${workspace.id}/targets/new?userId=user-member\n`);
});

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
