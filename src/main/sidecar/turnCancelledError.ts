export class TurnCancelledError extends Error {
  constructor() {
    super('The turn was cancelled.');
    this.name = 'TurnCancelledError';
  }
}
