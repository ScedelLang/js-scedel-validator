import { ValidationError } from './validation-error.js';

export class JsonValidator {
  static SUPPORTED_RFC_VERSIONS = ['0.14.2'];

  validate(jsonInput, repository, rootType = null) {
    let value;
    try {
      value = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
    } catch (error) {
      return [new ValidationError('$', `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`, 'InvalidExpression', 'ParseError')];
    }

    let resolvedRoot;
    try {
      resolvedRoot = repository.resolveRootType(rootType);
    } catch (error) {
      return [new ValidationError('$', error instanceof Error ? error.message : String(error), 'UnknownType', 'TypeError')];
    }

    const errors = [];
    this.#validateAgainstTypeName(value, resolvedRoot, '$', repository, errors, {
      root: value,
      current: value,
      parent: null,
    });

    return errors;
  }

  #validateAgainstTypeName(value, typeName, path, repository, errors, scope) {
    const typeDefinition = repository.getType(typeName);
    if (!typeDefinition) {
      errors.push(new ValidationError(path, `Unknown type: ${typeName}`, 'UnknownType', 'TypeError'));
      return;
    }

    if (typeDefinition.isBuiltin && typeof typeDefinition.matches === 'function') {
      if (!typeDefinition.matches(value)) {
        errors.push(new ValidationError(path, `Expected ${typeName}.`, 'TypeMismatch', 'TypeError'));
      }
      return;
    }

    this.#validateTypeNode(typeDefinition.expr, value, path, repository, errors, scope);
  }

  #validateTypeNode(typeNode, value, path, repository, errors, scope) {
    if (!typeNode || typeof typeNode !== 'object') {
      return;
    }

    switch (typeNode.kind) {
      case 'named': {
        this.#validateNamed(typeNode, value, path, repository, errors, scope);
        return;
      }

      case 'nullableNamed': {
        if (value === null) {
          return;
        }

        this.#validateAgainstTypeName(value, typeNode.name, path, repository, errors, scope);
        return;
      }

      case 'nullable': {
        if (value === null) {
          return;
        }

        this.#validateTypeNode(typeNode.inner, value, path, repository, errors, scope);
        return;
      }

      case 'array': {
        if (!Array.isArray(value)) {
          errors.push(new ValidationError(path, 'Expected array.', 'TypeMismatch', 'TypeError'));
          return;
        }

        for (const constraint of typeNode.constraints) {
          this.#applyConstraint('Array', constraint, value, path, repository, errors, scope);
        }

        for (let i = 0; i < value.length; i++) {
          this.#validateTypeNode(typeNode.itemType, value[i], `${path}[${i}]`, repository, errors, {
            ...scope,
            current: value[i],
            parent: value,
          });
        }
        return;
      }

      case 'record': {
        if (!isObject(value)) {
          errors.push(new ValidationError(path, 'Expected object.', 'TypeMismatch', 'TypeError'));
          return;
        }

        for (const field of typeNode.fields) {
          const hasValue = Object.prototype.hasOwnProperty.call(value, field.name);

          if (!hasValue) {
            if (field.optional || field.defaultExpr !== null) {
              continue;
            }

            if (field.type.kind === 'absent') {
              continue;
            }

            errors.push(new ValidationError(`${path}.${field.name}`, 'Missing required field.', 'FieldMissing', 'ValidationError'));
            continue;
          }

          const fieldValue = value[field.name];
          this.#validateTypeNode(field.type, fieldValue, `${path}.${field.name}`, repository, errors, {
            ...scope,
            current: fieldValue,
            parent: value,
          });
        }

        return;
      }

      case 'dict': {
        if (!isObject(value)) {
          errors.push(new ValidationError(path, 'Expected object/dict.', 'TypeMismatch', 'TypeError'));
          return;
        }

        for (const [entryKey, entryValue] of Object.entries(value)) {
          this.#validateTypeNode(typeNode.keyType, entryKey, `${path}.[key:${entryKey}]`, repository, errors, {
            ...scope,
            current: entryKey,
            parent: value,
          });

          this.#validateTypeNode(typeNode.valueType, entryValue, `${path}.${entryKey}`, repository, errors, {
            ...scope,
            current: entryValue,
            parent: value,
          });
        }

        return;
      }

      case 'union': {
        if (typeNode.members.some((member) => this.#isValid(member, value, repository, scope))) {
          return;
        }

        errors.push(new ValidationError(path, 'Value does not match any union member.', 'TypeMismatch', 'TypeError'));
        return;
      }

      case 'intersection': {
        for (const member of typeNode.members) {
          this.#validateTypeNode(member, value, path, repository, errors, scope);
        }
        return;
      }

      case 'conditional': {
        const matched = evaluateCondition(typeNode.condition, scope.parent ?? scope.root);
        const branch = matched === true ? typeNode.thenType : matched === false ? typeNode.elseType : null;

        if (branch) {
          this.#validateTypeNode(branch, value, path, repository, errors, scope);
          return;
        }

        if (!this.#isValid(typeNode.thenType, value, repository, scope) && !this.#isValid(typeNode.elseType, value, repository, scope)) {
          errors.push(new ValidationError(path, 'Value does not match conditional branches.', 'TypeMismatch', 'TypeError'));
        }

        return;
      }

      case 'literal': {
        if (value !== typeNode.value) {
          errors.push(new ValidationError(path, `Expected literal ${JSON.stringify(typeNode.value)}.`, 'TypeMismatch', 'TypeError'));
        }
        return;
      }

      case 'absent': {
        if (value !== undefined) {
          errors.push(new ValidationError(path, 'Expected field to be absent.', 'FieldMustBeAbsent', 'ValidationError'));
        }
        return;
      }

      default:
        return;
    }
  }

  #validateNamed(typeNode, value, path, repository, errors, scope) {
    this.#validateAgainstTypeName(value, typeNode.name, path, repository, errors, scope);

    for (const constraint of typeNode.constraints ?? []) {
      this.#applyConstraint(typeNode.name, constraint, value, path, repository, errors, scope);
    }
  }

  #applyConstraint(targetType, constraint, value, path, repository, errors, scope) {
    const validator = repository.getValidator(targetType, constraint.name);
    if (!validator) {
      errors.push(new ValidationError(path, `Unknown constraint: ${targetType}.${constraint.name}`, 'UnknownConstraint', 'SemanticError'));
      return;
    }

    if (validator.isBuiltin && typeof validator.evaluate === 'function') {
      const result = validator.evaluate(value, resolveConstraintArgument(constraint));
      if (result === false) {
        errors.push(new ValidationError(path, `Constraint failed: ${targetType}.${constraint.name}`, 'ConstraintViolation', 'ValidationError'));
      }
      return;
    }

    const customResult = evaluateCustomValidator(validator, constraint, value, scope);
    if (customResult === false) {
      errors.push(new ValidationError(path, `Constraint failed: ${targetType}.${constraint.name}`, 'ValidatorFailed', 'ValidationError'));
    }
  }

  #isValid(typeNode, value, repository, scope) {
    const errors = [];
    this.#validateTypeNode(typeNode, value, '$', repository, errors, scope);
    return errors.length === 0;
  }
}

function resolveConstraintArgument(constraint) {
  if (constraint.callArgs && constraint.callArgs.length > 0) {
    if (constraint.callArgs.length === 1) {
      return parseMaybeLiteral(constraint.callArgs[0]);
    }

    return constraint.callArgs.map((arg) => parseMaybeLiteral(arg));
  }

  return constraint.argument;
}

function evaluateCustomValidator(validator, constraint, value, scope) {
  if (!validator.body || typeof validator.body !== 'string') {
    return null;
  }

  const args = {};
  const incomingArgs = constraint.callArgs ?? (constraint.argument !== null ? [constraint.argument] : []);

  validator.params.forEach((param, index) => {
    const raw = incomingArgs[index] ?? param.defaultExpr ?? null;
    args[param.name] = parseMaybeLiteral(raw);
  });

  const body = validator.body.trim();

  const regexNegation = body.match(/^not\s*\(\s*this\s+matches\s+(\/.*\/)\s*\)$/s);
  if (regexNegation) {
    const compiled = compileRegexLiteral(regexNegation[1]);
    return compiled ? !compiled.test(String(value ?? '')) : null;
  }

  const regexMatch = body.match(/^this\s+matches\s+(\/.*\/)$/s);
  if (regexMatch) {
    const compiled = compileRegexLiteral(regexMatch[1]);
    return compiled ? compiled.test(String(value ?? '')) : null;
  }

  const rangeAnd = body.match(/^this\s*([<>]=?)\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+and\s+this\s*([<>]=?)\s*\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (rangeAnd) {
    return compare(value, rangeAnd[1], args[rangeAnd[2]]) && compare(value, rangeAnd[3], args[rangeAnd[4]]);
  }

  const simpleComparison = body.match(/^this\s*(<=|>=|<|>|=|!=)\s*(.+)$/s);
  if (simpleComparison) {
    const right = simpleComparison[2].trim();
    const rightValue = right.startsWith('$')
      ? args[right.slice(1)]
      : parseMaybeLiteral(right);

    return compare(value, simpleComparison[1], rightValue);
  }

  return null;
}

function evaluateCondition(condition, objectValue) {
  if (!isObject(objectValue)) {
    return null;
  }

  const match = condition.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*(=|!=)\s*(.+)$/s);
  if (!match) {
    return null;
  }

  const path = match[1].split('.');
  const expected = parseMaybeLiteral(match[3].trim());

  let current = objectValue;
  for (const segment of path) {
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return false;
    }

    current = current[segment];
  }

  if (match[2] === '=') {
    return current === expected;
  }

  return current !== expected;
}

function compare(left, operator, right) {
  switch (operator) {
    case '<':
      return left < right;
    case '>':
      return left > right;
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
    case '=':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}

function compileRegexLiteral(raw) {
  const match = raw.match(/^\/(.*)\/([a-z]*)$/s);
  if (!match) {
    return null;
  }

  try {
    return new RegExp(match[1], match[2]);
  } catch (_error) {
    return null;
  }
}

function parseMaybeLiteral(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if (trimmed === 'null') {
    return null;
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return decodeStringLiteral(trimmed);
  }

  return trimmed;
}

function decodeStringLiteral(value) {
  let out = '';
  let escaped = false;

  for (let i = 1; i < value.length - 1; i++) {
    const char = value[i];

    if (escaped) {
      if (char === 'n') {
        out += '\n';
      } else if (char === 'r') {
        out += '\r';
      } else if (char === 't') {
        out += '\t';
      } else {
        out += char;
      }
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    out += char;
  }

  return out;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
