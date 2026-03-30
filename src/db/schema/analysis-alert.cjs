'use strict';

const articleAnalysisRiskBands = ['low', 'medium', 'high'];
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
  articleAnalysisRiskBands,
};
