import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepositoryBuilder } from '../../scedel-schema/src/index.js';
import { JsonValidator } from '../src/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, '../../..');
const examplePath = path.join(workspaceRoot, 'example.scedel');
const testJsonPath = path.join(workspaceRoot, 'test.json');

function buildRepository() {
  return new RepositoryBuilder().buildFromFile(examplePath);
}

function buildRepositoryFromString(schema) {
  return new RepositoryBuilder().buildFromString(schema, 'inline.scedel');
}

test('JsonValidator validates OddRangedInt success/failure', () => {
  const repository = buildRepository();
  const validator = new JsonValidator();

  const validErrors = validator.validate('11', repository, 'OddRangedInt');
  assert.equal(validErrors.length, 0);

  const invalidErrors = validator.validate('12', repository, 'OddRangedInt');
  assert.ok(invalidErrors.length > 0);
  assert.equal(invalidErrors[0].code, 'ConstraintViolation');
});

test('JsonValidator reports invalid JSON input', () => {
  const repository = buildRepository();
  const validator = new JsonValidator();

  const errors = validator.validate('{invalid json', repository, 'Post');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'InvalidExpression');
  assert.equal(errors[0].category, 'ParseError');
});

test('JsonValidator reports required field errors for Post', () => {
  const repository = buildRepository();
  const validator = new JsonValidator();
  const payload = fs.readFileSync(testJsonPath, 'utf8');

  const errors = validator.validate(payload, repository, 'Post');
  assert.ok(errors.length > 0);

  assert.ok(errors.some((error) => error.path === '$.id' && error.code === 'TypeMismatch'));
  assert.ok(errors.some((error) => error.path === '$.title' && error.code === 'FieldMissing'));
});

test('JsonValidator reports unknown constraint', () => {
  const repository = buildRepositoryFromString(`
type Root = {
  value: Int(unknownRule: 1)
}
`);
  const validator = new JsonValidator();

  const errors = validator.validate('{"value":10}', repository, 'Root');
  assert.ok(errors.length > 0);
  assert.equal(errors[0].code, 'UnknownConstraint');
  assert.equal(errors[0].category, 'SemanticError');
});

test('JsonValidator reports FieldMustBeAbsent for conditional absent', () => {
  const repository = buildRepositoryFromString(`
type Root = {
  status: "Rejected" | "Draft"
  reason: when status = "Rejected" then String(min:3) else absent
}
`);
  const validator = new JsonValidator();

  const errors = validator.validate('{"status":"Draft","reason":"because"}', repository, 'Root');
  assert.ok(errors.some((error) => error.code === 'FieldMustBeAbsent'));
});

test('JsonValidator declares supported RFC version', () => {
  assert.ok(JsonValidator.SUPPORTED_RFC_VERSIONS.includes('0.14.2'));
});
