export class RelayError extends Error {
  constructor(
    public readonly status: 400 | 401 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = "RelayError";
  }
}

export const notFound = () => new RelayError(404, "Form not found.");
