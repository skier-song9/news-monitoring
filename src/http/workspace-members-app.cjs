'use strict';

const { URL, URLSearchParams } = require('node:url');

const {
  WorkspaceServiceError,
  inviteTeammate,
  listWorkspaceMembersDirectory,
} = require('../backend/workspace-service.cjs');
const { renderWorkspaceMembersPage } = require('../ui/workspace-members-page.cjs');

function normalizeRequestUserId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function redirect(response, location) {
  response.writeHead(303, {
    location,
    'cache-control': 'no-store',
  });
  response.end();
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(message);
}

function getMembersRouteMatch(pathname) {
  return pathname.match(/^\/workspaces\/([^/]+)\/members\/?$/u);
}

function parseFormBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;

      if (totalBytes > 16 * 1024) {
        reject(new Error('Form payload exceeds 16kb limit'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });

    request.on('error', reject);
  });
}

function buildFlashMessage(requestUrl) {
  const invitedEmail = requestUrl.searchParams.get('invited');
  const errorMessage = requestUrl.searchParams.get('error');

  if (invitedEmail) {
    return {
      type: 'success',
      title: 'Invitation queued',
      message: `${invitedEmail} now appears in the pending invitations list.`,
    };
  }

  if (errorMessage) {
    return {
      type: 'error',
      title: 'Invitation not sent',
      message: errorMessage,
    };
  }

  return null;
}

function buildRedirectLocation(requestUrl, params) {
  const nextParams = new URLSearchParams(requestUrl.searchParams);

  nextParams.delete('invited');
  nextParams.delete('error');

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      nextParams.set(key, value);
      continue;
    }

    nextParams.delete(key);
  }

  const search = nextParams.toString();
  return `${requestUrl.pathname}${search ? `?${search}` : ''}`;
}

function createWorkspaceMembersApp({
  db,
  getCurrentUserId,
  now,
  createId,
  createToken,
}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a sqlite database connection');
  }

  if (typeof getCurrentUserId !== 'function') {
    throw new TypeError('getCurrentUserId must be a function');
  }

  async function handleRequest(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');

    if (requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204, {
        'cache-control': 'public, max-age=3600',
      });
      response.end();
      return;
    }

    const routeMatch = getMembersRouteMatch(requestUrl.pathname);

    if (!routeMatch) {
      sendText(response, 404, 'Not found');
      return;
    }

    const workspaceId = decodeURIComponent(routeMatch[1]);
    const userId = normalizeRequestUserId(
      getCurrentUserId({ request, requestUrl, workspaceId }),
    );

    if (!userId) {
      sendText(response, 401, 'Missing current user');
      return;
    }

    if (request.method === 'GET') {
      try {
        const directory = listWorkspaceMembersDirectory({
          db,
          workspaceId,
          userId,
        });

        sendHtml(
          response,
          200,
          renderWorkspaceMembersPage({
            directory,
            flashMessage: buildFlashMessage(requestUrl),
          }),
        );
      } catch (error) {
        if (error instanceof WorkspaceServiceError) {
          const statusCode =
            error.code === 'WORKSPACE_NOT_FOUND' ? 404 : 403;
          sendText(response, statusCode, error.message);
          return;
        }

        throw error;
      }

      return;
    }

    if (request.method === 'POST') {
      try {
        const formData = await parseFormBody(request);
        const email = formData.get('email');

        inviteTeammate({
          db,
          workspaceId,
          invitedByUserId: userId,
          email,
          now,
          createId,
          createToken,
        });

        redirect(response, buildRedirectLocation(requestUrl, { invited: email }));
      } catch (error) {
        if (error instanceof WorkspaceServiceError) {
          redirect(response, buildRedirectLocation(requestUrl, { error: error.message }));
          return;
        }

        if (error instanceof Error && /16kb/u.test(error.message)) {
          sendText(response, 413, error.message);
          return;
        }

        throw error;
      }

      return;
    }

    sendText(response, 405, 'Method not allowed');
  }

  return (request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      sendText(response, 500, 'Internal server error');
    });
  };
}

module.exports = {
  createWorkspaceMembersApp,
};
