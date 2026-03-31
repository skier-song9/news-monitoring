'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  invitationStatuses,
  membershipStatuses,
  workspaceRoles,
} = require('../src/db/schema/workspace.cjs');
const { applyMigrations } = require('../src/db/migrations.cjs');
const { verifyWorkspaceSchema } = require('../scripts/verify-workspace-schema.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

test('schema verification helper passes', () => {
  assert.doesNotThrow(() => verifyWorkspaceSchema());
});

test('workspace membership uniqueness is enforced per workspace', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO user_account (id, email, display_name)
    VALUES ('user-1', 'owner@example.com', 'Owner');

    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO workspace_membership (id, workspace_id, user_id, role)
    VALUES ('membership-1', 'workspace-1', 'user-1', 'owner');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO workspace_membership (id, workspace_id, user_id, role)
        VALUES ('membership-2', 'workspace-1', 'user-1', 'admin');
      `),
    /UNIQUE constraint failed: workspace_membership\.workspace_id, workspace_membership\.user_id/u,
  );

  db.close();
});

test('workspace invitation uniqueness is enforced per workspace and is case insensitive', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO user_account (id, email, display_name)
    VALUES ('user-1', 'owner@example.com', 'Owner');

    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme');

    INSERT INTO workspace_membership (id, workspace_id, user_id, role)
    VALUES ('membership-1', 'workspace-1', 'user-1', 'owner');

    INSERT INTO workspace_invitation (
      id,
      workspace_id,
      email,
      role,
      token,
      invited_by_membership_id,
      expires_at
    )
    VALUES (
      'invitation-1',
      'workspace-1',
      'teammate@example.com',
      'member',
      'token-1',
      'membership-1',
      '2030-01-01T00:00:00Z'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO workspace_invitation (
          id,
          workspace_id,
          email,
          role,
          token,
          invited_by_membership_id,
          expires_at
        )
        VALUES (
          'invitation-2',
          'workspace-1',
          'TEAMMATE@example.com',
          'member',
          'token-2',
          'membership-1',
          '2030-01-01T00:00:00Z'
        );
      `),
    /UNIQUE constraint failed: workspace_invitation\.workspace_id, workspace_invitation\.email/u,
  );

  db.close();
});

test('tenant-scoped foreign keys prevent cross-workspace invitation references', () => {
  const db = createDatabase();

  db.exec(`
    INSERT INTO user_account (id, email, display_name)
    VALUES ('user-1', 'owner@example.com', 'Owner');

    INSERT INTO workspace (id, slug, name)
    VALUES ('workspace-1', 'acme', 'Acme'),
           ('workspace-2', 'globex', 'Globex');

    INSERT INTO workspace_membership (id, workspace_id, user_id, role)
    VALUES ('membership-1', 'workspace-1', 'user-1', 'owner');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO workspace_invitation (
          id,
          workspace_id,
          email,
          role,
          token,
          invited_by_membership_id,
          expires_at
        )
        VALUES (
          'invitation-1',
          'workspace-2',
          'teammate@example.com',
          'member',
          'token-1',
          'membership-1',
          '2030-01-01T00:00:00Z'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  db.close();
});

test('role and status constants match the migration contract', () => {
  assert.deepEqual(workspaceRoles, ['owner', 'admin', 'member']);
  assert.deepEqual(membershipStatuses, ['active', 'pending', 'suspended']);
  assert.deepEqual(invitationStatuses, ['pending', 'accepted', 'expired', 'revoked']);
});
