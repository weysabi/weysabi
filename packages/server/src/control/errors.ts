export class ControlError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "ControlError";
  }
}

export class ProjectNotFoundError extends ControlError {
  constructor(id: string) {
    super(`Project "${id}" not found`, "PROJECT_NOT_FOUND", 404);
  }
}

export class ProjectSlugConflictError extends ControlError {
  constructor(slug: string) {
    super(`Project slug "${slug}" is already taken`, "PROJECT_SLUG_CONFLICT", 409);
  }
}

export class ControlResourceNotFoundError extends ControlError {
  constructor(resource: string, id: string, code: string) {
    super(`${resource} "${id}" not found`, code, 404);
  }
}

export class ControlConflictError extends ControlError {
  constructor(message: string, code: string) {
    super(message, code, 409);
  }
}
