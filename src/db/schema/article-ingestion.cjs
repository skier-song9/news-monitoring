'use strict';

const articleCandidateIngestionStatuses = ['pending', 'processing', 'linked', 'failed', 'discarded'];
const articleIngestionStatuses = ['pending', 'processing', 'completed', 'failed'];
const articleCandidatePortalNames = ['naver', 'nate', 'google_news'];

const defaultArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[0];
const defaultArticleIngestionStatus = articleIngestionStatuses[0];
const processingArticleIngestionStatus = articleIngestionStatuses[1];
const completedArticleIngestionStatus = articleIngestionStatuses[2];
const failedArticleIngestionStatus = articleIngestionStatuses[3];
const processingArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[1];
const linkedArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[2];
const failedArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[3];
const discardedArticleCandidateIngestionStatus = articleCandidateIngestionStatuses[4];

module.exports = {
  articleCandidatePortalNames,
  articleCandidateIngestionStatuses,
  articleIngestionStatuses,
  completedArticleIngestionStatus,
  defaultArticleCandidateIngestionStatus,
  defaultArticleIngestionStatus,
  discardedArticleCandidateIngestionStatus,
  failedArticleIngestionStatus,
  failedArticleCandidateIngestionStatus,
  linkedArticleCandidateIngestionStatus,
  processingArticleIngestionStatus,
  processingArticleCandidateIngestionStatus,
};
