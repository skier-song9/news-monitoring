'use strict';

const { URL, URLSearchParams } = require('node:url');

const {
  AlertPolicyServiceError,
  getAlertSettingsPage,
  saveTargetAlertPolicy,
  saveWorkspaceAlertPolicy,
} = require('../backend/alert-policy-service.cjs');
const {
  MonitoringTargetServiceError,
  activateMonitoringTarget,
  addTargetKeyword,
  createMonitoringTarget,
  disableTargetKeyword,
  getMonitoringTargetRegistrationPage,
  getMonitoringTargetReviewWorkflow,
  removeTargetKeyword,
  saveMonitoringTargetReviewDecision,
} = require('../backend/monitoring-target-service.cjs');
const {
  renderAlertSettingsPage,
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

function getAlertSettingsRouteMatch(pathname) {
  return pathname.match(/^\/workspaces\/([^/]+)\/alerts\/?$/u);
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

function normalizeCheckboxValue(value) {
  return value === '1' || value === 'true' || value === 'on';
}

function joinRecipientValues(value) {
  if (Array.isArray(value)) {
    return value.join('\n');
  }

  return normalizeFormValue(value);
}

function buildAlertSettingsFormValues(source) {
  return {
    riskThreshold:
      source?.riskThreshold == null ? '' : normalizeFormValue(String(source.riskThreshold)),
    slackEnabled: Boolean(source?.slackEnabled),
    slackWebhookUrl: normalizeFormValue(source?.slackWebhookUrl),
    emailEnabled: Boolean(source?.emailEnabled),
    emailRecipients: joinRecipientValues(source?.emailRecipients),
    smsEnabled: Boolean(source?.smsEnabled),
    smsRecipients: joinRecipientValues(source?.smsRecipients),
  };
}

function buildAlertSettingsFlashMessage(requestUrl) {
  const errorMessage = requestUrl.searchParams.get('error');

  if (errorMessage) {
    return {
      type: 'error',
      title: 'Alert settings not saved',
      message: errorMessage,
    };
  }

  const savedScope = requestUrl.searchParams.get('saved');

  if (savedScope === 'workspace') {
    return {
      type: 'success',
      title: 'Workspace defaults saved',
      message: 'The workspace-wide alert threshold and channel settings are updated.',
    };
  }

  if (savedScope === 'target') {
    return {
      type: 'success',
      title: 'Target override saved',
      message: 'The target-specific alert override now reflects the latest threshold and channels.',
    };
  }

  return null;
}

function getAlertSettingsErrorField(error) {
  if (!(error instanceof AlertPolicyServiceError) || error.code !== 'INVALID_INPUT') {
    return null;
  }

  if (/^riskThreshold\b/u.test(error.message)) {
    return 'riskThreshold';
  }

  if (/^slackWebhookUrl\b/u.test(error.message)) {
    return 'slackWebhookUrl';
  }

  if (/^emailRecipients\b/u.test(error.message)) {
    return 'emailRecipients';
  }

  if (/^smsRecipients\b/u.test(error.message)) {
    return 'smsRecipients';
  }

  return null;
}

function buildAlertSettingsFormErrors(requestUrl) {
  const errorMessage = requestUrl.searchParams.get('error');

  if (!errorMessage) {
    return {};
  }

  const errorField = requestUrl.searchParams.get('errorField');

  if (!errorField) {
    return {
      form: errorMessage,
    };
  }

  return {
    form: errorMessage,
    [errorField]: errorMessage,
  };
}

function getAlertSettingsFormOverride(requestUrl) {
  const scope = requestUrl.searchParams.get('scope');

  if (scope !== 'workspace' && scope !== 'target') {
    return null;
  }

  const hasFormValues = [
    'riskThreshold',
    'slackEnabled',
    'slackWebhookUrl',
    'emailEnabled',
    'emailRecipients',
    'smsEnabled',
    'smsRecipients',
  ].some((key) => requestUrl.searchParams.has(key));

  return {
    scope,
    monitoringTargetId: requestUrl.searchParams.get('monitoringTargetId'),
    formValues: hasFormValues
      ? buildAlertSettingsFormValues({
          riskThreshold: requestUrl.searchParams.get('riskThreshold'),
          slackEnabled: requestUrl.searchParams.get('slackEnabled') === '1',
          slackWebhookUrl: requestUrl.searchParams.get('slackWebhookUrl'),
          emailEnabled: requestUrl.searchParams.get('emailEnabled') === '1',
          emailRecipients: requestUrl.searchParams.get('emailRecipients'),
          smsEnabled: requestUrl.searchParams.get('smsEnabled') === '1',
          smsRecipients: requestUrl.searchParams.get('smsRecipients'),
        })
      : null,
    errors: buildAlertSettingsFormErrors(requestUrl),
  };
}

function buildAlertSettingsPageModel(alertSettingsPage, requestUrl) {
  const formOverride = getAlertSettingsFormOverride(requestUrl);
  const workspaceFormValues =
    formOverride?.scope === 'workspace' && formOverride.formValues
      ? formOverride.formValues
      : buildAlertSettingsFormValues(alertSettingsPage.workspacePolicy.effectivePolicy);

  return {
    ...alertSettingsPage,
    workspacePolicy: {
      ...alertSettingsPage.workspacePolicy,
      form: {
        values: workspaceFormValues,
        errors: formOverride?.scope === 'workspace' ? formOverride.errors : {},
        isHighlighted: formOverride?.scope === 'workspace',
      },
    },
    monitoringTargets: alertSettingsPage.monitoringTargets.map((monitoringTarget) => {
      const targetOverride =
        formOverride?.scope === 'target' &&
        formOverride.monitoringTargetId === monitoringTarget.id;

      return {
        ...monitoringTarget,
        alertSettingsForm: {
          values:
            targetOverride && formOverride.formValues
              ? formOverride.formValues
              : buildAlertSettingsFormValues(monitoringTarget.effectivePolicy),
          errors: targetOverride ? formOverride.errors : {},
          isHighlighted: targetOverride,
        },
      };
    }),
  };
}

function parseAlertSettingsFormSubmission(formData) {
  const formValues = buildAlertSettingsFormValues({
    riskThreshold: formData.get('riskThreshold'),
    slackEnabled: normalizeCheckboxValue(formData.get('slackEnabled')),
    slackWebhookUrl: formData.get('slackWebhookUrl'),
    emailEnabled: normalizeCheckboxValue(formData.get('emailEnabled')),
    emailRecipients: formData.get('emailRecipients'),
    smsEnabled: normalizeCheckboxValue(formData.get('smsEnabled')),
    smsRecipients: formData.get('smsRecipients'),
  });
  const policyOptions = {
    slackEnabled: formValues.slackEnabled,
    slackWebhookUrl: formValues.slackWebhookUrl,
    emailEnabled: formValues.emailEnabled,
    emailRecipients: formValues.emailRecipients,
    smsEnabled: formValues.smsEnabled,
    smsRecipients: formValues.smsRecipients,
  };
  const parsedRiskThreshold = parseRiskThreshold(formValues.riskThreshold);

  if (parsedRiskThreshold !== null) {
    policyOptions.riskThreshold = parsedRiskThreshold;
  }

  return {
    formValues,
    policyOptions,
  };
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
  const errorMessage = requestUrl.searchParams.get('error');

  if (errorMessage) {
    return {
      type: 'error',
      title: 'Review action unavailable',
      message: errorMessage,
    };
  }

  if (requestUrl.searchParams.get('activated') === '1') {
    return {
      type: 'success',
      title: 'Target activated',
      message: 'Collection can start because the review approval has already been saved.',
    };
  }

  const reviewSaved = requestUrl.searchParams.get('reviewSaved');

  if (reviewSaved) {
    return {
      type: 'success',
      title: 'Review saved',
      message: `Decision recorded: ${reviewSaved}.`,
    };
  }

  const keywordAction = requestUrl.searchParams.get('keywordAction');
  const keywordSourceType = requestUrl.searchParams.get('keywordSourceType');

  if (keywordAction && keywordSourceType) {
    return {
      type: 'success',
      title: 'Keyword updated',
      message: buildKeywordActionMessage(keywordAction, keywordSourceType),
    };
  }

  if (requestUrl.searchParams.get('created') !== '1') {
    return null;
  }

  return {
    type: 'success',
    title: 'Target saved',
    message: 'Your monitoring target is ready for the review workflow.',
  };
}

function formatKeywordSourceLabel(sourceType) {
  if (sourceType === 'seed') {
    return 'Seed';
  }

  if (sourceType === 'expanded') {
    return 'Expanded';
  }

  if (sourceType === 'excluded') {
    return 'Excluded';
  }

  return 'Keyword';
}

function buildKeywordActionMessage(action, sourceType) {
  const sourceLabel = formatKeywordSourceLabel(sourceType);

  if (action === 'added') {
    return `${sourceLabel} keyword saved.`;
  }

  if (action === 'disabled') {
    return `${sourceLabel} keyword disabled for future collector input.`;
  }

  if (action === 'removed') {
    return `${sourceLabel} keyword removed.`;
  }

  return `${sourceLabel} keywords updated.`;
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

function buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, flashState = {}) {
  const nextParams = new URLSearchParams();
  const userId = requestUrl.searchParams.get('userId');

  if (userId) {
    nextParams.set('userId', userId);
  }

  for (const [key, value] of Object.entries(flashState)) {
    if (value == null || value === '') {
      continue;
    }

    nextParams.set(key, String(value));
  }

  const search = nextParams.toString();
  const pathname = `/workspaces/${encodeURIComponent(workspaceId)}/targets/${encodeURIComponent(monitoringTargetId)}/review`;
  return search ? `${pathname}?${search}` : pathname;
}

function buildAlertSettingsLocation(requestUrl, workspaceId, state = {}) {
  const nextParams = new URLSearchParams();
  const userId = requestUrl.searchParams.get('userId');

  if (userId) {
    nextParams.set('userId', userId);
  }

  for (const [key, value] of Object.entries(state)) {
    if (value == null) {
      continue;
    }

    if (key === 'formValues') {
      nextParams.set('riskThreshold', value.riskThreshold);
      nextParams.set('slackEnabled', value.slackEnabled ? '1' : '0');
      nextParams.set('slackWebhookUrl', value.slackWebhookUrl);
      nextParams.set('emailEnabled', value.emailEnabled ? '1' : '0');
      nextParams.set('emailRecipients', value.emailRecipients);
      nextParams.set('smsEnabled', value.smsEnabled ? '1' : '0');
      nextParams.set('smsRecipients', value.smsRecipients);
      continue;
    }

    if (value === '') {
      nextParams.set(key, '');
      continue;
    }

    nextParams.set(key, String(value));
  }

  const search = nextParams.toString();
  const pathname = `/workspaces/${encodeURIComponent(workspaceId)}/alerts`;
  return search ? `${pathname}?${search}` : pathname;
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

function getAlertPolicyErrorStatusCode(error) {
  if (
    error.code === 'WORKSPACE_NOT_FOUND' ||
    error.code === 'MONITORING_TARGET_NOT_FOUND'
  ) {
    return 404;
  }

  if (error.code === 'INVALID_INPUT') {
    return 400;
  }

  return 403;
}

function assertKeywordEditingAllowed({
  db,
  workspaceId,
  monitoringTargetId,
  userId,
}) {
  const reviewWorkflow = getMonitoringTargetReviewWorkflow({
    db,
    workspaceId,
    monitoringTargetId,
    userId,
  });

  if (reviewWorkflow.keywordEditor.canEdit) {
    return;
  }

  throw new MonitoringTargetServiceError(
    'TARGET_KEYWORD_EDIT_FORBIDDEN',
    reviewWorkflow.keywordEditor.blockedReason ?? 'Keyword editing is unavailable.',
  );
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
            buildReviewLocation(requestUrl, workspaceId, monitoringTarget.id, {
              created: '1',
            }),
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

    const alertSettingsRouteMatch = getAlertSettingsRouteMatch(requestUrl.pathname);

    if (alertSettingsRouteMatch) {
      const workspaceId = decodeURIComponent(alertSettingsRouteMatch[1]);

      if (request.method === 'GET') {
        try {
          const alertSettingsPage = getAlertSettingsPage({
            db,
            workspaceId,
            userId,
          });

          sendHtml(
            response,
            200,
            renderAlertSettingsPage({
              alertSettingsPage: buildAlertSettingsPageModel(
                alertSettingsPage,
                requestUrl,
              ),
              flashMessage: buildAlertSettingsFlashMessage(requestUrl),
            }),
          );
        } catch (error) {
          if (error instanceof AlertPolicyServiceError) {
            sendText(response, getAlertPolicyErrorStatusCode(error), error.message);
            return;
          }

          throw error;
        }

        return;
      }

      if (request.method === 'POST') {
        let action = '';
        let monitoringTargetId = null;
        let formValues = null;
        let policyOptions = null;

        try {
          const formData = await parseFormBody(request);
          action = normalizeFormValue(formData.get('action'));
          ({ formValues, policyOptions } = parseAlertSettingsFormSubmission(formData));

          if (action === 'save-workspace-alert-settings') {
            saveWorkspaceAlertPolicy({
              db,
              workspaceId,
              userId,
              ...policyOptions,
              now,
              createId,
            });

            redirect(
              response,
              buildAlertSettingsLocation(requestUrl, workspaceId, {
                scope: 'workspace',
                saved: 'workspace',
              }),
            );
            return;
          }

          if (action === 'save-target-alert-settings') {
            monitoringTargetId = normalizeFormValue(formData.get('monitoringTargetId'));

            saveTargetAlertPolicy({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
              ...policyOptions,
              now,
              createId,
            });

            redirect(
              response,
              buildAlertSettingsLocation(requestUrl, workspaceId, {
                scope: 'target',
                monitoringTargetId,
                saved: 'target',
              }),
            );
            return;
          }

          sendText(response, 400, 'Unknown alert settings action');
        } catch (error) {
          if (error instanceof AlertPolicyServiceError) {
            if (error.code !== 'INVALID_INPUT') {
              sendText(response, getAlertPolicyErrorStatusCode(error), error.message);
              return;
            }

            redirect(
              response,
              buildAlertSettingsLocation(requestUrl, workspaceId, {
                scope: action === 'save-target-alert-settings' ? 'target' : 'workspace',
                monitoringTargetId,
                error: error.message,
                errorField: getAlertSettingsErrorField(error),
                formValues,
              }),
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
      const workspaceId = decodeURIComponent(reviewRouteMatch[1]);
      const monitoringTargetId = decodeURIComponent(reviewRouteMatch[2]);

      if (request.method === 'GET') {
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

      if (request.method === 'POST') {
        try {
          const formData = await parseFormBody(request);
          const action = normalizeFormValue(formData.get('action'));

          if (action === 'add-keyword') {
            assertKeywordEditingAllowed({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
            });

            const targetKeyword = addTargetKeyword({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
              keyword: normalizeFormValue(formData.get('keyword')),
              sourceType: normalizeFormValue(formData.get('sourceType')),
              now,
              createId,
            });

            redirect(
              response,
              buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, {
                keywordAction: 'added',
                keywordSourceType: targetKeyword.sourceType,
              }),
            );
            return;
          }

          if (action === 'disable-keyword') {
            assertKeywordEditingAllowed({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
            });

            const targetKeyword = disableTargetKeyword({
              db,
              workspaceId,
              monitoringTargetId,
              targetKeywordId: normalizeFormValue(formData.get('targetKeywordId')),
              userId,
              now,
            });

            redirect(
              response,
              buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, {
                keywordAction: 'disabled',
                keywordSourceType: targetKeyword.sourceType,
              }),
            );
            return;
          }

          if (action === 'remove-keyword') {
            assertKeywordEditingAllowed({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
            });

            const targetKeyword = removeTargetKeyword({
              db,
              workspaceId,
              monitoringTargetId,
              targetKeywordId: normalizeFormValue(formData.get('targetKeywordId')),
              userId,
              now,
            });

            redirect(
              response,
              buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, {
                keywordAction: 'removed',
                keywordSourceType: targetKeyword.sourceType,
              }),
            );
            return;
          }

          if (action === 'save-review') {
            const decision = normalizeFormValue(formData.get('decision'));

            saveMonitoringTargetReviewDecision({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
              decision,
              now,
              createId,
            });

            redirect(
              response,
              buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, {
                reviewSaved: decision.trim().toLowerCase(),
              }),
            );
            return;
          }

          if (action === 'activate') {
            activateMonitoringTarget({
              db,
              workspaceId,
              monitoringTargetId,
              userId,
              now,
            });

            redirect(
              response,
              buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, {
                activated: '1',
              }),
            );
            return;
          }

          sendText(response, 400, 'Unknown review action');
        } catch (error) {
          if (error instanceof MonitoringTargetServiceError) {
            redirect(
              response,
              buildReviewLocation(requestUrl, workspaceId, monitoringTargetId, {
                error: error.message,
              }),
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
