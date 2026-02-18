export class ValidationError {
  constructor(path, message, code = 'InvalidExpression', category = 'ValidationError') {
    this.path = path;
    this.message = message;
    this.code = code;
    this.category = category;
  }
}
