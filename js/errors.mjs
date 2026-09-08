export class AppError extends Error {
  constructor(message, code = "INVALID_INPUT", status = 400) {
    super(message); this.name = "AppError"; this.code = code; this.status = status;
  }
}
export function ensure(condition, message, code, status) {
  if (!condition) throw new AppError(message, code, status);
}
export function requireConfirmation(value, expected) {
  ensure(value === expected, "请先确认此次操作", "CONFIRMATION_REQUIRED", 400);
}
