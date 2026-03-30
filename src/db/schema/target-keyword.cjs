'use strict';

const defaultTargetKeywordDisplayOrder = 0;
const defaultTargetKeywordIsActive = 1;
const seedTargetKeywordSourceType = 'seed';
const expandedTargetKeywordSourceType = 'expanded';
const excludedTargetKeywordSourceType = 'excluded';
const targetKeywordSourceTypes = [
  seedTargetKeywordSourceType,
  expandedTargetKeywordSourceType,
  excludedTargetKeywordSourceType,
];

module.exports = {
  defaultTargetKeywordDisplayOrder,
  defaultTargetKeywordIsActive,
  expandedTargetKeywordSourceType,
  excludedTargetKeywordSourceType,
  seedTargetKeywordSourceType,
  targetKeywordSourceTypes,
};
