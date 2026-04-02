'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(value) {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function renderFlashMessage(flashMessage) {
  if (!flashMessage) {
    return '';
  }

  const toneClass = flashMessage.type === 'success' ? 'flash-success' : 'flash-error';

  return `
    <section class="flash ${toneClass}" aria-live="polite">
      <strong>${escapeHtml(flashMessage.title)}</strong>
      <p>${escapeHtml(flashMessage.message)}</p>
    </section>
  `;
}

function renderInvitePanel({ workspace, viewer }) {
  if (!viewer.canInvite) {
    return `
      <section class="panel muted-panel">
        <h2>Invite controls are limited to admins</h2>
        <p>
          You can review current access and pending invitations for
          <strong>${escapeHtml(workspace.name)}</strong>, but only owners and admins can send new invites.
        </p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Invite teammate</h2>
        <p>New invitations default to the <strong>member</strong> role for this workspace.</p>
      </div>
      <form method="post" class="invite-form">
        <label for="invite-email">Email address</label>
        <div class="invite-row">
          <input
            id="invite-email"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="teammate@example.com"
            required
          />
          <button type="submit">Send invite</button>
        </div>
      </form>
    </section>
  `;
}

function renderMembersTable(members) {
  const rows = members
    .map(
      (member) => `
        <tr>
          <td>
            <div class="person-cell">
              <strong>${escapeHtml(member.displayName)}</strong>
              <span>${escapeHtml(member.email)}</span>
            </div>
          </td>
          <td><span class="pill role-${escapeHtml(member.role)}">${escapeHtml(member.role)}</span></td>
          <td>${escapeHtml(member.status)}</td>
          <td>${escapeHtml(formatTimestamp(member.joinedAt))}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Current members</h2>
        <p>${members.length} people can access this workspace right now.</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function renderInvitationList(invitations) {
  if (!invitations.length) {
    return `
      <section class="panel muted-panel">
        <h2>Pending invitations</h2>
        <p>No pending invitations yet.</p>
      </section>
    `;
  }

  const items = invitations
    .map(
      (invitation) => `
        <li class="invitation-card">
          <div class="invitation-header">
            <strong>${escapeHtml(invitation.email)}</strong>
            <span class="pill">${escapeHtml(invitation.role)}</span>
          </div>
          <p>Invited by ${escapeHtml(invitation.invitedByDisplayName ?? 'Unknown')}</p>
          <p>Expires ${escapeHtml(formatTimestamp(invitation.expiresAt))}</p>
        </li>
      `,
    )
    .join('');

  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Pending invitations</h2>
        <p>${invitations.length} invite${invitations.length === 1 ? '' : 's'} still awaiting acceptance.</p>
      </div>
      <ul class="invitation-list">${items}</ul>
    </section>
  `;
}

function renderWorkspaceMembersPage({ directory, flashMessage }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(directory.workspace.name)} members</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6efe5;
        --bg-accent: #e3d7c3;
        --panel: rgba(255, 252, 247, 0.9);
        --panel-border: rgba(81, 53, 32, 0.18);
        --text: #2c1f16;
        --muted: #705849;
        --success: #205c3b;
        --success-bg: #dff4e6;
        --error: #7f231c;
        --error-bg: #fbe0dc;
        --owner: #6b250e;
        --admin: #7c5d12;
        --member: #244c6a;
        --shadow: 0 18px 45px rgba(65, 41, 24, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.8), transparent 40%),
          linear-gradient(135deg, var(--bg), var(--bg-accent));
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }

      main {
        width: min(1120px, calc(100% - 2rem));
        margin: 0 auto;
        padding: 3rem 0 4rem;
        animation: fade-in 240ms ease-out;
      }

      .hero {
        display: grid;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .eyebrow {
        margin: 0;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.78rem;
        color: var(--muted);
      }

      h1,
      h2 {
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        margin: 0;
      }

      h1 {
        font-size: clamp(2.2rem, 4vw, 3.6rem);
        line-height: 0.95;
      }

      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        color: var(--muted);
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
        gap: 1.25rem;
      }

      .stack {
        display: grid;
        gap: 1.25rem;
      }

      .panel {
        background: var(--panel);
        backdrop-filter: blur(10px);
        border: 1px solid var(--panel-border);
        border-radius: 22px;
        box-shadow: var(--shadow);
        padding: 1.25rem;
      }

      .muted-panel {
        color: var(--muted);
      }

      .panel-heading {
        display: grid;
        gap: 0.35rem;
        margin-bottom: 1rem;
      }

      .panel-heading p,
      .flash p,
      .invitation-card p,
      .muted-panel p {
        margin: 0;
        color: var(--muted);
      }

      .flash {
        border-radius: 18px;
        padding: 1rem 1.1rem;
        margin-bottom: 1rem;
      }

      .flash strong {
        display: block;
        margin-bottom: 0.3rem;
      }

      .flash-success {
        background: var(--success-bg);
        color: var(--success);
      }

      .flash-error {
        background: var(--error-bg);
        color: var(--error);
      }

      .invite-form {
        display: grid;
        gap: 0.7rem;
      }

      .invite-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.75rem;
      }

      input {
        width: 100%;
        border: 1px solid rgba(82, 56, 37, 0.2);
        border-radius: 999px;
        padding: 0.9rem 1rem;
        font: inherit;
        background: rgba(255, 255, 255, 0.92);
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 0.9rem 1.15rem;
        font: inherit;
        font-weight: 600;
        color: #f9f2ea;
        background: linear-gradient(135deg, #8c3f20, #52301e);
        cursor: pointer;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        text-align: left;
        padding: 0.85rem 0;
        border-top: 1px solid rgba(82, 56, 37, 0.12);
        vertical-align: top;
      }

      th {
        border-top: 0;
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .person-cell {
        display: grid;
        gap: 0.18rem;
      }

      .person-cell span {
        color: var(--muted);
      }

      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 0.3rem 0.7rem;
        font-size: 0.86rem;
        font-weight: 600;
        background: rgba(82, 56, 37, 0.08);
      }

      .role-owner {
        color: var(--owner);
        background: rgba(107, 37, 14, 0.12);
      }

      .role-admin {
        color: var(--admin);
        background: rgba(124, 93, 18, 0.14);
      }

      .role-member {
        color: var(--member);
        background: rgba(36, 76, 106, 0.12);
      }

      .invitation-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.85rem;
      }

      .invitation-card {
        border-radius: 18px;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(82, 56, 37, 0.12);
      }

      .invitation-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.45rem;
      }

      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }

        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 860px) {
        .layout,
        .invite-row {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Workspace access overview</p>
        <h1>${escapeHtml(directory.workspace.name)}</h1>
        <div class="hero-meta">
          <span>${escapeHtml(directory.workspace.slug)}</span>
          <span>Signed in as ${escapeHtml(directory.viewer.role)}</span>
          <span>${directory.members.length} members</span>
          <span>${directory.invitations.length} pending invites</span>
        </div>
      </section>
      ${renderFlashMessage(flashMessage)}
      <section class="layout">
        <div class="stack">
          ${renderInvitePanel(directory)}
          ${renderInvitationList(directory.invitations)}
        </div>
        ${renderMembersTable(directory.members)}
      </section>
    </main>
  </body>
</html>`;
}

module.exports = {
  renderWorkspaceMembersPage,
};
