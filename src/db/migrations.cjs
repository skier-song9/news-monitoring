'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const migrationDirectory = path.join(__dirname, '..', '..', 'db', 'migrations');

function listMigrationFiles() {
  return readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(migrationDirectory, fileName));
}

function applyMigrations(db) {
  for (const migrationFile of listMigrationFiles()) {
    db.exec(readFileSync(migrationFile, 'utf8'));
  }
}

module.exports = {
  applyMigrations,
  listMigrationFiles,
  migrationDirectory,
};
