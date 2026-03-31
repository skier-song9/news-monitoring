'use strict';

const { randomUUID } = require('node:crypto');

const { resolveEffectiveAlertPolicy } = require('./alert-policy-service.cjs');
const { highArticleAnalysisRiskBand } = require('../db/schema/analysis-alert.cjs');

const FINALIZED_ALERT_EVENT_STATUSES = new Set([
  'delivered',
  'partially_delivered',
  'failed',
  'suppressed',
]);

class OneMinuteAlertBatchingJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OneMinuteAlertBatchingJobError';
    this.code = code;
  }
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new OneMinuteAlertBatchingJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new OneMinuteAlertBatchingJobError('INVALID_INPUT', `${fieldName} is required`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value, fieldName) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new OneMinuteAlertBatchingJobError('INVALID_INPUT', `${fieldName} must be a string`);
  }

  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeBatchWindowMs(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new OneMinuteAlertBatchingJobError(
      'INVALID_INPUT',
      'batchWindowMs must be a positive integer',
    );
  }

  return value;
}

function parseRequiredTimestamp(value, fieldName) {
  const normalizedValue = normalizeRequiredString(value, fieldName);
  const timestampMs = Date.parse(normalizedValue);

  if (Number.isNaN(timestampMs)) {
    throw new OneMinuteAlertBatchingJobError(
      'INVALID_INPUT',
      `${fieldName} must be an ISO-8601 timestamp`,
    );
  }

  return {
    value: normalizedValue,
    timestampMs,
  };
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

function serializeDestination(destination) {
  if (Array.isArray(destination)) {
    return JSON.stringify(destination);
  }

  return destination;
}

function normalizeDispatchResult(channel, result, fallbackSentAt) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new OneMinuteAlertBatchingJobError(
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

function getBatchFinalStatus(deliveries) {
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

function listEligibleBatchSourceRows(db) {
  return db
    .prepare(`
      SELECT e.id AS alert_event_id,
             e.workspace_id,
             e.monitoring_target_id,
             e.article_id,
             e.article_analysis_id,
             e.alert_policy_id,
             e.threshold_value,
             e.risk_score,
             e.risk_band,
             e.status AS alert_event_status,
             e.triggered_at,
             e.dispatched_at,
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
             aa.relevance_score,
             aa.topic_labels,
             aa.summary,
             aa.rationale,
             aa.model_version,
             aa.relevance_scored_at,
             aa.topics_classified_at,
             aa.summary_generated_at,
             aa.risk_scored_at
      FROM alert_event e
      JOIN monitoring_target t
        ON t.workspace_id = e.workspace_id
       AND t.id = e.monitoring_target_id
      JOIN article a
        ON a.workspace_id = e.workspace_id
       AND a.id = e.article_id
      JOIN article_content ac
        ON ac.workspace_id = e.workspace_id
       AND ac.article_id = e.article_id
      JOIN article_analysis aa
        ON aa.workspace_id = e.workspace_id
       AND aa.id = e.article_analysis_id
      LEFT JOIN alert_batch_item bi
        ON bi.workspace_id = e.workspace_id
       AND bi.alert_event_id = e.id
      WHERE e.risk_band = ?
        AND bi.alert_event_id IS NULL
      ORDER BY e.workspace_id, e.monitoring_target_id, e.triggered_at, e.risk_score DESC, e.id
    `)
    .all(highArticleAnalysisRiskBand)
    .filter((row) => FINALIZED_ALERT_EVENT_STATUSES.has(row.alert_event_status));
}

function normalizeBatchSourceRow(row) {
  const triggeredAt = parseRequiredTimestamp(row.triggered_at, 'triggeredAt');

  return {
    id: row.alert_event_id,
    workspaceId: row.workspace_id,
    monitoringTargetId: row.monitoring_target_id,
    articleId: row.article_id,
    articleAnalysisId: row.article_analysis_id,
    alertPolicyId: row.alert_policy_id,
    thresholdValue: row.threshold_value,
    riskScore: row.risk_score,
    riskBand: row.risk_band,
    status: row.alert_event_status,
    triggeredAt: triggeredAt.value,
    triggeredAtMs: triggeredAt.timestampMs,
    dispatchedAt: row.dispatched_at,
    monitoringTarget: {
      id: row.monitoring_target_id,
      workspaceId: row.workspace_id,
      type: row.monitoring_target_type,
      displayName: row.monitoring_target_display_name,
      note: row.monitoring_target_note,
      status: row.monitoring_target_status,
      defaultRiskThreshold: row.default_risk_threshold,
    },
    article: {
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
    },
    articleAnalysis: {
      id: row.article_analysis_id,
      workspaceId: row.workspace_id,
      monitoringTargetId: row.monitoring_target_id,
      articleId: row.article_id,
      relevanceScore: row.relevance_score,
      topicLabels: parseTopicLabels(row.topic_labels),
      summary: row.summary,
      rationale: row.rationale,
      riskScore: row.risk_score,
      riskBand: row.risk_band,
      modelVersion: row.model_version,
      relevanceScoredAt: row.relevance_scored_at,
      topicsClassifiedAt: row.topics_classified_at,
      summaryGeneratedAt: row.summary_generated_at,
      riskScoredAt: row.risk_scored_at,
    },
  };
}

function createBatchGroups(batchSourceRows, batchWindowMs) {
  const groups = [];
  let currentGroup = null;

  for (const row of batchSourceRows.map(normalizeBatchSourceRow)) {
    const canAppendToCurrentGroup =
      currentGroup &&
      currentGroup.workspaceId === row.workspaceId &&
      currentGroup.monitoringTargetId === row.monitoringTargetId &&
      row.triggeredAtMs - currentGroup.windowStartedAtMs <= batchWindowMs;

    if (!canAppendToCurrentGroup) {
      if (currentGroup && currentGroup.alertEvents.length >= 2) {
        groups.push(currentGroup);
      }

      currentGroup = {
        workspaceId: row.workspaceId,
        monitoringTargetId: row.monitoringTargetId,
        windowStartedAt: row.triggeredAt,
        windowStartedAtMs: row.triggeredAtMs,
        windowEndedAt: row.triggeredAt,
        windowEndedAtMs: row.triggeredAtMs,
        monitoringTarget: row.monitoringTarget,
        alertEvents: [row],
      };
      continue;
    }

    currentGroup.alertEvents.push(row);
    currentGroup.windowEndedAt = row.triggeredAt;
    currentGroup.windowEndedAtMs = row.triggeredAtMs;
  }

  if (currentGroup && currentGroup.alertEvents.length >= 2) {
    groups.push(currentGroup);
  }

  return groups;
}

function pickHighestRiskAlertEvent(alertEvents) {
  return alertEvents
    .slice()
    .sort((left, right) => {
      if (right.riskScore !== left.riskScore) {
        return right.riskScore - left.riskScore;
      }

      if (left.triggeredAtMs !== right.triggeredAtMs) {
        return left.triggeredAtMs - right.triggeredAtMs;
      }

      return left.id.localeCompare(right.id);
    })[0];
}

function buildBatchPayload({
  monitoringTarget,
  highestRiskAlertEvent,
  articleCount,
  windowStartedAt,
  windowEndedAt,
}) {
  return {
    monitoringTargetName: monitoringTarget.displayName,
    articleCount,
    additionalArticleCount: articleCount - 1,
    thresholdValue: highestRiskAlertEvent.thresholdValue,
    highestRiskArticleTitle: highestRiskAlertEvent.article.title,
    highestRiskRiskScore: highestRiskAlertEvent.riskScore,
    highestRiskRiskBand: highestRiskAlertEvent.riskBand,
    highestRiskRationale: highestRiskAlertEvent.articleAnalysis.rationale,
    highestRiskPublisherName: highestRiskAlertEvent.article.publisherName,
    highestRiskArticleUrl: highestRiskAlertEvent.article.articleUrl,
    windowStartedAt,
    windowEndedAt,
  };
}

function createAlertBatch(db, batch) {
  db.prepare(`
    INSERT INTO alert_batch (
      id,
      workspace_id,
      monitoring_target_id,
      alert_policy_id,
      highest_risk_alert_event_id,
      article_count,
      status,
      window_started_at,
      window_ended_at,
      dispatched_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    batch.id,
    batch.workspaceId,
    batch.monitoringTargetId,
    batch.alertPolicyId,
    batch.highestRiskAlertEventId,
    batch.articleCount,
    batch.status,
    batch.windowStartedAt,
    batch.windowEndedAt,
    batch.dispatchedAt,
    batch.createdAt,
    batch.updatedAt,
  );
}

function createAlertBatchItem(db, item) {
  db.prepare(`
    INSERT INTO alert_batch_item (
      workspace_id,
      alert_batch_id,
      alert_event_id,
      created_at
    )
    VALUES (?, ?, ?, ?)
  `).run(
    item.workspaceId,
    item.alertBatchId,
    item.alertEventId,
    item.createdAt,
  );
}

function persistAlertBatchDelivery(db, delivery) {
  db.prepare(`
    INSERT INTO alert_batch_delivery (
      id,
      workspace_id,
      alert_batch_id,
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
    delivery.alertBatchId,
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
    INSERT INTO alert_batch_delivery_dispatch (
      workspace_id,
      alert_batch_delivery_id,
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

function updateAlertBatch(db, batch) {
  db.prepare(`
    UPDATE alert_batch
    SET status = ?,
        dispatched_at = ?,
        updated_at = ?
    WHERE workspace_id = ? AND id = ?
  `).run(
    batch.status,
    batch.dispatchedAt,
    batch.updatedAt,
    batch.workspaceId,
    batch.id,
  );
}

function cloneAlertEventForDispatch(alertEvent) {
  return {
    ...alertEvent,
    monitoringTarget: { ...alertEvent.monitoringTarget },
    article: { ...alertEvent.article },
    articleAnalysis: {
      ...alertEvent.articleAnalysis,
      topicLabels: alertEvent.articleAnalysis.topicLabels.slice(),
    },
  };
}

async function dispatchChannelBatchAlert({
  dispatcher,
  dispatcherName,
  channel,
  now,
  payload,
  alertBatch,
  alertPolicy,
  monitoringTarget,
  highestRiskAlertEvent,
  alertEvents,
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
        alertBatch: { ...alertBatch },
        alertPolicy: { ...alertPolicy },
        monitoringTarget: { ...monitoringTarget },
        highestRiskAlertEvent: cloneAlertEventForDispatch(highestRiskAlertEvent),
        alertEvents: alertEvents.map(cloneAlertEventForDispatch),
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

async function runOneMinuteAlertBatchingJob({
  db,
  dispatchSlackAlert,
  dispatchEmailAlert,
  dispatchSmsAlert,
  now = defaultNow,
  createId = defaultCreateId,
  batchWindowMs = 60_000,
}) {
  const normalizedBatchWindowMs = normalizeBatchWindowMs(batchWindowMs);
  const processedBatches = [];
  const batchGroups = createBatchGroups(listEligibleBatchSourceRows(db), normalizedBatchWindowMs);

  for (const group of batchGroups) {
    const effectivePolicy = resolveEffectiveAlertPolicy({
      db,
      workspaceId: group.workspaceId,
      monitoringTargetId: group.monitoringTargetId,
    });
    const highestRiskAlertEvent = pickHighestRiskAlertEvent(group.alertEvents);
    const alertBatchId = createId();
    const createdAt = now();
    const enabledChannels = buildEnabledChannels(effectivePolicy);
    const payload = buildBatchPayload({
      monitoringTarget: group.monitoringTarget,
      highestRiskAlertEvent,
      articleCount: group.alertEvents.length,
      windowStartedAt: group.windowStartedAt,
      windowEndedAt: group.windowEndedAt,
    });

    runInTransaction(db, () => {
      createAlertBatch(db, {
        id: alertBatchId,
        workspaceId: group.workspaceId,
        monitoringTargetId: group.monitoringTargetId,
        alertPolicyId: effectivePolicy.id,
        highestRiskAlertEventId: highestRiskAlertEvent.id,
        articleCount: group.alertEvents.length,
        status: enabledChannels.length > 0 ? 'dispatching' : 'suppressed',
        windowStartedAt: group.windowStartedAt,
        windowEndedAt: group.windowEndedAt,
        dispatchedAt: null,
        createdAt,
        updatedAt: createdAt,
      });

      for (const alertEvent of group.alertEvents) {
        createAlertBatchItem(db, {
          workspaceId: group.workspaceId,
          alertBatchId,
          alertEventId: alertEvent.id,
          createdAt,
        });
      }
    });

    if (enabledChannels.length === 0) {
      processedBatches.push({
        id: alertBatchId,
        workspaceId: group.workspaceId,
        monitoringTargetId: group.monitoringTargetId,
        alertPolicyId: effectivePolicy.id,
        highestRiskAlertEventId: highestRiskAlertEvent.id,
        articleCount: group.alertEvents.length,
        status: 'suppressed',
        windowStartedAt: group.windowStartedAt,
        windowEndedAt: group.windowEndedAt,
        dispatchedAt: null,
        alertEventIds: group.alertEvents.map((alertEvent) => alertEvent.id),
        deliveries: [],
        payload,
      });
      continue;
    }

    const deliveries = [];

    for (const enabledChannel of enabledChannels) {
      const delivery = await dispatchChannelBatchAlert({
        dispatcher:
          enabledChannel.dispatcherName === 'dispatchSlackAlert'
            ? dispatchSlackAlert
            : enabledChannel.dispatcherName === 'dispatchEmailAlert'
              ? dispatchEmailAlert
              : dispatchSmsAlert,
        dispatcherName: enabledChannel.dispatcherName,
        channel: enabledChannel.channel,
        now,
        payload,
        alertBatch: {
          id: alertBatchId,
          workspaceId: group.workspaceId,
          monitoringTargetId: group.monitoringTargetId,
          alertPolicyId: effectivePolicy.id,
          highestRiskAlertEventId: highestRiskAlertEvent.id,
          articleCount: group.alertEvents.length,
          status: 'dispatching',
          windowStartedAt: group.windowStartedAt,
          windowEndedAt: group.windowEndedAt,
          dispatchedAt: null,
        },
        alertPolicy: { ...effectivePolicy },
        monitoringTarget: { ...group.monitoringTarget },
        highestRiskAlertEvent,
        alertEvents: group.alertEvents,
        destination: enabledChannel.destination,
      });

      deliveries.push({
        id: createId(),
        workspaceId: group.workspaceId,
        alertBatchId,
        alertPolicyId: effectivePolicy.id,
        channel: delivery.channel,
        destination: delivery.destination,
        finalStatus: delivery.finalStatus,
        failureReason: delivery.failureReason,
        attemptedAt: delivery.attemptedAt,
        deliveredAt: delivery.deliveredAt,
        payloadReference: delivery.payloadReference,
        sentAt: delivery.sentAt,
      });
    }

    const finalStatus = getBatchFinalStatus(deliveries);
    const dispatchedAt = now();

    runInTransaction(db, () => {
      for (const delivery of deliveries) {
        persistAlertBatchDelivery(db, {
          ...delivery,
          createdAt: dispatchedAt,
          updatedAt: dispatchedAt,
        });
      }

      updateAlertBatch(db, {
        id: alertBatchId,
        workspaceId: group.workspaceId,
        status: finalStatus,
        dispatchedAt,
        updatedAt: dispatchedAt,
      });
    });

    processedBatches.push({
      id: alertBatchId,
      workspaceId: group.workspaceId,
      monitoringTargetId: group.monitoringTargetId,
      alertPolicyId: effectivePolicy.id,
      highestRiskAlertEventId: highestRiskAlertEvent.id,
      articleCount: group.alertEvents.length,
      status: finalStatus,
      windowStartedAt: group.windowStartedAt,
      windowEndedAt: group.windowEndedAt,
      dispatchedAt,
      alertEventIds: group.alertEvents.map((alertEvent) => alertEvent.id),
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        channel: delivery.channel,
        destination: delivery.destination,
        finalStatus: delivery.finalStatus,
        failureReason: delivery.failureReason,
        payloadReference: delivery.payloadReference,
        sentAt: delivery.sentAt,
      })),
      payload,
    });
  }

  return {
    processedBatches,
    totalProcessed: processedBatches.length,
    dispatchedBatches: processedBatches.filter((batch) => batch.status !== 'suppressed').length,
  };
}

module.exports = {
  OneMinuteAlertBatchingJobError,
  runOneMinuteAlertBatchingJob,
};
