'use strict';

const { randomUUID } = require('node:crypto');

const { resolveEffectiveAlertPolicy } = require('./alert-policy-service.cjs');
const { completedArticleIngestionStatus } = require('../db/schema/article-ingestion.cjs');
const { activeMonitoringTargetStatus } = require('../db/schema/monitoring-target.cjs');

const retryableAlertEventStatuses = ['pending', 'dispatching'];

class ImmediateAlertDispatchJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImmediateAlertDispatchJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new ImmediateAlertDispatchJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new ImmediateAlertDispatchJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new ImmediateAlertDispatchJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function defaultNow() {
  return new Date().toISOString();
}

function defaultCreateId() {
  return randomUUID();
}

function runInTransaction(db, callback) {
  db.exec('BEGIN');

  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures because the original error is the actionable one.
    }

    throw error;
  }
}

function parseTopicLabels(value) {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter((topicLabel) => typeof topicLabel === 'string');
  } catch {
    return [];
  }
}

function listEligibleImmediateAlerts(db) {
  return db
    .prepare(`
      SELECT aa.id AS article_analysis_id,
             aa.workspace_id,
             aa.monitoring_target_id,
             aa.article_id,
             aa.relevance_score,
             aa.topic_labels,
             aa.summary,
             aa.risk_score,
             aa.risk_band,
             aa.rationale,
             aa.model_version,
             aa.relevance_scored_at,
             aa.topics_classified_at,
             aa.summary_generated_at,
             aa.risk_scored_at,
             t.type AS monitoring_target_type,
             t.display_name AS monitoring_target_display_name,
             t.note AS monitoring_target_note,
             t.status AS monitoring_target_status,
             t.default_risk_threshold,
             a.source_url,
             a.canonical_url,
             a.ingestion_status,
             ac.title,
             ac.body_text,
             ac.author_name,
             ac.publisher_name,
             ac.published_at,
             ac.view_count,
             ac.fetched_at,
             e.id AS alert_event_id,
             e.status AS alert_event_status,
             e.triggered_at AS alert_event_triggered_at
      FROM article_analysis aa
      JOIN monitoring_target t
        ON t.workspace_id = aa.workspace_id
       AND t.id = aa.monitoring_target_id
      JOIN article a
        ON a.workspace_id = aa.workspace_id
       AND a.id = aa.article_id
      JOIN article_content ac
        ON ac.workspace_id = aa.workspace_id
       AND ac.article_id = aa.article_id
      LEFT JOIN alert_event e
       ON e.workspace_id = aa.workspace_id
       AND e.article_analysis_id = aa.id
      WHERE a.ingestion_status = ?
        AND aa.risk_score IS NOT NULL
        AND t.status = ?
        AND (
          e.id IS NULL
          OR e.status IN (?, ?)
        )
      ORDER BY aa.workspace_id, aa.monitoring_target_id, aa.article_id
    `)
    .all(
      completedArticleIngestionStatus,
      activeMonitoringTargetStatus,
      retryableAlertEventStatuses[0],
      retryableAlertEventStatuses[1],
    );
}

function normalizeMonitoringTargetRow(row) {
  return {
    id: row.monitoring_target_id,
    workspaceId: row.workspace_id,
    type: row.monitoring_target_type,
    displayName: row.monitoring_target_display_name,
    note: row.monitoring_target_note,
    status: row.monitoring_target_status,
    defaultRiskThreshold: row.default_risk_threshold,
  };
}

function normalizeArticleRow(row) {
  return {
    id: row.article_id,
    workspaceId: row.workspace_id,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    articleUrl: row.canonical_url || row.source_url,
    ingestionStatus: row.ingestion_status,
    title: row.title,
    bodyText: row.body_text,
    authorName: row.author_name,
    publisherName: row.publisher_name,
    publishedAt: row.published_at,
    viewCount: row.view_count,
    fetchedAt: row.fetched_at,
  };
}

function normalizeArticleAnalysisRow(row) {
  return {
    id: row.article_analysis_id,
    workspaceId: row.workspace_id,
    monitoringTargetId: row.monitoring_target_id,
    articleId: row.article_id,
    relevanceScore: row.relevance_score,
    topicLabels: parseTopicLabels(row.topic_labels),
    summary: row.summary,
    riskScore: row.risk_score,
    riskBand: row.risk_band,
    rationale: row.rationale,
    modelVersion: row.model_version,
    relevanceScoredAt: row.relevance_scored_at,
    topicsClassifiedAt: row.topics_classified_at,
    summaryGeneratedAt: row.summary_generated_at,
    riskScoredAt: row.risk_scored_at,
  };
}

function normalizeExistingAlertEventRow(row) {
  if (typeof row.alert_event_id !== 'string' || !row.alert_event_id.trim()) {
    return null;
  }

  return {
    id: row.alert_event_id,
    status: row.alert_event_status,
    triggeredAt: row.alert_event_triggered_at,
  };
}

function buildAlertPayload({ monitoringTarget, article, articleAnalysis, thresholdValue }) {
  return {
    monitoringTargetName: monitoringTarget.displayName,
    articleTitle: article.title,
    riskScore: articleAnalysis.riskScore,
    riskBand: articleAnalysis.riskBand,
    rationale: articleAnalysis.rationale,
    publisherName: article.publisherName,
    articleUrl: article.articleUrl,
    thresholdValue,
  };
}

function buildEnabledChannels(policy) {
  const enabledChannels = [];

  if (policy.slackEnabled && policy.slackWebhookUrl) {
    enabledChannels.push({
      channel: 'slack',
      destination: policy.slackWebhookUrl,
      dispatcherName: 'dispatchSlackAlert',
    });
  }

  if (policy.emailEnabled && policy.emailRecipients.length > 0) {
    enabledChannels.push({
      channel: 'email',
      destination: policy.emailRecipients.slice(),
      dispatcherName: 'dispatchEmailAlert',
    });
  }

  if (policy.smsEnabled && policy.smsRecipients.length > 0) {
    enabledChannels.push({
      channel: 'sms',
      destination: policy.smsRecipients.slice(),
      dispatcherName: 'dispatchSmsAlert',
    });
  }

  return enabledChannels;
}

function serializeDestination(destination) {
  if (Array.isArray(destination)) {
    return JSON.stringify(destination);
  }

  return destination;
}

function normalizeDispatchResult(channel, result, fallbackSentAt) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ImmediateAlertDispatchJobError(
      'INVALID_DISPATCH_RESULT',
      `${channel} dispatch must resolve to an object`,
    );
  }

  return {
    payloadReference: normalizeRequiredString(
      result.payloadReference,
      `${channel} payloadReference`,
    ),
    sentAt: normalizeOptionalString(result.sentAt, `${channel} sentAt`) || fallbackSentAt,
  };
}

function getFailureReason(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return 'Alert dispatch failed';
}

function getAlertEventFinalStatus(deliveries) {
  if (deliveries.length === 0) {
    return 'suppressed';
  }

  const sentDeliveries = deliveries.filter((delivery) => delivery.finalStatus === 'sent');

  if (sentDeliveries.length === deliveries.length) {
    return 'delivered';
  }

  if (sentDeliveries.length > 0) {
    return 'partially_delivered';
  }

  return 'failed';
}

function createAlertEvent(db, event) {
  db.prepare(`
    INSERT INTO alert_event (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      article_analysis_id,
      alert_policy_id,
      threshold_value,
      risk_score,
      risk_band,
      status,
      triggered_at,
      dispatched_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.workspaceId,
    event.monitoringTargetId,
    event.articleId,
    event.articleAnalysisId,
    event.alertPolicyId,
    event.thresholdValue,
    event.riskScore,
    event.riskBand,
    event.status,
    event.triggeredAt,
    event.dispatchedAt,
    event.createdAt,
    event.updatedAt,
  );
}

function deleteAlertDeliveriesByEventId(db, event) {
  db.prepare(`
    DELETE FROM alert_delivery
    WHERE workspace_id = ? AND alert_event_id = ?
  `).run(event.workspaceId, event.id);
}

function resetAlertEventForDispatch(db, event) {
  db.prepare(`
    UPDATE alert_event
    SET alert_policy_id = ?,
        threshold_value = ?,
        risk_score = ?,
        risk_band = ?,
        status = ?,
        dispatched_at = ?,
        updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `).run(
    event.alertPolicyId,
    event.thresholdValue,
    event.riskScore,
    event.riskBand,
    event.status,
    event.dispatchedAt,
    event.updatedAt,
    event.workspaceId,
    event.id,
  );
}

function persistAlertDelivery(db, delivery) {
  db.prepare(`
    INSERT INTO alert_delivery (
      id,
      workspace_id,
      alert_event_id,
      alert_policy_id,
      channel,
      destination,
      final_status,
      failure_reason,
      attempted_at,
      delivered_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    delivery.id,
    delivery.workspaceId,
    delivery.alertEventId,
    delivery.alertPolicyId,
    delivery.channel,
    serializeDestination(delivery.destination),
    delivery.finalStatus,
    delivery.failureReason,
    delivery.attemptedAt,
    delivery.deliveredAt,
    delivery.createdAt,
    delivery.updatedAt,
  );

  db.prepare(`
    INSERT INTO alert_delivery_dispatch (
      workspace_id,
      alert_delivery_id,
      payload_reference,
      sent_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    delivery.workspaceId,
    delivery.id,
    delivery.payloadReference,
    delivery.sentAt,
    delivery.createdAt,
    delivery.updatedAt,
  );
}

function updateAlertEvent(db, event) {
  db.prepare(`
    UPDATE alert_event
    SET status = ?,
        dispatched_at = ?,
        updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `).run(
    event.status,
    event.dispatchedAt,
    event.updatedAt,
    event.workspaceId,
    event.id,
  );
}

async function dispatchChannelAlert({
  dispatcher,
  dispatcherName,
  channel,
  now,
  payload,
  alertEvent,
  alertPolicy,
  monitoringTarget,
  article,
  articleAnalysis,
  destination,
}) {
  const attemptedAt = now();

  if (typeof dispatcher !== 'function') {
    return {
      channel,
      destination,
      finalStatus: 'failed',
      failureReason: `${dispatcherName} must be configured for enabled ${channel} alerts`,
      attemptedAt,
      deliveredAt: null,
      payloadReference: null,
      sentAt: null,
    };
  }

  try {
    const dispatchResult = normalizeDispatchResult(
      channel,
      await dispatcher({
        alertEvent: { ...alertEvent },
        alertPolicy: { ...alertPolicy },
        monitoringTarget: { ...monitoringTarget },
        article: { ...article },
        articleAnalysis: {
          ...articleAnalysis,
          topicLabels: articleAnalysis.topicLabels.slice(),
        },
        destination: Array.isArray(destination) ? destination.slice() : destination,
        payload: { ...payload },
      }),
      attemptedAt,
    );

    return {
      channel,
      destination,
      finalStatus: 'sent',
      failureReason: null,
      attemptedAt: dispatchResult.sentAt,
      deliveredAt: dispatchResult.sentAt,
      payloadReference: dispatchResult.payloadReference,
      sentAt: dispatchResult.sentAt,
    };
  } catch (error) {
    return {
      channel,
      destination,
      finalStatus: 'failed',
      failureReason: getFailureReason(error),
      attemptedAt,
      deliveredAt: null,
      payloadReference: null,
      sentAt: null,
    };
  }
}

async function runImmediateAlertDispatchJob({
  db,
  dispatchSlackAlert,
  dispatchEmailAlert,
  dispatchSmsAlert,
  now = defaultNow,
  createId = defaultCreateId,
}) {
  const processedAlerts = [];

  for (const row of listEligibleImmediateAlerts(db)) {
    const monitoringTarget = normalizeMonitoringTargetRow(row);
    const article = normalizeArticleRow(row);
    const articleAnalysis = normalizeArticleAnalysisRow(row);
    const existingAlertEvent = normalizeExistingAlertEventRow(row);
    const effectivePolicy = resolveEffectiveAlertPolicy({
      db,
      workspaceId: monitoringTarget.workspaceId,
      monitoringTargetId: monitoringTarget.id,
    });

    if (articleAnalysis.riskScore < effectivePolicy.riskThreshold) {
      continue;
    }

    const triggeredAt = existingAlertEvent ? existingAlertEvent.triggeredAt : now();
    const alertEventId = existingAlertEvent ? existingAlertEvent.id : createId();
    const alertPayload = buildAlertPayload({
      monitoringTarget,
      article,
      articleAnalysis,
      thresholdValue: effectivePolicy.riskThreshold,
    });
    const enabledChannels = buildEnabledChannels(effectivePolicy);
    const initialStatus = enabledChannels.length > 0 ? 'dispatching' : 'suppressed';

    runInTransaction(db, () => {
      if (existingAlertEvent) {
        deleteAlertDeliveriesByEventId(db, {
          id: alertEventId,
          workspaceId: monitoringTarget.workspaceId,
        });
        resetAlertEventForDispatch(db, {
          id: alertEventId,
          workspaceId: monitoringTarget.workspaceId,
          alertPolicyId: effectivePolicy.id,
          thresholdValue: effectivePolicy.riskThreshold,
          riskScore: articleAnalysis.riskScore,
          riskBand: articleAnalysis.riskBand,
          status: initialStatus,
          dispatchedAt: null,
          updatedAt: now(),
        });
        return;
      }

      createAlertEvent(db, {
        id: alertEventId,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        articleAnalysisId: articleAnalysis.id,
        alertPolicyId: effectivePolicy.id,
        thresholdValue: effectivePolicy.riskThreshold,
        riskScore: articleAnalysis.riskScore,
        riskBand: articleAnalysis.riskBand,
        status: initialStatus,
        triggeredAt,
        dispatchedAt: null,
        createdAt: triggeredAt,
        updatedAt: triggeredAt,
      });
    });

    if (enabledChannels.length === 0) {
      processedAlerts.push({
        id: alertEventId,
        workspaceId: monitoringTarget.workspaceId,
        monitoringTargetId: monitoringTarget.id,
        articleId: article.id,
        articleAnalysisId: articleAnalysis.id,
        alertPolicyId: effectivePolicy.id,
        thresholdValue: effectivePolicy.riskThreshold,
        riskScore: articleAnalysis.riskScore,
        riskBand: articleAnalysis.riskBand,
        status: 'suppressed',
        triggeredAt,
        dispatchedAt: null,
        deliveries: [],
        payload: alertPayload,
      });
      continue;
    }

    const dispatchers = {
      dispatchSlackAlert,
      dispatchEmailAlert,
      dispatchSmsAlert,
    };

    const dispatchResults = [];

    for (const enabledChannel of enabledChannels) {
      dispatchResults.push(
        await dispatchChannelAlert({
          dispatcher: dispatchers[enabledChannel.dispatcherName],
          dispatcherName: enabledChannel.dispatcherName,
          channel: enabledChannel.channel,
          now,
          payload: alertPayload,
          alertEvent: {
            id: alertEventId,
            workspaceId: monitoringTarget.workspaceId,
            monitoringTargetId: monitoringTarget.id,
            articleId: article.id,
            articleAnalysisId: articleAnalysis.id,
            alertPolicyId: effectivePolicy.id,
            thresholdValue: effectivePolicy.riskThreshold,
            riskScore: articleAnalysis.riskScore,
            riskBand: articleAnalysis.riskBand,
            status: 'dispatching',
            triggeredAt,
          },
          alertPolicy: { ...effectivePolicy },
          monitoringTarget,
          article,
          articleAnalysis,
          destination: enabledChannel.destination,
        }),
      );
    }

    const finalizedAt = now();
    const finalStatus = getAlertEventFinalStatus(dispatchResults);
    const persistedDeliveries = dispatchResults.map((dispatchResult) => ({
      id: createId(),
      workspaceId: monitoringTarget.workspaceId,
      alertEventId,
      alertPolicyId: effectivePolicy.id,
      channel: dispatchResult.channel,
      destination: dispatchResult.destination,
      finalStatus: dispatchResult.finalStatus,
      failureReason: dispatchResult.failureReason,
      attemptedAt: dispatchResult.attemptedAt,
      deliveredAt: dispatchResult.deliveredAt,
      payloadReference: dispatchResult.payloadReference,
      sentAt: dispatchResult.sentAt,
      createdAt: finalizedAt,
      updatedAt: finalizedAt,
    }));

    runInTransaction(db, () => {
      for (const delivery of persistedDeliveries) {
        persistAlertDelivery(db, delivery);
      }

      updateAlertEvent(db, {
        id: alertEventId,
        workspaceId: monitoringTarget.workspaceId,
        status: finalStatus,
        dispatchedAt: finalizedAt,
        updatedAt: finalizedAt,
      });
    });

    processedAlerts.push({
      id: alertEventId,
      workspaceId: monitoringTarget.workspaceId,
      monitoringTargetId: monitoringTarget.id,
      articleId: article.id,
      articleAnalysisId: articleAnalysis.id,
      alertPolicyId: effectivePolicy.id,
      thresholdValue: effectivePolicy.riskThreshold,
      riskScore: articleAnalysis.riskScore,
      riskBand: articleAnalysis.riskBand,
      status: finalStatus,
      triggeredAt,
      dispatchedAt: finalizedAt,
      deliveries: persistedDeliveries.map((delivery) => ({
        id: delivery.id,
        channel: delivery.channel,
        destination: Array.isArray(delivery.destination)
          ? delivery.destination.slice()
          : delivery.destination,
        finalStatus: delivery.finalStatus,
        failureReason: delivery.failureReason,
        payloadReference: delivery.payloadReference,
        sentAt: delivery.sentAt,
      })),
      payload: alertPayload,
    });
  }

  return {
    processedAlerts,
    totalProcessed: processedAlerts.length,
    dispatchedAlerts: processedAlerts.filter((alert) => alert.deliveries.length > 0).length,
  };
}

module.exports = {
  ImmediateAlertDispatchJobError,
  runImmediateAlertDispatchJob,
};
