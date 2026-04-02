'use strict';

const { URL, URLSearchParams } = require('node:url');

const {
  MonitoringTargetServiceError,
  createMonitoringTarget,
  getMonitoringTargetRegistrationPage,
  getMonitoringTargetReviewWorkflow,
} = require('../backend/monitoring-target-service.cjs');
const {
  renderMonitoringTargetRegistrationPage,
  renderMonitoringTargetReviewPage,
} = require('../ui/monitoring-target-registration-page.cjs');

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

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(message);
}

function redirect(response, location) {
  response.writeHead(303, {
    location,
    'cache-control': 'no-store',
  });
  response.end();
}

function getRegistrationRouteMatch(pathname) {
  return pathname.match(/^\/workspaces\/([^/]+)\/targets\/new\/?$/u);
}

function getReviewRouteMatch(pathname) {
  return pathname.match(/^\/workspaces\/([^/]+)\/targets\/([^/]+)\/review\/?$/u);
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

function normalizeFormValue(value) {
  return typeof value === 'string' ? value : '';
}

function buildFormValues(source) {
  return {
    type: normalizeFormValue(source.type),
    displayName: normalizeFormValue(source.displayName),
    note: normalizeFormValue(source.note),
    defaultRiskThreshold: normalizeFormValue(source.defaultRiskThreshold),
    seedKeywords: normalizeFormValue(source.seedKeywords),
  };
}

function parseRiskThreshold(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  return Number(normalizedValue);
}

function parseSeedKeywords(value) {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(/\r?\n/u)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function buildRegistrationFlashMessage(requestUrl) {
  const errorMessage = requestUrl.searchParams.get('error');

  if (!errorMessage) {
    return null;
  }

  return {
    type: 'error',
    title: 'Target not saved',
    message: errorMessage,
  };
}

function buildReviewFlashMessage(requestUrl) {
  if (requestUrl.searchParams.get('created') !== '1') {
    return null;
  }

  return {
    type: 'success',
    title: 'Target saved',
    message: 'Your monitoring target is ready for the review workflow.',
  };
}

function buildRegistrationLocation(requestUrl, formValues, errorMessage) {
  const nextParams = new URLSearchParams();
  const userId = requestUrl.searchParams.get('userId');

  if (userId) {
    nextParams.set('userId', userId);
  }

  if (errorMessage) {
    nextParams.set('error', errorMessage);
  }

  for (const [key, value] of Object.entries(formValues)) {
    if (value) {
      nextParams.set(key, value);
    }
  }

  const search = nextParams.toString();
  return `${requestUrl.pathname}${search ? `?${search}` : ''}`;
}

function buildReviewLocation(requestUrl, workspaceId, monitoringTargetId) {
  const nextParams = new URLSearchParams();
  const userId = requestUrl.searchParams.get('userId');

  if (userId) {
    nextParams.set('userId', userId);
  }

  nextParams.set('created', '1');

  return `/workspaces/${encodeURIComponent(workspaceId)}/targets/${encodeURIComponent(monitoringTargetId)}/review?${nextParams.toString()}`;
}

function getErrorStatusCode(error) {
  if (
    error.code === 'WORKSPACE_NOT_FOUND' ||
    error.code === 'MONITORING_TARGET_NOT_FOUND'
  ) {
    return 404;
  }

  return 403;
}

function createMonitoringTargetRegistrationApp({
  db,
  getCurrentUserId,
  now,
  createId,
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

    const userId = normalizeRequestUserId(
      getCurrentUserId({ request, requestUrl }),
    );

    if (!userId) {
      sendText(response, 401, 'Missing current user');
      return;
    }

    const registrationRouteMatch = getRegistrationRouteMatch(requestUrl.pathname);

    if (registrationRouteMatch) {
      const workspaceId = decodeURIComponent(registrationRouteMatch[1]);

      if (request.method === 'GET') {
        try {
          const registration = getMonitoringTargetRegistrationPage({
            db,
            workspaceId,
            userId,
          });
          const formValues = buildFormValues({
            type: requestUrl.searchParams.get('type') ?? registration.defaults.type,
            displayName: requestUrl.searchParams.get('displayName'),
            note: requestUrl.searchParams.get('note'),
            defaultRiskThreshold:
              requestUrl.searchParams.get('defaultRiskThreshold') ??
              String(registration.defaults.defaultRiskThreshold),
            seedKeywords: requestUrl.searchParams.get('seedKeywords'),
          });

          sendHtml(
            response,
            200,
            renderMonitoringTargetRegistrationPage({
              registration,
              formValues,
              flashMessage: buildRegistrationFlashMessage(requestUrl),
            }),
          );
        } catch (error) {
          if (error instanceof MonitoringTargetServiceError) {
            sendText(response, getErrorStatusCode(error), error.message);
            return;
          }

          throw error;
        }

        return;
      }

      if (request.method === 'POST') {
        const formData = await parseFormBody(request);
        const formValues = buildFormValues({
          type: formData.get('type'),
          displayName: formData.get('displayName'),
          note: formData.get('note'),
          defaultRiskThreshold: formData.get('defaultRiskThreshold'),
          seedKeywords: formData.get('seedKeywords'),
        });

        try {
          const monitoringTarget = createMonitoringTarget({
            db,
            workspaceId,
            userId,
            type: formValues.type,
            displayName: formValues.displayName,
            note: formValues.note,
            defaultRiskThreshold: parseRiskThreshold(formValues.defaultRiskThreshold),
            seedKeywords: parseSeedKeywords(formValues.seedKeywords),
            now,
            createId,
          });

          redirect(
            response,
            buildReviewLocation(requestUrl, workspaceId, monitoringTarget.id),
          );
        } catch (error) {
          if (error instanceof MonitoringTargetServiceError) {
            redirect(
              response,
              buildRegistrationLocation(requestUrl, formValues, error.message),
            );
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
      return;
    }

    const reviewRouteMatch = getReviewRouteMatch(requestUrl.pathname);

    if (reviewRouteMatch) {
      if (request.method !== 'GET') {
        sendText(response, 405, 'Method not allowed');
        return;
      }

      const workspaceId = decodeURIComponent(reviewRouteMatch[1]);
      const monitoringTargetId = decodeURIComponent(reviewRouteMatch[2]);

      try {
        const reviewWorkflow = getMonitoringTargetReviewWorkflow({
          db,
          workspaceId,
          monitoringTargetId,
          userId,
        });

        sendHtml(
          response,
          200,
          renderMonitoringTargetReviewPage({
            reviewWorkflow,
            flashMessage: buildReviewFlashMessage(requestUrl),
          }),
        );
      } catch (error) {
        if (error instanceof MonitoringTargetServiceError) {
          sendText(response, getErrorStatusCode(error), error.message);
          return;
        }

        throw error;
      }

      return;
    }

    sendText(response, 404, 'Not found');
  }

  return (request, response) => {
    handleRequest(request, response).catch((error) => {
      sendText(response, 500, error.message);
    });
  };
}

module.exports = {
  createMonitoringTargetRegistrationApp,
};
