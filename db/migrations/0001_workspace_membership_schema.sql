PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_account (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_account_email
  ON user_account (email);

CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_slug
  ON workspace (slug);

CREATE TABLE IF NOT EXISTS workspace_membership (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user_account (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_membership_workspace_user
  ON workspace_membership (workspace_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_membership_workspace_scoped_id
  ON workspace_membership (workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_workspace_membership_user_id
  ON workspace_membership (user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_membership_workspace_role
  ON workspace_membership (workspace_id, role);

CREATE TABLE IF NOT EXISTS workspace_invitation (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  token TEXT NOT NULL,
  invited_by_membership_id TEXT NOT NULL,
  accepted_membership_id TEXT,
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, invited_by_membership_id)
    REFERENCES workspace_membership (workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, accepted_membership_id)
    REFERENCES workspace_membership (workspace_id, id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitation_workspace_email
  ON workspace_invitation (workspace_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitation_token
  ON workspace_invitation (token);

CREATE INDEX IF NOT EXISTS idx_workspace_invitation_workspace_status
  ON workspace_invitation (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_invitation_workspace_expires_at
  ON workspace_invitation (workspace_id, expires_at);
