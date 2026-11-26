export const SESSION_DOUBLE_CLICK_MS = 400;

export type SessionActivation = 'select' | 'open';

/** Tracks clicks explicitly so native double-click detection cannot drop activation. */
export class SessionActivationTracker {
  private lastClick?: { profileId: string; time: number };

  click(profileId: string, time = Date.now()): SessionActivation {
    const previous = this.lastClick;
    const isSecondClick = previous?.profileId === profileId
      && time >= previous.time
      && time - previous.time <= SESSION_DOUBLE_CLICK_MS;
    this.lastClick = isSecondClick ? undefined : { profileId, time };
    return isSecondClick ? 'open' : 'select';
  }

  openByKeyboard(): SessionActivation {
    return 'open';
  }

  reset(): void {
    this.lastClick = undefined;
  }
}
