#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { RepositoryBuilder } from '../../scedel-schema/src/index.js';
import { JsonValidator } from '../src/index.js';

const args = process.argv.slice(2);

let type = null;
const positionals = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg.startsWith('--type=')) {
    type = arg.slice('--type='.length);
    continue;
  }

  if (arg === '--type') {
    type = args[i + 1] ?? null;
    i++;
    continue;
  }

  positionals.push(arg);
}

if (positionals.length !== 2) {
  console.error('Usage:');
  console.error('  validate-json [--type RootType] <json-or-json-file> <schema.scedel>');
  process.exit(2);
}

const jsonInput = loadJsonInput(positionals[0]);
const schemaPath = path.resolve(positionals[1]);

try {
  const repository = new RepositoryBuilder().buildFromFile(schemaPath);
  const validator = new JsonValidator();
  const errors = validator.validate(jsonInput, repository, type);

  if (errors.length === 0) {
    console.log('JSON is valid.');
    process.exit(0);
  }

  console.error('Validation failed:');
  for (const error of errors) {
    console.error(`- ${error.path}: ${error.message}`);
  }

  process.exit(1);
} catch (error) {
  console.error('Failed to validate JSON:');
  console.error(`- ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

function loadJsonInput(input) {
  const resolvedPath = path.resolve(input);
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    return fs.readFileSync(resolvedPath, 'utf8');
  }

  return input;
}
