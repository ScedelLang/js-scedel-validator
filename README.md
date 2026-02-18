# @scedel/validator

<img src="https://raw.githubusercontent.com/ScedelLang/grammar/5f1e7572f328d657c726a2fcaeaf53d9f6863d6a/logo.svg" width="250px" alt="logo" />

Pure JS validator for Scedel `SchemaRepository`.

## RFC support

- [Target RFC: `0.14.2`](https://github.com/ScedelLang/grammar/blob/main/RFC-Scedel-0.14.2.md)

## API

```js
import { JsonValidator } from '@scedel/validator';

const validator = new JsonValidator();
const errors = validator.validate(json, repository, 'Root');
```

`validate()` returns `ValidationError[]` with `path`, `message`, `code`, `category`.

## CLI

```bash
node js/scedel-validator/bin/validate-json.mjs '<json>' /absolute/path/schema.scedel
node js/scedel-validator/bin/validate-json.mjs --type Post payload.json /absolute/path/schema.scedel
```
