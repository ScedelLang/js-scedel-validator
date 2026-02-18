# @scedel/validator

Pure JS validator for SCEDel `SchemaRepository`.

## RFC support

- Target RFC: `0.14.2`

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
