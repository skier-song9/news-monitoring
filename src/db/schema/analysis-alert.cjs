'use strict';

const articleAnalysisRiskBands = ['low', 'medium', 'high'];
const keywordArticleAnalysisRelevanceSignalType = 'keyword';
const entityArticleAnalysisRelevanceSignalType = 'entity';
const articleAnalysisRelevanceSignalTypes = [
  keywordArticleAnalysisRelevanceSignalType,
  entityArticleAnalysisRelevanceSignalType,
];
const alertChannels = ['slack', 'email', 'sms'];
const alertEventStatuses = [
  'pending',
  'dispatching',
  'delivered',
  'partially_delivered',
  'failed',
  'suppressed',
];
const alertDeliveryStatuses = ['pending', 'sent', 'failed', 'skipped'];
const alertPolicyDefaultThreshold = 70;

module.exports = {
  alertChannels,
  alertDeliveryStatuses,
  alertEventStatuses,
  alertPolicyDefaultThreshold,
  articleAnalysisRelevanceSignalTypes,
  articleAnalysisRiskBands,
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
};
